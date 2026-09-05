"""
AgraX — alert evaluation and delivery.

Runs after the daily ingest. For every active rule it compares the latest
terminal price for that commodity/market against the rule's threshold and
emails the owner when it trips.

Idempotent by design: a row in alert_deliveries keyed on (rule_id,
report_date) is written before sending, so re-running the job for the same
report date cannot email anyone twice.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_KEY   required
  RESEND_API_KEY                       required to actually send
  ALERT_FROM        default "AgraX <alerts@agra-x.com>"
  ALERT_DRY_RUN     "1" to evaluate and log without sending
"""

import os
import sys
from collections import defaultdict
from datetime import date, timedelta

import requests
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
ALERT_FROM = os.getenv("ALERT_FROM", "AgraX <alerts@agra-x.com>")
DRY_RUN = os.getenv("ALERT_DRY_RUN") == "1"
SITE = os.getenv("FRONTEND_URL", "https://www.agra-x.com")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
TABLE = "produce_prices"


def rep_price(row):
    """Representative price for a SKU row.

    Mirrors skuPrice() in the frontend so an alert fires on the same number
    the user saw when they created the rule. Keep the two in step.
    """
    def num(v):
        try:
            return float(v) if v is not None and v != "" else None
        except (TypeError, ValueError):
            return None

    ml, mh = num(row.get("price_mostly_low")), num(row.get("price_mostly_high"))
    if ml is not None and mh is not None:
        return (ml + mh) / 2
    if ml is not None:
        return ml
    if mh is not None:
        return mh
    lo, hi = num(row.get("price_low")), num(row.get("price_high"))
    if lo is not None and hi is not None:
        return (lo + hi) / 2
    return lo if lo is not None else hi


def latest_report_date():
    res = (
        sb.table(TABLE)
        .select("report_date")
        .order("report_date", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0]["report_date"] if res.data else None


def prices_for(report_date):
    """{(market, commodity): median representative price} for one date."""
    rows, page, size = [], 0, 1000
    while True:
        res = (
            sb.table(TABLE)
            .select("market,commodity,price_low,price_high,price_mostly_low,price_mostly_high")
            .eq("report_date", report_date)
            .range(page * size, page * size + size - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < size:
            break
        page += 1

    buckets = defaultdict(list)
    for r in rows:
        p = rep_price(r)
        if p is not None and r.get("market") and r.get("commodity"):
            buckets[(r["market"], r["commodity"])].append(p)

    out = {}
    for key, vals in buckets.items():
        vals.sort()
        out[key] = vals[len(vals) // 2]
    return out


def evaluate(rule, today_px, week_px):
    """Return (fired, value, description) for one rule."""
    key = (rule["market"], rule["commodity"])
    now = today_px.get(key)
    if now is None:
        return False, None, None

    kind = rule["kind"]
    threshold = float(rule["threshold"])

    if kind == "price_above":
        if now >= threshold:
            return True, now, f"is ${now:,.2f}, at or above your ${threshold:,.2f} mark"
        return False, now, None

    if kind == "price_below":
        if now <= threshold:
            return True, now, f"is ${now:,.2f}, at or below your ${threshold:,.2f} mark"
        return False, now, None

    # any_move: needs a prior week to compare against
    then = week_px.get(key)
    if then is None or then == 0:
        return False, now, None
    pct = (now - then) / then * 100
    if abs(pct) >= threshold:
        direction = "up" if pct > 0 else "down"
        return True, now, (
            f"is {direction} {abs(pct):.1f}% on the week to ${now:,.2f}"
        )
    return False, now, None


def send_email(to_addr, subject, lines):
    if DRY_RUN or not RESEND_API_KEY:
        print(f"[dry-run] would email {to_addr}: {subject}")
        return True

    body = "".join(f"<p style='margin:0 0 12px'>{ln}</p>" for ln in lines)
    html = (
        "<div style=\"font:15px/1.55 -apple-system,system-ui,sans-serif;"
        "color:#0A0A0A;max-width:520px\">"
        f"<h2 style='font-size:19px;margin:0 0 16px'>{subject}</h2>"
        f"{body}"
        f"<p style='margin:22px 0 0'><a href='{SITE}/browse' "
        "style='color:#4D7C0F'>Open AgraX</a></p>"
        "<p style='margin:22px 0 0;font-size:12px;color:#A3A3A3'>"
        "You set this alert on AgraX. Manage or delete it under Watch. "
        "Data from the USDA Agricultural Marketing Service.</p></div>"
    )
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": ALERT_FROM, "to": [to_addr], "subject": subject, "html": html},
            timeout=20,
        )
        if r.status_code >= 300:
            print(f"[alerts] send failed for {to_addr}: {r.status_code} {r.text[:200]}")
            return False
        return True
    except Exception as e:
        print(f"[alerts] send exception for {to_addr}: {e}")
        return False


def main():
    today = latest_report_date()
    if not today:
        print("[alerts] no report data; nothing to do")
        return

    rules = sb.table("alert_rules").select("*").eq("active", True).execute().data or []
    if not rules:
        print("[alerts] no active rules")
        return

    # Only load the prior week if some rule actually needs it.
    today_px = prices_for(today)
    week_px = {}
    if any(r["kind"] == "any_move" for r in rules):
        prior = (date.fromisoformat(str(today)) - timedelta(days=7)).isoformat()
        res = (
            sb.table(TABLE)
            .select("report_date")
            .lte("report_date", prior)
            .order("report_date", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            week_px = prices_for(res.data[0]["report_date"])

    # Resolve emails once per user.
    user_ids = list({r["user_id"] for r in rules})
    emails = {}
    for i in range(0, len(user_ids), 100):
        chunk = user_ids[i : i + 100]
        res = sb.table("profiles").select("id,email").in_("id", chunk).execute()
        for row in res.data or []:
            if row.get("email"):
                emails[row["id"]] = row["email"]

    # Group fired rules per user so one person gets one email, not five.
    per_user = defaultdict(list)
    for rule in rules:
        fired, value, desc = evaluate(rule, today_px, week_px)
        if not fired:
            continue
        try:
            sb.table("alert_deliveries").insert(
                {"rule_id": rule["id"], "report_date": str(today), "value": value}
            ).execute()
        except Exception:
            # Unique index tripped: already sent for this report date.
            continue
        per_user[rule["user_id"]].append((rule, value, desc))

    sent = 0
    for user_id, hits in per_user.items():
        to_addr = emails.get(user_id)
        if not to_addr:
            print(f"[alerts] no email on file for user {user_id}; skipping")
            continue

        lines = [
            f"<strong>{r['commodity']}</strong> in {r['market']} {desc}."
            for r, _v, desc in hits
        ]
        subject = (
            f"{hits[0][0]['commodity']} moved in {hits[0][0]['market']}"
            if len(hits) == 1
            else f"{len(hits)} of your commodities moved"
        )
        if send_email(to_addr, subject, lines):
            sent += 1
            for rule, value, _d in hits:
                sb.table("alert_rules").update(
                    {"last_fired_at": "now()", "last_value": value}
                ).eq("id", rule["id"]).execute()

    print(
        f"[alerts] report {today}: {len(rules)} rules, "
        f"{sum(len(v) for v in per_user.values())} fired, {sent} emails sent"
    )


if __name__ == "__main__":
    main()
