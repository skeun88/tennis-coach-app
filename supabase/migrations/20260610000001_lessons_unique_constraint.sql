-- TC-007-B: 같은 날짜/시간 중복 레슨 방지
-- coach_id + date + start_time 조합으로 unique constraint 추가

ALTER TABLE lessons
  ADD CONSTRAINT lessons_no_duplicate
  UNIQUE (coach_id, date, start_time);
