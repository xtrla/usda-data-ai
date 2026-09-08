from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import create_client
import stripe
import os
import logging
from datetime import date, timedelta

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agrax.api")

app = FastAPI(title="AGRA API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Scheduler ─────────────────────────────────────────────────────────────
# scheduler.py defined start_scheduler() but nothing ever called it. That is
# why /dates returned two report_dates total: one manual `python ingest.py`
# run and nothing else. This @on_event hook is the missing wiring.
#
# ENABLE_SCHEDULER=1 in Railway keeps this on in prod; unset in local dev
# so `uvicorn --reload` doesn't kick off a full USDA pull on every save.
@app.on_event("startup")
def _boot_scheduler():
    import os as _os
    if _os.getenv("ENABLE_SCHEDULER", "0") != "1":
        return
    try:
        from scheduler import start_scheduler
        start_scheduler()
    except Exception as e:
        import logging as _logging
        _logging.getLogger(__name__).error("Scheduler failed to start: %s", e)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
TABLE = "produce_prices"

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
MOVEMENT_TABLE = "produce_movement"

# ─────────────────────────────────────────────────────────────
# STRIPE CONFIG
# ─────────────────────────────────────────────────────────────
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "price_1U8hW0D7tfZTkL3MZUQLmD6W")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://www.agra-x.com")

@app.get("/")
def health():
    return {"status": "ok", "version": "2.0.0", "service": "AGRA API"}

@app.get("/dates")
def get_dates():
    try:
        # Must page. Unpaged this saw an arbitrary 1000-row slice, so the
        # "latest" date it reported was whatever happened to land in that
        # slice — not the newest date in the table.
        result_rows = fetch_all(supabase.table(TABLE).select("report_date,row_hash"))
        if not result_rows:
            return []

        date_counts = {}
        for row in result_rows:
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
        result_rows = fetch_all(supabase.table(TABLE).select("*").eq("report_date", date))
        return result_rows
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
        # The endpoint whose whole job is listing markets was the one
        # endpoint reading a truncated 1000-row slice, so markets outside
        # that slice simply did not exist as far as the frontend knew.
        result_rows = fetch_all(supabase.table(TABLE).select("market, market_type, row_hash"))
        if not result_rows:
            return []

        market_counts = {}
        for row in result_rows:
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

def fetch_all(query_builder, page_size: int = 1000, order_by: str = "row_hash"):
    """Page through a PostgREST query and return every row.

    Supabase enforces a server-side `db-max-rows` cap (1000 by default)
    that silently truncates results no matter what `.limit()` says. A
    plain .limit(50000) therefore returns only the first 1000 rows, so
    markets past that boundary come back empty. Paging with .range()
    is the only way to get a full day of terminal data.

    The ORDER BY is not cosmetic. Postgres gives no ordering guarantee
    across separate LIMIT/OFFSET queries, so paging an unordered result
    lets the planner return the same row on two pages and no page at
    all for another. Dropped rows cluster by physical page, which means
    a whole market can disappear from one request and come back on the
    next. Sorting on a unique column (row_hash) makes the window stable.
    """
    try:
        query_builder = query_builder.order(order_by)
    except Exception:
        # Older postgrest clients, or a view without that column. Paging
        # unordered is still better than not paging at all.
        log.warning("fetch_all: could not order by %s; paging unordered", order_by)

    rows, start = [], 0
    while True:
        batch = query_builder.range(start, start + page_size - 1).execute().data or []
        if not batch:
            return rows
        rows.extend(batch)
        # Advance by what the server ACTUALLY returned, not by page_size.
        # PostgREST caps each response at db-max-rows, which is not always
        # the 1000 the client assumes — on this project it is 999. The old
        # termination test (`len(batch) < page_size`) was therefore true on
        # the very first page, so this returned 999 of 6732 rows and never
        # asked for page two. Stopping only on an empty batch makes the
        # loop correct for any server-side cap.
        start += len(batch)
        if len(rows) > 200_000:     # guard against a runaway loop
            log.warning("fetch_all: hit the 200k-row guard; result may be truncated")
            return rows


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
        result_rows = fetch_all(q)
        return result_rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/reports/latest")
