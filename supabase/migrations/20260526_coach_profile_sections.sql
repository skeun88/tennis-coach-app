-- 코치 프로필 경력 정보 컬럼 추가 (섹션 4)
ALTER TABLE coach_profiles
  ADD COLUMN IF NOT EXISTS coaching_years     integer,
  ADD COLUMN IF NOT EXISTS has_player_career  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS career_details     text,
  ADD COLUMN IF NOT EXISTS certifications     text,
  ADD COLUMN IF NOT EXISTS awards             text;
