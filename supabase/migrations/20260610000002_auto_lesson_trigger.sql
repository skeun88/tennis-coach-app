-- TC-001-B: 신규 회원 등록 시 오늘 고정 스케줄 레슨 자동 생성 트리거
-- fixed_schedule_days에 오늘 요일이 포함되고 total_credits > 0 이면
-- 오늘 날짜로 레슨 1개 + lesson_members 1개 자동 생성

CREATE OR REPLACE FUNCTION auto_create_today_lesson()
RETURNS TRIGGER AS $$
DECLARE
  v_today       date    := (NOW() AT TIME ZONE 'Asia/Seoul')::date;
  v_today_dow   int     := EXTRACT(DOW FROM v_today)::int;
  v_time_str    text;
  v_start_time  time;
  v_end_time    time;
  v_duration    int;
  v_lesson_id   uuid;
BEGIN
  -- 조건: total_credits > 0, fixed_schedule_days에 오늘 요일 포함
  IF NEW.total_credits IS NULL OR NEW.total_credits <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.fixed_schedule_days IS NULL OR NOT (NEW.fixed_schedule_days @> ARRAY[v_today_dow]) THEN
    RETURN NEW;
  END IF;

  -- 시작 시간 결정 (fixed_schedule_times 우선, 없으면 fixed_schedule_time)
  v_time_str := NULL;
  IF NEW.fixed_schedule_times IS NOT NULL THEN
    v_time_str := NEW.fixed_schedule_times->>(v_today_dow::text);
    -- JSONB 배열인 경우 첫 번째 값 추출
    IF v_time_str IS NOT NULL AND LEFT(v_time_str, 1) = '[' THEN
      v_time_str := (NEW.fixed_schedule_times->(v_today_dow::text)->>0);
    END IF;
  END IF;
  IF v_time_str IS NULL AND NEW.fixed_schedule_time IS NOT NULL THEN
    v_time_str := LEFT(NEW.fixed_schedule_time::text, 5);
  END IF;
  IF v_time_str IS NULL THEN
    RETURN NEW; -- 시간 정보 없음
  END IF;

  -- duration
  v_duration := COALESCE(NEW.fixed_lesson_duration, 60);
  v_start_time := v_time_str::time;
  v_end_time   := v_start_time + (v_duration || ' minutes')::interval;

  -- 이미 같은 날짜/시간 레슨 없는지 확인 (constraint 우회)
  IF EXISTS (
    SELECT 1 FROM lessons
    WHERE coach_id = NEW.coach_id
      AND date = v_today
      AND start_time = v_start_time
  ) THEN
    -- 기존 레슨에 이 회원만 추가
    SELECT id INTO v_lesson_id FROM lessons
    WHERE coach_id = NEW.coach_id AND date = v_today AND start_time = v_start_time
    LIMIT 1;
  ELSE
    INSERT INTO lessons (coach_id, title, date, start_time, end_time)
    VALUES (NEW.coach_id, NEW.name, v_today, v_start_time, v_end_time)
    RETURNING id INTO v_lesson_id;
  END IF;

  -- lesson_members에 추가 (중복 방지)
  INSERT INTO lesson_members (lesson_id, member_id)
  VALUES (v_lesson_id, NEW.id)
  ON CONFLICT (lesson_id, member_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 등록 (idempotent)
DROP TRIGGER IF EXISTS trg_auto_create_today_lesson ON members;
CREATE TRIGGER trg_auto_create_today_lesson
  AFTER INSERT ON members
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_today_lesson();
