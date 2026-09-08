"""
agraX — USDA Movement Data Ingestion
=====================================

Fetches daily fruit & vegetable shipment/movement data from the USDA MARS API
and upserts into the `produce_movement` table in Supabase.

This fills the gap: the existing ingest.py handles terminal market prices and
FOB shipping point prices, but nothing was writing to produce_movement.

Reports ingested:
  WA_FV170  (slug 3283) — National daily movement (Truck/Air/Boat), Washington DC
  WA_FV171  (slug 3285) — National truck shipments by weight

Run manually:   python ingest_movement.py
Run on schedule: call from scheduler.py after the main ingest

Requires the same env vars as ingest.py:
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  MARS_API_KEY
"""

import os
import re
import json
import hashlib
import logging
import requests
from datetime import date, datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
MOVEMENT_TABLE = "produce_movement"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── USDA MARS API ────────────────────────────────────────────────────────────
MARS_KEY = os.getenv("MARS_API_KEY", "")
MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"

# Movement report slugs (current, not discontinued)
MOVEMENT_SLUGS = [
    # National daily movement — the big one, replaces all old regional FV175 reports
    {"slug_id": 3283, "code": "WA_FV170", "name": "National Daily Movement (Truck/Air/Boat)"},
    # National truck shipments by weight
    {"slug_id": 3285, "code": "WA_FV171", "name": "National Truck Shipments by Weight"},
]

# Regional movement reports (still active as of 2026)
REGIONAL_MOVEMENT_SLUGS = [
    {"slug_id": 2792, "code": "CA_FV175", "name": "Columbia, SC Movement"},
    {"slug_id": 2716, "code": "TV_FV175", "name": "Thomasville, GA Movement"},
    {"slug_id": 3126, "code": "NG_FV175", "name": "Nogales, AZ Movement"},
]

# ── Transport mode normalization ─────────────────────────────────────────────
TRANS_MODE_MAP = {
    "TRUCK": ("T", "Truck"),
    "T": ("T", "Truck"),
    "RAIL": ("R", "Rail"),
    "R": ("R", "Rail"),
    "AIR": ("A", "Air"),
    "A": ("A", "Air"),
    "BOAT": ("B", "Boat"),
    "B": ("B", "Boat"),
    "IMPORT": ("I", "Import"),
    "I": ("I", "Import"),
}

def normalize_trans_mode(raw: str) -> tuple:
    """Return (short_code, full_name) for a transport mode string."""
    if not raw:
        return ("T", "Truck")  # default
    key = raw.strip().upper()
    # Handle parenthetical like "CD (BOAT)"
    paren = re.search(r"\((\w+)\)", key)
    if paren:
        key = paren.group(1)
    return TRANS_MODE_MAP.get(key, ("T", "Truck"))


# ── Origin normalization ────────────────────────────────────────────────────
# USDA movement uses 2-letter state codes and country codes
STATE_CODES = {
    "AL": "Alabama", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CA-C": "Central California", "CA-S": "Southern California", "CA-N": "Northern California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida",
    "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
    # Countries
    "MX": "Mexico", "CD": "Canada", "GT": "Guatemala", "CL": "Chile",
    "PE": "Peru", "CR": "Costa Rica", "HN": "Honduras", "EC": "Ecuador",
    "CO": "Colombia", "AR": "Argentina", "BR": "Brazil", "DR": "Dominican Republic",
    "NZ": "New Zealand", "AU": "Australia", "ZA": "South Africa",
    "GU": "Guatemala", "HD": "Honduras", "MR": "Morocco",
}

def normalize_origin(raw: str) -> tuple:
    """Return (origin_code, origin_name) from a USDA origin string."""
    if not raw:
        return (None, None)
    raw = raw.strip()
    # Try direct lookup
    upper = raw.upper()
    if upper in STATE_CODES:
        return (upper, STATE_CODES[upper])
    # Maybe it's already a full name
    for code, name in STATE_CODES.items():
        if raw.lower() == name.lower():
            return (code, name)
    # Return as-is
    return (raw[:10], raw)


