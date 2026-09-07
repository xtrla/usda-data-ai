from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import create_client
import stripe
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
        dates_result = supabase.table(TABLE).select("report_date").eq("market_type", "terminal").eq("market", market).order("report_date", desc=True).limit(50000).execute()
        if not dates_result.data:
            return {"market": market, "current_date": None, "prev_date": None, "items": []}

        all_dates = sorted(set(r["report_date"] for r in dates_result.data), reverse=True)
        if len(all_dates) < 2:
            return {"market": market, "current_date": all_dates[0] if all_dates else None, "prev_date": None, "items": []}

        current_date = all_dates[0]
        prev_date = all_dates[1]

        # Fetch both dates
        current_rows = supabase.table(TABLE).select("*").eq("market_type", "terminal").eq("market", market).eq("report_date", current_date).limit(50000).execute()
        prev_rows = supabase.table(TABLE).select("*").eq("market_type", "terminal").eq("market", market).eq("report_date", prev_date).limit(50000).execute()

        current_data = current_rows.data or []
        prev_data = prev_rows.data or []

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
            all_rows = supabase.table(TABLE).select("commodity,movement,market").eq("market_type", "terminal").eq("report_date", report_date).limit(50000).execute()
            rows = all_rows.data or []
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

            data_snapshot = {
                "scope": "national — all 12 USDA terminal markets",
                "date": report_date,
                "total_commodities_higher": total_h,
                "total_commodities_lower": total_l,
                "total_commodities_steady": total_s,
                "markets": market_summaries,
                "biggest_movers_at_" + top_market: top_movers,
            }

            prompt = f"""You are a produce market analyst writing a national daily briefing.
You have today's USDA data across all 12 U.S. terminal markets.

DATA:
{json.dumps(data_snapshot, indent=2)}

RULES:
- Write a headline (1 sentence, under 15 words) about the national market picture today.
- Write a body paragraph (3-4 sentences) that gives the big picture across markets. Which markets are tightening? Which are easing? Mention 2-3 specific commodities and their direction.
- Write for a produce buyer checking prices at 5 AM. Plain language. No jargon.
- End with one sentence about what to watch today.
- Do NOT say "I" or "we." Just state the facts.

Respond ONLY in JSON: {{"headline": "...", "body": "..."}}"""
        else:
            summary = market_summary(market=market)
            wow_data = week_over_week(market=market)
            movers_items = wow_data.get("items", [])[:10]

            data_snapshot = {
                "market": market,
                "date": report_date,
                "commodities_reporting": summary.get("commodities"),
                "tone_higher": summary.get("tone_higher"),
                "tone_lower": summary.get("tone_lower"),
                "tone_steady": summary.get("tone_steady"),
                "movement_loads": summary.get("movement_loads"),
                "movement_wow_pct": summary.get("movement_wow"),
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
- Write a body paragraph (3-4 sentences) that explains WHY — connect shipping point movement to price changes. Mention specific commodities, dollar amounts, and percentages from the data.
- Write in plain produce industry language. No jargon. A buyer in a truck at 5 AM should understand this instantly.
- If movement is down and prices are up, say supply is tightening. If movement is up and prices are flat, say supply is flooding.
- End with one actionable sentence — buy ahead, negotiate, hold, or wait.
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
