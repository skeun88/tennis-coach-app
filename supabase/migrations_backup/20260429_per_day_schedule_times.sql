-- 요일별 개별 시간 지원을 위한 컬럼 추가
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS fixed_schedule_times jsonb;

COMMENT ON COLUMN members.fixed_schedule_times IS
  '요일별 레슨 시작 시간. 예: {"1": "10:00", "3": "14:30"} (0=일, 1=월 ... 6=토)';
