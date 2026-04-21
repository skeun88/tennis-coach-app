-- ============================================================
-- Tennis Coach App - V2 안전한 마이그레이션
-- 기존 데이터 있어도 에러 없이 실행됨
-- ============================================================

-- ============================================================
-- 1. members 테이블 - 레벨 6단계 마이그레이션
-- ============================================================
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_level_check;

UPDATE members SET level = '완전초보' WHERE level = '입문';
UPDATE members SET level = '초급'
  WHERE level NOT IN ('완전초보','초급','초중급','중급','중고급','고급');

ALTER TABLE members ADD CONSTRAINT members_level_check
  CHECK (level IN ('완전초보','초급','초중급','중급','중고급','고급'));

-- ============================================================
-- 2. members 테이블 - 새 컬럼 추가 (court_type 포함)
-- ============================================================
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS dominant_hand text DEFAULT '오른손',
  ADD COLUMN IF NOT EXISTS backhand_type text DEFAULT '양손',
  ADD COLUMN IF NOT EXISTS goal text DEFAULT '취미',
  ADD COLUMN IF NOT EXISTS injury_history text,
  ADD COLUMN IF NOT EXISTS weak_points text[],
  ADD COLUMN IF NOT EXISTS lesson_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS court_type text DEFAULT '풀코트야외';

-- court_type 기존 값 정리 후 constraint
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_court_type_check;

UPDATE members
  SET court_type = '풀코트야외'
  WHERE court_type IS NULL
     OR court_type NOT IN ('상가미니','하프코트','풀코트실내','풀코트야외','멀티코트');

ALTER TABLE members ADD CONSTRAINT members_court_type_check
  CHECK (court_type IN ('상가미니','하프코트','풀코트실내','풀코트야외','멀티코트'));

-- dominant_hand constraint
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_dominant_hand_check;
UPDATE members SET dominant_hand = '오른손'
  WHERE dominant_hand NOT IN ('오른손','왼손');
ALTER TABLE members ADD CONSTRAINT members_dominant_hand_check
  CHECK (dominant_hand IN ('오른손','왼손'));

-- backhand_type constraint
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_backhand_type_check;
UPDATE members SET backhand_type = '양손'
  WHERE backhand_type NOT IN ('양손','한손');
ALTER TABLE members ADD CONSTRAINT members_backhand_type_check
  CHECK (backhand_type IN ('양손','한손'));

-- goal constraint
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_goal_check;
UPDATE members SET goal = '취미'
  WHERE goal NOT IN ('취미','건강','대회출전','심화기술');
ALTER TABLE members ADD CONSTRAINT members_goal_check
  CHECK (goal IN ('취미','건강','대회출전','심화기술'));

-- ============================================================
-- 3. coach_profiles 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_profiles (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  coach_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name text,
  default_court_type text DEFAULT '풀코트야외',
  academy_name text,
  specialties text[],
  coaching_style text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE coach_profiles DROP CONSTRAINT IF EXISTS coach_profiles_court_type_check;
ALTER TABLE coach_profiles ADD CONSTRAINT coach_profiles_court_type_check
  CHECK (default_court_type IN ('상가미니','하프코트','풀코트실내','풀코트야외','멀티코트'));

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coaches own profile" ON coach_profiles;
CREATE POLICY "coaches own profile" ON coach_profiles FOR ALL USING (auth.uid() = coach_id);

DROP TRIGGER IF EXISTS coach_profiles_updated_at ON coach_profiles;
CREATE TRIGGER coach_profiles_updated_at
  BEFORE UPDATE ON coach_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4. tennis_knowledge 컬럼 추가
-- ============================================================
ALTER TABLE tennis_knowledge
  ADD COLUMN IF NOT EXISTS court_type text DEFAULT '전체',
  ADD COLUMN IF NOT EXISTS tags text[],
  ADD COLUMN IF NOT EXISTS difficulty integer DEFAULT 1;

ALTER TABLE tennis_knowledge DROP CONSTRAINT IF EXISTS tennis_knowledge_court_type_check;
UPDATE tennis_knowledge
  SET court_type = '전체'
  WHERE court_type IS NULL
     OR court_type NOT IN ('전체','상가미니','하프코트','풀코트실내','풀코트야외','멀티코트');
ALTER TABLE tennis_knowledge ADD CONSTRAINT tennis_knowledge_court_type_check
  CHECK (court_type IN ('전체','상가미니','하프코트','풀코트실내','풀코트야외','멀티코트'));

ALTER TABLE tennis_knowledge DROP CONSTRAINT IF EXISTS tennis_knowledge_difficulty_check;
UPDATE tennis_knowledge SET difficulty = 1 WHERE difficulty NOT BETWEEN 1 AND 5;
ALTER TABLE tennis_knowledge ADD CONSTRAINT tennis_knowledge_difficulty_check
  CHECK (difficulty BETWEEN 1 AND 5);

-- ============================================================
-- 5. lesson_plans 컬럼 추가
-- ============================================================
ALTER TABLE lesson_plans
  ADD COLUMN IF NOT EXISTS court_type text,
  ADD COLUMN IF NOT EXISTS session_goals text,
  ADD COLUMN IF NOT EXISTS drill_suggestions jsonb,
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- ============================================================
-- 6. 벡터 검색 함수 업데이트 (코트환경 필터 포함)
-- ============================================================
DROP FUNCTION IF EXISTS search_tennis_knowledge CASCADE;

CREATE OR REPLACE FUNCTION search_tennis_knowledge(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.4,
  match_count int DEFAULT 8,
  filter_level text DEFAULT NULL,
  filter_court_type text DEFAULT NULL
)
RETURNS TABLE (
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
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    tk.id, tk.source, tk.category, tk.level, tk.court_type,
    tk.title, tk.content, tk.tags,
    1 - (tk.embedding <=> query_embedding) AS similarity
  FROM tennis_knowledge tk
  WHERE
    1 - (tk.embedding <=> query_embedding) > match_threshold
    AND (filter_level IS NULL OR tk.level IS NULL OR tk.level = filter_level OR tk.level = '전체')
    AND (filter_court_type IS NULL OR tk.court_type = '전체' OR tk.court_type = filter_court_type)
  ORDER BY tk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
DO $$ BEGIN
  RAISE NOTICE '✅ V2 마이그레이션 완료';
END $$;
