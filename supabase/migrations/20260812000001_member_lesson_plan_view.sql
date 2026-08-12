-- 회원앱에서 lesson_plans를 안전하게 읽기 위한 뷰 + RLS 정책

-- 1. 회원 SELECT 정책 (TO authenticated 명시 — anon 차단)
CREATE POLICY "lesson_plans_member_read"
ON lesson_plans
FOR SELECT
TO authenticated
USING (
  member_id IN (
    SELECT id FROM members
    WHERE auth_user_id = auth.uid() OR id = auth.uid()
  )
);

-- 2. 노출 가능 컬럼만 담은 뷰
--    security_invoker = true: 뷰 소유자가 아닌 호출자 권한으로 실행 → lesson_plans RLS 적용됨
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
