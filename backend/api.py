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
