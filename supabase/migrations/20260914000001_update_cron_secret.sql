-- Update pg_cron jobs with new CRON_SECRET value
SELECT cron.unschedule('lesson-reminders');
SELECT cron.unschedule('process-billing-daily');

SELECT cron.schedule(
  'lesson-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://luhuiwyhewofjxnbzbdt.supabase.co/functions/v1/schedule-lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '1273f32ab1005cc606f3294a21a79a656412e47d8fd9c1d0165d1598ff825620'
    )
  );
  $$
);

SELECT cron.schedule(
  'process-billing-daily',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://luhuiwyhewofjxnbzbdt.supabase.co/functions/v1/process-billing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '1273f32ab1005cc606f3294a21a79a656412e47d8fd9c1d0165d1598ff825620'
    )
  );
  $$
);
