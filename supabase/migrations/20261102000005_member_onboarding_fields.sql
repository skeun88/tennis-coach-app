-- 멤버 온보딩 리뉴얼: 운동 경험, 지역, 온보딩 완료 상태 필드 추가
ALTER TABLE members ADD COLUMN IF NOT EXISTS exercise_experience text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS lesson_goal text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
