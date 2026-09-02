#!/usr/bin/env bash
# ================================================================
# AgraX — Full data setup
# ================================================================
# Run this from the backend/ directory with your .env loaded:
#   cd backend && source .env && bash setup_data.sh
#
# What it does:
#   1. Creates the produce_movement table (if not exists)
#   2. Runs main price ingestion (terminal + shipping point)
#   3. Runs movement ingestion (truck/air/boat volumes)
#   4. Verifies data by hitting API endpoints
# ================================================================

set -e

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  AgraX — Full Data Setup"
echo "═══════════════════════════════════════════════════════"
echo ""

# Check env vars
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set."
    echo "  export SUPABASE_URL=https://xxx.supabase.co"
    echo "  export SUPABASE_SERVICE_KEY=eyJ..."
    exit 1
fi

if [ -z "$MARS_API_KEY" ]; then
    echo "ERROR: MARS_API_KEY must be set."
    echo "  Get one free at: https://mymarketnews.ams.usda.gov"
    exit 1
fi

echo "✓ Environment variables found"
echo "  SUPABASE_URL: ${SUPABASE_URL:0:40}..."
echo "  MARS_API_KEY: ${MARS_API_KEY:0:8}..."
echo ""

# Step 1: Create produce_movement table
echo "─── Step 1: Creating produce_movement table ───"
echo "(Run migrations/001_create_produce_movement.sql in Supabase SQL Editor if not done)"
echo "Skipping auto-migration — Supabase requires SQL Editor for DDL."
echo "If you haven't created the table yet, go to:"
echo "  Supabase Dashboard → SQL Editor → paste migrations/001_create_produce_movement.sql → Run"
echo ""

# Step 2: Run main price ingestion
echo "─── Step 2: Running price ingestion (terminal + shipping point) ───"
python ingest.py
echo ""

# Step 3: Run movement ingestion
echo "─── Step 3: Running movement ingestion (truck/air/boat volumes) ───"
python ingest_movement.py
echo ""

# Step 4: Verify by starting API and hitting endpoints
echo "─── Step 4: Verification ───"
echo "Starting API server for verification..."
uvicorn api:app --host 0.0.0.0 --port 8000 &
API_PID=$!
sleep 3

echo ""
echo "Checking endpoints..."

check() {
    local name=$1
    local url=$2
    local result=$(curl -s "$url" | python3 -c "import sys,json; d=json.load(sys.stdin); print(type(d).__name__, '—', len(d) if isinstance(d, list) else json.dumps(d)[:120])" 2>/dev/null || echo "FAILED")
    echo "  $name: $result"
}

check "Health" "http://localhost:8000/"
check "Dates" "http://localhost:8000/dates"
check "Terminal (NY)" "http://localhost:8000/reports/terminal"
check "Shipping Points" "http://localhost:8000/reports/shipping-points"
check "Movement Latest" "http://localhost:8000/movement/latest"
check "Market Summary" "http://localhost:8000/market-summary?market=New%20York"
check "Week-over-Week" "http://localhost:8000/wow?market=New%20York"
check "Biggest Movers" "http://localhost:8000/movers?market=New%20York"

if [ -n "$ANTHROPIC_API_KEY" ]; then
    check "Story of the Day" "http://localhost:8000/story?market=New%20York"
else
    echo "  Story of the Day: SKIPPED (no ANTHROPIC_API_KEY)"
fi

echo ""

# Cleanup
kill $API_PID 2>/dev/null
echo "═══════════════════════════════════════════════════════"
echo "  Setup complete."
echo ""
echo "  To start the API:"
echo "    uvicorn api:app --reload --port 8000"
echo ""
echo "  New endpoints available:"
echo "    GET /market-summary?market=Dallas"
echo "    GET /wow?market=Dallas"
echo "    GET /movers?market=Dallas&limit=6"
echo "    GET /story?market=Dallas"
echo "═══════════════════════════════════════════════════════"
