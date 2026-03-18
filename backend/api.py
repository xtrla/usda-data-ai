"""
agraX API v3 — FastAPI backend
Updated for new produce_prices schema with package, size, grade, quality_note, etc.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client
from typing import Optional
import os

app = FastAPI(title="agraX API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
TABLE = "produce_prices"

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "version": "3.0.0", "service": "agraX API"}


# ── Dates ─────────────────────────────────────────────────────────────────────

@app.get("/dates")
def get_dates(market_type: Optional[str] = None):
    """Return the last 30 available report dates with record counts."""
    try:
        q = supabase.table(TABLE).select("report_date, market_type").order("report_date", desc=True).limit(100000)
        if market_type:
            q = q.eq("market_type", market_type)
        result = q.execute()

        if not result.data:
            return []

        counts: dict[str, int] = {}
        for row in result.data:
            d = row["report_date"]
            counts[d] = counts.get(d, 0) + 1

        dates = [{"date": d, "count": c} for d, c in counts.items()]
        dates.sort(key=lambda x: x["date"], reverse=True)
        return dates[:30]
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Commodities by date ───────────────────────────────────────────────────────

@app.get("/commodities/by-date/{report_date}")
def get_by_date(
    report_date: str,
    market_type: Optional[str] = None,
    market: Optional[str] = None,
    commodity: Optional[str] = None,
    organic: Optional[bool] = None,
):
    """
    Return all produce_prices rows for a given date.
    Supports filtering by market_type, market, commodity, organic.
    """
    try:
        q = (
            supabase.table(TABLE)
            .select("*")
            .eq("report_date", report_date)
            .limit(50000)
        )
        if market_type:
            q = q.eq("market_type", market_type)
        if market:
            q = q.eq("market", market)
        if commodity:
            q = q.ilike("commodity", f"%{commodity}%")
        if organic is not None:
            q = q.eq("organic", organic)

        result = q.execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Commodity detail — all prices across sizes/grades for one commodity ───────

@app.get("/commodity/{commodity}")
def get_commodity(
    commodity: str,
    report_date: Optional[str] = None,
    market: Optional[str] = None,
    market_type: Optional[str] = None,
    organic: Optional[bool] = None,
    limit: int = Query(default=500, le=2000),
):
    """
    Return all listings for a commodity, grouped ready for the detail page.
    If no date given, returns the most recent report date available.
    """
    try:
        # Resolve latest date if not supplied
        if not report_date:
            date_res = (
                supabase.table(TABLE)
                .select("report_date")
                .ilike("commodity", f"%{commodity}%")
                .order("report_date", desc=True)
                .limit(1)
                .execute()
            )
            if not date_res.data:
                return {"rows": [], "report_date": None}
            report_date = date_res.data[0]["report_date"]

        q = (
            supabase.table(TABLE)
            .select("*")
            .ilike("commodity", f"%{commodity}%")
            .eq("report_date", report_date)
            .limit(limit)
        )
        if market:
            q = q.eq("market", market)
        if market_type:
            q = q.eq("market_type", market_type)
        if organic is not None:
            q = q.eq("organic", organic)

        result = q.execute()
        rows = result.data or []

        # Sort: market → variety → size
        def sort_key(r):
            size_val = r.get("size") or "zzz"
            # sort numerically by extracting leading digits
            import re
            m = re.match(r"(\d+)", size_val)
            size_num = int(m.group(1)) if m else 9999
            return (r.get("market") or "", r.get("variety") or "", size_num)

        rows.sort(key=sort_key)
        return {"rows": rows, "report_date": report_date}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Price trend — one commodity over time ─────────────────────────────────────

@app.get("/commodity/{commodity}/trend")
def get_trend(
    commodity: str,
    market: Optional[str] = None,
    variety: Optional[str] = None,
    size: Optional[str] = None,
    days: int = Query(default=30, le=90),
):
    """
    Return avg price_low per report_date for sparklines / trend charts.
    Optionally filter by market, variety, size for an apples-to-apples comparison.
    """
    try:
        q = (
            supabase.table(TABLE)
            .select("report_date, price_low, price_high, market, variety, size")
            .ilike("commodity", f"%{commodity}%")
            .order("report_date", desc=True)
            .limit(days * 20)  # over-fetch, aggregate in Python
        )
        if market:
            q = q.eq("market", market)
        if variety:
            q = q.ilike("variety", f"%{variety}%")
        if size:
            q = q.eq("size", size)

        result = q.execute()
        rows = result.data or []

        # Aggregate avg price per date
        by_date: dict[str, list[float]] = {}
        for r in rows:
            d = r["report_date"]
            p = r.get("price_low")
            if p is not None:
                by_date.setdefault(d, []).append(float(p))

        trend = [
            {
                "date": d,
                "avg_price": round(sum(prices) / len(prices), 2),
                "min_price": min(prices),
                "max_price": max(prices),
                "listing_count": len(prices),
            }
            for d, prices in sorted(by_date.items())
        ][-days:]

        return trend
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Markets ───────────────────────────────────────────────────────────────────

@app.get("/markets")
def get_markets(market_type: Optional[str] = None):
    """Return distinct markets with listing counts."""
    try:
        q = supabase.table(TABLE).select("market, market_type")
        if market_type:
            q = q.eq("market_type", market_type)
        result = q.execute()

        counts: dict[str, dict] = {}
        for row in result.data or []:
            m = row["market"]
            if m not in counts:
                counts[m] = {"market": m, "type": row.get("market_type"), "count": 0}
            counts[m]["count"] += 1

        return sorted(counts.values(), key=lambda x: -x["count"])
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/search")
def search(
    q: str,
    limit: int = Query(default=100, le=500),
    market_type: Optional[str] = None,
):
    """Search commodities by name. Returns latest price for each match."""
    try:
        query = (
            supabase.table(TABLE)
            .select("commodity, market, variety, origin, price_low, price_high, size, grade, quality_note, organic, report_date, market_type")
            .ilike("commodity", f"%{q}%")
            .order("report_date", desc=True)
            .limit(limit)
        )
        if market_type:
            query = query.eq("market_type", market_type)

        result = query.execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/freshness")
def get_freshness():
    """
    Return the most recent report_date in the DB per market type.
    Used by frontend to show honest data freshness, not today's date.
    """
    try:
        result = (
            supabase.table(TABLE)
            .select("report_date, market_type, market, source_report")
            .order("report_date", desc=True)
            .limit(10000)
            .execute()
        )
        if not result.data:
            return {"terminal": None, "shipping_point": None, "latest": None, "by_market": {}}

        terminal_date   = None
        shipping_date   = None
        by_market: dict = {}

        for row in result.data:
            mt     = row.get("market_type")
            market = row.get("market", "")
            rd     = row.get("report_date")
            if not rd:
                continue
            if mt == "terminal" and (terminal_date is None or rd > terminal_date):
                terminal_date = rd
            if mt == "shipping_point" and (shipping_date is None or rd > shipping_date):
                shipping_date = rd
            if market and (market not in by_market or rd > by_market[market]):
                by_market[market] = rd

        latest = max(filter(None, [terminal_date, shipping_date]), default=None)
        return {
            "terminal":       terminal_date,
            "shipping_point": shipping_date,
            "latest":         latest,
            "by_market":      by_market,
        }
    except Exception as e:
        raise HTTPException(500, str(e))



    """Dashboard stats: total records, unique commodities, markets, dates."""
    try:
        result = (
            supabase.table(TABLE)
            .select("commodity, market, report_date, organic")
            .limit(200000)
            .execute()
        )
        if not result.data:
            return {"total_records": 0, "commodities": 0, "markets": 0, "dates": 0, "organic_count": 0}

        commodities, markets, dates, organic_count = set(), set(), set(), 0
        for row in result.data:
            commodities.add(row["commodity"])
            markets.add(row["market"])
            dates.add(row["report_date"])
            if row.get("organic"):
                organic_count += 1

        return {
            "total_records": len(result.data),
            "commodities": len(commodities),
            "markets": len(markets),
            "dates": len(dates),
            "organic_count": organic_count,
        }
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Price movers — for home page ──────────────────────────────────────────────

@app.get("/movers")
def get_movers(
    market_type: str = "terminal",
    days_back: int = Query(default=7, le=30),
):
    """
    Return commodities with the biggest price change over the last N days.
    Used on the home page for Rising/Falling cards.
    """
    try:
        result = (
            supabase.table(TABLE)
            .select("commodity, price_low, report_date")
            .eq("market_type", market_type)
            .order("report_date", desc=True)
            .limit(100000)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return {"rising": [], "falling": []}

        # Group by commodity → list of (date, price) sorted desc
        from collections import defaultdict
        by_commodity: dict[str, list] = defaultdict(list)
        for r in rows:
            by_commodity[r["commodity"]].append((r["report_date"], float(r["price_low"])))

        for c in by_commodity:
            by_commodity[c].sort(key=lambda x: x[0], reverse=True)

        movers = []
        for commodity, entries in by_commodity.items():
            if len(entries) < 2:
                continue
            # Latest price
            latest_price = sum(p for _, p in entries[:5]) / min(5, len(entries))
            # Price N days ago (approximate by taking oldest in recent window)
            old_entries = [p for d, p in entries if d < entries[0][0]]
            if not old_entries:
                continue
            old_price = sum(old_entries[:5]) / min(5, len(old_entries))
            if old_price == 0:
                continue

            dollar_change = latest_price - old_price
            pct_change = (dollar_change / old_price) * 100

            movers.append({
                "commodity": commodity,
                "price": round(latest_price, 2),
                "dollar_change": round(dollar_change, 2),
                "pct_change": round(pct_change, 1),
            })

        movers.sort(key=lambda x: x["pct_change"])
        falling = [m for m in movers if m["pct_change"] < -2][:6]
        rising = [m for m in movers if m["pct_change"] > 2][:6]
        rising.sort(key=lambda x: -x["pct_change"])

        return {"rising": rising, "falling": falling}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Live verification endpoint ─────────────────────────────────────────────────

@app.get("/verify")
def verify_live(
    commodity: str = Query(..., description="Commodity name e.g. 'Cilantro'"),
    slug_id: Optional[int] = Query(default=2315, description="MARS slug ID (default: NX_FV020 New York terminal)"),
    date: Optional[str] = Query(default=None, description="Report date MM/DD/YYYY (default: latest)"),
):
    """
    Live verification tool — calls the MARS API directly and returns:
    1. Raw API rows for the commodity (what USDA actually says)
    2. What's stored in our DB for the same commodity
    3. Side-by-side diff of key price fields

    Use this to verify data integrity without waiting for a workflow run.
    Example: /verify?commodity=Cilantro
    Example: /verify?commodity=Artichokes&slug_id=2403
    """
    import requests
    from datetime import date as date_cls

    MARS_KEY = os.getenv("MARS_API_KEY", "")
    MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"

    if not MARS_KEY:
        raise HTTPException(503, "MARS_API_KEY not configured on this server")

    # ── 1. Fetch from MARS API live ──────────────────────────────────────────
    url = f"{MARS_BASE}/reports/{slug_id}/report details"
    params = {}
    if date:
        params["q"] = f"report_date={date}"
    else:
        params["lastReports"] = 1

    try:
        resp = requests.get(url, params=params, auth=(MARS_KEY, ""), timeout=15)
        resp.raise_for_status()
        raw = resp.json()
        all_rows = raw if isinstance(raw, list) else raw.get("results", [])
    except Exception as e:
        raise HTTPException(502, f"MARS API error: {e}")

    # Filter to requested commodity (case-insensitive)
    comm_lower = commodity.lower()
    live_rows = [
        r for r in all_rows
        if (r.get("commodity") or "").lower() == comm_lower
    ]

    # Get report date from data
    live_date = all_rows[0].get("report_date") if all_rows else None

    # Summarise live rows — key fields only
    live_summary = []
    for r in live_rows:
        live_summary.append({
            "commodity":    r.get("commodity"),
            "variety":      r.get("variety") or r.get("var"),
            "origin":       r.get("origin") or r.get("district") or r.get("reporting_city"),
            "size":         r.get("item_size"),
            "package":      r.get("package") or r.get("pkg"),
            "price_low":    r.get("low_price"),
            "price_high":   r.get("high_price"),
            "movement":     r.get("movement") or r.get("market_tone_comments", "")[:80],
        })

    # ── 2. Fetch from our DB ─────────────────────────────────────────────────
    try:
        db_result = (
            supabase.table(TABLE)
            .select("commodity,variety,origin,size,package,price_low,price_high,movement,report_date,market,market_type")
            .ilike("commodity", f"%{commodity}%")
            .eq("slug_id", str(slug_id))
            .order("report_date", desc=True)
            .limit(50)
            .execute()
        )
        db_rows = db_result.data or []
    except Exception as e:
        db_rows = []

    db_date = db_rows[0]["report_date"] if db_rows else None

    # ── 3. Diff summary ──────────────────────────────────────────────────────
    live_prices = sorted(set(
        float(r["price_low"]) for r in live_summary if r["price_low"] is not None
    ))
    db_prices = sorted(set(
        float(r["price_low"]) for r in db_rows if r.get("price_low") is not None
    ))

    prices_match = live_prices == db_prices
    date_match   = live_date and db_date and live_date.split("/")[2] in db_date

    return {
        "status": "✅ MATCH" if (prices_match and date_match) else "⚠️ MISMATCH",
        "commodity": commodity,
        "slug_id": slug_id,
        "dates": {
            "mars_api":  live_date,
            "our_db":    db_date,
            "match":     date_match,
        },
        "row_counts": {
            "mars_api":  len(live_rows),
            "our_db":    len(db_rows),
        },
        "prices": {
            "mars_api":  live_prices,
            "our_db":    db_prices,
            "match":     prices_match,
        },
        "mars_api_raw":  live_summary,
        "our_db_rows":   db_rows,
    }
