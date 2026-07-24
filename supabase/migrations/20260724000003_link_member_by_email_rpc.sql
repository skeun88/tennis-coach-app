-- SECURITY DEFINER RPC: 이메일로 member row 찾고 auth_user_id 자동 링크
-- getMyMemberRow() step-3 폴백용 — members RLS를 우회해서 이메일 매칭
CREATE OR REPLACE FUNCTION get_my_member_id_by_email()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
  v_user_email TEXT;
  v_user_id UUID;
BEGIN
  SELECT id, email INTO v_user_id, v_user_email
  FROM auth.users
  WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_member_id
  FROM members
  WHERE lower(email) = lower(v_user_email)
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- auth_user_id 링크 (이후 RLS 기반 쿼리 작동)
  UPDATE members
  SET auth_user_id = v_user_id
  WHERE id = v_member_id
    AND (auth_user_id IS NULL OR auth_user_id != v_user_id);

  RETURN v_member_id;
END;
$$;
