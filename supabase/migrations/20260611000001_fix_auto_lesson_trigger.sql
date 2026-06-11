-- BUG-1 Fix: TC-001-B — 오늘 레슨 자동 생성 트리거 미작동
-- 원인 1: SECURITY DEFINER 함수가 lessons INSERT 시 RLS에 막힐 수 있음
--         → SET row_security = off 추가로 해결
-- 원인 2: fixed_schedule_days 타입 불일치 (jsonb vs integer[]) 시 silent fail
--         → EXCEPTION 블록 + RAISE LOG 추가로 디버깅 및 방어 처리

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
  v_days_match  boolean;
BEGIN
  RAISE LOG 'auto_create_today_lesson: member=%, coach=%, credits=%, days=%',
    NEW.id, NEW.coach_id, NEW.total_credits, NEW.fixed_schedule_days;

  -- 조건: total_credits > 0
  IF NEW.total_credits IS NULL OR NEW.total_credits <= 0 THEN
    RAISE LOG 'auto_create_today_lesson: skip — no credits';
    RETURN NEW;
  END IF;

  IF NEW.fixed_schedule_days IS NULL THEN
    RAISE LOG 'auto_create_today_lesson: skip — fixed_schedule_days is null';
    RETURN NEW;
  END IF;

  -- fixed_schedule_days 타입에 따라 오늘 요일 포함 여부 체크
  -- integer[] 타입인 경우
  BEGIN
    v_days_match := (NEW.fixed_schedule_days @> ARRAY[v_today_dow]);
  EXCEPTION WHEN others THEN
    -- jsonb 타입이면 jsonb 연산자로 재시도
    BEGIN
      v_days_match := (NEW.fixed_schedule_days::jsonb @> to_jsonb(v_today_dow));
    EXCEPTION WHEN others THEN
      RAISE LOG 'auto_create_today_lesson: skip — cannot check fixed_schedule_days type: %', SQLERRM;
      RETURN NEW;
    END;
  END;

  IF NOT v_days_match THEN
    RAISE LOG 'auto_create_today_lesson: skip — today(%) not in schedule days', v_today_dow;
    RETURN NEW;
  END IF;

  -- 시작 시간 결정 (fixed_schedule_times 우선, 없으면 fixed_schedule_time)
  v_time_str := NULL;
  IF NEW.fixed_schedule_times IS NOT NULL THEN
    v_time_str := NEW.fixed_schedule_times->>(v_today_dow::text);
    IF v_time_str IS NOT NULL AND LEFT(v_time_str, 1) = '[' THEN
      v_time_str := (NEW.fixed_schedule_times->(v_today_dow::text)->>0);
    END IF;
  END IF;
  IF v_time_str IS NULL AND NEW.fixed_schedule_time IS NOT NULL THEN
    v_time_str := LEFT(NEW.fixed_schedule_time::text, 5);
  END IF;
  IF v_time_str IS NULL THEN
    RAISE LOG 'auto_create_today_lesson: skip — no time info';
    RETURN NEW;
  END IF;

  RAISE LOG 'auto_create_today_lesson: creating lesson date=%, time=%', v_today, v_time_str;

  -- duration
  v_duration := COALESCE(NEW.fixed_lesson_duration, 60);
  v_start_time := v_time_str::time;
  v_end_time   := v_start_time + (v_duration || ' minutes')::interval;

  -- 이미 같은 날짜/시간 레슨 없는지 확인
  IF EXISTS (
    SELECT 1 FROM lessons
    WHERE coach_id = NEW.coach_id
      AND date = v_today
      AND start_time = v_start_time
  ) THEN
    SELECT id INTO v_lesson_id FROM lessons
    WHERE coach_id = NEW.coach_id AND date = v_today AND start_time = v_start_time
    LIMIT 1;
    RAISE LOG 'auto_create_today_lesson: reusing existing lesson %', v_lesson_id;
  ELSE
    INSERT INTO lessons (coach_id, title, date, start_time, end_time)
    VALUES (NEW.coach_id, NEW.name, v_today, v_start_time, v_end_time)
    RETURNING id INTO v_lesson_id;
    RAISE LOG 'auto_create_today_lesson: inserted new lesson %', v_lesson_id;
  END IF;

  -- lesson_members에 추가 (중복 방지)
  INSERT INTO lesson_members (lesson_id, member_id)
  VALUES (v_lesson_id, NEW.id)
  ON CONFLICT (lesson_id, member_id) DO NOTHING;

  RAISE LOG 'auto_create_today_lesson: done — lesson=%, member=%', v_lesson_id, NEW.id;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE LOG 'auto_create_today_lesson: ERROR — %: %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

-- 트리거 재등록
DROP TRIGGER IF EXISTS trg_auto_create_today_lesson ON members;
CREATE TRIGGER trg_auto_create_today_lesson
  AFTER INSERT ON members
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_today_lesson();
