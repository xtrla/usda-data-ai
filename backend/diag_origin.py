#!/usr/bin/env python3
"""
agraX — MARS API origin diagnostic.

Run:  MARS_API_KEY=xxx python diag_origin.py

Fetches the latest New York Fruit terminal report (slug 2314, NX_FV010)
and reports:

1. Every field name MARS returns
2. Which fields have any non-null data
3. Origin-related fields specifically and their sample values
4. Row-by-row: raw origin from MARS vs what our current ingest.py mapping picks
5. If origins cascade (blank rows immediately after non-blank in same commodity),
   flags them as forward-fill candidates.

No writes, no side effects — just prints.
"""

import os, sys, json, requests
from collections import Counter, defaultdict

MARS_KEY = os.getenv("MARS_API_KEY") or ""
if not MARS_KEY:
    print("ERROR: set MARS_API_KEY env var first.")
    print("  Windows: $env:MARS_API_KEY='your-key'")
    print("  Bash:    export MARS_API_KEY=your-key")
    sys.exit(1)

MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"
SLUG_ID = 2314   # NX_FV010 = New York Fruit terminal
REPORT_NAME = "NY Fruit terminal (NX_FV010)"

print(f"\n{'='*70}\nagraX MARS diagnostic — {REPORT_NAME}\n{'='*70}\n")

# ── FETCH ────────────────────────────────────────────────────────────────
url = f"{MARS_BASE}/reports/{SLUG_ID}/report details"
params = {"lastReports": 1}
print(f"Fetching {url} …")
r = requests.get(url, params=params, auth=(MARS_KEY, ""), timeout=30)
r.raise_for_status()
data = r.json()
rows = data if isinstance(data, list) else data.get("results", [])
print(f"Got {len(rows)} rows.\n")

if not rows:
    print("No rows returned. Try a different slug or check API key.")
    sys.exit(0)

# ── 1. FIELD INVENTORY ───────────────────────────────────────────────────
print("─── 1. All field names present in this report ──────────────────────")
all_fields = set()
for row in rows:
    all_fields.update(row.keys())
for f in sorted(all_fields):
    non_null = sum(1 for r in rows if r.get(f) not in (None, "", "N/A"))
    pct = non_null * 100 // len(rows)
    marker = "✓" if pct >= 80 else "◐" if pct >= 20 else "✗"
    print(f"  {marker} {f:35s} {non_null:4d}/{len(rows)} rows ({pct}%)")

# ── 2. ORIGIN-RELATED FIELDS ─────────────────────────────────────────────
print("\n─── 2. Fields that look origin-related ─────────────────────────────")
origin_candidates = [
    f for f in all_fields
    if any(w in f.lower() for w in ("origin", "district", "region", "state", "country", "reporting"))
]
for f in origin_candidates:
    values = Counter(str(r.get(f) or "").strip() for r in rows if r.get(f))
    print(f"\n  Field: {f!r}")
    print(f"  Non-null: {sum(values.values())}/{len(rows)}")
    if values:
        print(f"  Sample values (top 8):")
        for v, count in values.most_common(8):
            print(f"    {count:4d}×  {v!r}")

# ── 3. WHAT OUR CURRENT INGEST WOULD PICK ────────────────────────────────
print("\n─── 3. Current ingest.py mapping simulation ────────────────────────")
print("Formula: district or origin or reporting_city\n")
would_pick = Counter()
for row in rows:
    picked = row.get("district") or row.get("origin") or row.get("reporting_city") or ""
    would_pick[str(picked).strip()] += 1
print("What our ingest would store as origin:")
for v, count in would_pick.most_common(10):
    label = v if v else "(empty)"
    print(f"  {count:4d}×  {label!r}")

# ── 4. CASCADE / FORWARD-FILL CANDIDATES ─────────────────────────────────
print("\n─── 4. Origin cascade analysis (forward-fill candidates) ───────────")
by_commodity = defaultdict(list)
for row in rows:
    by_commodity[row.get("commodity", "?")].append(row)

cascade_candidates = 0
for commodity, com_rows in by_commodity.items():
    last_origin = None
    for i, row in enumerate(com_rows):
        # Check every plausible field
        raw_origin = (
            (row.get("origin") or "").strip()
            or (row.get("district") or "").strip()
            or (row.get("origin_district") or "").strip()
        )
        if raw_origin:
            last_origin = raw_origin
        elif last_origin:
            cascade_candidates += 1
print(f"Rows with empty origin but a prior row in same commodity had one: {cascade_candidates}")
print("These are recoverable via forward-fill within a commodity block.")

# ── 5. SAMPLE 3 ROWS RAW ─────────────────────────────────────────────────
print("\n─── 5. First 3 raw rows (full JSON, for reference) ─────────────────")
for i, row in enumerate(rows[:3]):
    print(f"\n[row {i}] commodity={row.get('commodity')!r}")
    print(json.dumps(row, indent=2, default=str)[:1200])
    if len(json.dumps(row, default=str)) > 1200:
        print("  … (truncated)")

print(f"\n{'='*70}\nDone. Send this output back and we'll know exactly what to fix.\n")
