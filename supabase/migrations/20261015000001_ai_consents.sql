-- ai_consents: AI 레슨 기록 동의 (코치/회원/보호자)
-- 코치 동의 ≠ 회원 동의 — 별도 저장, 코치가 대신 동의 불가

CREATE TABLE IF NOT EXISTS ai_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('coach', 'member', 'guardian')),
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('agreed', 'withdrawn', 'pending')),
  consent_version TEXT NOT NULL,
  consent_document_hash TEXT,
  agreed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  source TEXT CHECK (source IN ('coach_app', 'member_app', 'web_link')),
  guardian_name TEXT,
  guardian_relation TEXT,
  guardian_phone TEXT,
  is_minor BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_consents_coach ON ai_consents(coach_id, consent_type, consent_status);
CREATE INDEX IF NOT EXISTS idx_ai_consents_member ON ai_consents(member_id, consent_type, consent_status);

ALTER TABLE ai_consents ENABLE ROW LEVEL SECURITY;

-- 코치: coach_id = auth.uid()
CREATE POLICY "Coaches can read own ai_consents"
  ON ai_consents FOR SELECT
  USING (coach_id = auth.uid());

CREATE POLICY "Coaches can insert own ai_consents"
  ON ai_consents FOR INSERT
  WITH CHECK (coach_id = auth.uid());

CREATE POLICY "Coaches can update own ai_consents"
  ON ai_consents FOR UPDATE
  USING (coach_id = auth.uid());

-- 회원: member_id → members.auth_user_id = auth.uid()
CREATE POLICY "Members can read own ai_consents"
  ON ai_consents FOR SELECT
  USING (
    member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Members can insert own ai_consents"
  ON ai_consents FOR INSERT
  WITH CHECK (
    member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Members can update own ai_consents"
  ON ai_consents FOR UPDATE
  USING (
    member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid())
  );

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_ai_consents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_consents_updated_at
  BEFORE UPDATE ON ai_consents
  FOR EACH ROW EXECUTE FUNCTION update_ai_consents_updated_at();
