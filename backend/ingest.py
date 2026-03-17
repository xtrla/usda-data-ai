"""
agraX — USDA Market News ingestion script
Fetches terminal market + shipping point reports daily and upserts into Supabase.

Run manually:   python ingest.py
Run on schedule: add to Railway cron or a simple cron job

Requires env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  MARS_API_KEY   (free from mymarketnews.ams.usda.gov)
"""

import os
import re
import json
import logging
import requests
from datetime import date, datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
TABLE = "produce_prices"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── USDA MARS API ────────────────────────────────────────────────────────────
MARS_KEY = os.getenv("MARS_API_KEY", "")
MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"

# Report slug IDs to ingest daily.
# Add more from https://mymarketnews.ams.usda.gov/public_data
# market_type: "terminal" or "shipping_point"
REPORT_SLUGS = [
    # ── Terminal Markets ─────────────────────────────────────────
    {"slug_id": 2232, "code": "NX_FV010", "market": "New York",      "market_type": "terminal"},
    {"slug_id": 2315, "code": "NX_FV020", "market": "New York",      "market_type": "terminal"},
    {"slug_id": 945,  "code": "HC_FV010", "market": "Los Angeles",   "market_type": "terminal"},
    {"slug_id": 946,  "code": "HC_FV020", "market": "Los Angeles",   "market_type": "terminal"},
    {"slug_id": 1094, "code": "MH_FV010", "market": "Miami",         "market_type": "terminal"},
    {"slug_id": 1095, "code": "MH_FV020", "market": "Miami",         "market_type": "terminal"},
    {"slug_id": 1150, "code": "CH_FV010", "market": "Chicago",       "market_type": "terminal"},
    {"slug_id": 1151, "code": "CH_FV020", "market": "Chicago",       "market_type": "terminal"},
    {"slug_id": 1200, "code": "DA_FV010", "market": "Dallas",        "market_type": "terminal"},
    {"slug_id": 1201, "code": "DA_FV020", "market": "Dallas",        "market_type": "terminal"},
    # ── Shipping Points (FOB) ────────────────────────────────────
    {"slug_id": 1780, "code": "fvdfob",   "market": "National FOB",  "market_type": "shipping_point"},
    {"slug_id": 1781, "code": "fvwtrds",  "market": "National Trends","market_type": "shipping_point"},
]


# ── USDA Fetch ───────────────────────────────────────────────────────────────

def fetch_report(slug_id: int, report_date: str = None) -> list[dict]:
    """Fetch rows from MARS API for a given slug, optionally filtered by date."""
    params = {}
    if report_date:
        params["q"] = f"report_date={report_date}"

    url = f"{MARS_BASE}/reports/{slug_id}"
    resp = requests.get(
        url,
        params=params,
        auth=(MARS_KEY, ""),
        timeout=30,
    )
    if resp.status_code == 404:
        log.warning("Slug %s returned 404 — may not be published yet", slug_id)
        return []
    resp.raise_for_status()
    data = resp.json()
    # MARS API returns either a list or {"results": [...]}
    if isinstance(data, list):
        return data
    return data.get("results", [])


# ── Parsers ──────────────────────────────────────────────────────────────────

def parse_price_range(price_str: str) -> tuple[float | None, float | None]:
    """
    Parse USDA price strings into (low, high).
    Handles: "35.00", "35.00-37.00", "35.00 - 37.00"
    """
    if not price_str:
        return None, None
    price_str = str(price_str).strip()
    match = re.match(r"^(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)$", price_str)
    if match:
        return float(match.group(1)), float(match.group(2))
    try:
        v = float(price_str)
        return v, None
    except ValueError:
        return None, None


def parse_mostly_range(mostly_str: str) -> tuple[float | None, float | None]:
    """Parse 'mostly 35.50-36.50' → (35.50, 36.50)"""
    if not mostly_str:
        return None, None
    mostly_str = str(mostly_str).strip().lower().replace("mostly", "").strip()
    return parse_price_range(mostly_str)


# ── Quality/condition qualifier parser ──────────────────────────────────────
#
# USDA uses these qualifiers inline with prices in the raw text.
# They appear in the API as separate fields (quality, item_size, market_note)
# or embedded in the size/description string.
#
# Ordered longest-first so "fair appearance holdovers" matches before "fair appearance"
# and "poorer quality and condition" matches before "poorer quality".
#
# Meaning:
#   fine appearance         → premium, top visual quality, highest price tier
#   fair quality/appearance → below standard, still saleable, lower price
#   fair condition          → condition issue (bruising, ripeness), lower price
#   holdovers               → old stock from prior day(s), significantly lower
#   fair appearance holdovers → old AND below grade, lowest price tier
#   poorer quality/condition  → significant defects, rarely sold in bulk

