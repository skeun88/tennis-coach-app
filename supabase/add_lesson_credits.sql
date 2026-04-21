-- 수강권 컬럼 추가
ALTER TABLE members ADD COLUMN IF NOT EXISTS total_credits integer NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS remaining_credits integer NOT NULL DEFAULT 0;

-- 출석 시 차감 여부 컬럼 추가
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS deduct_credit boolean NOT NULL DEFAULT false;
