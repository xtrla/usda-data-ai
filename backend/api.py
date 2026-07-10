from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client
import os

app = FastAPI(title="AGRA API", version="2.0.0")

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
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
MOVEMENT_TABLE = "produce_movement"

@app.get("/")
def health():
    return {"status": "ok", "version": "2.0.0", "service": "AGRA API"}

@app.get("/dates")
def get_dates():
    try:
        result = supabase.table(TABLE).select("report_date").execute()
        if not result.data:
            return []
        
        date_counts = {}
        for row in result.data:
            d = row["report_date"]
            date_counts[d] = date_counts.get(d, 0) + 1
        
        dates = [{"date": d, "count": c} for d, c in date_counts.items()]
        dates.sort(key=lambda x: x["date"], reverse=True)
        return dates[:30]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/commodities/by-date/{date}")
def get_commodities_by_date(date: str):
    try:
        result = supabase.table(TABLE).select("*").eq("report_date", date).limit(50000).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/search")
def search_commodities(q: str, limit: int = 100):
    try:
        result = supabase.table(TABLE).select("*").ilike("commodity", f"%{q}%").limit(limit).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/markets")
def get_markets():
    try:
        result = supabase.table(TABLE).select("market, market_type").execute()
        if not result.data:
            return []
        
        market_counts = {}
        for row in result.data:
            m = row["market"]
            t = row.get("market_type", "unknown")
            if m not in market_counts:
                market_counts[m] = {"market": m, "type": t, "count": 0}
            market_counts[m]["count"] += 1
        
        markets = list(market_counts.values())
        markets.sort(key=lambda x: x["count"], reverse=True)
        return markets
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/reports/terminal")
def get_terminal_report(date: str = None):
    """All terminal market rows for a given date (defaults to latest)."""
    try:
        q = supabase.table(TABLE).select("*").eq("market_type", "terminal")
        if date:
            q = q.eq("report_date", date)
        else:
            dates_result = supabase.table(TABLE).select("report_date").eq("market_type", "terminal").order("report_date", desc=True).limit(1).execute()
            if dates_result.data:
                latest = dates_result.data[0]["report_date"]
                q = q.eq("report_date", latest)
        result = q.limit(50000).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/reports/shipping-points")
def get_shipping_points(date: str = None):
    """All FOB shipping point rows (excl. National Trends) for a given date."""
    try:
        q = supabase.table(TABLE).select("*").eq("market_type", "shipping_point").neq("market", "National Trends")
        if date:
            q = q.eq("report_date", date)
        else:
            dates_result = supabase.table(TABLE).select("report_date").eq("market_type", "shipping_point").neq("market", "National Trends").order("report_date", desc=True).limit(1).execute()
            if dates_result.data:
                latest = dates_result.data[0]["report_date"]
                q = q.eq("report_date", latest)
        result = q.limit(50000).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/reports/trends")
def get_national_trends(date: str = None):
    """National Trends (FVWTRDS) rows — movement direction + commentary."""
    try:
        q = supabase.table(TABLE).select("*").eq("market", "National Trends")
        if date:
            q = q.eq("report_date", date)
        else:
            dates_result = supabase.table(TABLE).select("report_date").eq("market", "National Trends").order("report_date", desc=True).limit(1).execute()
            if dates_result.data:
                latest = dates_result.data[0]["report_date"]
                q = q.eq("report_date", latest)
        result = q.limit(10000).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────
# HISTORY — time series for one commodity/variety/origin/size/market
# ─────────────────────────────────────────────────────────────

@app.get("/history")
def get_history(
    commodity: str,
    market: str = None,
    variety: str = None,
    origin: str = None,
    size: str = None,
    package: str = None,
    days: int = 90,
):
    """Return time-series rows for the given SKU filters, most recent first."""
    try:
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=days)).isoformat()

        q = supabase.table(TABLE).select("*").eq("commodity", commodity).gte("report_date", cutoff)
        if market:  q = q.eq("market", market)
        if variety: q = q.eq("variety", variety)
        if origin:  q = q.eq("origin", origin)
        if size:    q = q.eq("size", size)
        if package: q = q.eq("package", package)

        result = q.order("report_date", desc=True).limit(10000).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────
