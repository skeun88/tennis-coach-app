-- lesson-audio Storage 버킷 생성 및 RLS 정책
INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-audio', 'lesson-audio', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "coach upload own lesson audio"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "coach read own lesson audio"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "coach delete own lesson audio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
