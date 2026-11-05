-- Allow members to soft-delete individual notifications
ALTER TABLE member_notifications ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL;
