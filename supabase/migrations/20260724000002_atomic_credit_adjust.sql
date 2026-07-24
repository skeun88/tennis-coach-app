-- Atomic remaining_credits adjustment to prevent stale-read race conditions
CREATE OR REPLACE FUNCTION adjust_remaining_credits(p_member_id UUID, p_delta INT)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
AS $$
  UPDATE members
  SET remaining_credits = GREATEST(0, remaining_credits + p_delta)
  WHERE id = p_member_id;
$$;
