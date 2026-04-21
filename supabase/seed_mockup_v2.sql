-- ============================================================
-- Tennis Coach App - Mock Seed v2
-- 회원 120명 (활성 105명 내외), 오늘~7일간 매일 20명씩 레슨
-- ⚠️ coach_id를 실제 UUID로 교체하세요
--    Supabase → Authentication → Users 에서 확인
-- ============================================================

DO $$
DECLARE
  coach_id uuid := 'd505efbe-84d5-4188-b6b8-21a31519f03d'; -- ← 실제 UUID로 교체

  m uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,120));

  names text[] := ARRAY[
    '김민준','이서연','박지호','최수아','정우진','강예린','조현우','윤지아',
    '임도현','한소율','오태양','서채원','문준혁','신유진','권민서','배성호',
    '허지수','남궁민','엄태준','추다혜','류승현','노은서','안재원','백지현',
    '황민호','전수빈','송태양','심예지','변준서','곽다은','진우성','마지현',
    '석현준','하은솔','양민기','편지윤','봉재우','온다연','경민수','라해린',
    '계준영','여소연','도재현','피지민','길태우','두채린','탁민준','소유진',
    '판현우','나지수','선태민','모채은','초민서','거지현','다준혁','사예진',
    '장민우','이채현','박소윤','최준혁','정지은','강민호','조채원','윤태양',
    '임서연','한민준','오유진','서지호','문수아','신우진','권예린','배현우',
    '허지아','남도현','엄소율','추태양','류채원','노준혁','안유진','백지호',
    '황수아','전우진','송예린','심현우','변지아','곽도현','진소율','마태양',
    '석채원','하준혁','양유진','편지호','봉수아','온우진','경예린','라현우',
    '김태준','이다혜','박승현','최은서','정재원','강지현','조민호','윤수빈',
    '임태양','한예지','오준서','서다은','문우성','신지현','권진우','배은솔',
    '허민기','남지윤','엄재우','추다연','류민수','노해린','안준영','백소연'
  ];

  levels text[] := ARRAY['완전초보','초급','초중급','중급','중고급','고급'];
  titles text[] := ARRAY[
    '오전 기초반','오전 중급반','오후 초급반','오후 중급반',
    '저녁 고급반','주말 입문반','개인 레슨','그룹 레슨 A',
    '그룹 레슨 B','청소년반','성인 입문반','직장인반'
  ];
  locations text[] := ARRAY['A코트','B코트','C코트','실내 코트 1','실내 코트 2','야외 코트'];

  -- 오늘~+6일, 시간 슬롯 (30분 단위, 09:00~21:00)
  time_slots text[] := ARRAY[
    '09:00','09:30','10:00','10:30','11:00','11:30',
    '14:00','14:30','15:00','15:30','16:00','16:30',
    '17:00','17:30','19:00','19:30','20:00','20:30'
  ];

  i int;
  j int;
  d int;
  rand_weight int;
  rand_level text;
  lesson_id uuid;
  lesson_date date;
  start_t text;
  end_h int;
  end_m int;
  start_h int;
  start_m int;
  selected_members uuid[];
  temp_member uuid;
  lesson_title text;
  fee int;
  paid int;
  pay_status text;
  due_d date;
  member_phone text;
  join_offset int;

  note_contents text[] := ARRAY[
    '포핸드 스윙 개선 중. 팔꿈치 각도 교정 필요.',
    '백핸드가 많이 늘었음. 다음 단계 준비 중.',
    '서브 속도 향상됨. 토스 위치 조정 필요.',
    '풋워크 훈련 집중. 체력 좋아짐.',
    '랠리 일관성 향상. 네트 앞 플레이 연습 시작.',
    '경기 감각 좋음. 멘탈 훈련 필요.',
    '기초 그립 재교정. 빠르게 적응 중.',
    '볼 감각 뛰어남. 전술 훈련 시작.',
    '오른쪽 무릎 주의. 과부하 주지 않도록.',
    '규칙적으로 출석. 성실한 편.'
  ];
  desc_arr text[] := ARRAY['4월 수강료','5월 수강료','3월 수강료','레슨비','월 회비','특별 레슨비'];