# MOVEMENT (produce_movement — USDA WA_FV175 truck/air/boat data)
# ─────────────────────────────────────────────────────────────

@app.get("/movement/dates")
def movement_dates():
    """List available movement report dates, most recent first."""
    try:
        result = supabase.table(MOVEMENT_TABLE).select("report_date").order("report_date", desc=True).limit(30000).execute()
        if not result.data:
            return []
        date_counts = {}
        for row in result.data:
            d = row["report_date"]
            date_counts[d] = date_counts.get(d, 0) + 1
        dates = [{"date": d, "count": c} for d, c in date_counts.items()]
        dates.sort(key=lambda x: x["date"], reverse=True)
        return dates[:30]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/movement/latest")
def movement_latest():
    """Latest movement rows in one call. Returns {date, rows}."""
    try:
        dates_result = supabase.table(MOVEMENT_TABLE).select("report_date").order("report_date", desc=True).limit(1).execute()
        if not dates_result.data:
            return {"date": None, "rows": []}
        latest = dates_result.data[0]["report_date"]
        rows = supabase.table(MOVEMENT_TABLE).select("*").eq("report_date", latest).limit(50000).execute()
        return {"date": latest, "rows": rows.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/movement/by-date/{date}")
def movement_by_date(date: str):
    """All movement rows for a specific date."""
    try:
        result = supabase.table(MOVEMENT_TABLE).select("*").eq("report_date", date).limit(50000).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/movement/summary/{date}")
def movement_summary(date: str):
    """Aggregated movement view: totals, by mode, by origin, top commodities."""
    try:
        result = supabase.table(MOVEMENT_TABLE).select("*").eq("report_date", date).limit(50000).execute()
        rows = result.data or []
        if not rows:
            return {"date": date, "total_pounds": 0, "row_count": 0, "by_mode": [], "by_origin": [], "by_commodity": []}

        total = 0
        by_mode = {}
        by_origin = {}
        by_commodity = {}

        for r in rows:
            lbs = r.get("total_pounds") or 0
            if r.get("is_correction"):
                # correction rows can be negative — approximate by treating as adjustment
                pass
            total += lbs

            mode = r.get("trans_mode_full") or r.get("trans_mode") or "Unknown"
            by_mode[mode] = by_mode.get(mode, 0) + lbs

            origin = r.get("origin_name") or r.get("origin_code") or "Unknown"
            by_origin[origin] = by_origin.get(origin, 0) + lbs

            commodity = r.get("commodity") or "Unknown"
            by_commodity[commodity] = by_commodity.get(commodity, 0) + lbs

        def to_sorted_list(d):
            return sorted(
                [{"name": k, "pounds": v} for k, v in d.items()],
                key=lambda x: x["pounds"], reverse=True
            )

        return {
            "date": date,
            "total_pounds": total,
            "row_count": len(rows),
            "by_mode": to_sorted_list(by_mode),
            "by_origin": to_sorted_list(by_origin)[:20],
            "by_commodity": to_sorted_list(by_commodity)[:30],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats")
def get_stats():
    try:
        result = supabase.table(TABLE).select("commodity, market, report_date").limit(200000).execute()
        if not result.data:
            return {"total_records": 0, "commodities": 0, "markets": 0, "dates": 0}
        
        commodities = set()
        markets = set()
        dates = set()
        
        for row in result.data:
            commodities.add(row["commodity"])
            markets.add(row["market"])
            dates.add(row["report_date"])
        
        return {
            "total_records": len(result.data),
            "commodities": len(commodities),
            "markets": len(markets),
            "dates": len(dates)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
