"""
AgraX — USDA vs database reconciliation.

Answers the question spot-checking can't: is EVERY commodity in EVERY market
faithful to what USDA published?

For each report slug it pulls the same USDA report ingest.py pulled, runs the
identical build_row() transform, and compares the result to what Supabase
actually holds. Anything that doesn't line up is printed with the market,
commodity and both values.

What it catches
---------------
  DROPPED   USDA published it, the database doesn't have it. Row lost to a
            hash collision, a failed batch, or an over-eager purge.
  EXTRA     Database has a row USDA didn't publish for that date. Usually a
            stale row a purge should have removed.
  PRICE     Same SKU, different price. A parser bug or a silent overwrite.
  SKIPPED   build_row() returned None, so the row was never ingested at all.
            Mostly rows with no price, which is legitimate, but a spike here
            means the parser is rejecting good data.

What it does NOT catch
----------------------
It reuses build_row(), so a bug INSIDE build_row that misreads USDA the same
way twice will agree with itself. The RAW SAMPLE section prints untransformed
USDA fields next to the stored values so that class of bug stays visible to a
human. Read a few of those against the published PDF now and then.

Run
---
    cd backend
    export MARS_API_KEY=...  SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...

    python reconcile.py                 # every terminal slug
    python reconcile.py --market Asheville
    python reconcile.py --all           # terminal + shipping point
    python reconcile.py --verbose       # list every discrepancy, not a sample
    python reconcile.py --raw 5         # show 5 raw USDA rows per slug

Exit code is 0 when clean, 1 when discrepancies were found, so CI can gate on
it. Read-only on both sides — it changes nothing.
"""

import argparse
import os
import sys
from collections import defaultdict

# ingest.py builds its Supabase client at import time, so importing it without
# credentials set raises before argparse ever runs. Import lazily inside main()
# instead, after the environment has been checked — --help must work anywhere.
TABLE = "produce_prices"
PRICE_FIELDS = ["price_low", "price_high", "price_mostly_low", "price_mostly_high"]

# Prices are numeric(8,2); compare at cent resolution so float noise and
# Decimal/str round-trips through PostgREST don't read as mismatches.
TOL = 0.005


def money(v):
    if v is None or v == "":
        return None
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def same_price(a, b):
    a, b = money(a), money(b)
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(a - b) < TOL


def fetch_db_rows(sb, slug_id, report_date):
    """Every stored row for one slug on one report date, paged.

    Paging matters here more than anywhere: this project's db-max-rows is
    999, so an unpaged read would silently compare a partial database
    against a complete USDA report and invent hundreds of DROPPED rows.
    """
    rows, start, page = [], 0, 1000
    while True:
        batch = (
            sb.table(TABLE)
            .select("*")
            .eq("slug_id", slug_id)
            .eq("report_date", report_date)
            .order("row_hash")
            .range(start, start + page - 1)
            .execute()
            .data
            or []
        )
        if not batch:
            return rows
        rows.extend(batch)
        start += len(batch)
        if len(rows) > 100_000:
            return rows


def describe(row):
    bits = [row.get("commodity") or "?"]
    for f in ("variety", "origin", "grade", "package", "size"):
        v = row.get(f)
        if v:
            bits.append(str(v))
    return " · ".join(bits)


