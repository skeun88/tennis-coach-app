-- cron job이 올바른 CRON_SECRET을 보내도록 업데이트
-- vault.decrypted_secrets 대신 직접 값을 사용 (vault UPDATE 권한 없음)
SELECT cron.unschedule('lesson-reminders');

SELECT cron.schedule(
  'lesson-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://luhuiwyhewofjxnbzbdt.supabase.co/functions/v1/schedule-lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'dd0c7416e72261cda9e659384858c85dc672a3772cdba390ecf9db6ef03e89c1'
    ),
    body := '{}'::jsonb
  );
  $$
);
