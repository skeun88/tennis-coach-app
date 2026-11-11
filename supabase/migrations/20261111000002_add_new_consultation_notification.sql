-- notification_settings에 new_consultation 컬럼 추가
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS new_consultation boolean NOT NULL DEFAULT true;

-- 신규 상담 문의 발생 시 코치에게 push 발송하는 트리거 함수
CREATE OR REPLACE FUNCTION notify_coach_new_web_inquiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- source='web' 인 신규 상담 문의에만 발동
  IF NEW.source = 'web' AND NEW.coach_id IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://luhuiwyhewofjxnbzbdt.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1aHVpd3loZXdvZmp4bmJ6YmR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTcwNDIwNiwiZXhwIjoyMDkxMjgwMjA2fQ.6_BsBH3nVscOQbuNRJv0OBDEkN7f7ZNstwkB6av4Cms'
      ),
      body    := jsonb_build_object(
        'recipient_type', 'coach',
        'recipient_id',   NEW.coach_id,
        'title',          '신규 상담 문의',
        'body',           COALESCE(NEW.guest_name, '신규 고객') || '님의 레슨 상담 문의가 도착했어요.',
        'data',           jsonb_build_object('screen', 'consultations'),
        'notif_id',       'PN-19'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 트리거 등록 (기존 트리거 있으면 먼저 제거)
DROP TRIGGER IF EXISTS trg_notify_new_web_inquiry ON lesson_requests;

CREATE TRIGGER trg_notify_new_web_inquiry
  AFTER INSERT ON lesson_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_coach_new_web_inquiry();
