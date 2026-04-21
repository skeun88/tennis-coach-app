-- ============================================================
-- Tennis Coach App - Seed Data (300 members + related data)
-- ============================================================
-- ⚠️ 주의: 먼저 schema.sql을 실행한 후 이 파일을 실행하세요.
-- ⚠️ coach_id는 실제 로그인한 사용자 UUID로 교체해야 합니다.
--    Supabase → Authentication → Users 에서 UUID 확인
--    아래 'd505efbe-84d5-4188-b6b8-21a31519f03d' 를 실제 UUID로 교체하세요.
-- ============================================================

DO $$
DECLARE
  coach_id uuid := 'd505efbe-84d5-4188-b6b8-21a31519f03d'; -- ← 여기에 실제 UUID 입력

  -- member ids
  m uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,300));

  -- lesson ids
  l uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,60));

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
    '임태양','한예지','오준서','서다은','문우성','신지현','권마준','배은솔',
    '허민기','남지윤','엄재우','추다연','류민수','노해린','안준영','백소연',
    '황재현','전지민','송태우','심채린','변민준','곽유진','진지수','마태민',
    '석채은','하민서','양지현','편준혁','봉예진','온민우','경채현','라소윤',
    '계준혁','여지은','도민호','피채원','길태양','두유진','탁지호','소수아',
    '판우진','나예린','선현우','모지아','초도현','거소율','다태양','사채원',
    '장준혁','이유진','박지호','최수빈','정태양','강예지','조준서','윤다은',
    '임우성','한지현','오마준','서은솔','문민기','신지윤','권재우','배다연',
    '허민수','남해린','엄준영','추소연','류재현','노지민','안태우','백채린',
    '황민준','전유진','송지수','심태민','변채은','곽민서','진지현','마준혁',
    '석예진','하민우','양채현','편소윤','봉준혁','온지은','경민호','라채원',
    '김도현','이소율','박태양','최채원','정준혁','강유진','조지호','윤수아',
    '임우진','한예린','오현우','서지아','문도현','신소율','권태양','배채원',
    '허준혁','남유진','엄지호','추수아','류우진','노예린','안현우','백지아',
    '황도현','전소율','송태양','심채원','변준혁','곽유진','진지호','마수아',
    '석우진','하예린','양현우','편지아','봉도현','온소율','경태양','라채원',
    '계준혁','여유진','도지호','피수아','길우진','두예린','탁현우','소지아',
    '판도현','나소율','선태양','모채원','초준혁','거유진','다지호','사수아',
    '장우진','이예린','박현우','최지아','정도현','강소율','조태양','윤채원',
    '임준혁','한유진','오지호','서수아','문우진','신예린','권현우','배지아',
    '허도현','남소율','엄태양','추채원','류준혁','노유진','안지호','백수아',
    '황우진','전예린','송현우','심지아','변도현','곽소율','진태양','마채원',
    '석준혁','하유진','양지호','편수아','봉우진','온예린','경현우','라지아',
    '계도현','여소율','도태양','피채원','길준혁','두유진','탁지호','소수아'
  ];

  phones text[];
  levels text[] := ARRAY['입문','초급','중급','고급','선수'];
  level_weights int[] := ARRAY[15,35,30,15,5]; -- 입문15% 초급35% 중급30% 고급15% 선수5%
  statuses text[] := ARRAY['납부완료','미납','부분납부'];
  att_statuses text[] := ARRAY['출석','결석','지각','조퇴'];

  i int;
  j int;
  k int;
  rand_level text;
  rand_weight int;
  join_offset int;
  member_phone text;
  lesson_date date;
  lesson_hour int;
  lesson_title text;
  titles text[] := ARRAY['오전 기초반','오전 중급반','오후 초급반','오후 중급반','저녁 고급반','주말 입문반','주말 중급반','개인 레슨','그룹 레슨 A','그룹 레슨 B','선수 훈련반','청소년반','성인 입문반','직장인반'];
  locations text[] := ARRAY['A코트','B코트','C코트','실내 코트 1','실내 코트 2','야외 코트'];
  desc_arr text[] := ARRAY['4월 수강료','5월 수강료','3월 수강료','6월 수강료','2월 수강료','1월 수강료','레슨비','특별 레슨비','월 회비'];
  fee int;
  paid int;
  pay_status text;
  due_d date;
  selected_members uuid[];
  att_status text;
  lm_id uuid;
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
    '규칙적으로 출석. 성실한 편.',
    '개인 연습도 열심히 함. 성장 속도 빠름.',
    '초보인데 잠재력 있음. 꾸준히 격려 필요.',
    '경쟁심 강함. 시합 위주 훈련 선호.',
    '유연성 부족. 스트레칭 과제 드림.',
    '집중력 좋음. 코치 지시 잘 따름.'
  ];

