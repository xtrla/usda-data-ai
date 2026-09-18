-- Apply before deploying the source-preserving terminal importer/API.
-- Existing records require a verified, scoped reimport; this migration does
-- not manufacture missing fields or delete old rows.
ALTER TABLE produce_prices
  ADD COLUMN IF NOT EXISTS source_record jsonb,
  ADD COLUMN IF NOT EXISTS properties text,
  ADD COLUMN IF NOT EXISTS appearance text,
  ADD COLUMN IF NOT EXISTS quality text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS price_qualifier text;
