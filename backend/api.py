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

MOVEMENT_TABLE = "produce_movement"


@app.get("/movement/dates")
def get_movement_dates():
    """Return available report dates for movement data."""
    try:
        result = (
            supabase.table(MOVEMENT_TABLE)
            .select("report_date")
            .order("report_date", desc=True)
            .limit(30)
            .execute()
        )
        if not result.data:
            return []
        seen = {}
        for row in result.data:
            d = row["report_date"]
            seen[d] = seen.get(d, 0) + 1
        return [{"date": d, "count": c} for d, c in seen.items()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/movement/by-date/{date}")
def get_movement_by_date(date: str):
    """
    Return aggregated movement data for a given date.
    Aggregates total_pounds per commodity, broken down by origin_code and trans_mode.
    Excludes weekly (W/E) and correction rows so only daily shipments are counted.
    """
    try:
        result = (
            supabase.table(MOVEMENT_TABLE)
            .select("commodity,variety,organic,origin_code,origin_name,trans_mode,trans_mode_full,total_pounds,units_10k,is_weekly,is_correction")
            .eq("report_date", date)
            .eq("is_weekly", False)
            .eq("is_correction", False)
            .limit(50000)
            .execute()
        )
        rows = result.data or []

        # Aggregate by commodity
        agg: dict[str, dict] = {}
        for r in rows:
            c = r["commodity"]
            if c not in agg:
                agg[c] = {
                    "commodity":    c,
                    "total_pounds": 0,
                    "units_10k":    0.0,
                    "origins":      {},   # origin_code → pounds
                    "modes":        {},   # trans_mode  → pounds
                    "organic_lbs":  0,
                    "rows":         0,
                }
            a = agg[c]
            lbs = r.get("total_pounds") or 0
            a["total_pounds"] += lbs
            a["units_10k"]    = round(a["total_pounds"] / 10000, 1)
            a["rows"]         += 1

            origin = r.get("origin_code") or "UNK"
            a["origins"][origin] = a["origins"].get(origin, 0) + lbs

            mode = r.get("trans_mode") or "?"
            a["modes"][mode] = a["modes"].get(mode, 0) + lbs

            if r.get("organic"):
                a["organic_lbs"] += lbs

        # Sort origins and modes by volume desc, convert to list
        output = []
        for c, a in sorted(agg.items(), key=lambda x: x[1]["total_pounds"], reverse=True):
            a["origins"] = [
                {"code": k, "name": v, "pounds": p}
                for k, (v, p) in sorted(
                    {code: (
                        next((r2["origin_name"] for r2 in rows
                              if r2["commodity"] == c and r2["origin_code"] == code), code),
                        pounds
                    ) for code, pounds in a["origins"].items()}.items(),
                    key=lambda x: x[1][1], reverse=True
                )
            ]
            a["modes"] = [
                {"mode": k, "full": TRANS_MODE_LABELS.get(k, k), "pounds": p}
                for k, p in sorted(a["modes"].items(), key=lambda x: x[1], reverse=True)
            ]
            output.append(a)

        return output
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/movement/commodity/{commodity}")
def get_movement_for_commodity(commodity: str, limit: int = 30):
    """
    Return movement history for a specific commodity across recent dates.
    Useful for trend views in the commodity detail sheet.
    """
    try:
        result = (
            supabase.table(MOVEMENT_TABLE)
            .select("report_date,commodity,origin_code,origin_name,trans_mode,total_pounds,units_10k")
            .ilike("commodity", f"%{commodity}%")
            .eq("is_weekly", False)
            .eq("is_correction", False)
            .order("report_date", desc=True)
            .limit(limit * 20)  # get enough rows to aggregate
            .execute()
        )
        rows = result.data or []

        # Aggregate by date
        by_date: dict[str, dict] = {}
        for r in rows:
            d = r["report_date"]
            if d not in by_date:
                by_date[d] = {
                    "date": d,
                    "total_pounds": 0,
                    "origins": {},
                    "modes": {},
                }
            lbs = r.get("total_pounds") or 0
            by_date[d]["total_pounds"] += lbs
            origin = r.get("origin_code") or "UNK"
            by_date[d]["origins"][origin] = by_date[d]["origins"].get(origin, 0) + lbs
            mode = r.get("trans_mode") or "?"
            by_date[d]["modes"][mode] = by_date[d]["modes"].get(mode, 0) + lbs

        result_list = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)[:limit]
        return result_list
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


TRANS_MODE_LABELS = {"T": "Truck", "A": "Air", "B": "Boat"}


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
