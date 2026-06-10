-- Fix members.level check constraint: '고급' → '상급'
-- App code uses '상급' but DB constraint had '고급'

-- 1. 기존 제약조건 제거
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_level_check;

-- 2. 기존 '고급' 데이터를 '상급'으로 업데이트
UPDATE members SET level = '상급' WHERE level = '고급';

-- 3. 새 제약조건 추가 (코드와 일치)
ALTER TABLE members ADD CONSTRAINT members_level_check
  CHECK (level IN ('입문', '초급', '중급', '상급', '선수'));
