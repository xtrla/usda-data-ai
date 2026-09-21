-- Apply before enabling NEWSLETTER_DELIVERY_ENABLED on ingestion and sender.
BEGIN;
CREATE TABLE public.newsletter_reports (
 market text NOT NULL, category text NOT NULL, report_date date NOT NULL,
 ready boolean NOT NULL DEFAULT false, row_count integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(market,category,report_date)
);
CREATE TABLE public.newsletter_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscriber_id uuid NOT NULL REFERENCES public.subscribers(id),
 market text NOT NULL, category text NOT NULL, report_date date NOT NULL,
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','accepted','uncertain','cancelled')),
 provider_id text, manage_token_hash text NOT NULL UNIQUE,
 manage_expires_at timestamptz NOT NULL DEFAULT now()+interval '1 year',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(subscriber_id,market,category,report_date)
);
ALTER TABLE public.newsletter_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_reports, public.newsletter_deliveries FROM anon, authenticated;
GRANT ALL ON public.newsletter_reports, public.newsletter_deliveries TO service_role;
CREATE FUNCTION public.newsletter_claim(p_subscriber uuid,p_market text,p_category text,p_date date,p_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF p_date <> (now() AT TIME ZONE 'America/New_York')::date THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM subscribers WHERE id=p_subscriber AND confirmed AND NOT unsubscribed
   AND report_preferences @> jsonb_build_array(jsonb_build_object('market',p_market,'category',p_category))) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM newsletter_reports WHERE market=p_market AND category=p_category AND report_date=p_date AND ready AND row_count>0) THEN RETURN NULL; END IF;
 INSERT INTO newsletter_deliveries(subscriber_id,market,category,report_date,manage_token_hash)
 VALUES(p_subscriber,p_market,p_category,p_date,p_hash)
 ON CONFLICT(subscriber_id,market,category,report_date) DO NOTHING RETURNING id INTO result;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.newsletter_claim(uuid,text,text,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_claim(uuid,text,text,date,text) TO service_role;
COMMIT;
