-- 결제 방법 컬럼 추가
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('계좌이체', '카드', '현금'));

COMMENT ON COLUMN payments.payment_method IS '납부 방법: 계좌이체, 카드, 현금';
