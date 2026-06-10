-- ─────────────────────────────────────────────
-- member_notifications: 코치 → 회원 인앱 알림 테이블
-- ─────────────────────────────────────────────
create table if not exists member_notifications (
  id            uuid default gen_random_uuid() primary key,
  coach_id      uuid references auth.users(id) on delete cascade not null,
  member_id     uuid references members(id) on delete cascade not null,
  title         text not null,
  body          text not null,
  type          text not null default 'reregister'
                  check (type in ('reregister', 'churn_risk', 'general')),
  is_read       boolean not null default false,
  created_at    timestamptz default now() not null
);

alter table member_notifications enable row level security;

-- 코치만 자신의 회원에게 보낸 알림을 관리
create policy "coaches manage own notifications"
  on member_notifications for all
  using (auth.uid() = coach_id);

-- ─────────────────────────────────────────────
-- member_push_tokens: 회원 앱 푸시 토큰 저장
-- (회원 앱 구현 시 활성화; 현재는 테이블만 준비)
-- ─────────────────────────────────────────────
create table if not exists member_push_tokens (
  id         uuid default gen_random_uuid() primary key,
  member_id  uuid references members(id) on delete cascade not null unique,
  push_token text not null,
  platform   text check (platform in ('ios', 'android')),
  updated_at timestamptz default now() not null
);

alter table member_push_tokens enable row level security;

-- 코치가 자신 회원의 토큰 읽기 허용 (알림 발송 목적)
create policy "coaches read member push tokens"
  on member_push_tokens for select
  using (
    exists (
      select 1 from members m
      where m.id = member_id and m.coach_id = auth.uid()
    )
  );
