-- ─────────────────────────────────────────────
-- coach_availability: 코치 레슨 가능 시간대 설정
-- available_days: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
-- ─────────────────────────────────────────────
create table if not exists coach_availability (
  id              uuid default gen_random_uuid() primary key,
  coach_id        uuid references auth.users(id) on delete cascade not null unique,
  available_days  integer[] not null default '{1,2,3,4,5}',
  available_start time not null default '09:00',
  available_end   time not null default '18:00',
  updated_at      timestamptz default now() not null
);

alter table coach_availability enable row level security;

create policy "coaches manage own availability"
  on coach_availability for all
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- 회원이 코치 가용시간 조회 가능
create policy "members read coach availability"
  on coach_availability for select
  using (true);
