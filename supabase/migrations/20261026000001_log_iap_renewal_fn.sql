-- Apple IAP 구독 갱신 이벤트를 subscription_logs에 기록하는 SECURITY DEFINER 함수
-- 클라이언트(RN 앱)에서 호출 가능; RLS 우회하여 서비스 권한으로 INSERT
-- 멱등성: 동일 갱신일(±2일 범위) 중복 기록 방지

CREATE OR REPLACE FUNCTION log_iap_renewal(
  p_plan_id    text,
  p_renewal_date timestamptz,  -- Apple이 실제 청구한 날짜 (RevenueCat latestPurchaseDate)
  p_period_end timestamptz,
  p_amount     integer,
  p_product_id text
)
RETURNS boolean   -- true = 신규 기록, false = 중복 스킵
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id  uuid;
  v_coach_id uuid := auth.uid();
  v_dup     integer;
BEGIN
  IF v_coach_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT id INTO v_sub_id
  FROM subscriptions
  WHERE coach_id = v_coach_id;

  -- 2일 이내 동일 갱신 이벤트 중복 체크
  SELECT COUNT(*) INTO v_dup
  FROM subscription_logs
  WHERE coach_id = v_coach_id
    AND event_type = 'subscription_renewed'
    AND (metadata->>'source') = 'apple_iap'
    AND ABS(EXTRACT(EPOCH FROM (created_at - p_renewal_date))) < 172800;

  IF v_dup > 0 THEN
    RETURN false;
  END IF;

  INSERT INTO subscription_logs (subscription_id, coach_id, event_type, amount, plan_id, metadata, created_at)
  VALUES (
    v_sub_id,
    v_coach_id,
    'subscription_renewed',
    p_amount,
    p_plan_id,
    jsonb_build_object(
      'source',     'apple_iap',
      'product_id', p_product_id,
      'period_end', p_period_end
    ),
    p_renewal_date
  );

  RETURN true;
END;
$$;

-- 인증된 사용자가 이 함수를 호출할 수 있도록 EXECUTE 권한 부여
GRANT EXECUTE ON FUNCTION log_iap_renewal(text, timestamptz, timestamptz, integer, text) TO authenticated;
