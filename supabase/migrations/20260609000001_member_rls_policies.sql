-- ============================================================
-- 회원앱(kerri-member-app) 회원 계정 RLS 정책 추가
-- 기존: coaches 전용 policy만 있음
-- 추가: auth_user_id = auth.uid() 인 회원도 자신의 데이터 SELECT 가능
--
-- NOTE: lessons 테이블은 기존 lessons_member_view policy가 처리함
--   (coach_id 기준으로 해당 코치의 레슨 전체 접근 허용)
--   members view their lessons 는 lesson_members 순환참조 유발로 제외
-- ============================================================

-- 1. members: 자기 자신의 row 조회
DROP POLICY IF EXISTS "members view own row" ON members;
CREATE POLICY "members view own row" ON members
  FOR SELECT USING (
    auth_user_id = auth.uid() OR id = auth.uid()
  );

-- 2. lesson_members: 자신의 lesson_members 행 조회 (Realtime 포함)
--    주의: lesson_members.coaches own lesson_members 가 lessons 테이블을 참조하므로
--    lessons 에서 lesson_members 를 참조하는 policy 는 만들면 안 됨 (무한재귀)
DROP POLICY IF EXISTS "members view their lesson_members" ON lesson_members;
CREATE POLICY "members view their lesson_members" ON lesson_members
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );

-- 3. payments: 자신의 결제 내역 조회
DROP POLICY IF EXISTS "members view their payments" ON payments;
CREATE POLICY "members view their payments" ON payments
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );

-- 4. lesson_packages: 자신의 코치 패키지 조회
DROP POLICY IF EXISTS "members view coach lesson packages" ON lesson_packages;
CREATE POLICY "members view coach lesson packages" ON lesson_packages
  FOR SELECT USING (
    coach_id IN (
      SELECT coach_id FROM members WHERE auth_user_id = auth.uid() OR id = auth.uid()
    )
  );

-- 5. [안전 삭제] 만약 순환참조 유발 policy 가 존재한다면 제거
DROP POLICY IF EXISTS "members view their lessons" ON lessons;
