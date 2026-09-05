-- ================================================================
-- AgraX — Watchlists, alert rules, newsletter subscribers
-- Run in Supabase SQL Editor after 001_profiles.sql.
-- Safe to re-run: every statement is guarded.
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1. WATCHLIST
--    One row per (user, commodity). Market is nullable: null means
--    "watch this commodity in whichever market I'm viewing", which
--    is how the mobile watch tab behaves today.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  commodity   TEXT NOT NULL,
  market      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user can only watch a given commodity/market pair once.
-- COALESCE lets the unique index treat null market as its own value.
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_items_unique
  ON watchlist_items (user_id, commodity, COALESCE(market, ''));

CREATE INDEX IF NOT EXISTS watchlist_items_user
  ON watchlist_items (user_id);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own watchlist" ON watchlist_items;
CREATE POLICY "Users manage own watchlist" ON watchlist_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access watchlist" ON watchlist_items;
CREATE POLICY "Service role full access watchlist" ON watchlist_items
  FOR ALL USING (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────────
-- 2. ALERT RULES
--    kind:
--      'any_move'   → fire when |week-over-week %| >= threshold
--      'price_above'→ fire when the representative price >= threshold
--      'price_below'→ fire when the representative price <= threshold
--    threshold is a percent for 'any_move', dollars otherwise.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  commodity     TEXT NOT NULL,
  market        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('any_move', 'price_above', 'price_below')),
  threshold     NUMERIC NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_fired_at TIMESTAMPTZ,
  last_value    NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_user   ON alert_rules (user_id);
CREATE INDEX IF NOT EXISTS alert_rules_active ON alert_rules (active) WHERE active;

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own alerts" ON alert_rules;
CREATE POLICY "Users manage own alerts" ON alert_rules
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access alerts" ON alert_rules;
CREATE POLICY "Service role full access alerts" ON alert_rules
  FOR ALL USING (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────────
-- 3. NEWSLETTER SUBSCRIBERS
--    Separate from auth.users on purpose: the morning-brief form
--    takes an email without forcing an account. No RLS read policy
--    for anon, so the list can't be enumerated from the browser.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  source        TEXT,
  market        TEXT,
  confirmed     BOOLEAN NOT NULL DEFAULT false,
  unsubscribed  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_unique
  ON subscribers (lower(email));

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Only the backend (service role) touches this table.
DROP POLICY IF EXISTS "Service role full access subscribers" ON subscribers;
CREATE POLICY "Service role full access subscribers" ON subscribers
  FOR ALL USING (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────────
-- 4. ALERT DELIVERY LOG
--    Lets the sender stay idempotent: one row per rule per report
--    date, so a re-run of the job can't email the same person twice.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  report_date  DATE NOT NULL,
  value        NUMERIC,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_deliveries_once
  ON alert_deliveries (rule_id, report_date);

ALTER TABLE alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access deliveries" ON alert_deliveries;
CREATE POLICY "Service role full access deliveries" ON alert_deliveries
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own deliveries" ON alert_deliveries;
CREATE POLICY "Users read own deliveries" ON alert_deliveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM alert_rules r
      WHERE r.id = alert_deliveries.rule_id AND r.user_id = auth.uid()
    )
  );