QUALITY_QUALIFIERS = [
    "poorer quality and condition",
    "fair appearance holdovers",
    "fair quality holdovers",
    "fine appearance",
    "fair appearance",
    "fair quality",
    "fair condition",
    "poorer quality",
    "holdovers",
]

def extract_quality_note(
    quality_field: str | None,
    size_field: str | None = None,
    market_note: str | None = None,
) -> str | None:
    """
    Extract quality/condition qualifier from MARS API fields.

    The qualifier can live in:
      - quality_field  (raw.get("quality") or raw.get("condition"))
      - size_field     (raw.get("item_size") — USDA sometimes embeds it here)
      - market_note    (raw.get("market_note") — fallback)

    Returns None for standard/unqualified stock.
    """
    combined = " ".join(filter(None, [
        str(quality_field or "").lower(),
        str(size_field or "").lower(),
        str(market_note or "").lower(),
    ])).strip()

    if not combined:
        return None

    for qualifier in QUALITY_QUALIFIERS:
        if qualifier in combined:
            return qualifier

    return None


# Known grade strings — separate from quality notes
GRADE_PATTERNS = [
    r"u\.?s\.?\s*one",
    r"u\.?s\.?\s*fancy",
    r"u\.?s\.?\s*extra\s*fancy",
    r"u\.?s\.?\s*no\.?\s*1",
    r"shippers?\s*first\s*grade",
    r"shippers?\s*choice",
    r"extra\s*fancy",
    r"no\s*grade\s*marks",
    r"wa\s*extra\s*fancy",
    r"wa\s*fancy",
]


def extract_grade(text: str) -> str | None:
    text_lower = text.lower()
    for pat in GRADE_PATTERNS:
        m = re.search(pat, text_lower)
        if m:
            return m.group(0).title()
    return None


def is_organic(text: str) -> bool:
    return "organic" in text.lower()


def normalize_size(size_val) -> str | None:
    """Normalize size field — USDA uses '48s', '48', 'jumbo', '110s', etc."""
    if size_val is None:
        return None
    s = str(size_val).strip()
    if not s or s == "0":
        return None
    # Ensure trailing 's' for count sizes
    if re.match(r"^\d+$", s):
        return s + "s"
    return s


def normalize_package(pkg_val) -> str | None:
    if not pkg_val:
        return None
    return str(pkg_val).strip().lower() or None


def normalize_movement(mov_val) -> str | None:
    if not mov_val:
        return None
    s = str(mov_val).strip()
    # Normalize USDA movement strings
    mapping = {
        "much higher": "Much Higher",
        "higher": "Higher",
        "slightly higher": "Slightly Higher",
        "generally unchanged": "Unchanged",
        "unchanged": "Unchanged",
        "slightly lower": "Slightly Lower",
        "lower": "Lower",
        "much lower": "Much Lower",
    }
    return mapping.get(s.lower(), s.title())


def normalize_trading(trading_val) -> str | None:
    if not trading_val:
        return None
    s = str(trading_val).strip()
    mapping = {
        "active": "Active",
        "fairly active": "Fairly Active",
        "moderate": "Moderate",
        "slow": "Slow",
        "good": "Good",
        "light": "Light",
    }
    return mapping.get(s.lower(), s.title())


# ── Row builder ──────────────────────────────────────────────────────────────

