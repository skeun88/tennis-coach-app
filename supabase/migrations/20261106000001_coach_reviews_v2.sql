-- coach_reviews 테이블 확장 + 관련 테이블 추가

-- 1. coach_reviews에 keyword_codes, is_deleted 추가
ALTER TABLE public.coach_reviews
  ADD COLUMN IF NOT EXISTS keyword_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- 2. 코치당 회원 1개 리뷰 고유 제약
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_reviews_coach_member_unique'
  ) THEN
    ALTER TABLE public.coach_reviews
      ADD CONSTRAINT coach_reviews_coach_member_unique UNIQUE (coach_id, member_id);
  END IF;
END $$;

-- 3. review_keywords 테이블
CREATE TABLE IF NOT EXISTS public.review_keywords (
  code text PRIMARY KEY,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE public.review_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "review_keywords_public_read" ON public.review_keywords;
CREATE POLICY "review_keywords_public_read" ON public.review_keywords
  FOR SELECT USING (true);

-- 4. 키워드 초기 데이터
INSERT INTO public.review_keywords (code, label, sort_order) VALUES
  ('easy_to_understand', '설명이 이해하기 쉬워요', 1),
  ('careful_correction', '자세를 꼼꼼하게 교정해줘요', 2),
  ('level_matched', '수준에 맞춰 가르쳐줘요', 3),
  ('goal_oriented', '목표에 맞춰 지도해줘요', 4),
  ('clear_direction', '연습 방향을 명확하게 알려줘요', 5),
  ('notices_progress', '작은 변화도 알아봐줘요', 6),
  ('safe_exercise', '안전하게 운동할 수 있어요', 7),
  ('confidence_boost', '자신감을 높여줘요', 8),
  ('easy_to_ask', '편하게 질문할 수 있어요', 9),
  ('passionate', '레슨에 열정적이에요', 10),
  ('punctual', '시간을 잘 지켜요', 11),
  ('fun_lesson', '레슨이 즐거워요', 12)
ON CONFLICT (code) DO NOTHING;

-- 5. review_reports 테이블 (신고)
CREATE TABLE IF NOT EXISTS public.review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.coach_reviews(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('inappropriate', 'personal_info', 'other')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "review_reports_member_insert" ON public.review_reports;
CREATE POLICY "review_reports_member_insert" ON public.review_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());

-- 6. coach_reviews RLS: 인증된 사용자는 삭제되지 않은 리뷰 조회 가능
DROP POLICY IF EXISTS "coach_reviews_public_read" ON public.coach_reviews;
CREATE POLICY "coach_reviews_public_read" ON public.coach_reviews
  FOR SELECT USING (is_deleted = false);

-- 7. send-push에서 review 타입 지원을 위한 coach_notifications type 허용
-- (기존 coach_reviews_member_write 는 ALL - member_id = auth.uid() 이므로 유지)