# ── Commodity normalization ─────────────────────────────────────────────────
def normalize_commodity(raw: str) -> str:
    """Clean up commodity name to match the terminal market names."""
    if not raw:
        return "Unknown"
    name = raw.strip()
    # Title case but preserve existing caps like "Type" qualifiers
    # Remove trailing type indicators that are redundant
    name = re.sub(r"\s+", " ", name)
    # Capitalize first letter of each word
    name = name.title()
    # Fix common patterns
    name = name.replace(" - ", ", ")
    return name[:100]


# ── Fetch from MARS API ────────────────────────────────────────────────────
def fetch_movement_report(slug_id: int, report_date: str = None) -> list[dict]:
    """
    Fetch movement rows from MARS API.
    report_date format: "MM/DD/YYYY"
    """
    url = f"{MARS_BASE}/reports/{slug_id}/report details"
    params = {}
    if report_date:
        params["q"] = f"report_date={report_date}"

    try:
        resp = requests.get(url, params=params, auth=(MARS_KEY, ""), timeout=60)
        if resp.status_code in (404, 401):
            log.warning("Slug %s returned %d", slug_id, resp.status_code)
            return []
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("results", [])
    except Exception as e:
        log.error("Failed to fetch slug %s: %s", slug_id, e)
        return []


def fetch_latest_movement(slug_id: int) -> list[dict]:
    """Fetch the most recently published movement report."""
    url = f"{MARS_BASE}/reports/{slug_id}/report details"
    params = {"lastReports": 1}
    try:
        resp = requests.get(url, params=params, auth=(MARS_KEY, ""), timeout=60)
        if resp.status_code in (404, 401):
            return []
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("results", [])
    except Exception as e:
        log.error("Failed to fetch latest for slug %s: %s", slug_id, e)
        return []


# ── Parse a raw MARS row into a produce_movement record ────────────────────

# ── FIELD RESOLUTION ────────────────────────────────────────
# The MARS movement endpoints don't use the same field names as the price
# endpoints, and they differ between reports. Hard-coding a guessed list
# meant WA_FV170 returned 1,159 good rows and every one was discarded as
# "no commodity/volume".
#
# These resolve a field by looking for a pattern in the actual keys, so a
# rename or a report-specific spelling doesn't silently drop a whole day.

def _find_key(raw: dict, *patterns) -> str | None:
    """First key whose lowered name contains one of the patterns.

    Exact matches win over substring matches so that "commodity" is never
    beaten by "commodity_group" when both are present.
    """
    keys = list(raw.keys())
    lowered = {k: k.lower().replace(" ", "_") for k in keys}
    for pat in patterns:
        for k in keys:
            if lowered[k] == pat:
                return k
    for pat in patterns:
        for k in keys:
            if pat in lowered[k]:
                return k
    return None


def _get(raw: dict, *patterns):
    k = _find_key(raw, *patterns)
    return raw.get(k) if k else None


