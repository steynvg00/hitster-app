-- =============================================================================
-- Hitster — Session 8a: audio storage bucket
-- Creates (or confirms) the 'audio' bucket as public.
-- Storage object RLS: allow public SELECT so audio URLs work without auth.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio',
  'audio',
  true,
  10485760,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4',
        'audio/m4a', 'audio/aac', 'audio/flac', 'audio/webm', 'audio/x-wav']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760;

-- Public read so served URLs work without auth tokens
DO $$ BEGIN
  CREATE POLICY "Public audio read" ON storage.objects
    FOR SELECT USING (bucket_id = 'audio');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