BEGIN

  -- =================== MEMBERS (120명) ===================
  FOR i IN 1..120 LOOP
    member_phone := '010-' || lpad((floor(random()*9000+1000))::text,4,'0') || '-' || lpad((floor(random()*9000+1000))::text,4,'0');

    rand_weight := floor(random()*100)::int;
    IF    rand_weight < 10 THEN rand_level := '완전초보';
    ELSIF rand_weight < 30 THEN rand_level := '초급';
    ELSIF rand_weight < 50 THEN rand_level := '초중급';
    ELSIF rand_weight < 70 THEN rand_level := '중급';
    ELSIF rand_weight < 88 THEN rand_level := '중고급';
    ELSE                        rand_level := '고급';
    END IF;

    join_offset := floor(random() * 730)::int; -- 최대 2년 전

    INSERT INTO members (id, coach_id, name, phone, email, level, join_date, is_active, notes, remaining_credits)
    VALUES (
      m[i],
      coach_id,
      names[i],
      member_phone,
      CASE WHEN random() > 0.4
        THEN lower(replace(names[i],' ','')) || floor(random()*99+1)::text || '@gmail.com'
        ELSE NULL END,
      rand_level,
      current_date - join_offset,
      CASE WHEN i <= 105 THEN true ELSE false END,  -- 105명 활성, 15명 비활성
      CASE WHEN random() > 0.5
        THEN note_contents[floor(random()*array_length(note_contents,1))+1]
        ELSE NULL END,
      floor(random()*20+1)::int  -- 잔여 횟수 1~20
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- =================== LESSONS + MEMBERS + ATTENDANCE ===================
  -- 오늘부터 7일, 하루에 레슨 여러 타임 → 총 ~20명/일 배정
  FOR d IN 0..6 LOOP
    lesson_date := current_date + d;

    -- 하루에 타임슬롯 4개 생성 (각 슬롯에 ~5명 → 총 ~20명)
    FOR j IN 1..4 LOOP
      lesson_id := gen_random_uuid();
      start_t := time_slots[j * 3 - 2 + floor(random()*2)::int]; -- 오전/오후 분산
      lesson_title := titles[floor(random()*array_length(titles,1))+1];

      -- end_time = start + 30분
      start_h := split_part(start_t, ':', 1)::int;
      start_m := split_part(start_t, ':', 2)::int;
      IF start_m = 30 THEN
        end_h := start_h + 1; end_m := 0;
      ELSE
        end_h := start_h; end_m := 30;
      END IF;

      INSERT INTO lessons (id, coach_id, title, date, start_time, end_time, location, notes)
      VALUES (
        lesson_id,
        coach_id,
        lesson_title,
        lesson_date,
        start_t::time,
        (lpad(end_h::text,2,'0') || ':' || lpad(end_m::text,2,'0'))::time,
        locations[floor(random()*array_length(locations,1))+1],
        NULL
      );

      -- 슬롯당 4~6명 랜덤 배정 (활성 회원 105명 중에서)
      selected_members := ARRAY(
        SELECT DISTINCT m[floor(random()*105+1)::int]
        FROM generate_series(1, 6)
        LIMIT 5
      );

      FOR i IN 1..array_length(selected_members,1) LOOP
        BEGIN
          INSERT INTO lesson_members (lesson_id, member_id)
          VALUES (lesson_id, selected_members[i]);
        EXCEPTION WHEN unique_violation THEN NULL;
        END;

        -- 오늘 이전은 출석 데이터 있음, 오늘/미래는 없음
        IF lesson_date < current_date THEN
          BEGIN
            INSERT INTO attendance (lesson_id, member_id, status)
            VALUES (
              lesson_id,
              selected_members[i],
              (ARRAY['출석','출석','출석','출석','출석','지각','결석'])[floor(random()*7+1)::int]
            );
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
        END IF;
      END LOOP;

    END LOOP;
  END LOOP;

  -- =================== PAYMENTS ===================
  FOR i IN 1..120 LOOP
    fee := (ARRAY[80000,100000,120000,150000,200000])[floor(random()*5+1)::int];
    due_d := current_date - floor(random()*30)::int + floor(random()*20)::int;

    rand_weight := floor(random()*100)::int;
    IF    rand_weight < 60 THEN pay_status := '납부완료'; paid := fee;
    ELSIF rand_weight < 85 THEN pay_status := '미납';     paid := 0;
    ELSE                        pay_status := '부분납부'; paid := fee / 2;
    END IF;

    INSERT INTO payments (coach_id, member_id, amount, paid_amount, due_date, paid_date, status, description)
    VALUES (
      coach_id, m[i], fee, paid, due_d,
      CASE WHEN pay_status = '납부완료' THEN due_d - floor(random()*5)::int ELSE NULL END,
      pay_status,
      desc_arr[floor(random()*array_length(desc_arr,1))+1]
    );
  END LOOP;

  RAISE NOTICE '✅ Mock v2 완료: 회원 120명 (활성 105), 레슨 7일×4타임=28개 (~20명/일), 결제 120건';
END $$;
