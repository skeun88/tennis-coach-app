-- Add reference_id/reference_type for deep linking from notifications
ALTER TABLE member_notifications
  ADD COLUMN IF NOT EXISTS reference_id uuid,
  ADD COLUMN IF NOT EXISTS reference_type text;

-- Allow members to read their own notifications
CREATE POLICY "members read own notifications" ON member_notifications
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM members
    WHERE members.id = member_notifications.member_id
      AND members.auth_user_id = auth.uid()
  )
);

-- Allow members to mark their own notifications as read
CREATE POLICY "members update own notification read status" ON member_notifications
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM members
    WHERE members.id = member_notifications.member_id
      AND members.auth_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM members
    WHERE members.id = member_notifications.member_id
      AND members.auth_user_id = auth.uid()
  )
);