def reconcile_slug(sb, meta, args, build_row, fetch_latest_report):
    code, slug_id = meta["code"], meta["slug_id"]
    result = {
        "code": code, "market": meta["market"], "slug_id": slug_id,
        "usda": 0, "built": 0, "skipped": 0, "db": 0,
        "dropped": [], "extra": [], "price": [], "date": None,
        "error": None, "raw_pairs": [],
    }

    try:
        raw_rows = fetch_latest_report(slug_id)
    except Exception as e:
        result["error"] = f"USDA fetch failed: {e}"
        return result

    if not raw_rows:
        result["error"] = "USDA returned nothing"
        return result

    result["usda"] = len(raw_rows)

    built, skipped_raw = [], []
    for raw in raw_rows:
        try:
            r = build_row(raw, meta)
        except Exception as e:
            result["error"] = f"build_row raised: {e}"
            return result
        if r:
            built.append((raw, r))
        else:
            skipped_raw.append(raw)

    result["built"] = len(built)
    result["skipped"] = len(skipped_raw)
    if not built:
        result["error"] = "every USDA row was skipped by build_row"
        return result

    report_date = built[0][1]["report_date"]
    result["date"] = report_date

    try:
        db_rows = fetch_db_rows(sb, slug_id, report_date)
    except Exception as e:
        result["error"] = f"database read failed: {e}"
        return result
    result["db"] = len(db_rows)

    db_by_hash = {r.get("row_hash"): r for r in db_rows}

    # USDA rows can legitimately collapse: two identical lines produce the
    # same row_hash and the upsert stores one. Compare on distinct hashes so
    # that isn't reported as loss.
    expected = {}
    for raw, r in built:
        expected.setdefault(r["row_hash"], (raw, r))

    for h, (raw, r) in expected.items():
        db = db_by_hash.get(h)
        if db is None:
            result["dropped"].append(r)
            continue
        for f in PRICE_FIELDS:
            if not same_price(r.get(f), db.get(f)):
                result["price"].append((r, f, r.get(f), db.get(f)))

    for h, db in db_by_hash.items():
        if h not in expected:
            result["extra"].append(db)

    if args.raw:
        for raw, r in built[: args.raw]:
            result["raw_pairs"].append((raw, db_by_hash.get(r["row_hash"]) or r))

    return result


