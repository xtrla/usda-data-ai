-- All fixtures and claims roll back; no real subscriber changes.
BEGIN;
DO $$
DECLARE sid uuid; day date := (now() AT TIME ZONE 'America/New_York')::date; first_claim uuid;
BEGIN
 INSERT INTO subscribers(email,confirmed,unsubscribed,report_preferences)
 VALUES('newsletter-check-'||gen_random_uuid()::text||'@example.invalid',true,false,
 '[{"market":"Test only","category":"vegetables"}]') RETURNING id INTO sid;
 INSERT INTO newsletter_reports(market,category,report_date,ready,row_count) VALUES('Test only','vegetables',day,false,1);
 IF newsletter_claim(sid,'Test only','vegetables',day,'check-unready') IS NOT NULL THEN RAISE EXCEPTION 'Unready report allowed'; END IF;
 UPDATE newsletter_reports SET ready=true WHERE market='Test only';
 IF newsletter_claim(sid,'Test only','vegetables',day-1,'check-old') IS NOT NULL THEN RAISE EXCEPTION 'Old report allowed'; END IF;
 IF newsletter_claim(sid,'Test only','fruits',day,'check-wrong') IS NOT NULL THEN RAISE EXCEPTION 'Wrong preference allowed'; END IF;
 UPDATE subscribers SET unsubscribed=true WHERE id=sid;
 IF newsletter_claim(sid,'Test only','vegetables',day,'check-unsubscribed') IS NOT NULL THEN RAISE EXCEPTION 'Unsubscribed allowed'; END IF;
 UPDATE subscribers SET unsubscribed=false WHERE id=sid;
 first_claim := newsletter_claim(sid,'Test only','vegetables',day,'check-first');
 IF first_claim IS NULL THEN RAISE EXCEPTION 'Valid claim refused'; END IF;
 IF newsletter_claim(sid,'Test only','vegetables',day,'check-repeat') IS NOT NULL THEN RAISE EXCEPTION 'Duplicate allowed'; END IF;
 IF has_table_privilege('anon','public.newsletter_deliveries','SELECT') THEN RAISE EXCEPTION 'Public delivery access'; END IF;
 IF has_function_privilege('anon','public.newsletter_claim(uuid,text,text,date,text)','EXECUTE') THEN RAISE EXCEPTION 'Public claim access'; END IF;
END;$$;
ROLLBACK;
SELECT 'Newsletter database checks passed; fixtures rolled back' AS result;
