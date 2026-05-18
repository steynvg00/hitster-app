CREATE TABLE IF NOT EXISTS host_whitelist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  added_by uuid REFERENCES auth.users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  is_super_admin boolean NOT NULL DEFAULT false,
  notes text
);

-- Case-insensitive email lookups
CREATE INDEX IF NOT EXISTS host_whitelist_email_idx ON host_whitelist(lower(email));

ALTER TABLE host_whitelist ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (needed for the layout-level whitelist check)
CREATE POLICY "authenticated can read host_whitelist"
ON host_whitelist FOR SELECT
TO authenticated
USING (true);

-- No INSERT/UPDATE/DELETE policies — writes only via admin client (service role).
