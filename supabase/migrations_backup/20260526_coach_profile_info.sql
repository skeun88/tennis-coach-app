-- 코치 개인정보 필드 추가
-- 프로필 사진, 종목, 활동 지역, 소속 센터, 한 줄 소개

ALTER TABLE coach_profiles
  ADD COLUMN IF NOT EXISTS avatar_url      text,          -- 프로필 사진 URL
  ADD COLUMN IF NOT EXISTS sport           text DEFAULT '테니스',  -- 종목
  ADD COLUMN IF NOT EXISTS region_city     text,          -- 활동 지역 - 시
  ADD COLUMN IF NOT EXISTS region_district text,          -- 활동 지역 - 구
  ADD COLUMN IF NOT EXISTS center_name     text,          -- 소속 센터
  ADD COLUMN IF NOT EXISTS bio             text;          -- 한 줄 소개

COMMENT ON COLUMN coach_profiles.avatar_url IS '프로필 사진 (Supabase Storage URL)';
COMMENT ON COLUMN coach_profiles.sport IS '종목 (테니스, 배드민턴 등)';
COMMENT ON COLUMN coach_profiles.region_city IS '활동 지역 - 시 (예: 서울)';
COMMENT ON COLUMN coach_profiles.region_district IS '활동 지역 - 구 (예: 강남구)';
COMMENT ON COLUMN coach_profiles.center_name IS '소속 센터/클럽명';
COMMENT ON COLUMN coach_profiles.bio IS '한 줄 소개';

-- Storage bucket for profile avatars (run once)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
-- ON CONFLICT (id) DO NOTHING;

-- Storage policy
-- CREATE POLICY "avatar upload" ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "avatar public read" ON storage.objects FOR SELECT
--   USING (bucket_id = 'avatars');
