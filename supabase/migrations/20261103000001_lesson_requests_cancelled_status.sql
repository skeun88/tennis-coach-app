-- lesson_requests status constraint에 cancelled 추가
-- 회원이 보강 신청을 취소할 때 status = 'cancelled'로 업데이트하는데 DB constraint가 이를 허용하지 않아 오류 발생
ALTER TABLE lesson_requests DROP CONSTRAINT lesson_requests_status_check;
ALTER TABLE lesson_requests ADD CONSTRAINT lesson_requests_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text]));
