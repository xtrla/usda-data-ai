-- Apply before deploying the report-preference signup endpoint.
CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  source TEXT,
  market TEXT,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  unsubscribed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON subscribers FROM anon, authenticated;
GRANT ALL ON subscribers TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_unique ON subscribers (lower(email));
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS markets TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';
-- PostgREST's on_conflict=email needs a plain column unique index.
-- The existing lower(email) expression index remains for case-insensitivity.
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_upsert ON subscribers (email);
-- This stores interest only. Confirmation, unsubscribe handling and a
-- scheduled report-delivery process are required before sending emails.
