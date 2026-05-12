-- 코치 ↔ 회원 메시지 테이블
CREATE TABLE IF NOT EXISTS messages (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id     uuid NOT NULL,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sender_type  text NOT NULL CHECK (sender_type IN ('coach', 'member')),
  content      text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  read_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON messages(coach_id, member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages(coach_id, member_id) WHERE read_at IS NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_coach" ON messages
  FOR ALL USING (coach_id = auth.uid());

CREATE POLICY "messages_member" ON messages
  FOR ALL USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );
