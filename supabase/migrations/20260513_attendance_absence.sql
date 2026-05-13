-- attendance 테이블에 결석 관련 컬럼 추가
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS absence_reason text,
  ADD COLUMN IF NOT EXISTS deduction_type  text;

-- absence_reason: 개인사정 / 부상 / 일정충돌 / 무단결석 / 기타
-- deduction_type: 정상차감 / 미차감 / 보강예정
