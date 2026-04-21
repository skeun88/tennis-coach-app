-- ============================================================
-- Tennis Coach App - AI 기능 스키마
-- schema.sql 실행 후 이 파일을 실행하세요
-- Supabase SQL Editor에서 순서대로 실행:
-- 1. 먼저 pgvector extension 활성화 확인
-- 2. 이 파일 실행
-- ============================================================

-- pgvector extension (Supabase에서 기본 제공)
create extension if not exists vector;

-- 기존 테이블 삭제 후 재생성
drop table if exists lesson_plans cascade;
drop table if exists lesson_transcripts cascade;
drop table if exists tennis_knowledge cascade;
drop function if exists search_tennis_knowledge cascade;

-- ============================================================
-- 1. tennis_knowledge - 테니스 교육 자료 + 임베딩
-- ============================================================
create table tennis_knowledge (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade,  -- null이면 공용 자료
  source text not null,        -- 출처 (예: 'ITF 교재', '코치 직접 입력')
  category text not null,      -- 분류 (예: '포핸드', '서브', '풋워크', '전술')
  level text,                  -- 적합 레벨 (null = 전체, '입문','초급','중급','고급','선수')
  title text not null,         -- 자료 제목
  content text not null,       -- 자료 내용
  embedding vector(1536),      -- text-embedding-3-small 벡터
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- 2. lesson_transcripts - 레슨 녹음 → 텍스트 변환 결과
-- ============================================================
create table lesson_transcripts (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  lesson_id uuid references lessons(id) on delete set null,   -- 특정 레슨과 연결 (선택)
  transcript text not null,    -- Whisper 변환 텍스트
  duration_seconds integer,    -- 녹음 길이 (초)
  recorded_at timestamptz not null default now(),
  created_at timestamptz default now() not null
);

-- ============================================================
-- 3. lesson_plans - AI가 생성한 레슨 분석 + 다음 계획
-- ============================================================
create table lesson_plans (
  id uuid default uuid_generate_v4() primary key,
  coach_id uuid references auth.users(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  transcript_id uuid references lesson_transcripts(id) on delete set null,
  summary text not null default '',          -- 오늘 레슨 요약
  improvement_points text not null default '', -- 개선 포인트
  next_goals text not null default '',        -- 다음 레슨 목표
  raw_response text,                          -- Claude 원본 응답 (디버깅용)
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- RLS 설정
-- ============================================================
alter table tennis_knowledge enable row level security;
alter table lesson_transcripts enable row level security;
alter table lesson_plans enable row level security;

-- tennis_knowledge: 공용 자료(coach_id null)는 모두 읽기 가능, 자기 자료만 쓰기
create policy "knowledge read all" on tennis_knowledge
  for select using (coach_id is null or auth.uid() = coach_id);

create policy "knowledge write own" on tennis_knowledge
  for insert with check (auth.uid() = coach_id);

create policy "knowledge update own" on tennis_knowledge
  for update using (auth.uid() = coach_id);

create policy "knowledge delete own" on tennis_knowledge
  for delete using (auth.uid() = coach_id);

-- lesson_transcripts: 자기 것만
create policy "coaches own transcripts" on lesson_transcripts
  for all using (auth.uid() = coach_id);

-- lesson_plans: 자기 것만
create policy "coaches own plans" on lesson_plans
  for all using (auth.uid() = coach_id);

-- ============================================================
-- 인덱스 (벡터 검색 성능)
-- ============================================================
create index if not exists tennis_knowledge_embedding_idx
  on tennis_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists lesson_transcripts_member_idx
  on lesson_transcripts (member_id, recorded_at desc);

create index if not exists lesson_plans_member_idx
  on lesson_plans (member_id, created_at desc);

-- ============================================================
-- updated_at 트리거
-- ============================================================
create trigger tennis_knowledge_updated_at
  before update on tennis_knowledge
  for each row execute function update_updated_at();

create trigger lesson_plans_updated_at
  before update on lesson_plans
  for each row execute function update_updated_at();

-- ============================================================
-- 벡터 검색 함수 (search-knowledge edge function에서 호출)
-- ============================================================
create or replace function search_tennis_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.4,
  match_count int default 5,
  filter_level text default null
)
returns table (
  id uuid,
  source text,
  category text,
  level text,
  title text,
  content text,
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
    tk.title,
    tk.content,
    1 - (tk.embedding <=> query_embedding) as similarity
  from tennis_knowledge tk
  where
    1 - (tk.embedding <=> query_embedding) > match_threshold
    and (filter_level is null or tk.level is null or tk.level = filter_level or tk.level = '전체')
  order by tk.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- 샘플 테니스 지식 데이터 (임베딩 없이 텍스트만, 나중에 임베딩 생성)
-- ============================================================
insert into tennis_knowledge (source, category, level, title, content) values
('기초 교재', '포핸드', '입문', '포핸드 그립 잡기',
 '이스턴 포핸드 그립: 라켓 면과 손바닥이 같은 방향. 검지 너클을 3번 베벨에 위치. 초보자에게 가장 기본적인 그립으로 컨트롤이 쉽다.'),
('기초 교재', '포핸드', '초급', '포핸드 스윙 기초',
 '테이크백: 어깨 회전으로 라켓을 뒤로. 포워드 스윙: 낮에서 높으로(low-to-high). 팔로스루: 반대편 어깨 위까지 마무리. 무릎을 구부려 안정된 자세 유지.'),
('기초 교재', '백핸드', '초급', '양손 백핸드 기초',
 '왼손(오른손잡이 기준)이 주도. 양 손 모두 그립을 잡고 컨택 포인트는 왼쪽 허리 앞. 어깨 회전 중요. 팔로스루는 어깨 높이까지.'),
('기초 교재', '서브', '초급', '서브 기초 - 트로피 자세',
 '트로피 자세: 무릎을 구부리고 라켓 팔은 위로, 공 던지는 팔은 앞으로 뻗음. 토스는 오른쪽 어깨 약간 앞 위치. 체중을 앞발로 이동하며 타격.'),
('기초 교재', '풋워크', '전체', '스플릿 스텝',
 '상대방이 공을 치는 순간 작게 점프하며 양발로 착지(스플릿 스텝). 다음 움직임을 위한 준비 자세. 모든 레벨에서 가장 중요한 기본기.'),
('중급 교재', '전술', '중급', '크로스코트 vs 다운더라인',
 '크로스코트: 네트가 낮은 중앙 통과, 코트 대각선 최대 활용 - 안전한 선택. 다운더라인: 날카로운 각도, 상대 포지션 변경 유도 - 공격적 선택. 중립 상황에서는 크로스코트 기본.'),
('중급 교재', '포핸드', '중급', '탑스핀 포핸드',
 '라켓 면을 약간 닫고 낮에서 높으로 강하게 브러싱. 웨스턴/세미웨스턴 그립 사용. 높은 바운드로 상대 압박. 그물에 걸릴 위험 감소.'),
('고급 교재', '서브', '고급', '슬라이스 서브',
 '컨택 시 라켓을 공의 바깥쪽(3시 방향)을 긁듯 스윙. 공이 오른쪽으로 휘어짐(오른손잡이). 듀스 코트에서 상대를 코트 밖으로 끌어내는 효과적인 서브.'),
('기초 교재', '멘탈', '전체', '실수 후 리셋',
 '실수 후 3초 내 부정적 감정 털어내기. 다음 포인트에 집중. 짧은 루틴(라켓 줄 만지기, 심호흡) 활용. 실수는 과정의 일부임을 인식.'),
('기초 교재', '체력', '전체', '코트 내 이동',
 '사이드스텝으로 좌우 이동. 공을 향해 크로스스텝(교차보)으로 빠른 이동. 볼 후 항상 기본 위치로 복귀. 코트 센터 마크 기준 중앙 복귀 습관화.')
on conflict do nothing;

-- ============================================================
-- 완료 메시지
-- ============================================================
do $$ begin
  raise notice '✅ AI 스키마 완료: tennis_knowledge, lesson_transcripts, lesson_plans 테이블 생성';
  raise notice '📌 다음 단계: Supabase Dashboard → Settings → Edge Functions → Secrets 에서';
  raise notice '   OPENAI_API_KEY, ANTHROPIC_API_KEY 설정 필요';
end $$;
