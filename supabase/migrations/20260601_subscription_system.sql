-- =============================================
-- 월구독 시스템 마이그레이션
-- =============================================

-- 1. 플랜 정의 테이블
create table if not exists subscription_plans (
  id text primary key,
  name text not null,
  price integer not null,
  features jsonb not null,
  created_at timestamptz default now()
);

insert into subscription_plans (id, name, price, features) values
  ('basic', 'Basic', 29000, '{"member_management": true, "ai_analysis": false, "reports": false, "profile": false, "tagging": false}'),
  ('pro', 'Pro', 49000, '{"member_management": true, "ai_analysis": true, "reports": true, "profile": true, "tagging": true}')
on conflict (id) do nothing;

-- 2. 구독 테이블
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references auth.users(id) on delete cascade not null unique,
  plan_id text references subscription_plans(id) not null,
  status text not null default 'trial',
  -- status: trial | active | past_due | cancelled | blocked
  trial_starts_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  toss_billing_key text,
  toss_customer_key text,
  pending_plan_id text references subscription_plans(id),
  -- 다운그레이드 예약 시 사용
  downgrade_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. 결제 이력 테이블
create table if not exists subscription_logs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade not null,
  coach_id uuid references auth.users(id) not null,
  event_type text not null,
  -- payment_success | payment_failed | plan_changed | trial_started | trial_ended | cancelled | blocked | upgrade | downgrade_scheduled
  amount integer,
  plan_id text,
  toss_payment_key text,
  toss_order_id text,
  metadata jsonb,
  created_at timestamptz default now()
);

-- 4. RLS 정책
alter table subscriptions enable row level security;
alter table subscription_plans enable row level security;
alter table subscription_logs enable row level security;

-- 코치는 자신의 구독만
create policy "coach own subscription" on subscriptions
  for all using (auth.uid() = coach_id);

-- 플랜은 모두 읽기 가능
create policy "plans readable by all" on subscription_plans
  for select using (true);

-- 코치는 자신의 로그만
create policy "coach own logs" on subscription_logs
  for all using (auth.uid() = coach_id);

-- 5. updated_at 자동 업데이트 트리거
create or replace function update_subscription_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger subscription_updated_at
  before update on subscriptions
  for each row execute function update_subscription_updated_at();

-- 6. 회원앱에서 코치 플랜 조회용 뷰 (public)
-- 회원앱에서 소속 코치의 플랜만 조회 가능
create or replace view coach_subscription_public as
  select
    s.coach_id,
    s.plan_id,
    s.status,
    p.features
  from subscriptions s
  join subscription_plans p on p.id = s.plan_id;

-- 회원용: 자신의 레슨 코치 구독 조회
create policy "member can view their coach subscription" on subscriptions
  for select using (
    coach_id in (
      select distinct l.coach_id
      from lesson_members lm
      join lessons l on l.id = lm.lesson_id
      join members m on m.id = lm.member_id
      where m.auth_user_id = auth.uid()
    )
  );
