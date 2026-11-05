-- coach_reviews RLS 수정:
-- 기존 정책은 member_id = auth.uid() 를 요구했으나,
-- members.id가 auth.uid()와 다른 사용자(이메일 연결 등)는 차단됨.
-- auth_user_id 또는 id로 연결된 member row를 모두 허용.

DROP POLICY IF EXISTS "coach_reviews_member_write" ON public.coach_reviews;

CREATE POLICY "coach_reviews_member_write" ON public.coach_reviews
  FOR ALL USING (
    member_id IN (
      SELECT id FROM public.members
      WHERE auth_user_id = auth.uid()
         OR id = auth.uid()
    )
  );
