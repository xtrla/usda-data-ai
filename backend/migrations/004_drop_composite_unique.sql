-- ============================================================================
-- AgraX — migration_v4_drop_composite_unique.sql
-- ============================================================================
-- Fixes: bulk upserts hit Postgres error 23505 (unique_violation) on the
-- composite index uq_produce_daily_row even when row_hash is unique, because
-- Postgres checks ALL unique constraints before applying ON CONFLICT.
--
-- The row_hash column already fingerprints every field this composite covers,
-- so the composite is redundant. Dropping it lets on_conflict=row_hash work
-- as intended and stops mid-run failures that blanked out most markets.
--
-- Run this in the Supabase SQL editor.
-- ============================================================================

DROP INDEX IF EXISTS uq_produce_daily_row;

-- Sanity check: row_hash should be the only remaining unique thing on this
-- table besides the primary key. If this SELECT returns more than "row_hash"
-- and a pkey, another duplicate constraint exists and needs the same treatment.
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'produce_prices'
  AND (indexdef ILIKE '%unique%' OR indexname LIKE '%pkey%');
