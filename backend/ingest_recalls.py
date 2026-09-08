"""
AgraX — FDA food recall ingestion.

Pulls food enforcement records straight from openFDA and matches them to the
commodities we publish prices for, so a buyer looking at mango prices can see
that mangoes are under recall without leaving the page.

Source is FDA's own record, not a trade-press article about it. Free, no key,
no licensing, and it's what the trade press is reporting on anyway.

FDA's stated limits, which shape how this is built:
  - The dataset must NOT be used to issue public recall alerts.
  - FDA does not update a recall's status after classification, so "Ongoing"
    records from 2013 are still "Ongoing" today.
Everything stored here is therefore "as published on report_date", and every
row carries a link so a reader can check the live status at FDA.

Run
---
    python ingest_recalls.py            # last 180 days
    python ingest_recalls.py --days 730
"""

import argparse
import logging
import os
import re
import sys
from datetime import date, timedelta

import requests
from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agrax.recalls")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

FDA_URL = "https://api.fda.gov/food/enforcement.json"
PRICES_TABLE = "produce_prices"
TABLE = "produce_recalls"

# Words that mean a match is about something other than the fresh commodity.
# "Apple cider vinegar" and "banana bread mix" are not produce recalls.
EXCLUDE_CONTEXT = (
    "vinegar", "juice", "soda", "candy", "flavored", "flavour", "scented",
    "shampoo", "lotion", "cereal", "cookie", "cracker", "bread", "muffin",
    "yogurt", "ice cream", "pie filling", "jam", "jelly", "syrup", "puree",
    "smoothie", "chips", "supplement", "capsule", "tea", "extract",
)


def fetch_commodities() -> list[str]:
    """Distinct commodity names we publish, longest first.

    Longest first so "Beans, Green" is tested before "Beans" and the more
    specific match wins.
    """
    rows, start = [], 0
    while True:
        batch = (
            supabase.table(PRICES_TABLE).select("commodity")
            .order("commodity").range(start, start + 999).execute().data or []
        )
        if not batch:
            break
        rows.extend(batch)
        start += len(batch)
        if start > 100_000:
            break
    names = {r["commodity"] for r in rows if r.get("commodity")}
    return sorted(names, key=len, reverse=True)


def fetch_recalls(days: int) -> list[dict]:
    """Food enforcement records published in the window, newest first."""
    since = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
    until = date.today().strftime("%Y%m%d")
    out, skip = [], 0

    while True:
        params = {
            "search": f"report_date:[{since}+TO+{until}]",
            "limit": 100,
            "skip": skip,
            "sort": "report_date:desc",
        }
        resp = requests.get(FDA_URL, params=params, timeout=45)
        if resp.status_code == 404:
            break                       # openFDA returns 404 for "no more results"
        if resp.status_code != 200:
            log.warning("FDA returned %s: %s", resp.status_code, resp.text[:200])
            break
        results = resp.json().get("results", [])
        if not results:
            break
        out.extend(results)
        skip += len(results)
        # openFDA refuses skip beyond 26,000; stop well short of it.
        if skip >= 5000:
            break
    return out


def word_forms(name: str) -> set[str]:
    """Singular/plural spellings a recall notice might use for a commodity.

    Our list says "Mangoes"; FDA wrote "Mangos". Naive stemming produced
    "mangoe" and matched neither. Generating the small set of real forms is
    more reliable than trying to stem English correctly.
    """
    n = name.strip().lower()
    forms = {n}
    if n.endswith("oes"):               # mangoes -> mango, mangos
        forms.update({n[:-2], n[:-2] + "s"})
    elif n.endswith("ies"):             # berries -> berry
        forms.add(n[:-3] + "y")
    elif n.endswith("es"):              # cantaloupes -> cantaloupe
        forms.update({n[:-1], n[:-2]})
    elif n.endswith("s"):               # apples -> apple
        forms.add(n[:-1])
    else:                               # onion -> onions
        forms.add(n + "s")
    return {f for f in forms if len(f) >= 4}


def match_commodity(rec: dict, commodities: list[str]) -> str | None:
    """Which commodity, if any, this recall is about.

    Word-boundary matching only. A substring test matched "Corn" inside
    "Popcorn" and "Peas" inside "Please", which would put a snack recall on
    a fresh-produce price page.
    """
    text = " ".join(str(rec.get(f) or "") for f in
                    ("product_description", "reason_for_recall")).lower()
    if not text.strip():
        return None
    if any(x in text for x in EXCLUDE_CONTEXT):
        return None

    for com in commodities:
        # "Beans, Green" -> match on the head word before the comma.
        head = com.split(",")[0].strip()
        forms = word_forms(head)
        if not forms:
            continue
        pattern = r"\b(" + "|".join(re.escape(f) for f in sorted(forms, key=len, reverse=True)) + r")\b"
        if re.search(pattern, text):
            return com
    return None


def parse_date(v):
    if not v or len(str(v)) != 8:
        return None
    v = str(v)
    return f"{v[0:4]}-{v[4:6]}-{v[6:8]}"


def build_row(rec: dict, commodity: str | None) -> dict | None:
    num = rec.get("recall_number")
    if not num:
        return None
    return {
        "recall_number": num,
        "commodity": commodity,
        "classification": rec.get("classification"),
        "status": rec.get("status"),
        "reason": (rec.get("reason_for_recall") or "")[:600] or None,
        "product_description": (rec.get("product_description") or "")[:900] or None,
        "recalling_firm": rec.get("recalling_firm"),
        "distribution": (rec.get("distribution_pattern") or "")[:600] or None,
        "voluntary_mandated": rec.get("voluntary_mandated"),
        "report_date": parse_date(rec.get("report_date")),
        "initiation_date": parse_date(rec.get("recall_initiation_date")),
        "fda_url": "https://www.accessdata.fda.gov/scripts/ires/index.cfm?"
                   f"sd={num}",
    }


def main():
    ap = argparse.ArgumentParser(description="Ingest FDA food recalls.")
    ap.add_argument("--days", type=int, default=180, help="lookback window")
    args = ap.parse_args()

    if not supabase:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set.")

    log.info("=== FDA recall ingestion, last %d days ===", args.days)

    commodities = fetch_commodities()
    log.info("Matching against %d commodities we publish", len(commodities))

    recalls = fetch_recalls(args.days)
    log.info("FDA returned %d food enforcement records", len(recalls))
    if not recalls:
        log.info("Nothing to do.")
        return 0

    rows, matched = [], 0
    for rec in recalls:
        com = match_commodity(rec, commodities)
        if not com:
            continue                    # only store what we can attach to a price
        r = build_row(rec, com)
        if r:
            rows.append(r)
            matched += 1

    log.info("%d records matched a commodity we price", matched)
    if not rows:
        log.info("No produce-relevant recalls in this window.")
        return 0

    # Dedupe on FDA's own recall number before upserting.
    seen, deduped = set(), []
    for r in rows:
        if r["recall_number"] in seen:
            continue
        seen.add(r["recall_number"])
        deduped.append(r)

    total = 0
    for i in range(0, len(deduped), 200):
        chunk = deduped[i:i + 200]
        supabase.table(TABLE).upsert(chunk, on_conflict="recall_number").execute()
        total += len(chunk)
        log.info("  Upserted %d recalls", len(chunk))

    by_com = {}
    for r in deduped:
        by_com[r["commodity"]] = by_com.get(r["commodity"], 0) + 1
    for com, n in sorted(by_com.items(), key=lambda x: -x[1])[:12]:
        log.info("    %-24s %d", com, n)

    log.info("=== Recall ingestion complete. %d rows upserted ===", total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
