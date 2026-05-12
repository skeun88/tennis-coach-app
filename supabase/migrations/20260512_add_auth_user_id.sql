-- auth_user_id 컬럼 추가: 회원앱 로그인 시 UUID로 회원 연결
ALTER TABLE members ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_members_auth_user_id ON members(auth_user_id);

-- 현재 member.id = auth uid인 케이스 자동 처리 (테스트 회원)
UPDATE members SET auth_user_id = id WHERE auth_user_id IS NULL AND id = '6877bb8d-8c58-435d-9a8a-ca0d0670b8c5';
