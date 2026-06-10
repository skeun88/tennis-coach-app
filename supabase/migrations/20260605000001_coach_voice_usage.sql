-- Coach Voice Usage: 월별 음성 녹음 사용량 추적
-- 음성 입력 월 30분(1800초) 제한

create table if not exists coach_voice_usage (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  year_month text not null, -- 'YYYY-MM' 형식
  used_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_coach_month unique (coach_id, year_month)
);

-- RLS
alter table coach_voice_usage enable row level security;

-- 코치 본인만 자신의 사용량 조회/수정 가능
drop policy if exists "coach_own_voice_usage_select" on coach_voice_usage;
create policy "coach_own_voice_usage_select"
  on coach_voice_usage for select
  using (coach_id = auth.uid());

drop policy if exists "coach_own_voice_usage_insert" on coach_voice_usage;
create policy "coach_own_voice_usage_insert"
  on coach_voice_usage for insert
  with check (coach_id = auth.uid());

drop policy if exists "coach_own_voice_usage_update" on coach_voice_usage;
create policy "coach_own_voice_usage_update"
  on coach_voice_usage for update
  using (coach_id = auth.uid());

-- updated_at 자동 갱신 트리거
create or replace function update_coach_voice_usage_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coach_voice_usage_updated_at on coach_voice_usage;
create trigger coach_voice_usage_updated_at
  before update on coach_voice_usage
  for each row execute function update_coach_voice_usage_timestamp();
