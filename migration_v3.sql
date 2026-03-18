-- ============================================================
-- agraX: produce_prices schema migration v3
-- Adds commodity_type column for Veg / Fruit / Onions & Potatoes / Nuts
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add commodity_type column
ALTER TABLE produce_prices
  ADD COLUMN IF NOT EXISTS commodity_type text DEFAULT 'vegetables';

-- 2. Backfill existing rows based on source_report suffix
UPDATE produce_prices SET commodity_type = 'vegetables'       WHERE source_report ILIKE '%FV020%';
UPDATE produce_prices SET commodity_type = 'fruits'           WHERE source_report ILIKE '%FV010%' OR source_report ILIKE '%FV110%' OR source_report ILIKE '%FV111%';
UPDATE produce_prices SET commodity_type = 'onions_potatoes'  WHERE source_report ILIKE '%FV030%' OR source_report ILIKE '%FV120%';
UPDATE produce_prices SET commodity_type = 'nuts'             WHERE source_report ILIKE '%FV040%' OR source_report ILIKE '%FV140%';

-- 3. Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_produce_commodity_type
  ON produce_prices (commodity_type);

CREATE INDEX IF NOT EXISTS idx_produce_commodity_type_date
  ON produce_prices (commodity_type, report_date DESC);

-- ============================================================
-- HOTFIX: Drop legacy unique index that conflicts with row_hash upsert
-- The old idx_produce_unique uses price columns in the key which causes
-- conflicts when the same row exists with slightly different prices.
-- Our row_hash index (uq_row_hash / uq_produce_daily_row) is the correct one.
-- ============================================================
DROP INDEX IF EXISTS idx_produce_unique;
ALTER TABLE produce_prices DROP CONSTRAINT IF EXISTS idx_produce_unique;
