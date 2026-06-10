-- QR 온보딩: 잠재 회원 관심 레슨권 저장
create table if not exists member_interest (
  id uuid default gen_random_uuid() primary key,
  coach_id uuid references auth.users(id) on delete cascade,
  name text,
  phone text,
  package_id uuid references lesson_packages(id) on delete set null,
  status text default 'pending'
    check (status in ('pending', 'registered', 'dismissed')),
  created_at timestamptz default now()
);

alter table member_interest enable row level security;

create policy "coaches manage own interests"
  on member_interest for all
  using (auth.uid() = coach_id);

create policy "anyone can insert interest"
  on member_interest for insert
  with check (true);