def main():
    ap = argparse.ArgumentParser(description="Reconcile AgraX against USDA.")
    ap.add_argument("--market", help="only this market (e.g. Asheville)")
    ap.add_argument("--all", action="store_true", help="include shipping points")
    ap.add_argument("--verbose", action="store_true", help="list every discrepancy")
    ap.add_argument("--raw", type=int, default=0, metavar="N",
                    help="print N raw USDA rows per slug beside stored values")
    args = ap.parse_args()

    if not os.getenv("MARS_API_KEY"):
        sys.exit("MARS_API_KEY not set.")
    if not (os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_KEY")):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set.")

    # Reuse the real ingest transform. If these two ever diverge, the
    # reconciliation is meaningless.
    import ingest
    from ingest import REPORT_SLUGS, TRENDS_SLUG, build_row, fetch_latest_report

    sb = ingest.supabase
    globals()["TABLE"] = ingest.TABLE

    slugs = list(REPORT_SLUGS) + ([TRENDS_SLUG] if args.all else [])
    if not args.all:
        slugs = [s for s in slugs if s.get("market_type") == "terminal"]
    if args.market:
        want = args.market.strip().lower()
        slugs = [s for s in slugs if s["market"].strip().lower() == want]
    if not slugs:
        sys.exit("No slugs matched.")

    print("AgraX reconciliation — USDA vs database")
    print(f"{len(slugs)} report(s)\n")
    print(f"{'MARKET':<15}{'CODE':<12}{'DATE':<12}{'USDA':>6}{'BUILT':>7}{'DB':>7}"
          f"{'DROP':>6}{'EXTRA':>7}{'PRICE':>7}  STATUS")
    print("-" * 96)

    results = []
    for meta in sorted(slugs, key=lambda m: (m["market"], m["code"])):
        r = reconcile_slug(sb, meta, args, build_row, fetch_latest_report)
        results.append(r)
        if r["error"]:
            status = r["error"]
        elif r["dropped"] or r["extra"] or r["price"]:
            status = "MISMATCH"
        else:
            status = "ok"
        print(f"{r['market']:<15}{r['code']:<12}{str(r['date'] or '-'):<12}"
              f"{r['usda']:>6}{r['built']:>7}{r['db']:>7}"
              f"{len(r['dropped']):>6}{len(r['extra']):>7}{len(r['price']):>7}  {status}")

    bad = [r for r in results if r["dropped"] or r["extra"] or r["price"]]
    errors = [r for r in results if r["error"]]

    if bad:
        print("\n" + "=" * 96)
        print("DISCREPANCIES")
        print("=" * 96)
        for r in bad:
            print(f"\n{r['market']} — {r['code']} ({r['date']})")
            limit = None if args.verbose else 8

            if r["dropped"]:
                print(f"  DROPPED — published by USDA, missing from the database ({len(r['dropped'])}):")
                for x in r["dropped"][:limit]:
                    print(f"    - {describe(x)}")
                if limit and len(r["dropped"]) > limit:
                    print(f"    … {len(r['dropped']) - limit} more (--verbose)")

            if r["extra"]:
                print(f"  EXTRA — in the database, not in this USDA report ({len(r['extra'])}):")
                for x in r["extra"][:limit]:
                    print(f"    - {describe(x)}")
                if limit and len(r["extra"]) > limit:
                    print(f"    … {len(r['extra']) - limit} more (--verbose)")

            if r["price"]:
                print(f"  PRICE — same SKU, different value ({len(r['price'])}):")
                for x, f, usda_v, db_v in r["price"][:limit]:
                    print(f"    - {describe(x)}")
                    print(f"        {f}: USDA {usda_v}  |  database {db_v}")
                if limit and len(r["price"]) > limit:
                    print(f"    … {len(r['price']) - limit} more (--verbose)")

    skipped = [r for r in results if r["skipped"]]
    if skipped:
        print("\n" + "=" * 96)
        print("SKIPPED BY build_row (usually rows USDA published with no price)")
        print("=" * 96)
        for r in sorted(skipped, key=lambda x: -x["skipped"])[:15]:
            pct = r["skipped"] / r["usda"] * 100 if r["usda"] else 0
            flag = "   <-- high, check the parser" if pct > 25 else ""
            print(f"  {r['market']:<15}{r['code']:<12}{r['skipped']:>5} of {r['usda']:<5}({pct:.0f}%){flag}")

    if args.raw:
        print("\n" + "=" * 96)
        print("RAW SAMPLE — untransformed USDA fields beside what was stored")
        print("Read these against the published PDF to catch parser bugs that")
        print("reconciliation alone cannot see.")
        print("=" * 96)
        for r in results:
            if not r["raw_pairs"]:
                continue
            print(f"\n{r['market']} — {r['code']}")
            for raw, stored in r["raw_pairs"]:
                print(f"  USDA  commodity={raw.get('commodity')!r} variety={raw.get('variety')!r} "
                      f"origin={raw.get('origin')!r}")
                print(f"        package={raw.get('package')!r} item_size={raw.get('item_size')!r} "
                      f"grade={raw.get('grade')!r}")
                print(f"        low={raw.get('low_price')!r} high={raw.get('high_price')!r} "
                      f"mostly_low={raw.get('mostly_low_price')!r} mostly_high={raw.get('mostly_high_price')!r}")
                print(f"  STORED {describe(stored)}")
                print(f"        low={stored.get('price_low')!r} high={stored.get('price_high')!r} "
                      f"mostly_low={stored.get('price_mostly_low')!r} mostly_high={stored.get('price_mostly_high')!r}")
                print()

    print("\n" + "=" * 96)
    tot = lambda k: sum(len(r[k]) for r in results)
    print(f"{len(results)} reports · {sum(r['usda'] for r in results)} USDA rows · "
          f"{sum(r['db'] for r in results)} database rows")
    print(f"dropped {tot('dropped')} · extra {tot('extra')} · price mismatches {tot('price')} · "
          f"errors {len(errors)}")

    if errors:
        print("\nReports that could not be checked:")
        for r in errors:
            print(f"  {r['market']:<15}{r['code']:<12}{r['error']}")

    if not bad and not errors:
        print("\nClean. Every commodity in every report matches the database.")
        return 0

    print("\nNot clean. Fix the rows above, re-run ingest, then re-run this.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
