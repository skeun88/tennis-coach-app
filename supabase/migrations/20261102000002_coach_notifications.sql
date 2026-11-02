-- ─────────────────────────────────────────────
-- coach_notifications: 코치 인앱 알림함
-- send-push 에서 recipient_type='coach' 발송 시 저장
-- ─────────────────────────────────────────────
create table if not exists coach_notifications (
  id             uuid default gen_random_uuid() primary key,
  coach_id       uuid references auth.users(id) on delete cascade not null,
  title          text not null,
  body           text not null,
  type           text not null default 'general'
                   check (type in ('lesson_reminder', 'member_message', 'general')),
  is_read        boolean not null default false,
  reference_id   uuid,
  reference_type text check (reference_type in ('lesson', 'member') or reference_type is null),
  created_at     timestamptz default now() not null
);

alter table coach_notifications enable row level security;

-- 코치 본인 알림만 조회·수정 가능
create policy "coaches read own notifications"
  on coach_notifications for select
  using (auth.uid() = coach_id);

create policy "coaches update own notifications"
  on coach_notifications for update
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- service_role 이 insert (Edge Function 사용)
-- (service_role bypasses RLS by default)
