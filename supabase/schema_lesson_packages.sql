-- 레슨권(패키지) 템플릿 테이블
-- 코치가 미리 등록해두는 레슨 타입 (제목, 요일, 가격, 횟수)

create table if not exists lesson_packages (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  title text not null,                          -- 예: "주 2회 60분 패키지"
  days integer[] not null default '{}',         -- 요일 배열 (0=일, 1=월, ..., 6=토)
  price integer not null default 0,             -- 가격 (원)
  total_credits integer not null default 10,    -- 기본 횟수
  duration_minutes integer not null default 60, -- 레슨 시간 (분)
  color text not null default '#1a7a4a',        -- 카드 색상
  is_active boolean not null default true,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table lesson_packages enable row level security;
create policy "coaches own lesson_packages" on lesson_packages
  for all using (auth.uid() = coach_id);
create trigger lesson_packages_updated_at
  before update on lesson_packages
  for each row execute function update_updated_at();

-- members 테이블에 lesson_package_id 컬럼 추가
alter table members add column if not exists lesson_package_id uuid references lesson_packages(id) on delete set null;