def get_latest_report(market_type: str = "terminal", lookback_days: int = 90):
    """Latest known row per SKU, per market — regardless of report date.

    USDA terminals don't all print every day: a market can be quiet for a
    week and its last real price is still the price a buyer needs. Keying
    on a single report_date makes those markets look empty, which is both
    wrong and the most confusing possible failure.

    This returns, for every (market, commodity, variety, origin, grade,
    package, size), the most recent row within the lookback window, with
    its own report_date intact so the UI can show how stale it is.
    """
    try:
        cutoff = (date.today() - timedelta(days=max(1, min(lookback_days, 120)))).isoformat()

        q = supabase.table(TABLE).select("*").gte("report_date", cutoff)
        if market_type == "shipping_point":
            q = q.eq("market_type", "shipping_point").neq("market", "National Trends")
        else:
            q = q.eq("market_type", "terminal")

        rows = fetch_all(q)

        # Newest first, then keep the first occurrence of each SKU key.
        rows.sort(key=lambda r: str(r.get("report_date") or ""), reverse=True)
        latest, seen = [], set()
        for r in rows:
            key = (
                r.get("market"), r.get("commodity"), r.get("variety"),
                r.get("origin"), r.get("grade"), r.get("package"), r.get("size"),
                # quality_note distinguishes genuinely different prints of the
                # same pack. USDA publishes Mexican Hass 48s three times — a
                # base price, a "Few" price and a "fine appearance" price —
                # and they are not the same product to a buyer. Leaving this
                # out of the key silently kept one of the three at random.
                r.get("quality_note"),
            )
            if key in seen:
                continue
            seen.add(key)
            latest.append(r)
        return latest
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/coverage")
def get_coverage(lookback_days: int = 90):
    """Per-market freshness: latest report date and row count.

    Lets the UI say "Chicago — Sep 4" rather than silently showing a
    market as empty when it simply hasn't printed today.
    """
    try:
        cutoff = (date.today() - timedelta(days=max(1, min(lookback_days, 120)))).isoformat()
        rows = fetch_all(
            supabase.table(TABLE)
            .select("market,report_date")
            .eq("market_type", "terminal")
            .gte("report_date", cutoff)
        )
        agg = {}
        for r in rows:
            m = r.get("market")
            if not m:
                continue
            d = str(r.get("report_date") or "")
            a = agg.setdefault(m, {"market": m, "latest_date": d, "rows": 0})
            a["rows"] += 1
            if d > a["latest_date"]:
                a["latest_date"] = d
        return sorted(agg.values(), key=lambda a: a["market"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/diagnose")
def diagnose_pipeline(lookback_days: int = 90):
    """Combined pipeline health check — no credentials needed to view.

    For every terminal slug configured in ingest.py, returns:
      - what USDA MARS says (HTTP status + row count from the latest report)
      - what Supabase has (row count + latest report_date within the window)

    Split shows exactly where the pipeline is breaking per slug:
      - USDA OK, Supabase empty  -> ingest is skipping this slug
      - USDA 404                 -> slug ID is stale, needs replacement
      - Both OK                  -> pipeline is healthy for this slug
      - USDA OK, Supabase stale  -> ingest hasn't run recently
    """
    import ast as _ast
    import requests as _requests
    import os as _os

    # Load REPORT_SLUGS from ingest.py without importing (avoids circular deps)
    try:
        ingest_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "ingest.py")
        src = open(ingest_path).read()
        tree = _ast.parse(src)
        wanted = [
            n for n in tree.body
            if (isinstance(n, _ast.FunctionDef) and n.name == "_slug")
            or (isinstance(n, _ast.Assign)
                and any(getattr(t, "id", "") == "REPORT_SLUGS" for t in n.targets))
        ]
        ns = {}
        exec(compile(_ast.Module(body=wanted, type_ignores=[]), "<slugs>", "exec"), ns)
        slugs = [s for s in ns.get("REPORT_SLUGS", []) if s.get("market_type") == "terminal"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not load slugs: {e}")

    mars_key = _os.getenv("MARS_API_KEY", "")
    mars_base = "https://marsapi.ams.usda.gov/services/v1.2"

    # Pull all Supabase terminal rows once in the window, then group per slug
    cutoff = (date.today() - timedelta(days=max(1, min(lookback_days, 120)))).isoformat()
    try:
        db_rows = fetch_all(
            supabase.table(TABLE)
            .select("market,commodity_type,report_date")
            .eq("market_type", "terminal")
            .gte("report_date", cutoff)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase query failed: {e}")

    # Bucket by (market, commodity_type) which is what a slug represents
    from collections import defaultdict as _dd
    db_buckets = _dd(lambda: {"rows": 0, "latest_date": ""})
    for r in db_rows:
        key = (r.get("market"), r.get("commodity_type"))
        b = db_buckets[key]
        b["rows"] += 1
        d = str(r.get("report_date") or "")
        if d > b["latest_date"]:
            b["latest_date"] = d

    results = []
    for slug in slugs:
        entry = {
            "market": slug["market"],
            "commodity_type": slug["commodity_type"],
            "code": slug["code"],
            "slug_id": slug["slug_id"],
            "usda_status": None,
            "usda_rows": 0,
            "usda_note": "",
            "supabase_rows": 0,
            "supabase_latest": None,
            "verdict": "",
        }

        # Supabase side
        key = (slug["market"], slug["commodity_type"])
        b = db_buckets.get(key, {"rows": 0, "latest_date": ""})
        entry["supabase_rows"] = b["rows"]
        entry["supabase_latest"] = b["latest_date"] or None

        # USDA side (skip if no key configured)
        if not mars_key:
            entry["usda_note"] = "MARS_API_KEY not configured on server"
        else:
            try:
                url = f"{mars_base}/reports/{slug['slug_id']}/report details"
                resp = _requests.get(url, params={"lastReports": 1}, auth=(mars_key, ""), timeout=15)
                entry["usda_status"] = resp.status_code
                if resp.status_code == 200:
                    data = resp.json()
                    payload = data if isinstance(data, list) else data.get("results", [])
                    entry["usda_rows"] = len(payload)
                    if not payload:
                        entry["usda_note"] = "USDA returned empty result"
                elif resp.status_code == 404:
                    entry["usda_note"] = "slug not found — retired or renumbered"
                elif resp.status_code == 401:
                    entry["usda_note"] = "MARS_API_KEY rejected"
                else:
                    entry["usda_note"] = f"HTTP {resp.status_code}"
            except Exception as e:
                entry["usda_note"] = f"request failed: {e}"

        # Verdict
        us_ok = (entry["usda_status"] == 200 and entry["usda_rows"] > 0)
        db_ok = entry["supabase_rows"] > 0
        if us_ok and db_ok:
            entry["verdict"] = "HEALTHY"
        elif us_ok and not db_ok:
            entry["verdict"] = "INGEST_BROKEN"  # USDA has data, we don't
        elif not us_ok and db_ok:
            entry["verdict"] = "USDA_DOWN_STALE_OK"  # we have older data still
        else:
            entry["verdict"] = "DEAD"  # neither side has anything

        results.append(entry)

    # Roll up per market for the top-of-response summary
    market_health = {}
    for e in results:
        m = e["market"]
        s = market_health.setdefault(m, {"slugs_total": 0, "slugs_healthy": 0, "supabase_rows": 0})
        s["slugs_total"] += 1
        if e["verdict"] == "HEALTHY":
            s["slugs_healthy"] += 1
        s["supabase_rows"] += e["supabase_rows"]

    summary = sorted(
        [{"market": m, **v} for m, v in market_health.items()],
        key=lambda x: (x["slugs_healthy"], x["market"]),
    )

    return {
        "lookback_days": lookback_days,
        "generated_at": date.today().isoformat(),
        "market_summary": summary,
        "per_slug": results,
    }


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
        result_rows = fetch_all(q)
        return result_rows
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
    grade: str = None,
    quality: str = None,
    days: int = 90,
):
    """Return time-series rows for the given SKU filters, most recent first.

    grade and quality are part of a SKU's identity, not decoration. Without
    them a history for Mexican Hass 48s mixed the base print, the "Few"
    print and the "fine appearance" print into one series, so the chart
    jumped between three different products and every change figure was
    meaningless. Callers that omit them still get the looser behaviour.
    """
    try:
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=days)).isoformat()

        q = supabase.table(TABLE).select("*").eq("commodity", commodity).gte("report_date", cutoff)
        if market:  q = q.eq("market", market)
        if variety: q = q.eq("variety", variety)
        if origin:  q = q.eq("origin", origin)
        if size:    q = q.eq("size", size)
        if package: q = q.eq("package", package)
        if grade:   q = q.eq("grade", grade)
        # An explicit empty string means "the print with no quality note",
        # which is a real and distinct record — not "don't filter".
        if quality is not None:
            q = q.eq("quality_note", quality) if quality else q.is_("quality_note", "null")

        result_rows = fetch_all(q.order("report_date", desc=True))
        return result_rows
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
        # Paged: .limit() cannot beat db-max-rows (999 on this project), so
        # this returned a single page of a multi-thousand-row day.
        rows = fetch_all(
            supabase.table(MOVEMENT_TABLE).select("*").eq("report_date", latest)
        )
        return {"date": latest, "rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/movement/commodity/{commodity}")
