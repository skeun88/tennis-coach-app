-- add_extra_report_credits: AI 충전권 구매 시 크레딧 적립 + 거래 완료 처리
CREATE OR REPLACE FUNCTION add_extra_report_credits(
  p_coach_id uuid,
  p_credits integer,
  p_transaction_id uuid
) RETURNS integer AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE subscriptions
  SET extra_report_credits = COALESCE(extra_report_credits, 0) + p_credits,
      updated_at = now()
  WHERE coach_id = p_coach_id
  RETURNING extra_report_credits INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'subscription not found for coach_id %', p_coach_id;
  END IF;

  UPDATE report_topup_transactions
  SET status = 'completed'
  WHERE id = p_transaction_id;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_extra_report_credits(uuid, integer, uuid) TO service_role;
