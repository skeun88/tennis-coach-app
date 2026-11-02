-- ─────────────────────────────────────────────
-- 결석 알리기 기능: attendance 테이블 필드 추가
-- + coach_notifications.type 제약 확장
-- ─────────────────────────────────────────────

-- attendance 테이블에 결석 알리기 관련 필드 추가
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS absence_reporter    text,      -- 'member' | 'coach'
  ADD COLUMN IF NOT EXISTS absence_reported_at timestamptz;

-- coach_notifications.type 제약에 absence_reported 추가
ALTER TABLE coach_notifications
  DROP CONSTRAINT IF EXISTS coach_notifications_type_check;

ALTER TABLE coach_notifications
  ADD CONSTRAINT coach_notifications_type_check
    CHECK (type IN ('lesson_reminder', 'member_message', 'general', 'absence_reported'));
