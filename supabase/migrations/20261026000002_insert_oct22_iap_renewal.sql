-- Insert missing Apple IAP subscription_renewed event for Karen (2026-10-22)
-- Apple confirmed: KERRI Pro monthly ₩19,000 renewed on 2026-10-22 16:16 KST (07:16 UTC)
-- Next renewal: 2026-11-22
INSERT INTO public.subscription_logs (
  subscription_id,
  coach_id,
  event_type,
  amount,
  plan_id,
  metadata,
  created_at
)
SELECT
  '98401761-2732-4261-aec5-89174cff6860',
  'bcbd0abd-ba14-4a08-a43a-a81a25f91dc7',
  'subscription_renewed',
  19000,
  'pro',
  '{"source": "apple_iap", "product_id": "kerri_pro_monthly", "period_end": "2026-11-22T08:24:21+00:00"}'::jsonb,
  '2026-10-22T07:16:00+00:00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscription_logs
  WHERE coach_id = 'bcbd0abd-ba14-4a08-a43a-a81a25f91dc7'
    AND event_type = 'subscription_renewed'
    AND ABS(EXTRACT(EPOCH FROM (created_at - '2026-10-22T07:16:00+00:00'::timestamptz))) < 172800
);

-- Also update the stale current_period_end (was 2026-09-15, Apple shows 2026-11-22)
UPDATE public.subscriptions
SET current_period_end = '2026-11-22T08:24:21+00:00',
    updated_at = now()
WHERE coach_id = 'bcbd0abd-ba14-4a08-a43a-a81a25f91dc7'
  AND current_period_end < '2026-11-01T00:00:00+00:00';
