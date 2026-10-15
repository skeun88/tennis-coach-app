-- ai_consents: consent_method 컬럼 추가 (verbal/app/digital)
ALTER TABLE ai_consents ADD COLUMN IF NOT EXISTS consent_method TEXT DEFAULT 'app';

-- 코치가 직접 앱에서 동의 확인한 경우: consent_method = 'verbal'
-- 코치앱에서 직접 동의: consent_method = 'app'
-- 기존 레코드는 DEFAULT 'app' 적용
