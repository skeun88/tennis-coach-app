-- lesson_plans 테이블에 transcript_summary 컬럼 추가
-- GPT-4o-mini가 추출한 요약본 영구 보관 (key_techniques, main_issues, lesson_flow, coach_instructions)
ALTER TABLE lesson_plans
  ADD COLUMN IF NOT EXISTS transcript_summary JSONB DEFAULT NULL;

-- 인덱스: key_techniques 배열 검색 (장기 트렌드 분석용)
CREATE INDEX IF NOT EXISTS idx_lesson_plans_transcript_summary
  ON lesson_plans USING GIN (transcript_summary);

-- Supabase Cron 등록: cleanup-transcripts 함수 매일 새벽 3시 실행
-- Supabase Dashboard > Database > Extensions에서 pg_cron 활성화 후 실행
-- SELECT cron.schedule(
--   'cleanup-old-transcripts',
--   '0 3 * * *',
--   $$
--     SELECT net.http_post(
--       url := current_setting('app.supabase_url') || '/functions/v1/cleanup-transcripts',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     )
--   $$
-- );
