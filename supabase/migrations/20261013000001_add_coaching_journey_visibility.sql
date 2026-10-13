-- 코칭 여정 카드 공개 설정 및 집계 스냅샷
-- 적용 전 확인 필요: supabase db push --linked

ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS show_coaching_journey boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS journey_snapshot jsonb DEFAULT null;

COMMENT ON COLUMN public.coach_profiles.show_coaching_journey IS
  '코칭 여정 카드 회원 공개 여부 (기본: 비공개)';
COMMENT ON COLUMN public.coach_profiles.journey_snapshot IS
  '공개 전환 시 저장되는 집계 스냅샷 {"members_count":N,"lessons_count":N,"reports_count":N}';
