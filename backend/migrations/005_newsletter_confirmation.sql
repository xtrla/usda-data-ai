-- Apply after 003 and 004. Existing subscriptions change only after email confirmation.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS report_preferences JSONB NOT NULL DEFAULT '[]';
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS manage_token_hash TEXT;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS manage_expires_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS newsletter_confirmations (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, preferences JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 day', used BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE newsletter_confirmations ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION newsletter_request(p_email TEXT,p_preferences JSONB,p_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_email,0));
 IF EXISTS(SELECT 1 FROM newsletter_confirmations WHERE email=p_email AND created_at>now()-interval '1 minute')
 OR (SELECT count(*) FROM newsletter_confirmations WHERE email=p_email AND created_at>now()-interval '1 day')>=5 THEN RETURN false; END IF;
 INSERT INTO newsletter_confirmations(token_hash,email,preferences) VALUES(p_hash,p_email,p_preferences);
 RETURN true;
END;$$;
CREATE OR REPLACE FUNCTION newsletter_confirm(p_hash TEXT,p_manage_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pending newsletter_confirmations;
BEGIN
 SELECT * INTO pending FROM newsletter_confirmations WHERE token_hash=p_hash AND NOT used AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO subscribers(email,source,confirmed,unsubscribed,report_preferences,manage_token_hash,manage_expires_at)
 VALUES(pending.email,'confirmed-reports',true,false,pending.preferences,p_manage_hash,now()+interval '30 days')
 ON CONFLICT(email) DO UPDATE SET confirmed=true,unsubscribed=false,report_preferences=EXCLUDED.report_preferences,
 manage_token_hash=EXCLUDED.manage_token_hash,manage_expires_at=EXCLUDED.manage_expires_at;
 UPDATE newsletter_confirmations SET used=true WHERE email=pending.email;
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION newsletter_request(TEXT,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION newsletter_confirm(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION newsletter_request(TEXT,JSONB,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION newsletter_confirm(TEXT,TEXT) TO service_role;
