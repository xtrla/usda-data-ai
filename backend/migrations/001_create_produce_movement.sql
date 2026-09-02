-- ================================================================
-- AgraX — produce_movement table
-- ================================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query)
-- This creates the table that the /movement/* API endpoints read from,
-- and that ingest_movement.py writes to.
-- ================================================================

-- Create the table
CREATE TABLE IF NOT EXISTS produce_movement (
    id              BIGSERIAL PRIMARY KEY,
    row_hash        TEXT UNIQUE NOT NULL,
    report_date     DATE NOT NULL,
    commodity       TEXT NOT NULL,
    origin_code     TEXT,           -- 2-letter state/country code (e.g. "CA", "MX")
    origin_name     TEXT,           -- Full name (e.g. "California", "Mexico")
    trans_mode      TEXT,           -- Short code: T, R, A, B, I
    trans_mode_full TEXT,           -- Full name: Truck, Rail, Air, Boat, Import
    total_pounds    BIGINT NOT NULL DEFAULT 0,
    is_correction   BOOLEAN DEFAULT FALSE,
    source_report   TEXT,           -- e.g. "WA_FV170"
    slug_id         INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the queries the API makes
CREATE INDEX IF NOT EXISTS idx_mv_report_date ON produce_movement (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_commodity ON produce_movement (commodity);
CREATE INDEX IF NOT EXISTS idx_mv_date_commodity ON produce_movement (report_date, commodity);
CREATE INDEX IF NOT EXISTS idx_mv_row_hash ON produce_movement (row_hash);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_movement_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movement_updated_at ON produce_movement;
CREATE TRIGGER movement_updated_at
    BEFORE UPDATE ON produce_movement
    FOR EACH ROW
    EXECUTE FUNCTION update_movement_timestamp();

-- Enable RLS but allow service role full access
ALTER TABLE produce_movement ENABLE ROW LEVEL SECURITY;

-- Public read access (the API uses the service key, but just in case)
CREATE POLICY IF NOT EXISTS "Public read access" ON produce_movement
    FOR SELECT
    USING (true);

-- Service role full access (for ingestion)
CREATE POLICY IF NOT EXISTS "Service role full access" ON produce_movement
    USING (true)
    WITH CHECK (true);