def parse_movement_row(raw: dict, slug_info: dict) -> dict | None:
    """
    Parse a single MARS API movement row into a produce_movement record.

    Movement reports vary in field names. Common fields across WA_FV170/FV175:
      commodity, origin/district, report_date/published_date
      trans_mode, package_count/total_10000_units, unit_of_measure

    The volume can come as:
      - total_pounds (direct weight)
      - package_count (count of packages — convert using avg pkg weight)
      - total_10000_units (10,000 lb units — multiply by 10000)
      - quantity (generic)
    """
    # Commodity
    commodity = _get(raw, "commodity", "item", "product") or ""
    commodity = normalize_commodity(commodity)
    if not commodity or commodity == "Unknown":
        return None

    # Report date — MARS returns various date formats
    report_date = _get(
        raw, "report_date", "published_date", "report_begin_date", "date"
    ) or ""
    if not report_date:
        return None
    # Normalize date to YYYY-MM-DD
    report_date = _normalize_date(str(report_date))
    if not report_date:
        return None

    # Origin
    origin_raw = _get(
        raw, "origin", "district", "reporting_area", "region", "state", "city"
    ) or ""
    origin_code, origin_name = normalize_origin(origin_raw)

    # Transport mode
    trans_raw = _get(raw, "trans_mode", "transportation_mode", "transportation", "mode") or ""
    trans_code, trans_full = normalize_trans_mode(trans_raw)

    # Volume — try multiple fields, convert to pounds
    total_pounds = _extract_volume(raw)
    if total_pounds is None or total_pounds <= 0:
        # Skip rows with no volume
        return None

    # Is this a correction / adjustment row?
    is_correction = bool(
        raw.get("is_correction")
        or raw.get("correction")
        or "correction" in str(raw.get("comments", "")).lower()
        or "add" in str(raw.get("comments", "")).lower()
    )

    # Build row
    row = {
        "report_date": report_date,
        "commodity": commodity,
        "origin_code": origin_code,
        "origin_name": origin_name,
        "trans_mode": trans_code,
        "trans_mode_full": trans_full,
        "total_pounds": int(total_pounds),
        "is_correction": is_correction,
        "source_report": slug_info["code"],
        "slug_id": slug_info["slug_id"],
    }

    # row_hash for deduplication
    hash_str = "|".join([
        str(row["report_date"]),
        str(row["source_report"]),
        str(row["commodity"]),
        str(row["origin_code"] or ""),
        str(row["trans_mode"]),
    ])
    row["row_hash"] = hashlib.md5(hash_str.encode()).hexdigest()

    return row


def _extract_volume(raw: dict) -> float | None:
    """
    Extract volume in pounds from a MARS movement row.

    Resolved by pattern rather than exact key, because the movement reports
    spell these differently from the price reports and from each other.
    Order matters: most specific unit first, so a row carrying both a
    package count and a pound total is read as pounds.
    """
    # Direct pounds. The guards matter: "hundredweight" contains "weight"
    # and would otherwise be read as a raw pound figure, reporting 50 lbs
    # where USDA meant 5,000.
    k = _find_key(raw, "total_pounds", "pounds", "lbs", "weight")
    if k and not any(x in k.lower().replace(" ", "_")
                     for x in ("10000", "hundred", "cwt", "avg", "average", "per_")):
        val = _num(raw.get(k))
        if val is not None and val > 0:
            return val

    # 10,000 lb units (FV170 format)
    k = _find_key(raw, "total_10000_units", "units_10000", "10000", "ten_thousand")
    if k:
        val = _num(raw.get(k))
        if val is not None and val > 0:
            return val * 10000

    # Hundredweight
    k = _find_key(raw, "hundredweight", "cwt")
    if k:
        val = _num(raw.get(k))
        if val is not None and val > 0:
            return val * 100

    # Package or load counts. Approximate — 25 lbs per package is a rough
    # average across produce and should not be presented as a measured
    # weight.
    k = _find_key(raw, "package_count", "total_packages", "pkgs", "quantity", "loads", "count")
    if k:
        val = _num(raw.get(k))
        if val is not None and val > 0:
            return val * 25

    return None


def _num(v) -> float | None:
    """Parse a value to float, returning None if invalid."""
    if v is None or v == "":
        return None
    try:
        n = float(str(v).replace(",", "").strip())
        return n if n > 0 else None
    except (ValueError, TypeError):
        return None


def _normalize_date(date_str: str) -> str | None:
    """Convert USDA date formats to YYYY-MM-DD."""
    date_str = date_str.strip()
    # Already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return date_str
    # MM/DD/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", date_str)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    # DD MON YYYY or MON DD, YYYY
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d %b %Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            d = datetime.strptime(date_str[:20], fmt)
            return d.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ── Upsert ──────────────────────────────────────────────────────────────────
