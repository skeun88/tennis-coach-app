-- Tennis Coach App - Supabase Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Members table
create table members (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  phone text not null,
  email text,
  birth_date date,
  level text not null default '초급' check (level in ('입문', '초급', '중급', '고급', '선수')),
  join_date date not null default current_date,
  notes text,
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Lessons table
create table lessons (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  location text,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Lesson members (many-to-many)
create table lesson_members (
  id uuid default uuid_generate_v4() primary key,
  lesson_id uuid references lessons(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  unique(lesson_id, member_id)
);

-- Attendance table
create table attendance (
  id uuid default uuid_generate_v4() primary key,
  lesson_id uuid references lessons(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  status text not null default '출석' check (status in ('출석', '결석', '지각', '조퇴')),
  notes text,
  created_at timestamptz default now() not null,
  unique(lesson_id, member_id)
);

-- Payments table
create table payments (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  amount integer not null,
  paid_amount integer not null default 0,
  due_date date not null,
  paid_date date,
  status text not null default '미납' check (status in ('납부완료', '미납', '부분납부')),
  description text not null,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Member notes table
create table member_notes (
  id uuid default uuid_generate_v4() primary key,
  member_id uuid references members(id) on delete cascade not null,
  coach_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Row Level Security (RLS)
alter table members enable row level security;
alter table lessons enable row level security;
alter table lesson_members enable row level security;
alter table attendance enable row level security;
alter table payments enable row level security;
alter table member_notes enable row level security;

-- RLS Policies: coach can only access their own data
create policy "coaches own members" on members for all using (auth.uid() = coach_id);
create policy "coaches own lessons" on lessons for all using (auth.uid() = coach_id);
create policy "coaches own lesson_members" on lesson_members for all
  using (exists (select 1 from lessons where lessons.id = lesson_id and lessons.coach_id = auth.uid()));
create policy "coaches own attendance" on attendance for all
  using (exists (select 1 from lessons where lessons.id = lesson_id and lessons.coach_id = auth.uid()));
create policy "coaches own payments" on payments for all using (auth.uid() = coach_id);
create policy "coaches own member_notes" on member_notes for all using (auth.uid() = coach_id);

-- Updated_at trigger function
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger members_updated_at before update on members for each row execute function update_updated_at();
create trigger lessons_updated_at before update on lessons for each row execute function update_updated_at();
create trigger payments_updated_at before update on payments for each row execute function update_updated_at();
create trigger member_notes_updated_at before update on member_notes for each row execute function update_updated_at();

-- ============================================================
-- KERRI MVP v2 additions
-- ============================================================

-- 횟수권 패키지 테이블
create table if not exists lesson_credits (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  total_credits integer not null default 0,
  remaining_credits integer not null default 0,
  package_name text not null default '기본 패키지',
  purchase_date date not null default current_date,
  expiry_date date,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table lesson_credits enable row level security;
create policy "coaches own lesson_credits" on lesson_credits for all using (auth.uid() = coach_id);
create trigger lesson_credits_updated_at before update on lesson_credits for each row execute function update_updated_at();

-- attendance에 deduct_credit 컬럼 추가
alter table attendance add column if not exists deduct_credit boolean not null default true;

-- 상호 체크 확인 테이블
create table if not exists lesson_check_confirmations (
  id uuid default uuid_generate_v4() primary key,
  attendance_id uuid references attendance(id) on delete cascade not null,
  coach_checked_at timestamptz,
  member_confirmed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed')),
  created_at timestamptz default now() not null
);
alter table lesson_check_confirmations enable row level security;
create policy "coaches own confirmations" on lesson_check_confirmations for all
  using (exists (
    select 1 from attendance a
    join lessons l on l.id = a.lesson_id
    where a.id = attendance_id and l.coach_id = auth.uid()
  ));
