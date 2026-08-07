-- coach_availability RLS: public → authenticated
-- anon 키로 전체 코치 가용시간 조회를 막기 위해 authenticated role로 제한

DROP POLICY IF EXISTS "members read coach availability" ON coach_availability;
DROP POLICY IF EXISTS "coaches manage own availability" ON coach_availability;

CREATE POLICY "members read coach availability"
  ON coach_availability FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "coaches manage own availability"
  ON coach_availability FOR ALL
  TO authenticated
  USING (auth.uid() = coach_id)
  WITH CHECK (auth.uid() = coach_id);
