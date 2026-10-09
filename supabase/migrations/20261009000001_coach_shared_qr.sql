-- ============================================================
-- 코치 공용 QR v1 — 통합 마이그레이션 (검토용, 아직 적용 안 함)
-- 전부 추가형. 기존 members.invite_code / verify-invite-code / auth_user_id 불변.
-- coach FK = public.coach_profiles(coach_id) (UNIQUE) → 일반 회원 계정의 발급 차단.
-- pgcrypto는 extensions 스키마에 설치됨 → extensions.gen_random_bytes 명시 호출.
-- DDL은 트랜잭션 안에서 실행(실패 시 전체 롤백).
-- ============================================================
begin;

-- ── 1. 테이블 ────────────────────────────────────────────────
create table public.coach_invite_links (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(coach_id) on delete cascade,
  token text not null check (token ~ '^[A-Za-z0-9_-]{43}$'),
  connect_code text not null check (connect_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index coach_invite_links_token_key on public.coach_invite_links(token);
create unique index coach_invite_links_connect_code_key on public.coach_invite_links(connect_code);
create unique index coach_invite_links_one_active on public.coach_invite_links(coach_id) where is_active;

create table public.member_connection_requests (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(coach_id) on delete cascade,
  request_id uuid not null,   -- 클라가 보안난수 UUID 생성, 엣지에서 형식 검증
  member_name text not null check (char_length(btrim(member_name)) between 1 and 60),
  phone_raw text check (phone_raw is null or char_length(phone_raw) <= 32),
  phone_norm text check (phone_norm is null or phone_norm ~ '^01[016789][0-9]{7,8}$'),
  status text not null default 'pending'
    check (status in ('pending','processed','rejected','cancelled')),
  process_type text check (process_type in ('existing_member','new_member')),
  matched_member_id uuid references public.members(id) on delete set null,
  processed_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('qr','connect_code','web_invite','shared_link')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint mcr_pending_phone_required check (
    status <> 'pending'
    or (phone_raw is not null and btrim(phone_raw) <> '' and phone_norm is not null))
);
create unique index mcr_coach_request_key on public.member_connection_requests(coach_id, request_id);
create unique index mcr_pending_dedup on public.member_connection_requests(coach_id, phone_norm)
  where status='pending' and phone_norm is not null;
create index mcr_coach_status_idx on public.member_connection_requests(coach_id, status);

create table public.invite_throttle (
  key text not null,            -- 'ip:'||h | 'phone:'||h | 'invite:'||h  (h=sha256(값+SALT), 엣지에서 해시)
  window_start timestamptz not null,
  count int not null default 0 check (count >= 0),
  primary key (key, window_start)
);

-- ── 2. RLS (코치 SELECT만, 쓰기는 함수/service role) ──────────
alter table public.coach_invite_links enable row level security;
create policy "coach reads own link" on public.coach_invite_links
  for select using (coach_id = auth.uid());

alter table public.member_connection_requests enable row level security;
create policy "coach reads own requests" on public.member_connection_requests
  for select using (coach_id = auth.uid());

alter table public.invite_throttle enable row level security;  -- 정책 없음

-- ── 3. 테이블 GRANT/REVOKE (RLS와 별개 권한 명시) ─────────────
revoke all on public.coach_invite_links from anon, authenticated;
grant select on public.coach_invite_links to authenticated;                -- 코치 앱 조회
grant select on public.coach_invite_links to service_role;                 -- get-coach-by-invite 엣지
revoke all on public.member_connection_requests from anon, authenticated;
grant select on public.member_connection_requests to authenticated;        -- 코치 앱 조회
grant select, insert on public.member_connection_requests to service_role; -- request-connection 엣지
revoke all on public.invite_throttle from anon, authenticated;   -- 직접접근 없음(bump SECURITY DEFINER만)
-- get-coach-by-invite 엣지가 service_role로 coach_profiles를 SELECT함. 신규 프로젝트는
-- default privilege로 service_role DML을 안 주므로(스테이징에서 실측 확인) 명시 grant 필요.
grant select on public.coach_profiles to service_role;                     -- get-coach-by-invite 엣지

-- ── 4. updated_at 트리거 (기존 공통함수 재사용) ───────────────
create trigger coach_invite_links_set_updated before update on public.coach_invite_links
  for each row execute function public.update_updated_at();
create trigger mcr_set_updated before update on public.member_connection_requests
  for each row execute function public.update_updated_at();

-- ── 5. 유틸 함수 ─────────────────────────────────────────────
-- connect_code 생성: CSPRNG(extensions.gen_random_bytes) 8자, 혼동문자 제외.
-- 알파벳 32자 & 256 % 32 = 0 → 모듈러 편향 없음(균일).
create or replace function public._gen_connect_code()
returns text language plpgsql volatile set search_path=public, pg_temp as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; r text := ''; b bytea; i int;
begin
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop
    r := r || substr(a, (get_byte(b, i) % length(a)) + 1, 1);
  end loop;
  return r;
end $$;
revoke all on function public._gen_connect_code() from public;  -- definer 내부 전용

-- 한국 휴대전화 정규화
create or replace function public.normalize_kr_phone(p text)
returns text language plpgsql immutable set search_path=public, pg_temp as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');                     -- 숫자만
  if left(d,2) = '82' then d := '0' || substr(d, 3); end if; -- +82 → 0
  if d ~ '^01[016789][0-9]{7,8}$' then return d; end if;
  return null;                                               -- 형식 불일치
end $$;
revoke all on function public.normalize_kr_phone(text) from public;
grant execute on function public.normalize_kr_phone(text) to service_role;

-- ── 6. SECURITY DEFINER 함수 ─────────────────────────────────
-- (A) 코치 공용 초대 링크 발급/재발급 (코치 RPC)
--   [✓고정 search_path][✓auth.uid()검증][✓코치 계정 검증(coach_profiles)][✓PUBLIC revoke]
--   [✓authenticated grant][✓코치단위 advisory lock(동시발급 직렬화)][✓활성1개(부분unique)]
--   [✓token base64url CSPRNG][✓connect_code CSPRNG][✓충돌 재생성 상한 10][예외시 전체 롤백]
create or replace function public.issue_coach_invite_link(p_reissue boolean default false)
returns public.coach_invite_links
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_coach uuid := auth.uid(); v_row public.coach_invite_links; v_code text; v_token text; v_try int := 0;
begin
  if v_coach is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from coach_profiles where coach_id = v_coach) then
    raise exception 'not_a_coach';                           -- 코치 프로필 없는 계정 거부
  end if;
  -- 코치 단위 트랜잭션 advisory lock → 동시 발급 직렬화
  perform pg_advisory_xact_lock(hashtext('coach_invite:' || v_coach::text)::bigint);
  if not p_reissue then
    select * into v_row from coach_invite_links where coach_id=v_coach and is_active limit 1;
    if found then return v_row; end if;                      -- (잠금 후) 기존 활성 재사용
  else
    update coach_invite_links set is_active=false, updated_at=now()
      where coach_id=v_coach and is_active;                  -- 재발급: 기존 즉시 무효
  end if;
  loop
    v_try := v_try + 1;
    if v_try > 10 then raise exception 'code_generation_failed'; end if;
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');  -- base64url
    v_code  := public._gen_connect_code();
    begin
      insert into coach_invite_links(coach_id,token,connect_code)
        values (v_coach,v_token,v_code) returning * into v_row;
      return v_row;
    exception when unique_violation then continue; end;
  end loop;
end $$;
revoke all on function public.issue_coach_invite_link(boolean) from public;
grant execute on function public.issue_coach_invite_link(boolean) to authenticated;

-- (B) 연결 요청 처리/거절/취소 (코치 RPC)
--   [✓고정 search_path][✓auth.uid()검증][✓PUBLIC revoke][✓authenticated grant]
--   [✓요청 coach 소유 검증][✓matched_member 코치 소유 검증][✓processed_by=auth.uid()]
--   [✓existing/new member 필수][✓processed_at 서버시간][✓pending만 처리(재처리 차단)][행잠금][예외시 전체 롤백]
create or replace function public.process_connection_request(
  p_id uuid, p_action text, p_member_id uuid default null)
returns public.member_connection_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_coach uuid := auth.uid(); v_req public.member_connection_requests;
begin
  if v_coach is null then raise exception 'unauthorized'; end if;
  select * into v_req from member_connection_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_req.coach_id <> v_coach then raise exception 'forbidden'; end if;
  if v_req.status <> 'pending' then raise exception 'already_%', v_req.status; end if;
  if p_action in ('process_existing','process_new') then
    if p_member_id is null then raise exception 'member_required'; end if;
    perform 1 from members where id = p_member_id and coach_id = v_coach;
    if not found then raise exception 'member_not_owned'; end if;
    update member_connection_requests set status='processed',
      process_type = case when p_action='process_existing' then 'existing_member' else 'new_member' end,
      matched_member_id = p_member_id, processed_by = v_coach, processed_at = now()
      where id = p_id returning * into v_req;
  elsif p_action = 'reject' then
    update member_connection_requests set status='rejected', processed_by=v_coach, processed_at=now()
      where id=p_id returning * into v_req;
  elsif p_action = 'cancel' then
    update member_connection_requests set status='cancelled', processed_by=v_coach, processed_at=now()
      where id=p_id returning * into v_req;
  else raise exception 'bad_action'; end if;
  return v_req;
end $$;
revoke all on function public.process_connection_request(uuid,text,uuid) from public;
grant execute on function public.process_connection_request(uuid,text,uuid) to authenticated;

-- (C) 레이트리밋 원자적 증가 (service_role 전용)
--   [✓고정 search_path][✓PUBLIC revoke][✓service_role EXECUTE only][예외시 전체 롤백]
create or replace function public.bump_invite_throttle(p_key text, p_window timestamptz, p_limit int)
returns boolean language plpgsql security definer set search_path=public, pg_temp as $$
declare v_count int;
begin
  insert into invite_throttle(key, window_start, count) values (p_key, p_window, 1)
    on conflict (key, window_start) do update set count = invite_throttle.count + 1
    returning count into v_count;
  return v_count <= p_limit;      -- true=허용, false=초과(429)
end $$;
revoke all on function public.bump_invite_throttle(text,timestamptz,int) from public;
grant execute on function public.bump_invite_throttle(text,timestamptz,int) to service_role;

-- ── 7. 정리(cleanup) 함수 — 모두 processed_at 기준 ────────────
create or replace function public.cleanup_invite_throttle()
returns void language sql security definer set search_path=public, pg_temp as $$
  delete from public.invite_throttle where window_start < now() - interval '1 day';
$$;
revoke all on function public.cleanup_invite_throttle() from public;

-- rejected/cancelled/processed: processed_at+30일 후 전화 NULL
-- rejected/cancelled: processed_at+90일 후 행 삭제
create or replace function public.cleanup_connection_requests()
returns void language sql security definer set search_path=public, pg_temp as $$
  update public.member_connection_requests set phone_raw=null, phone_norm=null
    where status in ('rejected','cancelled','processed')
      and processed_at is not null and processed_at < now() - interval '30 days'
      and (phone_raw is not null or phone_norm is not null);
  delete from public.member_connection_requests
    where status in ('rejected','cancelled')
      and processed_at is not null and processed_at < now() - interval '90 days';
$$;
revoke all on function public.cleanup_connection_requests() from public;

commit;

-- ── 8. pg_cron 스케줄 (pg_cron 설치됨=cron 스키마, 트랜잭션 밖에서 별도 실행) ──
-- select cron.schedule('cleanup-invite-throttle','*/30 * * * *','select public.cleanup_invite_throttle()');
-- select cron.schedule('cleanup-connection-requests','17 3 * * *','select public.cleanup_connection_requests()');

-- ============================================================
-- 롤백(스테이징, 데이터 없을 때): 아래 전부 drop. 운영은 drop 금지(피처플래그 off).
-- begin;
-- drop function if exists public.cleanup_connection_requests();
-- drop function if exists public.cleanup_invite_throttle();
-- drop function if exists public.bump_invite_throttle(text,timestamptz,int);
-- drop function if exists public.process_connection_request(uuid,text,uuid);
-- drop function if exists public.issue_coach_invite_link(boolean);
-- drop function if exists public.normalize_kr_phone(text);
-- drop function if exists public._gen_connect_code();
-- drop table if exists public.invite_throttle;
-- drop table if exists public.member_connection_requests;
-- drop table if exists public.coach_invite_links;
-- commit;
-- ============================================================
