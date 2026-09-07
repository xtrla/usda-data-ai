#!/usr/bin/env python3
"""
AgraX — verify_slugs.py

Hits USDA MARS once per configured slug ID and prints, for each one:
  ✓ live — how many rows the latest published report has
  ✗ dead — HTTP status + response snippet so you can fix or replace the ID

Run:
    cd backend
    export MARS_API_KEY=...
    python verify_slugs.py

Read-only, hits USDA only, does not touch Supabase.
"""

import os
import sys
import ast
import requests

MARS_KEY = os.getenv("MARS_API_KEY")
MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"

if not MARS_KEY:
    sys.exit("MARS_API_KEY not set. Export it and re-run.")


def load_slugs():
    """Pull REPORT_SLUGS out of ingest.py without importing (avoids DB deps)."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ingest.py")).read()
    tree = ast.parse(src)
    wanted = [
        n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name == "_slug")
        or (isinstance(n, ast.Assign)
            and any(getattr(t, "id", "") == "REPORT_SLUGS" for t in n.targets))
    ]
    ns = {}
    exec(compile(ast.Module(body=wanted, type_ignores=[]), "<slugs>", "exec"), ns)
    return ns.get("REPORT_SLUGS", [])


slugs = load_slugs()
terminals = [s for s in slugs if s["market_type"] == "terminal"]

print(f"\nChecking {len(terminals)} terminal slugs against USDA MARS...\n")
print(f"{'Market':<16} {'Code':<10} {'Slug':<7} {'Status':<10} {'Rows':<6} Notes")
print("-" * 78)

by_market = {}
for slug in terminals:
    url = f"{MARS_BASE}/reports/{slug['slug_id']}/report details"
    try:
        resp = requests.get(url, params={"lastReports": 1}, auth=(MARS_KEY, ""), timeout=20)
        status = resp.status_code
        rows = 0
        note = ""
        if status == 200:
            data = resp.json()
            payload = data if isinstance(data, list) else data.get("results", [])
            rows = len(payload)
            if rows == 0:
                note = "empty response"
        elif status == 404:
            note = "slug not found — retired or renumbered"
        elif status == 401:
            note = "MARS_API_KEY rejected"
        else:
            note = f"HTTP {status}"

        marker = "✓" if (status == 200 and rows > 0) else "✗"
        print(f"{slug['market']:<16} {slug['code']:<10} {slug['slug_id']:<7} {marker} {status:<7} {rows:<6} {note}")
        by_market.setdefault(slug["market"], []).append(rows > 0)
    except Exception as e:
        print(f"{slug['market']:<16} {slug['code']:<10} {slug['slug_id']:<7} ✗ ERR    -      {e}")
        by_market.setdefault(slug["market"], []).append(False)

print("\n" + "=" * 78)
print("Per-market summary (any live slug = market at least partially working):")
print("=" * 78)
for market in sorted(by_market):
    live = sum(by_market[market])
    total = len(by_market[market])
    status = "OK" if live == total else ("PARTIAL" if live > 0 else "DEAD")
    print(f"  {status:<8} {market:<20} {live}/{total} slugs returning data")

print()
