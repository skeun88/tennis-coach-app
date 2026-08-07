-- ─────────────────────────────────────────────
-- coach_push_tokens: 코치 앱 푸시 토큰 저장
-- ─────────────────────────────────────────────
create table if not exists coach_push_tokens (
  id         uuid default gen_random_uuid() primary key,
  coach_id   uuid references auth.users(id) on delete cascade not null unique,
  push_token text not null,
  platform   text check (platform in ('ios', 'android')),
  updated_at timestamptz default now() not null
);

alter table coach_push_tokens enable row level security;

create policy "coaches manage own push token"
  on coach_push_tokens for all
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- ─────────────────────────────────────────────
-- member_push_tokens RLS 추가
-- (기존 테이블에 회원이 자신의 토큰을 등록할 수 있도록)
-- ─────────────────────────────────────────────
create policy "members manage own push token"
  on member_push_tokens for all
  using (
    exists (
      select 1 from members
      where members.id = member_push_tokens.member_id
        and members.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from members
      where members.id = member_push_tokens.member_id
        and members.auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- notification_logs: 중복 발송 방지
-- (lesson_id + notif_id + recipient_id 조합 유니크)
-- ─────────────────────────────────────────────
create table if not exists notification_logs (
  id           uuid default gen_random_uuid() primary key,
  lesson_id    uuid,
  notif_id     text not null,
  recipient_id uuid not null,
  sent_at      timestamptz default now() not null,
  unique (lesson_id, notif_id, recipient_id)
);

alter table notification_logs enable row level security;

-- ─────────────────────────────────────────────
-- notification_settings: 사용자별 알림 수신 설정
-- ─────────────────────────────────────────────
create table if not exists notification_settings (
  id                  uuid default gen_random_uuid() primary key,
  coach_id            uuid references auth.users(id) on delete cascade unique,
  member_id           uuid references members(id) on delete cascade unique,
  user_type           text not null check (user_type in ('coach', 'member')),
  -- 공통
  lesson_day_before   boolean not null default true,
  lesson_hour_before  boolean not null default true,
  -- 코치 전용
  member_message      boolean not null default true,
  reregister_alert    boolean not null default true,
  -- 회원 전용
  ai_report           boolean not null default true,
  coach_message       boolean not null default true,
  schedule_change     boolean not null default true,
  lesson_cancel       boolean not null default true,
  lesson_count_update boolean not null default true,
  updated_at          timestamptz default now() not null,
  constraint check_one_user_type check (
    (coach_id is not null and member_id is null and user_type = 'coach') or
    (member_id is not null and coach_id is null and user_type = 'member')
  )
);

alter table notification_settings enable row level security;

create policy "coaches manage own notification settings"
  on notification_settings for all
  using (user_type = 'coach' and auth.uid() = coach_id)
  with check (user_type = 'coach' and auth.uid() = coach_id);

create policy "members manage own notification settings"
  on notification_settings for all
  using (
    user_type = 'member' and exists (
      select 1 from members
      where members.id = notification_settings.member_id
        and members.auth_user_id = auth.uid()
    )
  )
  with check (
    user_type = 'member' and exists (
      select 1 from members
      where members.id = notification_settings.member_id
        and members.auth_user_id = auth.uid()
    )
  );
