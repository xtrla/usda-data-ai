-- ============================================================
-- agraX: produce_prices schema migration v2
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Drop old conflicting constraints and indexes
DROP INDEX IF EXISTS idx_produce_unique;
ALTER TABLE produce_prices DROP CONSTRAINT IF EXISTS idx_produce_unique;
ALTER TABLE produce_prices DROP CONSTRAINT IF EXISTS uq_produce_daily_row;

-- 2. Add new columns (non-destructive)
ALTER TABLE produce_prices
  ADD COLUMN IF NOT EXISTS package           text,
  ADD COLUMN IF NOT EXISTS size              text,
  ADD COLUMN IF NOT EXISTS grade             text,
  ADD COLUMN IF NOT EXISTS quality_note      text,
  ADD COLUMN IF NOT EXISTS organic           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_high        numeric(8,2),
  ADD COLUMN IF NOT EXISTS price_mostly_low  numeric(8,2),
  ADD COLUMN IF NOT EXISTS price_mostly_high numeric(8,2),
  ADD COLUMN IF NOT EXISTS movement          text,
  ADD COLUMN IF NOT EXISTS trading_activity  text,
  ADD COLUMN IF NOT EXISTS supply_note       text,
  ADD COLUMN IF NOT EXISTS slug_id           integer,
  ADD COLUMN IF NOT EXISTS source_report     text;

-- 3. Unique index using COALESCE (correct Postgres syntax)
DROP INDEX IF EXISTS uq_produce_daily_row;
CREATE UNIQUE INDEX uq_produce_daily_row ON produce_prices (
  report_date,
  COALESCE(source_report, ''),
  COALESCE(market, ''),
  COALESCE(commodity, ''),
  COALESCE(variety, ''),
  COALESCE(origin, ''),
  COALESCE(package, ''),
  COALESCE(size, ''),
  COALESCE(quality_note, ''),
  COALESCE(organic::text, 'false')
);

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_produce_commodity
  ON produce_prices (commodity);

CREATE INDEX IF NOT EXISTS idx_produce_date
  ON produce_prices (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_produce_market_date
  ON produce_prices (market, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_produce_commodity_date
  ON produce_prices (commodity, report_date DESC);
