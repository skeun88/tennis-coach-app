-- Add sent_to_member flag to track explicit coach-initiated send
ALTER TABLE public.member_lesson_reports
  ADD COLUMN IF NOT EXISTS sent_to_member boolean NOT NULL DEFAULT false;
