-- 1. lesson_plans에 achievements 컬럼 추가 (Sonnet 단일 원본, haiku 제거 대비)
ALTER TABLE lesson_plans
ADD COLUMN IF NOT EXISTS achievements text[] NOT NULL DEFAULT '{}';

-- 2. 기존 haiku achievements → lesson_plans.achievements 이전
-- lesson_plan_id 연결된 records만, 코치 수정 없는 경우에만 이전
UPDATE lesson_plans lp
SET achievements = (
  SELECT mlr.achievements
  FROM member_lesson_reports mlr
  WHERE mlr.lesson_plan_id = lp.id
    AND mlr.achievements IS NOT NULL
    AND array_length(mlr.achievements, 1) > 0
  ORDER BY mlr.created_at DESC
  LIMIT 1
)
WHERE coalesce(array_length(lp.achievements, 1), 0) = 0
  AND EXISTS (
    SELECT 1 FROM member_lesson_reports mlr
    WHERE mlr.lesson_plan_id = lp.id
      AND mlr.achievements IS NOT NULL
      AND array_length(mlr.achievements, 1) > 0
  );

-- 3. lesson_plans RLS 수정: sent_to_member 조건 추가 (직접 접근도 차단)
-- m.id = auth.uid() 조건 제거 (members.id는 내부 UUID, auth.uid()와 매핑 불가)
DROP POLICY IF EXISTS "lesson_plans_member_read" ON lesson_plans;
CREATE POLICY "lesson_plans_member_read"
ON lesson_plans FOR SELECT TO authenticated
USING (
  id IN (
    SELECT mlr.lesson_plan_id
    FROM member_lesson_reports mlr
    JOIN members m ON m.id = mlr.member_id
    WHERE mlr.sent_to_member = true
      AND m.auth_user_id = auth.uid()
  )
);

-- 4. member_lesson_plan_view 재정의
-- drill_suggestions 제거, achievements + lesson_comparison 추가
-- security_invoker = true 유지 (RLS 자동 적용)
DROP VIEW IF EXISTS member_lesson_plan_view;
CREATE VIEW member_lesson_plan_view
WITH (security_invoker = true)
AS
SELECT
  lp.id,
  lp.member_id,
  lp.coach_id,
  lp.created_at,
  lp.summary,
  lp.achievements,
  lp.improvement_points,
  lp.next_goals,
  lp.court_type,
  lp.session_goals,
  lp.duration_minutes,
  lp.lesson_comparison
FROM lesson_plans lp
WHERE lp.status = 'completed';

-- 롤백 SQL (참고용):
-- DROP VIEW IF EXISTS member_lesson_plan_view;
-- CREATE VIEW member_lesson_plan_view WITH (security_invoker = true) AS
--   SELECT id, member_id, coach_id, created_at, summary, improvement_points,
--          next_goals, court_type, session_goals, drill_suggestions, duration_minutes
--   FROM lesson_plans WHERE status = 'completed';
-- DROP POLICY IF EXISTS "lesson_plans_member_read" ON lesson_plans;
-- CREATE POLICY "lesson_plans_member_read" ON lesson_plans FOR SELECT TO authenticated
--   USING (member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()));
