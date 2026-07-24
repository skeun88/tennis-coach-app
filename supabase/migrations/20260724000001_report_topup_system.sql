-- AI 리포트 추가 충전 시스템
-- extra_report_credits: 이월 O (매월 초기화 안 됨)
-- 월별 무료 할당량은 기존 ai_analysis_usage 테이블로 관리

-- 1. subscriptions 테이블에 추가 크레딧 컬럼 추가
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS extra_report_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_topup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_topup_product TEXT CHECK (auto_topup_product IN ('10', '30', '50'));

-- 2. 추가 충전 거래 내역 테이블
CREATE TABLE IF NOT EXISTS report_topup_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id TEXT NOT NULL CHECK (product_id IN ('10', '30', '50')),
  credits_added INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  toss_payment_key TEXT,
  toss_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE report_topup_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_own_topup_txns" ON report_topup_transactions
  FOR ALL TO authenticated
  USING (auth.uid() = coach_id);

-- 3. 추가 크레딧 원자적 차감 RPC
CREATE OR REPLACE FUNCTION deduct_extra_report_credit(p_coach_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_rows INTEGER;
BEGIN
  UPDATE subscriptions
  SET extra_report_credits = extra_report_credits - 1,
      updated_at = NOW()
  WHERE coach_id = p_coach_id
    AND extra_report_credits > 0;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  RETURN v_updated_rows > 0;
END;
$$;

-- 4. 추가 크레딧 충전 RPC (결제 완료 후 호출)
CREATE OR REPLACE FUNCTION add_extra_report_credits(
  p_coach_id UUID,
  p_credits INTEGER,
  p_transaction_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  UPDATE subscriptions
  SET extra_report_credits = extra_report_credits + p_credits,
      updated_at = NOW()
  WHERE coach_id = p_coach_id
  RETURNING extra_report_credits INTO v_new_balance;

  UPDATE report_topup_transactions
  SET status = 'completed', updated_at = NOW()
  WHERE id = p_transaction_id;

  RETURN v_new_balance;
END;
$$;

-- 5. updated_at 트리거
CREATE OR REPLACE FUNCTION update_topup_txn_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_topup_txn_updated_at
  BEFORE UPDATE ON report_topup_transactions
  FOR EACH ROW EXECUTE FUNCTION update_topup_txn_updated_at();
