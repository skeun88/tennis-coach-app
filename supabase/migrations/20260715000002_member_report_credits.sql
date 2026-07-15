-- 회원 리포트 크레딧 시스템
-- 회원이 만원 단위로 충전, 리포트 열람 시 1,000원 차감

CREATE TABLE IF NOT EXISTS member_report_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0), -- 크레딧 잔액 (원 단위)
  total_charged INTEGER NOT NULL DEFAULT 0,                -- 누적 충전액
  total_used INTEGER NOT NULL DEFAULT 0,                   -- 누적 사용액
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

-- 크레딧 거래 내역
CREATE TABLE IF NOT EXISTS member_report_credit_txns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('charge', 'use', 'refund')),
  amount INTEGER NOT NULL,           -- 거래 금액 (원) — 충전 양수, 사용 음수
  balance_after INTEGER NOT NULL,    -- 거래 후 잔액
  report_id UUID,                    -- use 시 연결된 리포트 id
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE member_report_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_report_credit_txns ENABLE ROW LEVEL SECURITY;

-- 회원은 자신의 크레딧만 조회/수정 가능
CREATE POLICY "member_credits_self" ON member_report_credits
  FOR ALL TO authenticated
  USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "member_credit_txns_self" ON member_report_credit_txns
  FOR ALL TO authenticated
  USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid()
    )
  );

-- 코치는 소속 회원 크레딧 잔액 조회 가능 (리포트 발송 가능 여부 확인용)
CREATE POLICY "coach_read_member_credits" ON member_report_credits
  FOR SELECT TO authenticated
  USING (
    member_id IN (
      SELECT m.id FROM members m
      WHERE m.coach_id = auth.uid()
    )
  );

-- 크레딧 차감 함수 (리포트 열람 시)
CREATE OR REPLACE FUNCTION deduct_member_report_credit(
  p_member_id UUID,
  p_report_id UUID,
  p_amount INTEGER DEFAULT 1000
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance
  FROM member_report_credits
  WHERE member_id = p_member_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE member_report_credits
  SET
    balance = balance - p_amount,
    total_used = total_used + p_amount,
    updated_at = now()
  WHERE member_id = p_member_id;

  INSERT INTO member_report_credit_txns (member_id, txn_type, amount, balance_after, report_id)
  VALUES (p_member_id, 'use', -p_amount, v_balance - p_amount, p_report_id);

  RETURN TRUE;
END;
$$;

-- 크레딧 충전 함수
CREATE OR REPLACE FUNCTION charge_member_report_credit(
  p_member_id UUID,
  p_amount INTEGER  -- 10000 단위
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance_after INTEGER;
BEGIN
  IF p_amount % 10000 != 0 OR p_amount <= 0 THEN
    RAISE EXCEPTION '충전 금액은 10,000원 단위여야 합니다.';
  END IF;

  INSERT INTO member_report_credits (member_id, balance, total_charged)
  VALUES (p_member_id, p_amount, p_amount)
  ON CONFLICT (member_id) DO UPDATE
  SET
    balance = member_report_credits.balance + p_amount,
    total_charged = member_report_credits.total_charged + p_amount,
    updated_at = now()
  RETURNING balance INTO v_balance_after;

  INSERT INTO member_report_credit_txns (member_id, txn_type, amount, balance_after, description)
  VALUES (p_member_id, 'charge', p_amount, v_balance_after, '크레딧 충전');

  RETURN v_balance_after;
END;
$$;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_member_credit_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_member_credit_updated_at
  BEFORE UPDATE ON member_report_credits
  FOR EACH ROW EXECUTE FUNCTION update_member_credit_updated_at();
