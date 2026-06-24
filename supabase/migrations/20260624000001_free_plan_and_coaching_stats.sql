-- =============================================
-- Free 플랜 추가 + 4대 지표 + AI 사용량 추적
-- =============================================

-- 1. subscription_plans: free 플랜 추가
INSERT INTO subscription_plans (id, name, price, features) VALUES
  ('free', 'Free', 0, '{
    "member_management": true,
    "schedule": true,
    "attendance": true,
    "payment": true,
    "basic_profile": true,
    "operations_management": false,
    "member_notifications": false,
    "ai_analysis": false,
    "coaching_stats_collect": false,
    "ai_coaching_model": false,
    "coaching_stats_public": false,
    "tagging": false
  }')
ON CONFLICT (id) DO UPDATE SET
  features = EXCLUDED.features;

-- 2. basic/pro features 업데이트 (새 구조 반영)
UPDATE subscription_plans SET features = '{
  "member_management": true,
  "schedule": true,
  "attendance": true,
  "payment": true,
  "basic_profile": true,
  "operations_management": true,
  "member_notifications": true,
  "ai_analysis": true,
  "coaching_stats_collect": true,
  "ai_coaching_model": false,
  "coaching_stats_public": false,
  "tagging": false
}' WHERE id = 'basic';

UPDATE subscription_plans SET features = '{
  "member_management": true,
  "schedule": true,
  "attendance": true,
  "payment": true,
  "basic_profile": true,
  "operations_management": true,
  "member_notifications": true,
  "ai_analysis": true,
  "coaching_stats_collect": true,
  "ai_coaching_model": true,
  "coaching_stats_public": true,
  "tagging": true
}' WHERE id = 'pro';

-- 3. subscriptions.status 에 'free' 허용
DO $$
BEGIN
  ALTER TABLE subscriptions 
    DROP CONSTRAINT IF EXISTS subscriptions_status_check;
  ALTER TABLE subscriptions 
    ADD CONSTRAINT subscriptions_status_check 
    CHECK (status IN ('free', 'trial', 'active', 'past_due', 'cancelled', 'blocked'));
END$$;

-- 4. 4대 지표 (coaching_stats) 테이블
CREATE TABLE IF NOT EXISTS coaching_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  total_lessons integer NOT NULL DEFAULT 0,           -- 누적 레슨 수
  avg_retention_days numeric(6,1) NOT NULL DEFAULT 0,  -- 평균 유지 기간 (일)
  avg_satisfaction numeric(3,2) NOT NULL DEFAULT 0,    -- 회원 만족도 (0.0~5.0)
  satisfaction_count integer NOT NULL DEFAULT 0,       -- 만족도 응답 수
  total_reports integer NOT NULL DEFAULT 0,            -- 리포트 발송 수
  kerri_verified boolean NOT NULL DEFAULT false,       -- KERRI 검증 여부
  kerri_started_at timestamptz DEFAULT now(),          -- KERRI 활동 시작일
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE coaching_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach own stats" ON coaching_stats;
CREATE POLICY "coach own stats" ON coaching_stats
  FOR ALL USING (auth.uid() = coach_id);

-- Pro 코치 stats 공개 (공개 프로필용)
DROP POLICY IF EXISTS "public can view pro coach stats" ON coaching_stats;
CREATE POLICY "public can view pro coach stats" ON coaching_stats
  FOR SELECT USING (
    coach_id IN (
      SELECT coach_id FROM subscriptions
      WHERE plan_id = 'pro' AND status IN ('trial', 'active')
    )
  );

CREATE OR REPLACE FUNCTION update_coaching_stats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coaching_stats_updated_at ON coaching_stats;
CREATE TRIGGER coaching_stats_updated_at
  BEFORE UPDATE ON coaching_stats
  FOR EACH ROW EXECUTE FUNCTION update_coaching_stats_updated_at();

-- 5. AI 레슨 분석 월별 사용량 추적
CREATE TABLE IF NOT EXISTS ai_analysis_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year_month text NOT NULL,   -- 'YYYY-MM'
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (coach_id, year_month)
);

ALTER TABLE ai_analysis_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach own ai usage" ON ai_analysis_usage;
CREATE POLICY "coach own ai usage" ON ai_analysis_usage
  FOR ALL USING (auth.uid() = coach_id);
