-- 요일별 다중 시간 지원을 위한 컬럼 업데이트
-- fixed_schedule_times: {"1": "10:00"} → {"1": ["10:00", "10:30"]}
-- 기존 string 값을 배열로 마이그레이션

UPDATE members
SET fixed_schedule_times = (
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN jsonb_typeof(value) = 'string' THEN jsonb_build_array(value)
      ELSE value
    END
  )
  FROM jsonb_each(fixed_schedule_times)
)
WHERE fixed_schedule_times IS NOT NULL
  AND fixed_schedule_times != 'null'::jsonb;

COMMENT ON COLUMN members.fixed_schedule_times IS
  '요일별 레슨 시작 시간 (다중). 예: {"1": ["09:00", "09:30"], "3": ["14:30"]} (0=일, 1=월 ... 6=토)';
