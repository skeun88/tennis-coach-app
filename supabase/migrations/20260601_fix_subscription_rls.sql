-- subscriptions INSERT 정책 명시적 추가
-- (FOR ALL의 USING은 INSERT WITH CHECK에 적용 안 될 수 있음)

DROP POLICY IF EXISTS "coach own subscription" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_select" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_update" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete" ON subscriptions;

CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (auth.uid() = coach_id);

CREATE POLICY "subscriptions_insert" ON subscriptions
  FOR INSERT WITH CHECK (auth.uid() = coach_id);

CREATE POLICY "subscriptions_update" ON subscriptions
  FOR UPDATE USING (auth.uid() = coach_id);

CREATE POLICY "subscriptions_delete" ON subscriptions
  FOR DELETE USING (auth.uid() = coach_id);

-- subscription_logs 동일 처리
DROP POLICY IF EXISTS "coach own logs" ON subscription_logs;
DROP POLICY IF EXISTS "logs_select" ON subscription_logs;
DROP POLICY IF EXISTS "logs_insert" ON subscription_logs;

CREATE POLICY "logs_select" ON subscription_logs
  FOR SELECT USING (auth.uid() = coach_id);

CREATE POLICY "logs_insert" ON subscription_logs
  FOR INSERT WITH CHECK (auth.uid() = coach_id);