def build_row(raw: dict, report_meta: dict) -> dict | None:
    """
    Transform one MARS API result row into our Supabase schema.

    MARS terminal market fields (actual field names from API):
      commodity, variety, origin, market, report_date,
      package, item_size, grade, quality, organic,
      low_price, high_price, mostly_low, mostly_high,
      movement, trading_desc, market_note
    """
    commodity = (raw.get("commodity") or "").strip()
    if not commodity:
        return None

    report_date_raw = raw.get("report_date") or raw.get("report_begin_date")
    try:
        report_date = datetime.strptime(report_date_raw, "%m/%d/%Y").date().isoformat()
    except Exception:
        report_date = date.today().isoformat()

    # Prices
    low_price_raw = raw.get("low_price") or raw.get("price") or raw.get("price_low")
    high_price_raw = raw.get("high_price") or raw.get("price_high")
    mostly_low_raw = raw.get("mostly_low")
    mostly_high_raw = raw.get("mostly_high")

    price_low, price_high_from_range = parse_price_range(str(low_price_raw) if low_price_raw else "")

    # If API gives separate high, prefer that; else use range parse
    if high_price_raw:
        try:
            price_high = float(high_price_raw)
        except (ValueError, TypeError):
            price_high = price_high_from_range
    else:
        price_high = price_high_from_range

    mostly_low, mostly_high = parse_mostly_range(str(mostly_low_raw) if mostly_low_raw else "")
    if not mostly_low and mostly_high_raw:
        try:
            mostly_low = float(mostly_low_raw)
            mostly_high = float(mostly_high_raw)
        except (ValueError, TypeError):
            pass

    if price_low is None:
        return None  # skip rows with no price

    # Pull quality-related fields individually for targeted parsing
    quality_field  = raw.get("quality") or raw.get("condition") or raw.get("quality_condition") or ""
    size_field     = raw.get("item_size") or raw.get("size") or ""
    market_note    = raw.get("market_note") or raw.get("supply") or ""
    grade_field    = raw.get("grade") or ""

    # Combined text for grade extraction (grade lives in different fields by report type)
    grade_text = " ".join(filter(None, [grade_field, quality_field, market_note]))

    # Organic flag — appears as a section header in USDA reports
    organic_flag = (
        bool(raw.get("organic"))
        or "organic" in str(quality_field).lower()
        or "organic" in str(market_note).lower()
        or "organic" in str(raw.get("section") or "").lower()
    )

    return {
        "report_date":        report_date,
        "market":             report_meta["market"],
        "market_type":        report_meta["market_type"],
        "commodity":          commodity.title(),
        "variety":            (raw.get("variety") or "").strip().upper() or None,
        "origin":             (raw.get("origin") or raw.get("location") or "").strip().title() or None,
        "package":            normalize_package(raw.get("package")),
        "size":               normalize_size(size_field),
        "grade":              extract_grade(grade_text) or grade_field.strip().title() or None,
        "quality_note":       extract_quality_note(quality_field, size_field, market_note),
        "organic":            organic_flag,
        "price_low":          price_low,
        "price_high":         price_high,
        "price_mostly_low":   mostly_low,
        "price_mostly_high":  mostly_high,
        "movement":           normalize_movement(raw.get("movement") or raw.get("price_change")),
        "trading_activity":   normalize_trading(raw.get("trading_desc") or raw.get("trading")),
        "supply_note":        (raw.get("market_note") or raw.get("supply") or "").strip().upper() or None,
        "slug_id":            report_meta["slug_id"],
        "source_report":      report_meta["code"],
    }


# ── Upsert ───────────────────────────────────────────────────────────────────

def upsert_rows(rows: list[dict]) -> int:
    """Upsert rows into Supabase using the unique constraint as the conflict target."""
    if not rows:
        return 0

    # Batch in chunks of 500 (Supabase limit)
    BATCH = 500
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        result = (
            supabase.table(TABLE)
            .upsert(
                chunk,
                on_conflict="report_date,source_report,market,commodity,variety,origin,package,size,quality_note,organic",
            )
            .execute()
        )
        total += len(chunk)
        log.info("Upserted batch %d rows", len(chunk))

    return total


# ── Main ─────────────────────────────────────────────────────────────────────

def run(target_date: str = None):
    """
    Ingest all configured report slugs for today (or target_date if given).
    target_date format: "MM/DD/YYYY"
    """
    if not target_date:
        target_date = date.today().strftime("%m/%d/%Y")

    log.info("Starting ingestion for %s", target_date)
    grand_total = 0

    for report_meta in REPORT_SLUGS:
        slug_id = report_meta["slug_id"]
        code = report_meta["code"]
        log.info("Fetching %s (slug %s)...", code, slug_id)

        try:
            raw_rows = fetch_report(slug_id, target_date)
        except Exception as e:
            log.error("Failed to fetch %s: %s", code, e)
            continue

        if not raw_rows:
            log.info("  No data for %s on %s", code, target_date)
            continue

        log.info("  Got %d raw rows from API", len(raw_rows))
        # Log first row keys and sample so we can verify field names
        if raw_rows:
            import json
            log.info("  Sample row keys: %s", list(raw_rows[0].keys()))
            log.info("  Sample row: %s", json.dumps(raw_rows[0], default=str)[:500])

        built = []
        for raw in raw_rows:
            row = build_row(raw, report_meta)
            if row:
                built.append(row)

        log.info("  Built %d valid rows", len(built))
        upserted = upsert_rows(built)
        grand_total += upserted
        log.info("  Upserted %d rows for %s", upserted, code)

    log.info("Ingestion complete. Total rows upserted: %d", grand_total)
    return grand_total


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else None
    run(target)
