-- Permanent, forward-only quote archive. Apply before deploying /history.
-- Capture is in the SAME transaction as each source-price write: neither can
-- succeed alone. Current-price pruning has no effect on this archive.
BEGIN;
CREATE TABLE IF NOT EXISTS public.price_history_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  start_date date NOT NULL
);
INSERT INTO public.price_history_settings VALUES (true, DATE '2026-09-20')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.price_history_revisions (
  revision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_key text NOT NULL,
  identity jsonb NOT NULL,
  report_date date NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  quote jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS price_history_series_date
ON public.price_history_revisions(series_key, report_date, revision_id DESC);
CREATE INDEX IF NOT EXISTS price_history_row_hash
ON public.price_history_revisions((quote->>'row_hash'), revision_id DESC);

-- Exact case-sensitive specifications. No fuzzy variety/origin matches. The
-- currency is USD, as supplied by this importer; prices are per stated package.
CREATE OR REPLACE FUNCTION public.price_history_identity(q jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT jsonb_object_agg(k, to_jsonb(coalesce(btrim(q->>k), '')))
   || jsonb_build_object('currency', 'USD', 'organic', coalesce((q->>'organic')::boolean,false),
     -- Qualified comments sometimes contain the price itself. Keep the
     -- qualifier in the identity without making each new price a new SKU.
     'source_dimensions', (SELECT jsonb_object_agg(d, to_jsonb(coalesce(btrim(q->'source_record'->>d),''))) FROM unnest(ARRAY['environment','repack','storage','crop','transportation_mode','unit_sales','special_notes']) AS d),
     'notes', regexp_replace(coalesce(q->>'notes',''),
       '(one lot|a lot|few|some) [0-9]+\.[0-9]{2}(\s*[-–]\s*[0-9]+\.[0-9]{2})?', '\1', 'gi'))
 FROM unnest(ARRAY['source_report','market_type','commodity_type','market',
   'commodity','variety','origin','package','size','grade','quality','quality_note',
   'properties','appearance','condition','price_qualifier']) AS k;
$$;

CREATE OR REPLACE FUNCTION public.capture_price_history(q jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  spec jsonb; key text; day date; previous public.price_history_revisions;
  today date := (current_timestamp AT TIME ZONE 'America/New_York')::date;
  amount numeric; field text; normalized jsonb; source_day text;
BEGIN
  day := (q->>'report_date')::date;
  IF day IS NULL THEN RAISE EXCEPTION 'Price history requires a source report date'; END IF;
  IF day < (SELECT start_date FROM public.price_history_settings WHERE singleton) THEN RETURN; END IF;
  IF day > today THEN RAISE EXCEPTION 'Future source report date: %', day; END IF;
  IF q->>'market_type' = 'terminal' THEN
    source_day := coalesce(q->'source_record'->>'report_date',q->'source_record'->>'report_begin_date');
    IF source_day IS NULL OR source_day !~ '^\d{2}/\d{2}/\d{4}$'
       OR to_char(day, 'MM/DD/YYYY') <> source_day THEN
      RAISE EXCEPTION 'Terminal quote date must match the original USDA source record';
    END IF;
  END IF;
  IF coalesce(q->>'row_hash','') = '' OR coalesce(q->>'commodity','') = ''
     OR coalesce(q->>'market','') = '' OR coalesce(q->>'source_report','') = '' THEN
    RAISE EXCEPTION 'Missing quote identity';
  END IF;
  -- Numeric storage retains the source decimal prices, never a chart midpoint.
  FOREACH field IN ARRAY ARRAY['price_low','price_high','price_mostly_low','price_mostly_high'] LOOP
    amount := (q->>field)::numeric;
    IF amount < 0 OR amount::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'Invalid historical price in %', field;
    END IF;
  END LOOP;
  IF (q->>'price_low')::numeric > (q->>'price_high')::numeric
     OR (q->>'price_mostly_low')::numeric > (q->>'price_mostly_high')::numeric THEN
    RAISE EXCEPTION 'Reversed historical price range';
  END IF;
  spec := public.price_history_identity(q);
  key := md5(spec::text);
  -- Serialize simultaneous retries/corrections for this series/date.
  PERFORM pg_advisory_xact_lock(hashtextextended(key || day::text, 0));
  SELECT * INTO previous FROM public.price_history_revisions
    WHERE series_key = key AND report_date = day ORDER BY revision_id DESC LIMIT 1;
  IF previous.revision_id IS NOT NULL AND previous.identity <> spec THEN
    RAISE EXCEPTION 'Historical series hash collision';
  END IF;
  normalized := q - ARRAY['id','created_at','updated_at'];
  IF previous.quote = normalized THEN RETURN; END IF;
  INSERT INTO public.price_history_revisions(series_key,identity,report_date,quote)
    VALUES (key,spec,day,normalized);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_price_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.capture_price_history(to_jsonb(NEW));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS archive_price_write ON public.produce_prices;
CREATE TRIGGER archive_price_write AFTER INSERT OR UPDATE ON public.produce_prices
FOR EACH ROW EXECUTE FUNCTION public.archive_price_write();

CREATE OR REPLACE FUNCTION public.reject_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Price history is append-only'; END;
$$;
DROP TRIGGER IF EXISTS immutable_price_history ON public.price_history_revisions;
CREATE TRIGGER immutable_price_history BEFORE UPDATE OR DELETE OR TRUNCATE
ON public.price_history_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.reject_history_mutation();

CREATE OR REPLACE FUNCTION public.read_price_history(p_row_hash text, p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q jsonb; spec jsonb; key text; result jsonb; beginning date;
BEGIN
  IF p_days < 1 OR p_days > 366 OR length(p_row_hash) > 128 THEN
    RAISE EXCEPTION 'Invalid history request';
  END IF;
  SELECT start_date INTO beginning FROM public.price_history_settings WHERE singleton;
  SELECT to_jsonb(p) INTO q FROM public.produce_prices p WHERE row_hash = p_row_hash LIMIT 1;
  IF q IS NULL THEN
    SELECT quote INTO q FROM public.price_history_revisions
      WHERE quote->>'row_hash' = p_row_hash ORDER BY revision_id DESC LIMIT 1;
  END IF;
  IF q IS NULL THEN
    RETURN jsonb_build_object('start_date',beginning,'found',false,'observations','[]'::jsonb);
  END IF;
  spec := public.price_history_identity(q); key := md5(spec::text);
  SELECT coalesce(jsonb_agg(latest.quote || jsonb_build_object(
      'history_revision', latest.revision_id, 'recorded_at',latest.observed_at)
      ORDER BY latest.report_date), '[]'::jsonb) INTO result
  FROM (
    SELECT DISTINCT ON (report_date) report_date,quote,revision_id,observed_at
    FROM public.price_history_revisions
    WHERE series_key = key AND identity = spec
      AND report_date >= greatest(beginning,
        (current_timestamp AT TIME ZONE 'America/New_York')::date - (p_days - 1))
      AND report_date <= (current_timestamp AT TIME ZONE 'America/New_York')::date
    ORDER BY report_date, revision_id DESC
  ) latest;
  RETURN jsonb_build_object('start_date',beginning,'found',true,'series_key',key,
    'observations',result);
END;
$$;

-- Archive any eligible rows already imported since launch; never backfill
-- older reports. Rerunning the migration does not move the start date.
SELECT public.capture_price_history(to_jsonb(p)) FROM public.produce_prices p
WHERE report_date >= (SELECT start_date FROM public.price_history_settings WHERE singleton);

ALTER TABLE public.price_history_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_history_settings, public.price_history_revisions FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_price_history(jsonb), public.archive_price_write(),
  public.read_price_history(text,integer), public.reject_history_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_price_history(text,integer) TO service_role;
-- No direct client or service writes: source-table trigger owns all capture.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_history_revisions FROM service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
