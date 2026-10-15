
CREATE TABLE ai_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES coaches(id),
  member_id UUID REFERENCES members(id),
  consent_type TEXT NOT NULL, -- 'coach', 'member', 'guardian'
  consent_status TEXT NOT NULL DEFAULT 'pending', -- 'agreed', 'withdrawn', 'pending'
  consent_version TEXT NOT NULL,
  consent_document_hash TEXT,
  agreed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  source TEXT, -- 'coach_app', 'member_app', 'web_link'
  guardian_name TEXT,
  guardian_relation TEXT,
  guardian_phone TEXT,
  is_minor BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_consents ENABLE ROW LEVEL SECURITY;

-- RLS for coaches
CREATE POLICY "coaches_read_own_consents" ON ai_consents
FOR SELECT USING (
  coach_id = (SELECT coach_id FROM coaches WHERE user_id = auth.uid())
);

CREATE POLICY "coaches_write_own_consents" ON ai_consents
FOR INSERT WITH CHECK (
  coach_id = (SELECT coach_id FROM coaches WHERE user_id = auth.uid())
);

-- RLS for members
CREATE POLICY "members_read_own_consents" ON ai_consents
FOR SELECT USING (
  member_id = (SELECT member_id FROM members WHERE user_id = auth.uid())
);

CREATE POLICY "members_write_own_consents" ON ai_consents
FOR INSERT WITH CHECK (
  member_id = (SELECT member_id FROM members WHERE user_id = auth.uid())
);

CREATE POLICY "members_update_own_consents" ON ai_consents
FOR UPDATE USING (
  member_id = (SELECT member_id FROM members WHERE user_id = auth.uid())
);


-- Indexes
CREATE INDEX idx_ai_consents_coach ON ai_consents(coach_id, consent_type, consent_status);
CREATE INDEX idx_ai_consents_member ON ai_consents(member_id, consent_type, consent_status);
