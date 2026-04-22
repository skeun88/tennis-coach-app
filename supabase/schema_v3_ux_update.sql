-- ============================================================
-- V3: 코치 UX 자동화 - 고정 스케줄 + 자동 차감 트리거
-- ============================================================

-- 1. members 테이블에 고정 스케줄 컬럼 추가
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS fixed_schedule_days integer[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fixed_schedule_time time,
  ADD COLUMN IF NOT EXISTS fixed_lesson_duration integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS total_credits integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_credits integer DEFAULT 0;

-- 2. 출석 체크 시 레슨권 자동 차감 함수
CREATE OR REPLACE FUNCTION auto_deduct_lesson_credit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = '출석' AND NEW.deduct_credit = true THEN
    UPDATE members
    SET remaining_credits = GREATEST(remaining_credits - 1, 0)
    WHERE id = NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_deduct_credit ON attendance;
CREATE TRIGGER trg_auto_deduct_credit
  AFTER INSERT ON attendance
  FOR EACH ROW EXECUTE FUNCTION auto_deduct_lesson_credit();

-- 출석 취소 시 크레딧 복원
CREATE OR REPLACE FUNCTION restore_lesson_credit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = '출석' AND OLD.deduct_credit = true THEN
    UPDATE members
    SET remaining_credits = remaining_credits + 1
    WHERE id = OLD.member_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_restore_credit ON attendance;
CREATE TRIGGER trg_restore_credit
  AFTER DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION restore_lesson_credit();

-- 3. 잔여 1회 이하 회원 뷰
CREATE OR REPLACE VIEW low_credit_members AS
SELECT id, coach_id, name, phone, remaining_credits, fixed_schedule_days, fixed_schedule_time
FROM members
WHERE is_active = true AND remaining_credits <= 1;

DO $$ BEGIN
  RAISE NOTICE '✅ V3 마이그레이션 완료';
END $$;
