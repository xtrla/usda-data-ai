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
import hashlib
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
    # ── Terminal Markets (destination wholesale prices) ──────────
    {"slug_id": 2232, "code": "NX_FV010", "market": "New York",        "market_type": "terminal"},
    {"slug_id": 2315, "code": "NX_FV020", "market": "New York",        "market_type": "terminal"},
    {"slug_id": 945,  "code": "HC_FV010", "market": "Los Angeles",     "market_type": "terminal"},
    {"slug_id": 946,  "code": "HC_FV020", "market": "Los Angeles",     "market_type": "terminal"},
    {"slug_id": 1094, "code": "MH_FV010", "market": "Miami",           "market_type": "terminal"},
    {"slug_id": 1095, "code": "MH_FV020", "market": "Miami",           "market_type": "terminal"},
    {"slug_id": 1150, "code": "CH_FV010", "market": "Chicago",         "market_type": "terminal"},
    {"slug_id": 1151, "code": "CH_FV020", "market": "Chicago",         "market_type": "terminal"},
    # ── Shipping Points (FOB origin prices) ─────────────────────
    # California — Fresno (fruits + vegetables, daily)
    {"slug_id": 2390, "code": "FR_FV110", "market": "Fresno",          "market_type": "shipping_point"},
    {"slug_id": 2391, "code": "FR_FV120", "market": "Fresno",          "market_type": "shipping_point"},
    # Florida — Orlando (fruits + vegetables, daily)
    {"slug_id": 2399, "code": "OR_FV110", "market": "Orlando",         "market_type": "shipping_point"},
    {"slug_id": 2400, "code": "OR_FV120", "market": "Orlando",         "market_type": "shipping_point"},
    # Florida — Orlando imports (tropical fruits via Miami/Orlando ports)
    {"slug_id": 2401, "code": "OR_FV111", "market": "Orlando Imports", "market_type": "shipping_point"},
    # Arizona/Mexico crossings — Phoenix (fruits + vegetables, daily)
    {"slug_id": 2402, "code": "IX_FV110", "market": "Phoenix",         "market_type": "shipping_point"},
    {"slug_id": 2403, "code": "IX_FV120", "market": "Phoenix",         "market_type": "shipping_point"},
    # Southeast — Raleigh NC (vegetables, seasonal)
    {"slug_id": 2404, "code": "RA_FV110", "market": "Raleigh",         "market_type": "shipping_point"},
    {"slug_id": 2405, "code": "RA_FV120", "market": "Raleigh",         "market_type": "shipping_point"},
    # Southeast — Thomasville GA (vegetables, daily)
    {"slug_id": 2410, "code": "TV_FV120", "market": "Thomasville",     "market_type": "shipping_point"},
    {"slug_id": 2411, "code": "TH_FV120", "market": "Thomasville",     "market_type": "shipping_point"},
    # Miami imports (tropical fruit through Miami port)
    {"slug_id": 2395, "code": "MH_FV111", "market": "Miami Imports",   "market_type": "shipping_point"},
    # National weekly trends — price direction + movement summary
    {"slug_id": 1662, "code": "FVWTRDS",  "market": "National Trends", "market_type": "shipping_point"},
]


# ── USDA Fetch ───────────────────────────────────────────────────────────────

def fetch_latest_report(slug_id: int) -> list[dict]:
    """Fetch the most recently published report for a slug (no date filter)."""
    url = f"{MARS_BASE}/reports/{slug_id}/report details"
    params = {"lastReports": 1}
    resp = requests.get(url, params=params, auth=(MARS_KEY, ""), timeout=30)
    if resp.status_code in (404, 401):
        return []
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, list):
        return data
    return data.get("results", [])


def fetch_report(slug_id: int, report_date: str = None) -> list[dict]:
    """
    Fetch price detail rows from MARS API for a given slug.
    Uses the 'report details' endpoint which returns actual commodity price rows,
    not the report header/summary.
    """
    # Build query string — MARS uses semicolon-separated filters
    filters = []
    if report_date:
        filters.append(f"report_date={report_date}")
    q = ";".join(filters) if filters else None

    # /reports/{slug_id}/report details  → returns actual price rows
    url = f"{MARS_BASE}/reports/{slug_id}/report details"
    params = {}
    if q:
        params["q"] = q

    resp = requests.get(
        url,
        params=params,
        auth=(MARS_KEY, ""),
        timeout=30,
    )
    if resp.status_code == 404:
        log.warning("Slug %s returned 404 — report not published yet", slug_id)
        return []
    if resp.status_code == 401:
        log.error("Slug %s returned 401 — check MARS_API_KEY", slug_id)
        return []
    resp.raise_for_status()
    data = resp.json()

    # API returns either a list directly or {"results": [...]}
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


# ── Commodity name normalizer ────────────────────────────────────────────────
# USDA uses different naming conventions between terminal and shipping point
# reports. Terminal: "Squash, Butternut"  Shipping point: "Squash" var="Butternut"
# This map ensures both resolve to the same canonical name in Supabase.
# Key = what the API returns (lowercased), Value = canonical display name.

