-- Add consultation_status and viewed_at to lesson_requests for web inquiry management
ALTER TABLE lesson_requests
  ADD COLUMN IF NOT EXISTS consultation_status text DEFAULT 'new_inquiry',
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

-- Backfill existing web records
UPDATE lesson_requests
SET consultation_status = CASE status
  WHEN 'accepted' THEN 'consulting'
  WHEN 'rejected' THEN 'closed'
  ELSE 'new_inquiry'
END
WHERE source = 'web';
