-- ─────────────────────────────────────────────
-- 체험 회원 컬럼 추가
-- ─────────────────────────────────────────────
alter table members
  add column if not exists is_trial boolean default false,
  add column if not exists trial_started_at date,
  add column if not exists trial_lesson_count integer default 0;
