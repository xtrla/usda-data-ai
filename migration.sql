-- ============================================================
-- agraX: produce_prices schema migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add new columns to existing table (non-destructive)
ALTER TABLE produce_prices
  ADD COLUMN IF NOT EXISTS package          text,
  ADD COLUMN IF NOT EXISTS size             text,
  ADD COLUMN IF NOT EXISTS grade            text,
  ADD COLUMN IF NOT EXISTS quality_note     text,
  ADD COLUMN IF NOT EXISTS organic          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_high       numeric(8,2),
  ADD COLUMN IF NOT EXISTS price_mostly_low  numeric(8,2),
  ADD COLUMN IF NOT EXISTS price_mostly_high numeric(8,2),
  ADD COLUMN IF NOT EXISTS movement         text,
  ADD COLUMN IF NOT EXISTS trading_activity text,
  ADD COLUMN IF NOT EXISTS supply_note      text,
  ADD COLUMN IF NOT EXISTS slug_id          integer,
  ADD COLUMN IF NOT EXISTS source_report    text;

-- 2. Rename price_low to be explicit (safe — keeps existing data)
-- If your column is already named price_low, skip this.
-- ALTER TABLE produce_prices RENAME COLUMN price_low TO price_low;

-- 3. Indexes for fast filtering and trend queries
CREATE INDEX IF NOT EXISTS idx_produce_commodity
  ON produce_prices (commodity);

CREATE INDEX IF NOT EXISTS idx_produce_date
  ON produce_prices (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_produce_market_date
  ON produce_prices (market, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_produce_commodity_date
  ON produce_prices (commodity, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_produce_market_type
  ON produce_prices (market_type);

-- 4. Composite unique constraint to prevent duplicate ingestion
--    (same report, same commodity+market+variety+package+size+quality on same day)
ALTER TABLE produce_prices
  DROP CONSTRAINT IF EXISTS uq_produce_daily_row;

ALTER TABLE produce_prices
  ADD CONSTRAINT uq_produce_daily_row UNIQUE (
    report_date,
    source_report,
    market,
    commodity,
    variety,
    origin,
    package,
    size,
    quality_note,
    organic
  );

-- 5. Helpful view: latest date per market for the API /dates endpoint
CREATE OR REPLACE VIEW produce_prices_dates AS
SELECT
  report_date,
  market_type,
  COUNT(*) AS record_count
FROM produce_prices
GROUP BY report_date, market_type
ORDER BY report_date DESC;

-- 6. Helpful view: commodity summary with price range across all markets
CREATE OR REPLACE VIEW commodity_summary AS
SELECT
  report_date,
  commodity,
  variety,
  origin,
  organic,
  COUNT(*)                          AS listing_count,
  MIN(price_low)                    AS price_min,
  MAX(COALESCE(price_high, price_low)) AS price_max,
  ROUND(AVG(price_low)::numeric, 2) AS price_avg
FROM produce_prices
GROUP BY report_date, commodity, variety, origin, organic;
