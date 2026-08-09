-- lesson-audio 버킷: AI 레슨 분석용 녹음 파일 저장
-- 경로 규칙: {coach_uid}/{timestamp}_lesson.m4a

INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-audio', 'lesson-audio', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "coach upload own lesson audio" ON storage.objects;
DROP POLICY IF EXISTS "coach read own lesson audio" ON storage.objects;
DROP POLICY IF EXISTS "coach delete own lesson audio" ON storage.objects;

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