def movement_for_commodity(commodity: str, days: int = 30):
    """Movement history for one commodity, newest first.

    Powers the Movement tab in the SKU panel. Grouped by date and origin so
    the reader can see whether supply into the country is tightening or
    flooding for the thing they are actually looking at.
    """
    try:
        from datetime import date as _date, timedelta
        cutoff = (_date.today() - timedelta(days=days)).isoformat()
        rows = fetch_all(
            supabase.table(MOVEMENT_TABLE).select("*")
            .eq("commodity", commodity)
            .gte("report_date", cutoff)
            .order("report_date", desc=True)
        )
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/movement/by-date/{date}")
def movement_by_date(date: str):
    """All movement rows for a specific date."""
    try:
        return fetch_all(
            supabase.table(MOVEMENT_TABLE).select("*").eq("report_date", date)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/movement/summary/{date}")
def movement_summary(date: str):
    """Aggregated movement view: totals, by mode, by origin, top commodities."""
    try:
        rows = fetch_all(
            supabase.table(MOVEMENT_TABLE).select("*").eq("report_date", date)
        )
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
        # .limit(200000) is a no-op: Supabase's db-max-rows caps the
        # response server-side, so this reported stats for the first
        # 1000 rows and called it the whole table.
        result_rows = fetch_all(
            supabase.table(TABLE).select("commodity, market, report_date, row_hash")
        )
        if not result_rows:
            return {"total_records": 0, "commodities": 0, "markets": 0, "dates": 0}

        commodities = set()
        markets = set()
        dates = set()

        for row in result_rows:
            commodities.add(row["commodity"])
            markets.add(row["market"])
            dates.add(row["report_date"])

        return {
            "total_records": len(result_rows),
            "commodities": len(commodities),
            "markets": len(markets),
            "dates": len(dates)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────
# STRIPE — Checkout + Webhooks
# ─────────────────────────────────────────────────────────────

@app.post("/create-checkout-session")
async def create_checkout_session(request: Request):
    """Create a Stripe Checkout session for AgraX Pro subscription."""
    try:
        body = await request.json()
        user_id = body.get("user_id")
        user_email = body.get("email")

        if not user_id or not user_email:
            raise HTTPException(status_code=400, detail="Missing user_id or email")

        if not stripe.api_key:
            raise HTTPException(status_code=500, detail="Stripe not configured")

        # Check if user already has a Stripe customer ID
        profile = supabase.table("profiles").select("stripe_customer_id").eq("id", user_id).single().execute()
        customer_id = profile.data.get("stripe_customer_id") if profile.data else None

        # Create or reuse Stripe customer
        if not customer_id:
            customer = stripe.Customer.create(
                email=user_email,
                metadata={"supabase_user_id": user_id}
            )
            customer_id = customer.id
            supabase.table("profiles").update({
                "stripe_customer_id": customer_id
            }).eq("id", user_id).execute()

        # Create checkout session
        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{
                "price": STRIPE_PRICE_ID,
                "quantity": 1,
            }],
            mode="subscription",
            success_url=f"{FRONTEND_URL}/app?checkout=success",
            cancel_url=f"{FRONTEND_URL}/app?checkout=cancelled",
            metadata={"supabase_user_id": user_id},
        )

        return {"checkout_url": session.url}

    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events to update subscription status."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid payload")
        except stripe.error.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        import json
        event = json.loads(payload)

    event_type = event.get("type") if isinstance(event, dict) else event["type"]
    data = event.get("data", {}).get("object", {}) if isinstance(event, dict) else event["data"]["object"]

    if event_type == "checkout.session.completed":
        customer_id = data.get("customer")
        subscription_id = data.get("subscription")
        user_id = data.get("metadata", {}).get("supabase_user_id")

        if user_id:
            supabase.table("profiles").update({
                "subscription_status": "active",
                "stripe_subscription_id": subscription_id,
                "stripe_customer_id": customer_id,
                "updated_at": "now()",
            }).eq("id", user_id).execute()

    elif event_type == "customer.subscription.updated":
        customer_id = data.get("customer")
        status = data.get("status")
        status_map = {
            "active": "active",
            "past_due": "past_due",
            "canceled": "cancelled",
            "unpaid": "past_due",
            "incomplete": "free",
            "incomplete_expired": "free",
        }
        mapped_status = status_map.get(status, "free")
        supabase.table("profiles").update({
            "subscription_status": mapped_status,
            "updated_at": "now()",
        }).eq("stripe_customer_id", customer_id).execute()

    elif event_type == "customer.subscription.deleted":
        customer_id = data.get("customer")
        supabase.table("profiles").update({
            "subscription_status": "cancelled",
            "stripe_subscription_id": None,
            "updated_at": "now()",
        }).eq("stripe_customer_id", customer_id).execute()

    elif event_type == "invoice.payment_failed":
        customer_id = data.get("customer")
        supabase.table("profiles").update({
            "subscription_status": "past_due",
            "updated_at": "now()",
        }).eq("stripe_customer_id", customer_id).execute()

    return JSONResponse(content={"received": True}, status_code=200)


