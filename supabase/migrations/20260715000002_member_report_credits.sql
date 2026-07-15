-- 회원 리포트 크레딧 시스템
-- 회원이 리포트를 열람할 때마다 크레딧 차감 (첫 1건 무료 체험)
-- 크레딧은 만원 단위 충전, 건당 1,000원 소진
-- 코치 플랜과 무관하게 회원이 직접 구매

CREATE TABLE IF NOT EXISTS member_report_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0), -- 크레딧 잔액 (원 단위)
  total_charged INTEGER NOT NULL DEFAULT 0,                -- 누적 충전액
  total_used INTEGER NOT NULL DEFAULT 0,                   -- 누적 사용액
  free_report_used BOOLEAN NOT NULL DEFAULT FALSE,         -- 첫 1건 무료 체험 사용 여부
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

-- 크레딧 거래 내역
CREATE TABLE IF NOT EXISTS member_report_credit_txns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('charge', 'use', 'free_use', 'refund')),
  amount INTEGER NOT NULL,           -- 거래 금액 (원) — 충전 양수, 사용 음수
  balance_after INTEGER NOT NULL,    -- 거래 후 잔액
  report_id UUID,                    -- use/free_use 시 연결된 리포트 id
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- member_lesson_reports에 열람 상태 컬럼 추가
ALTER TABLE member_lesson_reports
  ADD COLUMN IF NOT EXISTS credit_unlocked BOOLEAN NOT NULL DEFAULT FALSE;

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

-- 코치는 소속 회원 크레딧 잔액 조회 가능
CREATE POLICY "coach_read_member_credits" ON member_report_credits
  FOR SELECT TO authenticated
  USING (
    member_id IN (
      SELECT m.id FROM members m
      WHERE m.coach_id = auth.uid()
    )
  );

-- 리포트 열람 잠금 해제 함수
-- 첫 1건: 무료 / 이후: 크레딧 1,000원 차감
CREATE OR REPLACE FUNCTION unlock_member_report(
  p_member_id UUID,
  p_report_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit RECORD;
  v_already_unlocked BOOLEAN;
  v_cost INTEGER := 1000;
BEGIN
  -- 이미 열람했는지 확인
  SELECT credit_unlocked INTO v_already_unlocked
  FROM member_lesson_reports
  WHERE id = p_report_id AND member_id = p_member_id;

  IF v_already_unlocked IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'report_not_found');
  END IF;

  IF v_already_unlocked THEN
    RETURN jsonb_build_object('success', true, 'reason', 'already_unlocked');
  END IF;

  -- 크레딧 행 조회 (없으면 생성) — FOR UPDATE로 동시성 보호
  INSERT INTO member_report_credits (member_id)
  VALUES (p_member_id)
  ON CONFLICT (member_id) DO NOTHING;

  SELECT * INTO v_credit
  FROM member_report_credits
  WHERE member_id = p_member_id
  FOR UPDATE;

  -- 첫 1건 무료 체험
  IF NOT v_credit.free_report_used THEN
    UPDATE member_report_credits
    SET free_report_used = TRUE, updated_at = now()
    WHERE member_id = p_member_id;

    UPDATE member_lesson_reports
    SET credit_unlocked = TRUE
    WHERE id = p_report_id;

    INSERT INTO member_report_credit_txns
      (member_id, txn_type, amount, balance_after, report_id, description)
    VALUES
      (p_member_id, 'free_use', 0, v_credit.balance, p_report_id, '첫 리포트 무료 체험');

    RETURN jsonb_build_object('success', true, 'reason', 'free_trial', 'balance', v_credit.balance);
  END IF;

  -- 크레딧 잔액 확인
  IF v_credit.balance < v_cost THEN
    RETURN jsonb_build_object('success', false, 'reason', 'insufficient_credit', 'balance', v_credit.balance);
  END IF;

  -- 크레딧 차감
  UPDATE member_report_credits
  SET
    balance = balance - v_cost,
    total_used = total_used + v_cost,
    updated_at = now()
  WHERE member_id = p_member_id;

  UPDATE member_lesson_reports
  SET credit_unlocked = TRUE
  WHERE id = p_report_id;

  INSERT INTO member_report_credit_txns
    (member_id, txn_type, amount, balance_after, report_id, description)
  VALUES
    (p_member_id, 'use', -v_cost, v_credit.balance - v_cost, p_report_id, '리포트 열람');

  RETURN jsonb_build_object('success', true, 'reason', 'credit_used', 'balance', v_credit.balance - v_cost);
END;
$$;

-- 크레딧 충전 함수 (만원 단위)
CREATE OR REPLACE FUNCTION charge_member_report_credit(
  p_member_id UUID,
  p_amount INTEGER
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

  INSERT INTO member_report_credit_txns
    (member_id, txn_type, amount, balance_after, description)
  VALUES
    (p_member_id, 'charge', p_amount, v_balance_after, p_amount || '원 충전');

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
