-- ─────────────────────────────────────────────────────────────
-- lesson_requests 테이블 생성 + RLS + Realtime
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lesson_requests (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id       uuid NOT NULL,
  member_id      uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  requested_date date NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  message        text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','rejected')),
  responded_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_requests_coach
  ON lesson_requests(coach_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_requests_member
  ON lesson_requests(member_id, created_at DESC);

-- RLS
ALTER TABLE lesson_requests ENABLE ROW LEVEL SECURITY;

-- 코치: 자신의 모든 요청 조회/수정 가능
DROP POLICY IF EXISTS "coach_requests" ON lesson_requests;
CREATE POLICY "coach_requests" ON lesson_requests
  FOR ALL USING (coach_id = auth.uid());

-- 회원: 자신의 요청 조회/삽입 가능
DROP POLICY IF EXISTS "member_requests" ON lesson_requests;
CREATE POLICY "member_requests" ON lesson_requests
  FOR ALL USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE lesson_requests;

-- 거절 메시지 컬럼 추가
ALTER TABLE lesson_requests ADD COLUMN IF NOT EXISTS reject_message text;
