-- IAP(인앱결제) 트랜잭션 ID 컬럼 추가
-- RevenueCat 결제 완료 시 중복 충전 방지용 idempotency 키

ALTER TABLE member_report_credit_txns
  ADD COLUMN IF NOT EXISTS iap_transaction_id TEXT;

-- NULL 허용 + NULL 제외 unique (Toss 충전 txn에는 NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_txns_iap_tx_id
  ON member_report_credit_txns (iap_transaction_id)
  WHERE iap_transaction_id IS NOT NULL;

-- charge_member_report_credit RPC에 iap_transaction_id 파라미터 추가
CREATE OR REPLACE FUNCTION charge_member_report_credit(
  p_member_id UUID,
  p_amount INTEGER,
  p_iap_transaction_id TEXT DEFAULT NULL
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

  -- IAP 중복 방지: 동일 transaction_id가 이미 있으면 현재 잔액 반환
  IF p_iap_transaction_id IS NOT NULL THEN
    PERFORM 1
    FROM member_report_credit_txns
    WHERE iap_transaction_id = p_iap_transaction_id;

    IF FOUND THEN
      SELECT balance INTO v_balance_after
      FROM member_report_credits
      WHERE member_id = p_member_id;
      RETURN COALESCE(v_balance_after, 0);
    END IF;
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
    (member_id, txn_type, amount, balance_after, description, iap_transaction_id)
  VALUES
    (p_member_id, 'charge', p_amount, v_balance_after,
     p_amount || '원 충전', p_iap_transaction_id);

  RETURN v_balance_after;
END;
$$;
