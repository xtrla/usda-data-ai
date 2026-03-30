-- ============================================================
-- agraX — Movement Data Table
-- USDA WA_FV175: National Truck, Air & Boat Daily Movement
-- Run this in Supabase SQL editor before deploying new ingest
-- ============================================================

CREATE TABLE IF NOT EXISTS produce_movement (
    id              bigserial PRIMARY KEY,

    -- Report metadata
    report_date     date        NOT NULL,
    slug_id         integer     NOT NULL DEFAULT 3284,
    source_report   text        NOT NULL DEFAULT 'WA_FV175',

    -- Commodity
    commodity       text        NOT NULL,
    variety         text,           -- e.g. "CROWN CUT", "ICEBERG", "RED"
    organic         boolean     NOT NULL DEFAULT false,
    environment     text,           -- OF, AE, CE, GG (greenhouse)

    -- Origin
    origin_code     text        NOT NULL,   -- raw 2-4 char code: MX, CA-C, FL, GU
    origin_name     text,                   -- decoded: Mexico, California, Florida

    -- Transport
    trans_mode      text        NOT NULL,   -- T, A, B
    trans_mode_full text,                   -- Truck, Air, Boat

    -- Volume
    total_pounds    bigint,
    package_count   integer,
    units_10k       numeric(10,1),  -- total_pounds / 10000

    -- Flags
    is_weekly       boolean     NOT NULL DEFAULT false,  -- W/E flag
    is_correction   boolean     NOT NULL DEFAULT false,  -- Add/Subtract flag
    correction_date date,                                -- date the correction applies to

    -- Dedup
    row_hash        text        UNIQUE NOT NULL,

    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_movement_date
    ON produce_movement (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_movement_commodity
    ON produce_movement (commodity);

CREATE INDEX IF NOT EXISTS idx_movement_date_commodity
    ON produce_movement (report_date DESC, commodity);

CREATE INDEX IF NOT EXISTS idx_movement_origin
    ON produce_movement (origin_code);

CREATE INDEX IF NOT EXISTS idx_movement_mode
    ON produce_movement (trans_mode);

-- RLS: public read (matches existing produce_prices policy)
ALTER TABLE produce_movement ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on produce_movement"
    ON produce_movement FOR SELECT
    USING (true);

-- Comment
COMMENT ON TABLE produce_movement IS
    'USDA WA_FV175 National Truck/Air/Boat Daily Movement Report. '
    'Tracks physical volume (lbs) of produce shipments by commodity, origin, and transport mode. '
    'No price data — use produce_prices for pricing.';
