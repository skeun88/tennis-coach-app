-- 결제 PG 연동 및 정산 관련 마이그레이션
-- 1. 코치 프로필/설정 테이블 생성 (정산 계좌 포함)
CREATE TABLE IF NOT EXISTS coach_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 기본 정보
  name text,
  phone text,

  -- 토스페이먼츠 정산 계좌 (테니스장 사업자 계좌)
  settlement_bank       text,           -- 은행명 (예: 신한, 국민, 카카오뱅크)
  settlement_account    text,           -- 계좌번호
  settlement_holder     text,           -- 예금주명
  settlement_verified   boolean NOT NULL DEFAULT false,  -- 계좌 인증 여부

  -- 토스페이먼츠 Connect 서브머천트 ID (플랫폼에서 발급)
  toss_sub_merchant_id  text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_profiles_self" ON coach_profiles
  FOR ALL USING (auth.uid() = id);

-- 2. payments 테이블에 온라인 결제 관련 컬럼 추가
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS toss_order_id    text UNIQUE,  -- 주문 ID
  ADD COLUMN IF NOT EXISTS toss_payment_key text,          -- 결제 키 (승인 후)
  ADD COLUMN IF NOT EXISTS platform_fee     integer DEFAULT 0,     -- 플랫폼 수수료 (원)
  ADD COLUMN IF NOT EXISTS platform_fee_rate numeric(5,4) DEFAULT 0.03, -- 수수료율 (기본 3%)
  ADD COLUMN IF NOT EXISTS settlement_amount integer,      -- 코치 정산 금액
  ADD COLUMN IF NOT EXISTS payment_channel  text CHECK (payment_channel IN ('offline', 'online')) DEFAULT 'offline';

COMMENT ON COLUMN payments.toss_order_id IS '토스페이먼츠 주문 ID (온라인 결제)';
COMMENT ON COLUMN payments.toss_payment_key IS '토스페이먼츠 결제 키 (승인 완료 후)';
COMMENT ON COLUMN payments.platform_fee IS '플랫폼 수수료 (원)';
COMMENT ON COLUMN payments.platform_fee_rate IS '플랫폼 수수료율 (0.03 = 3%)';
COMMENT ON COLUMN payments.settlement_amount IS '코치/테니스장 정산 금액 = amount - platform_fee';
COMMENT ON COLUMN payments.payment_channel IS 'offline: 기존 수동 처리 / online: 앱 내 결제';
