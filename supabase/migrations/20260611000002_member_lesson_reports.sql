-- 회원용 AI 레슨 리포트 테이블
CREATE TABLE IF NOT EXISTS member_lesson_reports (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id        uuid NOT NULL,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  lesson_plan_id  uuid REFERENCES lesson_plans(id) ON DELETE SET NULL,
  lesson_date     date,
  -- 회원 친화적 4개 항목
  summary         text,                    -- 오늘 레슨 요약
  achievements    text[],                  -- 오늘의 중요 성과
  improvement_points text[],               -- 개선 및 보완 포인트
  practice_plan   jsonb,                   -- 맞춤 개인 연습 플랜 [{title, description, duration, frequency, tip}]
  is_read         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_lesson_reports_member
  ON member_lesson_reports(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_lesson_reports_coach
  ON member_lesson_reports(coach_id, created_at DESC);

ALTER TABLE member_lesson_reports ENABLE ROW LEVEL SECURITY;

-- 코치: 자신이 만든 리포트 전체 접근
DROP POLICY IF EXISTS "reports_coach" ON member_lesson_reports;
CREATE POLICY "reports_coach" ON member_lesson_reports
  FOR ALL USING (coach_id = auth.uid());

-- 회원: 자신의 리포트만 읽기
DROP POLICY IF EXISTS "reports_member_read" ON member_lesson_reports;
CREATE POLICY "reports_member_read" ON member_lesson_reports
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );

-- 회원: 자신의 리포트 읽음 처리(update)
DROP POLICY IF EXISTS "reports_member_update" ON member_lesson_reports;
CREATE POLICY "reports_member_update" ON member_lesson_reports
  FOR UPDATE USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );

-- source 컬럼 추가 (manual: 수동작성, ai: AI분석)
ALTER TABLE member_lesson_reports ADD COLUMN IF NOT EXISTS source text DEFAULT 'ai' CHECK (source IN ('ai', 'manual'));
