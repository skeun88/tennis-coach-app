-- Add missing UPDATE and DELETE RLS policies for avatars bucket
-- Without UPDATE policy, x-upsert:true on existing files returns 403
-- Without DELETE policy, removing old avatars before re-upload fails

CREATE POLICY "avatar_update" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'avatars'
  AND (auth.uid())::text = (storage.foldername(name))[1]
) WITH CHECK (
  bucket_id = 'avatars'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "avatar_delete" ON storage.objects
FOR DELETE USING (
  bucket_id = 'avatars'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);
