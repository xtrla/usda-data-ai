"""
AgraX — pipeline diagnostic.

Answers one question: for each of the 12 terminal markets, where does the
data stop? USDA, ingestion, or the database?

Run:
    cd backend
    export MARS_API_KEY=...  SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python diagnose.py

Checks nothing and changes nothing — read-only on both sides.
"""

import os
import sys
from collections import defaultdict
from datetime import date, datetime

import requests

MARS_KEY = os.getenv("MARS_API_KEY")
MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

def load_slugs():
    """Pull REPORT_SLUGS out of ingest.py without importing it.

    Importing the module would require supabase, stripe and a live config
    just to read a list of constants — and this script has to run even
    when the environment is half set up.
    """
    import ast as _ast
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ingest.py")).read()
    tree = _ast.parse(src)
    wanted = [
        n for n in tree.body
        if (isinstance(n, _ast.FunctionDef) and n.name == "_slug")
        or (isinstance(n, _ast.Assign)
            and any(getattr(t, "id", "") in ("REPORT_SLUGS", "MAX_FALLBACK_DAYS")
                    for t in n.targets))
    ]
    ns = {}
    exec(compile(_ast.Module(body=wanted, type_ignores=[]), "<slugs>", "exec"), ns)
    return ns.get("REPORT_SLUGS", [])


REPORT_SLUGS = load_slugs()
if not REPORT_SLUGS:
    sys.exit("Could not read REPORT_SLUGS from ingest.py")


def check_usda():
    """Ask USDA directly what each slug returns."""
    print("\n" + "=" * 78)
    print("1. USDA MARS API — what does each report slug actually return?")
    print("=" * 78)
    if not MARS_KEY:
        print("  MARS_API_KEY not set; skipping.")
        return {}

    results = {}
    terminal = [s for s in REPORT_SLUGS if s.get("market_type") == "terminal"]
    print(f"{'MARKET':<15}{'CODE':<12}{'SLUG':<7}{'HTTP':<7}{'ROWS':<7}REPORT DATE")
    print("-" * 78)

    for meta in sorted(terminal, key=lambda m: (m["market"], m["code"])):
        url = f"{MARS_BASE}/reports/{meta['slug_id']}/report details"
        try:
            r = requests.get(url, params={"lastReports": 1},
                             auth=(MARS_KEY, ""), timeout=30)
            status = r.status_code
            rows = []
            if status == 200:
                data = r.json()
                rows = data if isinstance(data, list) else data.get("results", [])
            rd = ""
            if rows:
                rd = rows[0].get("report_date") or rows[0].get("report_begin_date") or ""
            flag = "" if rows else "   <-- NOTHING"
            print(f"{meta['market']:<15}{meta['code']:<12}{meta['slug_id']:<7}"
                  f"{status:<7}{len(rows):<7}{rd}{flag}")
            results[(meta["market"], meta["code"])] = {
                "status": status, "rows": len(rows), "report_date": rd
            }
        except Exception as e:
            print(f"{meta['market']:<15}{meta['code']:<12}{meta['slug_id']:<7}"
                  f"{'ERR':<7}{'-':<7}{e}")
            results[(meta["market"], meta["code"])] = {"status": "ERR", "rows": 0}
    return results


def check_db():
    """Ask the database what it holds per market."""
    print("\n" + "=" * 78)
    print("2. SUPABASE — rows per terminal market, and how fresh")
    print("=" * 78)
    if not (SUPABASE_URL and SUPABASE_KEY):
        print("  SUPABASE_URL / SUPABASE_SERVICE_KEY not set; skipping.")
        return

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Page explicitly: Supabase caps responses at db-max-rows (1000 default)
    # no matter what .limit() says, which is itself a failure mode worth
    # proving here rather than assuming.
    rows, page, size = [], 0, 1000
    while True:
        batch = (sb.table("produce_prices")
                 .select("market,report_date,commodity")
                 .eq("market_type", "terminal")
                 .range(page * size, page * size + size - 1)
                 .execute().data or [])
        rows.extend(batch)
        if len(batch) < size:
            break
        page += 1
        if page > 300:
            break

    print(f"  Paged {page + 1} request(s), {len(rows)} total terminal rows.")
    if page == 0 and len(rows) == 1000:
        print("  WARNING: exactly 1000 rows in one page — the cap is likely biting.")

    agg = defaultdict(lambda: {"rows": 0, "latest": "", "commodities": set()})
    for r in rows:
        m = r.get("market")
        if not m:
            continue
        a = agg[m]
        a["rows"] += 1
        a["commodities"].add(r.get("commodity"))
        d = str(r.get("report_date") or "")
        if d > a["latest"]:
            a["latest"] = d

    print()
    print(f"{'MARKET':<16}{'ROWS':<8}{'COMMODITIES':<14}{'LATEST':<13}AGE")
    print("-" * 78)
    for m in sorted(agg):
        a = agg[m]
        age = ""
        try:
            age_days = (date.today() - datetime.fromisoformat(a["latest"]).date()).days
            age = f"{age_days}d ago"
            if age_days > 14:
                age += "   <-- STALE"
        except Exception:
            pass
        print(f"{m:<16}{a['rows']:<8}{len(a['commodities']):<14}{a['latest']:<13}{age}")

    expected = {
        "Los Angeles", "Atlanta", "Chicago", "Detroit", "Miami", "New York",
        "Boston", "Philadelphia", "Baltimore", "Columbia", "Asheville", "Raleigh",
    }
    missing = expected - set(agg)
    if missing:
        print(f"\n  MISSING ENTIRELY FROM DB: {', '.join(sorted(missing))}")
    extra = set(agg) - expected
    if extra:
        print(f"  Markets in DB under an unexpected name: {', '.join(sorted(extra))}")
        print("  (The frontend matches on exact market name — a mismatch here "
              "renders as an empty market.)")


def verdict(usda):
    print("\n" + "=" * 78)
    print("3. WHERE IS IT BREAKING?")
    print("=" * 78)
    if not usda:
        print("  Run with MARS_API_KEY set for a full verdict.")
        return
    dead = [f"{m} ({c})" for (m, c), v in usda.items() if not v.get("rows")]
    if dead:
        print("  These slugs return nothing from USDA — wrong slug_id, or that")
        print("  report genuinely isn't published:")
        for d in sorted(dead):
            print(f"    - {d}")
        print("\n  Look the correct slug up at:")
        print("    https://mymarketnews.ams.usda.gov/public_data")
        print("  then fix the slug_id in REPORT_SLUGS in ingest.py.")
    else:
        print("  Every slug returns data from USDA. If a market is still empty")
        print("  in the app, the break is in ingestion or delivery, not source:")
        print("    - check the 'Run price ingestion' step in the Actions log")
        print("      for 'returned 404' / 'too stale' / 'No data available'")
        print("    - confirm the DB table above shows rows for that market")


if __name__ == "__main__":
    print("AgraX pipeline diagnostic")
    print(f"Run at {datetime.now().isoformat(timespec='seconds')}")
    u = check_usda()
    check_db()
    verdict(u)