def upsert_movement_rows(rows: list[dict]) -> int:
    """Upsert rows into produce_movement using row_hash for dedup."""
    if not rows:
        return 0

    # Deduplicate within batch
    seen = {}
    for r in rows:
        h = r["row_hash"]
        if h in seen:
            # Merge: keep the one with higher volume
            if r["total_pounds"] > seen[h]["total_pounds"]:
                seen[h] = r
        else:
            seen[h] = r
    deduped = list(seen.values())
    if len(deduped) < len(rows):
        log.info("  Deduped %d → %d movement rows", len(rows), len(deduped))

    BATCH = 500
    total = 0
    for i in range(0, len(deduped), BATCH):
        chunk = deduped[i : i + BATCH]
        try:
            result = (
                supabase.table(MOVEMENT_TABLE)
                .upsert(chunk, on_conflict="row_hash", ignore_duplicates=False)
                .execute()
            )
            total += len(chunk)
            log.info("  Upserted batch of %d movement rows", len(chunk))
        except Exception as e:
            log.error("  Failed to upsert movement batch: %s", e)
            # Try one at a time to identify bad rows
            for row in chunk:
                try:
                    supabase.table(MOVEMENT_TABLE).upsert(
                        [row], on_conflict="row_hash", ignore_duplicates=False
                    ).execute()
                    total += 1
                except Exception as e2:
                    log.warning("  Skipped bad row (%s / %s): %s",
                              row.get("commodity"), row.get("report_date"), e2)
    return total


# ── Main ────────────────────────────────────────────────────────────────────
def run(target_date: str = None):
    """
    Ingest movement data from USDA MARS API.
    target_date format: "MM/DD/YYYY" (optional, defaults to today)
    """
    if not target_date:
        target_date = date.today().strftime("%m/%d/%Y")

    log.info("=== Movement ingestion starting for %s ===", target_date)
    grand_total = 0

    # Cleanup: delete movement rows older than 60 days
    cutoff = (date.today() - timedelta(days=60)).isoformat()
    try:
        result = supabase.table(MOVEMENT_TABLE).delete().lt("report_date", cutoff).execute()
        deleted = len(result.data) if result.data else 0
        if deleted:
            log.info("Cleanup: deleted %d movement rows older than %s", deleted, cutoff)
    except Exception as e:
        log.warning("Cleanup failed (table may not exist yet): %s", e)

    # Process each movement slug
    all_slugs = MOVEMENT_SLUGS + REGIONAL_MOVEMENT_SLUGS
    for slug in all_slugs:
        log.info("Fetching %s (slug %d) — %s", slug["code"], slug["slug_id"], slug["name"])

        # Try target date first, fall back to latest
        raw_rows = fetch_movement_report(slug["slug_id"], target_date)
        if not raw_rows:
            log.info("  No data for target date, trying latest published...")
            raw_rows = fetch_latest_movement(slug["slug_id"])

        if not raw_rows:
            log.info("  No data returned, skipping.")
            continue

        log.info("  Got %d raw rows from API", len(raw_rows))

        # Parse
        parsed = []
        skipped = 0
        for raw in raw_rows:
            row = parse_movement_row(raw, slug)
            if row:
                parsed.append(row)
            else:
                skipped += 1
        log.info("  Parsed %d rows, skipped %d (no commodity/volume)", len(parsed), skipped)

        if not parsed:
            # Everything was discarded. That is almost always a field-name
            # mismatch rather than an empty report, so print what USDA
            # actually sent — otherwise the next person is guessing at key
            # names the same way this parser originally did.
            if raw_rows:
                sample = raw_rows[0]
                log.warning("  ALL %d rows skipped for %s. Field names USDA returned:",
                            len(raw_rows), slug["code"])
                for k in sorted(sample.keys()):
                    v = sample.get(k)
                    v = (str(v)[:60] + "…") if v is not None and len(str(v)) > 60 else v
                    log.warning("      %-28s = %r", k, v)
            continue

        # Log a sample row for debugging
        sample = parsed[0]
        log.info("  Sample: %s | %s | %s | %d lbs | %s",
                 sample["commodity"], sample["origin_name"],
                 sample["trans_mode_full"], sample["total_pounds"],
                 sample["report_date"])

        # Upsert
        upserted = upsert_movement_rows(parsed)
        grand_total += upserted

    log.info("=== Movement ingestion complete. Total rows upserted: %d ===", grand_total)
    return grand_total


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else None
    run(target)
