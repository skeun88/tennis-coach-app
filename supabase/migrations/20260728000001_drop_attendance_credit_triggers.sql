-- 출석 처리 시 잔여 횟수 2회씩 차감되는 버그 수정
-- 원인: trg_auto_deduct_credit (INSERT) + trg_restore_credit (DELETE) 트리거가
--       attendance INSERT/DELETE 시 자동 차감/복원하는데,
--       앱 코드(handleAttend)도 adjust_remaining_credits RPC로 동일하게 처리 → 이중 차감
-- 수정: 두 트리거 제거, 앱 코드 RPC로만 처리
DROP TRIGGER IF EXISTS trg_auto_deduct_credit ON attendance;
DROP TRIGGER IF EXISTS trg_restore_credit ON attendance;
