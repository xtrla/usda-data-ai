-- Applied during Google account setup; account owners alone can access their rows.
BEGIN;
CREATE TABLE IF NOT EXISTS public.watchlist_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 commodity text NOT NULL,
 market text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, commodity)
);
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='watchlist_items' AND policyname='Account owners manage watchlist') THEN
  CREATE POLICY "Account owners manage watchlist" ON public.watchlist_items FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
 END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist_items TO authenticated;
REVOKE ALL ON public.watchlist_items FROM anon;
COMMIT;
