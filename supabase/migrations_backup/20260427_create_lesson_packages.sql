-- 레슨권(패키지) 템플릿 테이블
create table if not exists lesson_packages (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  days integer[] not null default '{}',
  price integer not null default 0,
  total_credits integer not null default 10,
  duration_minutes integer not null default 60,
  color text not null default '#1a7a4a',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table lesson_packages enable row level security;

drop policy if exists "coaches own lesson_packages" on lesson_packages;
create policy "coaches own lesson_packages" on lesson_packages
  for all using (auth.uid() = coach_id);

-- updated_at 자동 갱신 트리거 (update_updated_at 함수가 이미 있다면)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at') then
    execute 'create trigger lesson_packages_updated_at before update on lesson_packages for each row execute function update_updated_at()';
  end if;
exception when others then null;
end $$;

-- members 테이블에 lesson_package_id 컬럼 추가 (없으면)
alter table members add column if not exists lesson_package_id uuid references lesson_packages(id) on delete set null;
