-- member_notifications.type CHECK 제약조건 확장
-- 기존: reregister, churn_risk, general (협소)
-- 신규: 코드에서 실제 사용되는 모든 타입 포함
ALTER TABLE member_notifications DROP CONSTRAINT IF EXISTS member_notifications_type_check;

ALTER TABLE member_notifications
  ADD CONSTRAINT member_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'reregister'::text,
    'churn_risk'::text,
    'general'::text,
    'chat_message'::text,
    'message'::text,
    'lesson_reminder'::text,
    'lesson_report'::text,
    'lesson_update'::text,
    'payment'::text
  ]));
