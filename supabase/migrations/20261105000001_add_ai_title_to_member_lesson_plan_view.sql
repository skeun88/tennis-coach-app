-- Add ai_title to member_lesson_plan_view so members see the same lesson title as coaches
CREATE OR REPLACE VIEW member_lesson_plan_view AS
SELECT id, member_id, coach_id, created_at, summary, achievements,
       improvement_points, next_goals, court_type, session_goals,
       duration_minutes, lesson_comparison, ai_title
FROM lesson_plans lp
WHERE status = 'completed';
