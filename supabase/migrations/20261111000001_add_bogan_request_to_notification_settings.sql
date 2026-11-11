ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS bogan_request boolean NOT NULL DEFAULT true;