@app.get("/subscription/status")
async def subscription_status(user_id: str):
    """Check subscription status for a user."""
    try:
        result = supabase.table("profiles").select(
            "subscription_status, stripe_customer_id"
        ).eq("id", user_id).single().execute()

        if not result.data:
            return {"status": "free", "is_pro": False}

        status = result.data.get("subscription_status", "free")
        return {"status": status, "is_pro": status == "active"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# MARKET SUMMARY — everything the browse page market bar needs
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# NEWSLETTER SIGNUP
# ─────────────────────────────────────────────────────────────
@app.post("/subscribe")
async def subscribe(request: Request):
    """Capture an email for the weekday morning brief.

    Deliberately does not require an account. Always reports success to
    the caller so the endpoint can't be used to probe which addresses
    are already on the list.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Expected a JSON body")

    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        raise HTTPException(status_code=400, detail="A valid email is required")

    row = {
        "email": email,
        "source": (body.get("source") or "web")[:40],
        "market": (body.get("market") or None),
    }

    try:
        supabase.table("subscribers").upsert(row, on_conflict="email").execute()
    except Exception as e:
        print(f"[subscribe] failed for {email}: {e}")
        # Don't leak storage failures to the form; the address is far more
        # likely to be lost to a transient Supabase blip than to be a dupe.
        return {"ok": True}

    return {"ok": True}


@app.get("/market-summary")
def market_summary(market: str = "New York", date: str = None):
    """
    One-call summary for a market: commodity count, tone split,
    movement totals, shipping point breakdown, week-over-week changes.
    Powers the market summary bar + right panel on browse page.
    """
    from datetime import date as dt_date, timedelta
    from collections import Counter

    try:
        # Get terminal rows for this market on this date
        q = supabase.table(TABLE).select("*").eq("market_type", "terminal").eq("market", market)
        if date:
            q = q.eq("report_date", date)
        else:
            dates_result = supabase.table(TABLE).select("report_date").eq("market_type", "terminal").eq("market", market).order("report_date", desc=True).limit(1).execute()
            if dates_result.data:
                date = dates_result.data[0]["report_date"]
                q = q.eq("report_date", date)
            else:
                return {"market": market, "date": None, "commodities": 0, "prices": 0,
                        "tone_higher": 0, "tone_lower": 0, "tone_steady": 0,
                        "movement_loads": 0, "movement_wow": None, "shipping_points": []}

        rows = q.limit(50000).execute()
        rows = rows.data or []

        # Count commodities and tone
        commodities = set()
        tone = Counter()
        for r in rows:
            commodities.add(r.get("commodity"))
            mv = (r.get("movement") or "").lower()
            if "higher" in mv or mv == "up":
                tone["higher"] += 1
            elif "lower" in mv or mv == "down":
                tone["lower"] += 1
            else:
                tone["steady"] += 1

        # Deduplicate tone counts to commodity level
        com_tones = {}
        for r in rows:
            com = r.get("commodity")
            if com not in com_tones:
                mv = (r.get("movement") or "").lower()
                if "higher" in mv or mv == "up":
                    com_tones[com] = "higher"
                elif "lower" in mv or mv == "down":
                    com_tones[com] = "lower"
                else:
                    com_tones[com] = "steady"

        tone_higher = sum(1 for v in com_tones.values() if v == "higher")
        tone_lower = sum(1 for v in com_tones.values() if v == "lower")
        tone_steady = sum(1 for v in com_tones.values() if v == "steady")

        # Shipping point data for commodities in this market
        fob_rows = []
        try:
            fob_q = supabase.table(TABLE).select("*").eq("market_type", "shipping_point").neq("market", "National Trends")
            if date:
                fob_q = fob_q.eq("report_date", date)
            fob_result = fob_q.limit(50000).execute()
            fob_rows = fob_result.data or []
        except:
            pass

        # Aggregate shipping points
        sp_data = {}
        for r in fob_rows:
            sp = r.get("market") or r.get("origin") or "Unknown"
            if sp == "National Trends":
                continue
            if sp not in sp_data:
                sp_data[sp] = {"name": sp, "count": 0}
            sp_data[sp]["count"] += 1
        shipping_points = sorted(sp_data.values(), key=lambda x: x["count"], reverse=True)

        # Movement data
        movement_loads = 0
        movement_wow = None
        sp_movement = []
        try:
            mv_result = supabase.table(MOVEMENT_TABLE).select("*").order("report_date", desc=True).limit(50000).execute()
            mv_rows = mv_result.data or []
            if mv_rows:
                latest_mv_date = mv_rows[0].get("report_date")
                # Current week loads
                current_loads = {}
                prev_loads = {}
                prev_date = (dt_date.fromisoformat(latest_mv_date) - timedelta(days=7)).isoformat() if latest_mv_date else None

                for r in mv_rows:
                    lbs = r.get("total_pounds") or 0
                    loads = lbs / 40000  # approx 40k lbs per truck
                    origin = r.get("origin_name") or r.get("origin_code") or "Unknown"
                    rd = r.get("report_date")

                    if rd == latest_mv_date:
                        current_loads[origin] = current_loads.get(origin, 0) + loads
                    elif prev_date and rd == prev_date:
                        prev_loads[origin] = prev_loads.get(origin, 0) + loads

                total_current = sum(current_loads.values())
                total_prev = sum(prev_loads.values())
                movement_loads = round(total_current)

                if total_prev > 0:
                    movement_wow = round((total_current - total_prev) / total_prev * 100, 1)

                # Per shipping point with w/w
                for sp_name, cur in sorted(current_loads.items(), key=lambda x: x[1], reverse=True):
                    prev = prev_loads.get(sp_name, 0)
                    wow = round((cur - prev) / prev * 100, 1) if prev > 0 else None
                    sp_movement.append({
                        "name": sp_name,
                        "loads": round(cur),
                        "wow_pct": wow,
                    })
        except:
            pass

        return {
            "market": market,
            "date": date,
            "commodities": len(commodities),
            "prices": len(rows),
            "tone_higher": tone_higher,
            "tone_lower": tone_lower,
            "tone_steady": tone_steady,
            "movement_loads": movement_loads,
            "movement_wow": movement_wow,
            "shipping_points": shipping_points[:10],
            "shipping_point_movement": sp_movement[:10],
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# WEEK-OVER-WEEK COMPARISON — % change per commodity
# ─────────────────────────────────────────────────────────────

@app.get("/wow")
def week_over_week(market: str = "New York"):
    """
    Compare this week's prices to last week's for each commodity at a market.
    Returns [{commodity, current_price, prev_price, change_pct, direction}]
    """
    from datetime import date as dt_date, timedelta

    try:
        # Get last two report dates for this market
        # Paged: this needs the two most recent *distinct* dates, and one
        # busy day for a big market can fill the 1000-row cap on its own,
        # which left prev_date empty and every WoW change reading as flat.
        date_rows = fetch_all(
            supabase.table(TABLE)
            .select("report_date,row_hash")
            .eq("market_type", "terminal")
            .eq("market", market)
        )
        if not date_rows:
            return {"market": market, "current_date": None, "prev_date": None, "items": []}

        all_dates = sorted(set(r["report_date"] for r in date_rows), reverse=True)
        if len(all_dates) < 2:
            return {"market": market, "current_date": all_dates[0] if all_dates else None, "prev_date": None, "items": []}

        current_date = all_dates[0]
        prev_date = all_dates[1]

        # Fetch both dates
        current_data = fetch_all(
            supabase.table(TABLE).select("*")
            .eq("market_type", "terminal").eq("market", market)
            .eq("report_date", current_date)
        )
        prev_data = fetch_all(
            supabase.table(TABLE).select("*")
            .eq("market_type", "terminal").eq("market", market)
            .eq("report_date", prev_date)
        )

        # Build commodity-level medians for each date
        def commodity_prices(rows):
            """Get representative price per commodity (median of mostly prices)."""
            by_com = {}
            for r in rows:
                com = r.get("commodity")
                if not com:
                    continue
                # Prefer mostly price
                price = None
                ml = r.get("price_mostly_low")
                mh = r.get("price_mostly_high")
                if ml is not None and mh is not None:
                    price = (float(ml) + float(mh)) / 2
                elif ml is not None:
                    price = float(ml)
                elif mh is not None:
                    price = float(mh)
                else:
                    lo = r.get("price_low")
                    hi = r.get("price_high")
                    if lo is not None and hi is not None:
                        price = (float(lo) + float(hi)) / 2
                    elif lo is not None:
                        price = float(lo)
                    elif hi is not None:
                        price = float(hi)

                if price is not None:
                    if com not in by_com:
                        by_com[com] = []
                    by_com[com].append(price)

            # Median per commodity
            result = {}
            for com, prices in by_com.items():
                prices.sort()
                n = len(prices)
                median = prices[n // 2] if n % 2 == 1 else (prices[n // 2 - 1] + prices[n // 2]) / 2
                result[com] = round(median, 2)
            return result

        current_prices = commodity_prices(current_data)
        prev_prices = commodity_prices(prev_data)

        # Build comparison
        items = []
        all_commodities = set(list(current_prices.keys()) + list(prev_prices.keys()))
        for com in sorted(all_commodities):
            cur = current_prices.get(com)
            prev = prev_prices.get(com)
            if cur is None:
                continue

            change_pct = None
            if prev and prev > 0:
                change_pct = round((cur - prev) / prev * 100, 1)

            # Get tone from current data
            tone = "steady"
            for r in current_data:
                if r.get("commodity") == com:
                    mv = (r.get("movement") or "").lower()
                    if "higher" in mv or mv == "up":
                        tone = "higher"
                    elif "lower" in mv or mv == "down":
                        tone = "lower"
                    break

            items.append({
                "commodity": com,
                "current_price": cur,
                "prev_price": prev,
                "change_pct": change_pct,
                "tone": tone,
            })

        # Sort by absolute change
        items.sort(key=lambda x: abs(x.get("change_pct") or 0), reverse=True)

        return {
            "market": market,
            "current_date": current_date,
            "prev_date": prev_date,
            "items": items,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# BIGGEST MOVERS — top N commodities by w/w % change
# ─────────────────────────────────────────────────────────────

@app.get("/movers")
def biggest_movers(market: str = "New York", limit: int = 6):
    """
    Top movers by week-over-week price change at a market.
    Each mover includes one representative SKU with its specific price + source.
    """
    try:
        wow_data = week_over_week(market)
        items = wow_data.get("items", [])
        current_date = wow_data.get("current_date")

        if not items or not current_date:
            return {"market": market, "date": current_date, "movers": []}

        # Get only items with a change
        movers_raw = [i for i in items if i.get("change_pct") is not None and i["change_pct"] != 0]
        movers_raw = movers_raw[:limit]

        # For each mover, find the representative SKU (the one with a "mostly" price)
        all_rows = supabase.table(TABLE).select("*").eq("market_type", "terminal").eq("market", market).eq("report_date", current_date).limit(50000).execute()
        all_data = all_rows.data or []

        movers = []
        for m in movers_raw:
            com = m["commodity"]
            com_rows = [r for r in all_data if r.get("commodity") == com]

            # Find best representative SKU — prefer one with mostly price
            best_row = None
            best_price = None
            best_source = None

            for r in com_rows:
                ml = r.get("price_mostly_low")
                mh = r.get("price_mostly_high")
                if ml is not None or mh is not None:
                    p = float(ml or mh) if (ml is None or mh is None) else (float(ml) + float(mh)) / 2
                    if best_row is None or best_source != "mostly":
                        best_row = r
                        best_price = round(p, 2)
                        best_source = "mostly"
                elif best_row is None:
                    lo = r.get("price_low")
                    hi = r.get("price_high")
                    if lo is not None or hi is not None:
                        if lo is not None and hi is not None:
                            p = (float(lo) + float(hi)) / 2
                            src = "reported" if float(lo) == float(hi) else "mid-range"
                        else:
                            p = float(lo or hi)
                            src = "reported"
                        best_row = r
                        best_price = round(p, 2)
                        best_source = src

            if best_row and best_price:
                sku_desc = " · ".join(filter(None, [
                    best_row.get("variety"),
                    best_row.get("grade"),
                    best_row.get("size"),
                    best_row.get("package"),
                ]))
                movers.append({
                    "commodity": com,
                    "price": best_price,
                    "change_pct": m["change_pct"],
                    "tone": m["tone"],
                    "source": best_source,
                    "sku": sku_desc,
                    "origin": best_row.get("origin"),
                })

        return {"market": market, "date": current_date, "movers": movers}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# STORY OF THE DAY — AI-generated daily market narrative
# ─────────────────────────────────────────────────────────────

@app.get("/story")
def story_of_the_day(market: str = "New York"):
    """
    Daily market narrative. Checks cache first — generates once per market per day,
    then serves cached version to all subsequent visitors.
    market='national' generates a cross-market overview.
    """
    import json
    from datetime import date as dt_date

    STORY_TABLE = "story_cache"
    SOURCE_LINE = "AgraX analysis based on USDA AMS market reports. Not USDA guidance."
    is_national = market.lower() == 'national'

    # Step 1: Get today's report date
    try:
        dates_result = supabase.table(TABLE).select("report_date").eq("market_type", "terminal").order("report_date", desc=True).limit(1).execute()
        report_date = dates_result.data[0]["report_date"] if dates_result.data else dt_date.today().isoformat()
    except:
        report_date = dt_date.today().isoformat()

    # Step 2: Check cache
    cache_key = "national" if is_national else market
    try:
        cached = supabase.table(STORY_TABLE).select("*").eq(
            "market", cache_key
        ).eq("report_date", report_date).limit(1).execute()

        if cached.data and cached.data[0].get("headline"):
            row = cached.data[0]
            return {
                "headline": row["headline"],
                "body": row["body"],
                "source": SOURCE_LINE,
                "date": report_date,
                "market": cache_key,
                "cached": True,
            }
    except:
        pass

    # Step 3: Generate with Claude
    ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY")
    if not ANTHROPIC_KEY:
        return {"headline": None, "body": None, "source": SOURCE_LINE, "date": report_date,
                "market": cache_key, "error": "ANTHROPIC_API_KEY not configured"}

    try:
        # Build data snapshot
        if is_national:
            # Aggregate across all markets
            # A full day across all 12 terminals is well over 1000 rows,
            # so .limit(50000) truncated this to whichever markets landed
            # in the first page — the national story was written from a
            # partial slice of the country.
            rows = fetch_all(
                supabase.table(TABLE)
                .select("commodity,movement,market,row_hash")
                .eq("market_type", "terminal")
                .eq("report_date", report_date)
            )
            markets_data = {}
            total_h, total_l, total_s = 0, 0, 0
            for r in rows:
                mkt = r.get("market", "")
                com = r.get("commodity", "")
                mv = (r.get("movement") or "").lower()
                if mkt not in markets_data:
                    markets_data[mkt] = {"higher": 0, "lower": 0, "steady": 0, "count": 0, "coms": set()}
                if com not in markets_data[mkt]["coms"]:
                    markets_data[mkt]["coms"].add(com)
                    markets_data[mkt]["count"] += 1
                    if "higher" in mv or mv == "up":
                        markets_data[mkt]["higher"] += 1
                        total_h += 1
                    elif "lower" in mv or mv == "down":
                        markets_data[mkt]["lower"] += 1
                        total_l += 1
                    else:
                        markets_data[mkt]["steady"] += 1
                        total_s += 1

            market_summaries = []
            for mkt, d in sorted(markets_data.items(), key=lambda x: x[1]["count"], reverse=True)[:12]:
                market_summaries.append({
                    "market": mkt,
                    "commodities": d["count"],
                    "higher": d["higher"],
                    "lower": d["lower"],
                    "steady": d["steady"],
                })

            # Get biggest movers from the largest market
            top_market = market_summaries[0]["market"] if market_summaries else "New York"
            try:
                wow = week_over_week(market=top_market)
                top_movers = [{"commodity": m["commodity"], "change_pct": m["change_pct"], "tone": m["tone"]} for m in (wow.get("items") or [])[:6] if m.get("change_pct")]
            except:
                top_movers = []

            # As with the per-market story, decide here whether a national
            # cause-and-effect claim is defensible. A direction is only
            # "national" if a clear majority of markets agree; otherwise the
            # story is a set of local moves and must be told that way.
            markets_counted = len(market_summaries) or 1
            higher_led = sum(1 for m in market_summaries if m["higher"] > m["lower"])
            lower_led = sum(1 for m in market_summaries if m["lower"] > m["higher"])
            dominant = max(higher_led, lower_led)
            direction_is_national = dominant >= (markets_counted * 2 / 3)

            if direction_is_national:
                national_rule = (
                    f"- {dominant} of {markets_counted} markets moved the same direction, so a "
                    f"national picture is supportable. Describe it, but name the markets that "
                    f"ran against it rather than smoothing them over."
                )
            else:
                national_rule = (
                    f"- Markets split: {higher_led} leaned higher, {lower_led} leaned lower, out "
                    f"of {markets_counted}. There is NO single national direction today. Do not "
                    f"claim one. Report the split and describe individual markets instead."
                )

            data_snapshot = {
                "scope": "national — all 12 USDA terminal markets",
                "date": report_date,
                "total_commodities_higher": total_h,
                "total_commodities_lower": total_l,
                "total_commodities_steady": total_s,
                "markets_leaning_higher": higher_led,
                "markets_leaning_lower": lower_led,
                "direction_is_national": direction_is_national,
                "markets": market_summaries,
                "biggest_movers_at_" + top_market: top_movers,
            }

            prompt = f"""You are a produce market analyst writing a national daily briefing.
You have today's USDA data across all 12 U.S. terminal markets.

DATA:
{json.dumps(data_snapshot, indent=2)}

RULES:
- Write a headline (1 sentence, under 15 words) about the national market picture today.
- Write a body paragraph (3-4 sentences) giving the picture across markets. Mention 2-3 specific commodities and their direction.
{national_rule}
- Use ONLY figures that appear in the DATA above. Never state a number that is not in the data.
- Do not attribute price moves to weather, fuel, labour, holidays, trade or any other cause. None of that is in this data.
- Write for a produce buyer checking prices at 5 AM. Plain language. No jargon.
- End with one sentence on what the numbers show. Do not predict prices.
- Do NOT say "I" or "we." Just state the facts.

Respond ONLY in JSON: {{"headline": "...", "body": "..."}}"""
        else:
            summary = market_summary(market=market)
            wow_data = week_over_week(market=market)
            movers_items = wow_data.get("items", [])[:10]

            # Decide HERE whether the data can support a cause-and-effect
            # claim, rather than instructing the model to decide.
            #
            # The old rule was unconditional: "If movement is down and prices
            # are up, say supply is tightening." Movement and price move
            # together for plenty of reasons that aren't supply — a holiday
            # week, a reporting gap, one big market skewing the average — and
            # the model asserted a cause with full confidence either way.
            # A story that says supply is tightening when it isn't is exactly
            # the kind of error "every price as reported" is meant to prevent.
            mv_pct = summary.get("movement_wow")
            has_movement = mv_pct is not None and summary.get("movement_loads")

            # 15% is the threshold below which a week-over-week movement swing
            # is not distinguishable from normal weekly noise in these reports.
            CAUSAL_THRESHOLD = 15.0
            movement_is_decisive = bool(has_movement and abs(mv_pct) >= CAUSAL_THRESHOLD)

            if movement_is_decisive:
                direction = "fallen" if mv_pct < 0 else "risen"
                causal_rule = (
                    f"- Shipment movement has {direction} {abs(mv_pct):.0f}% week over week, "
                    f"which is a large enough swing to discuss as a driver. You may connect it "
                    f"to the price changes, but only for commodities where the direction "
                    f"actually matches. Do not claim it explains moves that run the other way."
                )
            elif has_movement:
                causal_rule = (
                    f"- Shipment movement changed {mv_pct:+.0f}% week over week. That is within "
                    f"normal weekly variation and does NOT explain today's price moves. Report "
                    f"what prices did without naming a cause. Do not say supply is tightening, "
                    f"loosening, or flooding."
                )
            else:
                causal_rule = (
                    "- No shipment movement data is available for this market today. Report the "
                    "price changes only. Do not speculate about supply, demand or any other "
                    "cause. Do not describe supply as tight, loose or flooding."
                )

            data_snapshot = {
                "market": market,
                "date": report_date,
                "commodities_reporting": summary.get("commodities"),
                "tone_higher": summary.get("tone_higher"),
                "tone_lower": summary.get("tone_lower"),
                "tone_steady": summary.get("tone_steady"),
                "movement_loads": summary.get("movement_loads"),
                "movement_wow_pct": summary.get("movement_wow"),
                "movement_supports_causal_claim": movement_is_decisive,
                "shipping_point_movement": summary.get("shipping_point_movement", [])[:6],
                "biggest_changes": [
                    {"commodity": m["commodity"], "change_pct": m["change_pct"], "current_price": m["current_price"], "tone": m["tone"]}
                    for m in movers_items if m.get("change_pct")
                ],
            }

            prompt = f"""You are a produce market analyst writing a daily briefing for small wholesale buyers.
You have today's USDA data for {market}. Write a Story of the Day.

DATA:
{json.dumps(data_snapshot, indent=2)}

RULES:
- Write a bold headline (1 sentence, under 15 words) that captures the single most important market move today.
- Write a body paragraph (3-4 sentences). Mention specific commodities, dollar amounts, and percentages, using ONLY figures that appear in the DATA above. Never state a number that is not in the data.
{causal_rule}
- Every figure you cite must be traceable to the DATA. If you are unsure of a number, leave it out rather than approximating.
- Write in plain produce industry language. No jargon. A buyer in a truck at 5 AM should understand this instantly.
- End with one sentence on what the numbers show going into today. Do not predict prices or claim to know what will happen.
- Do NOT say "I" or "we." Just state the facts.

Respond ONLY in JSON: {{"headline": "...", "body": "..."}}"""

        import requests as req
        resp = req.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 400,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30,
        )

        if resp.status_code != 200:
            err_body = ""
            try:
                err_body = resp.text[:500]
            except:
                pass
            return {"headline": None, "body": None, "source": SOURCE_LINE, "date": report_date,
                    "market": cache_key, "error": f"Anthropic API returned {resp.status_code}: {err_body}"}

        content = resp.json().get("content", [{}])
        text = content[0].get("text", "{}") if content else "{}"
        text = text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(text)

        headline = parsed.get("headline")
        body = parsed.get("body")

        # Step 4: Cache
        if headline:
            try:
                supabase.table(STORY_TABLE).upsert({
                    "market": cache_key,
                    "report_date": report_date,
                    "headline": headline,
                    "body": body,
                }, on_conflict="market,report_date").execute()
            except:
                pass

        return {
            "headline": headline,
            "body": body,
            "source": SOURCE_LINE,
            "date": report_date,
            "market": cache_key,
            "cached": False,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