COMMODITY_MAP = {
    # Squash variants — shipping point reports use "squash" + variety field
    "squash, acorn":           "Squash, Acorn",
    "squash, butternut":       "Squash, Butternut",
    "squash, delicata":        "Squash, Delicata",
    "squash, grey":            "Squash, Grey",
    "squash, kabocha":         "Squash, Kabocha",
    "squash, spaghetti":       "Squash, Spaghetti",
    "squash, yellow crookneck": "Squash, Yellow Crookneck",
    "squash, yellow straightneck": "Squash, Yellow Straightneck",
    "squash, zucchini":        "Squash, Zucchini",
    "squash":                  "Squash",
    # Tomato variants
    "tomatoes":                "Tomatoes",
    "tomatoes, cherry":        "Tomatoes, Cherry",
    "tomatoes, grape type":    "Tomatoes, Grape Type",
    "tomatoes, plum type":     "Tomatoes, Plum Type",
    # Pepper variants
    "peppers (bell type)":     "Peppers (Bell Type)",
    "peppers, bell type":      "Peppers (Bell Type)",
    "peppers, anaheim":        "Peppers, Anaheim",
    "peppers, jalapeno":       "Peppers, Jalapeno",
    "peppers, poblano":        "Peppers, Poblano",
    "peppers, serrano":        "Peppers, Serrano",
    "peppers, habanero":       "Peppers, Habanero",
    # Lettuce variants
    "lettuce, iceberg":        "Lettuce, Iceberg",
    "lettuce, romaine":        "Lettuce, Romaine",
    "lettuce, green leaf":     "Lettuce, Green Leaf",
    "lettuce, red leaf":       "Lettuce, Red Leaf",
    "lettuce, boston":         "Lettuce, Boston",
    # Onion variants
    "onions, dry":             "Onions",
    "onions dry":              "Onions",
    "onions":                  "Onions",
    "onions green":            "Onions, Green",
    "onions, green":           "Onions, Green",
    # Common name fixes
    "sweet potatoes":          "Sweet Potatoes",
    "potatoes":                "Potatoes",
    "avocados":                "Avocados",
    "strawberries":            "Strawberries",
    "blueberries":             "Blueberries",
    "raspberries":             "Raspberries",
    "blackberries":            "Blackberries",
    "grapes":                  "Grapes",
    "mangoes":                 "Mangoes",
    "pineapples":              "Pineapples",
    "watermelons":             "Watermelons",
    "cantaloupes":             "Cantaloupes",
    "honeydews":               "Honeydews",
    "oranges":                 "Oranges",
    "lemons":                  "Lemons",
    "limes":                   "Limes",
    "grapefruit":              "Grapefruit",
    "tangerines":              "Tangerines",
    "apples":                  "Apples",
    "pears":                   "Pears",
    "peaches":                 "Peaches",
    "plums":                   "Plums",
    "cherries":                "Cherries",
    "asparagus":               "Asparagus",
    "broccoli":                "Broccoli",
    "cauliflower":             "Cauliflower",
    "cabbage":                 "Cabbage",
    "celery":                  "Celery",
    "carrots":                 "Carrots",
    "cucumbers":               "Cucumbers",
    "eggplant":                "Eggplant",
    "garlic":                  "Garlic",
    "spinach":                 "Spinach",
    "corn, sweet":             "Corn, Sweet",
    "mushrooms":               "Mushrooms",
}

def normalize_commodity(raw_name: str) -> str:
    """
    Normalize commodity name to canonical form used across all report types.
    Preserves sub-commodity distinctions (Squash, Butternut vs Squash, Zucchini).
    """
    if not raw_name:
        return ""
    key = raw_name.strip().lower()
    if key in COMMODITY_MAP:
        return COMMODITY_MAP[key]
    # Default: title case but preserve comma-separated sub-names
    return raw_name.strip().title()


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


# ── Origin normalizer ────────────────────────────────────────────────────────
# Shipping point reports return verbose district names — normalize to clean form.
ORIGIN_MAP = {
    "mexico crossings through nogales arizona": "Nogales, AZ",
    "nogales fob sc":                           "Nogales, AZ",
    "phoenix fob sc":                           "Phoenix, AZ",
    "fresno (fr) fob sc":                       "Fresno, CA",
    "orlando (oviedo) fob sc":                  "Orlando, FL",
    "orlando (imports) fob sc":                 "Orlando Imports",
    "south florida":                            "South Florida",
    "central florida":                          "Central Florida",
    "mexico - texas crossing":                  "Mexico/Texas",
    "mexico - nogales":                         "Nogales, AZ",
    "salinas-watsonville california":           "Salinas, CA",
    "central coast california":                 "Central Coast, CA",
    "san joaquin valley california":            "San Joaquin, CA",
    "oxnard district california":               "Oxnard, CA",
    "western arizona":                          "Western AZ",
    "imperial valley california":               "Imperial Valley, CA",
    "columbia basin washington":                "Columbia Basin, WA",
}

