-- Story of the Day cache
-- One row per market per date. Generated once, served to all visitors.

CREATE TABLE IF NOT EXISTS story_cache (
    id           BIGSERIAL PRIMARY KEY,
    market       TEXT NOT NULL,
    report_date  DATE NOT NULL,
    headline     TEXT,
    body         TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(market, report_date)
);

CREATE INDEX IF NOT EXISTS idx_story_market_date ON story_cache (market, report_date DESC);

ALTER TABLE story_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read" ON story_cache FOR SELECT USING (true);
