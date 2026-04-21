-- ============================================================
-- Tennis Coach App - V2 스키마 업그레이드
-- 기존 schema.sql + schema_ai.sql 실행 후 이 파일 실행
-- ============================================================

-- ============================================================
-- 1. members 테이블 확장 (레벨 세분화 + 프로파일)
-- ============================================================

-- 기존 level 컬럼 constraint 수정
alter table members drop constraint if exists members_level_check;
alter table members add constraint members_level_check
  check (level in ('완전초보', '초급', '초중급', '중급', '중고급', '고급'));

-- 레벨 기본값 변경
alter table members alter column level set default '초급';

-- 프로파일 확장 컬럼 추가
alter table members
  add column if not exists dominant_hand text default '오른손' check (dominant_hand in ('오른손', '왼손')),
  add column if not exists backhand_type text default '양손' check (backhand_type in ('양손', '한손')),
  add column if not exists goal text default '취미' check (goal in ('취미', '건강', '대회출전', '심화기술')),
  add column if not exists injury_history text,          -- 부상 이력 (자유 텍스트)
  add column if not exists weak_points text[],           -- 약점 목록 ['백핸드', '서브', '풋워크']
  add column if not exists lesson_count integer default 0, -- 누적 레슨 횟수
  add column if not exists court_type text default '풀코트' -- 주로 사용하는 코트
    check (court_type in ('상가미니', '하프코트', '풀코트실내', '풀코트야외', '멀티코트'));

-- ============================================================
-- 2. coach_profile 테이블 (코치 환경 설정)
-- ============================================================
create table if not exists coach_profiles (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null unique,
  display_name text,
  default_court_type text default '풀코트야외'
    check (default_court_type in ('상가미니', '하프코트', '풀코트실내', '풀코트야외', '멀티코트')),
  academy_name text,
  specialties text[],           -- ['청소년', '성인초보', '대회선수']
  coaching_style text,          -- 자유 텍스트
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table coach_profiles enable row level security;
create policy "coaches own profile" on coach_profiles for all using (auth.uid() = coach_id);

create trigger coach_profiles_updated_at
  before update on coach_profiles
  for each row execute function update_updated_at();

-- ============================================================
-- 3. tennis_knowledge 테이블 확장 (코트환경 + 태그 추가)
-- ============================================================
alter table tennis_knowledge
  add column if not exists court_type text default '전체'
    check (court_type in ('전체', '상가미니', '하프코트', '풀코트실내', '풀코트야외', '멀티코트')),
  add column if not exists tags text[],                  -- ['드릴', '기술', '전술', '멘탈']
  add column if not exists difficulty integer default 1  -- 1(쉬움) ~ 5(어려움)
    check (difficulty between 1 and 5);

-- ============================================================
-- 4. lesson_plans 테이블 확장 (코트환경 + 구조화된 플랜)
-- ============================================================
alter table lesson_plans
  add column if not exists court_type text,             -- 이 레슨의 코트 환경
  add column if not exists session_goals text,          -- 이번 레슨 목표 (AI 추출)
  add column if not exists drill_suggestions jsonb,     -- 추천 드릴 목록 (JSON)
  add column if not exists duration_minutes integer;    -- 녹음 길이 (분)

-- ============================================================
-- 5. 업그레이드된 벡터 검색 함수 (코트환경 필터 추가)
-- ============================================================
drop function if exists search_tennis_knowledge cascade;

create or replace function search_tennis_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.4,
  match_count int default 8,
  filter_level text default null,
  filter_court_type text default null
)
returns table (
  id uuid,
  source text,
  category text,
  level text,
  court_type text,
  title text,
  content text,
  tags text[],
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    tk.id,
    tk.source,
    tk.category,
    tk.level,
    tk.court_type,
    tk.title,
    tk.content,
    tk.tags,
    1 - (tk.embedding <=> query_embedding) as similarity
  from tennis_knowledge tk
  where
    1 - (tk.embedding <=> query_embedding) > match_threshold
    and (filter_level is null or tk.level is null or tk.level = filter_level or tk.level = '전체')
    and (filter_court_type is null or tk.court_type = '전체' or tk.court_type = filter_court_type)
  order by tk.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- 완료 메시지
-- ============================================================
do $$ begin
  raise notice '✅ V2 스키마 업그레이드 완료';
  raise notice '   - members: 레벨 6단계, 프로파일 확장';
  raise notice '   - coach_profiles: 코트환경, 전문분야';
  raise notice '   - tennis_knowledge: 코트환경 필터, 태그, 난이도';
  raise notice '   - lesson_plans: 코트환경, 구조화된 드릴 추천';
  raise notice '   - search_tennis_knowledge: 코트환경 필터 추가';
end $$;