BEGIN

  -- =================== MEMBERS ===================
  FOR i IN 1..300 LOOP
    -- Generate phone
    member_phone := '010-' || lpad((floor(random()*9000+1000))::text, 4, '0') || '-' || lpad((floor(random()*9000+1000))::text, 4, '0');

    -- Weighted random level
    rand_weight := floor(random()*100)::int;
    IF rand_weight < 15 THEN rand_level := '입문';
    ELSIF rand_weight < 50 THEN rand_level := '초급';
    ELSIF rand_weight < 80 THEN rand_level := '중급';
    ELSIF rand_weight < 95 THEN rand_level := '고급';
    ELSE rand_level := '선수';
    END IF;

    -- Join date: between 3 years ago and today
    join_offset := floor(random() * 1095)::int;

    INSERT INTO members (id, coach_id, name, phone, email, level, join_date, is_active, notes)
    VALUES (
      m[i],
      coach_id,
      names[((i-1) % array_length(names,1)) + 1],
      member_phone,
      CASE WHEN random() > 0.4 THEN lower(replace(names[((i-1) % array_length(names,1)) + 1], ' ', '')) || floor(random()*999+1)::text || '@gmail.com' ELSE NULL END,
      rand_level,
      current_date - join_offset,
      CASE WHEN random() > 0.08 THEN true ELSE false END, -- 92% 활성
      CASE WHEN random() > 0.5 THEN note_contents[floor(random()*array_length(note_contents,1)+1)::int] ELSE NULL END
    );
  END LOOP;

  -- =================== LESSONS (60개, 최근 3개월) ===================
  FOR i IN 1..60 LOOP
    lesson_date := current_date - floor(random() * 90)::int;
    lesson_hour := (ARRAY[9,10,11,14,15,16,17,19,20])[floor(random()*9+1)::int];
    lesson_title := titles[floor(random()*array_length(titles,1)+1)::int];

    INSERT INTO lessons (id, coach_id, title, date, start_time, end_time, location, notes)
    VALUES (
      l[i],
      coach_id,
      lesson_title,
      lesson_date,
      (lesson_hour || ':00')::time,
      (lesson_hour + 1 || ':00')::time,
      locations[floor(random()*array_length(locations,1)+1)::int],
      CASE WHEN random() > 0.6 THEN '준비물: 라켓, 볼' ELSE NULL END
    );

    -- Assign 4~12 random members to each lesson
    selected_members := ARRAY(
      SELECT m[floor(random()*300+1)::int]
      FROM generate_series(1, floor(random()*9+4)::int)
    );
    -- Deduplicate
    selected_members := ARRAY(SELECT DISTINCT unnest(selected_members));

    FOR j IN 1..array_length(selected_members, 1) LOOP
      -- lesson_members
      BEGIN
        INSERT INTO lesson_members (lesson_id, member_id) VALUES (l[i], selected_members[j]);
      EXCEPTION WHEN unique_violation THEN NULL;
      END;

      -- attendance
      att_status := (ARRAY['출석','출석','출석','출석','출석','지각','조퇴','결석'])[floor(random()*8+1)::int];
      BEGIN
        INSERT INTO attendance (lesson_id, member_id, status)
        VALUES (l[i], selected_members[j], att_status);
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;

  -- =================== PAYMENTS (회원당 1~3건) ===================
  FOR i IN 1..300 LOOP
    -- 각 회원에게 1~3건의 결제 기록
    FOR k IN 1..floor(random()*3+1)::int LOOP
      fee := (ARRAY[80000,100000,120000,150000,180000,200000,250000])[floor(random()*7+1)::int];
      due_d := current_date - floor(random()*90)::int + floor(random()*30)::int;

      -- 결제 상태 분포: 완료 60%, 미납 30%, 부분 10%
      rand_weight := floor(random()*100)::int;
      IF rand_weight < 60 THEN
        pay_status := '납부완료';
        paid := fee;
      ELSIF rand_weight < 90 THEN
        pay_status := '미납';
        paid := 0;
      ELSE
        pay_status := '부분납부';
        paid := fee / 2;
      END IF;

      INSERT INTO payments (coach_id, member_id, amount, paid_amount, due_date, paid_date, status, description)
      VALUES (
        coach_id,
        m[i],
        fee,
        paid,
        due_d,
        CASE WHEN pay_status = '납부완료' THEN due_d - floor(random()*5)::int ELSE NULL END,
        pay_status,
        desc_arr[floor(random()*array_length(desc_arr,1)+1)::int]
      );
    END LOOP;
  END LOOP;

  -- =================== MEMBER NOTES (일부 회원에게) ===================
  FOR i IN 1..150 LOOP -- 150명에게 메모
    INSERT INTO member_notes (member_id, coach_id, content)
    VALUES (
      m[floor(random()*300+1)::int],
      coach_id,
      note_contents[floor(random()*array_length(note_contents,1)+1)::int]
    );
  END LOOP;

  RAISE NOTICE '✅ Seed 완료: 회원 300명, 레슨 60개, 결제 ~600건, 메모 150건';
END $$;
