-- Phase 1: lesson_plans 브리핑/비교 기능 추가

-- 1. 신규 컬럼 추가 (next_goals 변환 전)
ALTER TABLE lesson_plans
  ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lesson_comparison JSONB,
  ADD COLUMN IF NOT EXISTS coach_next_goals TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS next_goals_saved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compared_lesson_id UUID REFERENCES lesson_plans(id) ON DELETE SET NULL;

-- 2. next_goals: text → text[] 변환
--    member_lesson_plan_view가 next_goals에 의존하므로 뷰 먼저 드롭 후 재생성

DROP VIEW IF EXISTS member_lesson_plan_view;

ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS next_goals_new TEXT[] DEFAULT '{}';

UPDATE lesson_plans
  SET next_goals_new = CASE
    WHEN next_goals IS NOT NULL AND next_goals <> '' THEN ARRAY[next_goals]
    ELSE '{}'::TEXT[]
  END;

ALTER TABLE lesson_plans DROP COLUMN next_goals;
ALTER TABLE lesson_plans RENAME COLUMN next_goals_new TO next_goals;
ALTER TABLE lesson_plans ALTER COLUMN next_goals SET DEFAULT '{}';
ALTER TABLE lesson_plans ALTER COLUMN next_goals SET NOT NULL;

-- 3. member_lesson_plan_view 재생성 (next_goals는 이제 text[])
CREATE OR REPLACE VIEW member_lesson_plan_view
WITH (security_invoker = true)
AS
SELECT
  id,
  member_id,
  coach_id,
  created_at,
  summary,
  improvement_points,
  next_goals,
  court_type,
  session_goals,
  drill_suggestions,
  duration_minutes
FROM lesson_plans
WHERE status = 'completed';

-- 4. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_lesson_plans_lesson_id ON lesson_plans(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_member_coach_created ON lesson_plans(member_id, coach_id, created_at DESC);
