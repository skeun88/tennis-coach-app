-- consent_logs: 개인정보 처리방침 및 이용약관 동의 기록
-- 법적 증빙용 — 사용자가 동의한 시점과 버전을 보관

CREATE TABLE IF NOT EXISTS consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('privacy', 'terms')),
  version TEXT NOT NULL DEFAULT '1.0',
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT
);

CREATE INDEX IF NOT EXISTS consent_logs_user_id_idx ON consent_logs(user_id);
CREATE INDEX IF NOT EXISTS consent_logs_user_type_idx ON consent_logs(user_id, consent_type);

ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consent logs"
  ON consent_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own consent logs"
  ON consent_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
