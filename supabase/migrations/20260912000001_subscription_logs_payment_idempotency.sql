-- subscription_id + 날짜(UTC) 기준 payment_attempting 중복 방지
-- process-billing가 선점 로그 삽입 시 23505 에러 → 오늘 이미 처리된 것으로 간주하고 스킵
CREATE UNIQUE INDEX subscription_logs_payment_attempting_daily
  ON subscription_logs (subscription_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE event_type = 'payment_attempting';
