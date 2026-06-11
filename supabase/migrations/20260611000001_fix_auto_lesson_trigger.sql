-- BUG-1 수정: auto_create_today_lesson 트리거
-- 수정 사항:
-- 1. EXCEPTION 핸들러 추가 → 트리거 에러가 회원 등록을 실패시키지 않음
-- 2. OWNER TO postgres 설정 → SECURITY DEFINER가 실제로 RLS bypass 보장
-- 3. fixed_schedule_days 타입 명시적 캐스팅 (integer[] 가정)
-- 4. 불필요한 fixed_schedule_times JSONB 분기 제거 (미사용 컬럼)

CREATE OR REPLACE FUNCTION auto_create_today_lesson()
RETURNS TRIGGER AS $$
DECLARE
  v_today       date;
  v_today_dow   int;
  v_time_str    text;
  v_start_time  time;
  v_end_time    time;
  v_duration    int;
  v_lesson_id   uuid;
BEGIN
  -- 예외를 내부에서 처리 → 회원 INSERT가 트리거 오류로 롤백되지 않도록
  BEGIN

    v_today     := (NOW() AT TIME ZONE 'Asia/Seoul')::date;
    v_today_dow := EXTRACT(DOW FROM v_today)::int;

    -- 조건 1: total_credits > 0
    IF NEW.total_credits IS NULL OR NEW.total_credits <= 0 THEN
      RETURN NEW;
    END IF;

    -- 조건 2: fixed_schedule_days에 오늘 요일 포함
    -- fixed_schedule_days가 integer[]인지 확인 후 비교
    IF NEW.fixed_schedule_days IS NULL THEN
      RETURN NEW;
    END IF;

    -- integer[] 타입으로 캐스팅 후 contains 체크
    IF NOT (NEW.fixed_schedule_days::integer[] @> ARRAY[v_today_dow]) THEN
      RETURN NEW;
    END IF;

    -- 시작 시간 결정
    v_time_str := NULL;

    -- fixed_schedule_time (time 타입) 사용
    IF NEW.fixed_schedule_time IS NOT NULL THEN
      v_time_str := LEFT(NEW.fixed_schedule_time::text, 5);
    END IF;

    IF v_time_str IS NULL THEN
      RETURN NEW; -- 시간 정보 없음
    END IF;

    -- duration
    v_duration   := COALESCE(NEW.fixed_lesson_duration, 60);
    v_start_time := v_time_str::time;
    v_end_time   := v_start_time + (v_duration || ' minutes')::interval;

    -- 이미 같은 날짜/시간 레슨 있는지 확인
    SELECT id INTO v_lesson_id
    FROM lessons
    WHERE coach_id = NEW.coach_id
      AND date = v_today
      AND start_time = v_start_time
    LIMIT 1;

    -- 레슨 없으면 새로 생성
    IF v_lesson_id IS NULL THEN
      INSERT INTO lessons (coach_id, title, date, start_time, end_time)
      VALUES (NEW.coach_id, NEW.name, v_today, v_start_time, v_end_time)
      RETURNING id INTO v_lesson_id;
    END IF;

    -- lesson_members에 추가 (중복 방지)
    IF v_lesson_id IS NOT NULL THEN
      INSERT INTO lesson_members (lesson_id, member_id)
      VALUES (v_lesson_id, NEW.id)
      ON CONFLICT (lesson_id, member_id) DO NOTHING;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- 트리거 오류를 WARNING으로만 기록, 회원 등록은 정상 완료
    RAISE WARNING '[auto_create_today_lesson] error for member %: % (%)',
      NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, extensions;

-- 함수 소유자를 postgres로 명시 (SECURITY DEFINER + BYPASSRLS 보장)
ALTER FUNCTION auto_create_today_lesson() OWNER TO postgres;

-- 트리거 재등록 (idempotent)
DROP TRIGGER IF EXISTS trg_auto_create_today_lesson ON members;
CREATE TRIGGER trg_auto_create_today_lesson
  AFTER INSERT ON members
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_today_lesson();
