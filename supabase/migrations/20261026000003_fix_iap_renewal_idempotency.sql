-- Fix: log_iap_renewal race condition
-- Two concurrent calls could both pass the duplicate check before either INSERT completes.
-- Solution: add a unique partial index on (coach_id, created_at) for apple_iap renewals,
-- then use INSERT ... ON CONFLICT DO NOTHING so only one row lands.

-- 1. Remove duplicate apple_iap renewal records across all coaches (keep earliest created id per group)
DELETE FROM subscription_logs
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY coach_id, created_at
        ORDER BY id
      ) AS rn
    FROM subscription_logs
    WHERE event_type = 'subscription_renewed'
      AND (metadata->>'source') = 'apple_iap'
  ) ranked
  WHERE rn > 1
);

-- 2. Unique index prevents concurrent duplicate inserts going forward
CREATE UNIQUE INDEX IF NOT EXISTS subscription_logs_apple_iap_renewal_unique
  ON subscription_logs (coach_id, created_at)
  WHERE event_type = 'subscription_renewed'
    AND (metadata->>'source') = 'apple_iap';

-- 3. Replace function: drop SELECT-then-INSERT with INSERT ... ON CONFLICT DO NOTHING
CREATE OR REPLACE FUNCTION log_iap_renewal(
  p_plan_id      text,
  p_renewal_date timestamptz,
  p_period_end   timestamptz,
  p_amount       integer,
  p_product_id   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id   uuid;
  v_coach_id uuid := auth.uid();
  v_rows     integer;
BEGIN
  IF v_coach_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT id INTO v_sub_id
  FROM subscriptions
  WHERE coach_id = v_coach_id;

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
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;  -- true = inserted, false = duplicate skipped
END;
$$;

GRANT EXECUTE ON FUNCTION log_iap_renewal(text, timestamptz, timestamptz, integer, text) TO authenticated;