def normalize_origin(raw: str) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in ORIGIN_MAP:
        return ORIGIN_MAP[key]
    # Clean up verbose district names — title case, max 100 chars
    cleaned = raw.strip().title()[:100]
    return cleaned or None


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
    mostly_low_raw = raw.get("mostly_low_price") or raw.get("mostly_low")
    mostly_high_raw = raw.get("mostly_high_price") or raw.get("mostly_high")

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

    # ── Field names vary between terminal and shipping point reports ────────
    # Terminal:      appearance, quality, condition, package, variety, item_size
    # Shipping Point: appear,    quality, cond,      pkg,     var,     item_size
    appearance_field = str(raw.get("appearance") or raw.get("appear") or "").strip().lower()
    quality_field    = str(raw.get("quality") or "").strip().lower()
    condition_field  = str(raw.get("condition") or raw.get("cond") or "").strip().lower()
    size_field       = str(raw.get("item_size") or "").strip()
    grade_field      = str(raw.get("grade") or "").strip()
    supply_note      = str(raw.get("market_tone_comments") or raw.get("offerings_comments") or raw.get("supply_tone_comments") or "").strip()

    # Package field — terminal uses 'package', shipping point uses 'pkg'
    package_raw = str(raw.get("package") or raw.get("pkg") or "").strip()
    # Variety field — terminal uses 'variety', shipping point uses 'var'
    variety_raw = str(raw.get("variety") or raw.get("var") or "").strip().upper()

    # Combine all quality signals for parsing
    quality_combined = " ".join(filter(None, [appearance_field, quality_field, condition_field, size_field]))
    grade_text       = " ".join(filter(None, [grade_field, quality_combined]))

    # Organic — comes as "Y"/"N" or True/False
    organic_raw = raw.get("organic") or ""
    organic_flag = (
        str(organic_raw).strip().upper() in ("Y", "YES", "TRUE", "1")
        or "organic" in quality_combined.lower()
    )

    row = {
        "report_date":        report_date,
        "market":             report_meta["market"],
        "market_type":        report_meta["market_type"],
        "commodity":          normalize_commodity(commodity),
        "variety":            variety_raw[:100] or None,
        "origin":             normalize_origin(raw.get("origin") or raw.get("district") or raw.get("reporting_city") or ""),
        "package":            normalize_package(package_raw)[:100] if package_raw else None,
        "size":               normalize_size(size_field),
        "grade":              extract_grade(grade_text) or grade_field.title() or None,
        "quality_note":       extract_quality_note(appearance_field, quality_field, condition_field),
        "organic":            organic_flag,
        "price_low":          price_low,
        "price_high":         price_high,
        "price_mostly_low":   mostly_low,
        "price_mostly_high":  mostly_high,
        "movement":           normalize_movement(raw.get("movement") or raw.get("market_tone_comments")),
        "trading_activity":   normalize_trading(raw.get("trading_desc") or raw.get("unit_sales")),
        "supply_note":        supply_note.upper()[:200] or None,
        "slug_id":            report_meta["slug_id"],
        "source_report":      report_meta["code"],
    }
    # Compute row_hash for deduplication
    hash_str = "|".join([
        str(row.get("report_date") or ""),
        str(row.get("source_report") or ""),
        str(row.get("market") or ""),
        str(row.get("commodity") or ""),
        str(row.get("variety") or ""),
        str(row.get("origin") or ""),
        str(row.get("package") or ""),
        str(row.get("size") or ""),
        str(row.get("quality_note") or ""),
        str(row.get("organic") or "false"),
    ])
    row["row_hash"] = hashlib.md5(hash_str.encode()).hexdigest()
    return row


# ── Upsert ───────────────────────────────────────────────────────────────────

def upsert_rows(rows: list[dict]) -> int:
    """
    Upsert rows using row_hash as the conflict target.
    On conflict (same hash = same row already exists) do nothing.
    """
    if not rows:
        return 0

    BATCH = 500
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        result = (
            supabase.table(TABLE)
            .upsert(chunk, on_conflict="row_hash", ignore_duplicates=True)
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

    If today has no data yet (USDA not published), automatically falls back
    to the most recent available date for each report.
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

        # If no data for today, try fetching the most recent available report
        if not raw_rows:
            log.info("  No data for %s on %s — trying latest available...", code, target_date)
            try:
                raw_rows = fetch_latest_report(slug_id)
            except Exception as e:
                log.error("Failed to fetch latest %s: %s", code, e)
                continue

        if not raw_rows:
            log.info("  No data available for %s", code)
            continue

        log.info("  Got %d raw rows from API", len(raw_rows))
        # Log sample to verify field names and commodity names
        if raw_rows:
            import json
            log.info("  Sample row keys: %s", list(raw_rows[0].keys()))
            log.info("  Sample row: %s", json.dumps(raw_rows[0], default=str)[:500])
            # Log unique commodity names for mapping verification
            raw_commodities = list(set(r.get("commodity","") for r in raw_rows if r.get("commodity")))[:20]
            log.info("  Commodities in this report: %s", raw_commodities)

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
