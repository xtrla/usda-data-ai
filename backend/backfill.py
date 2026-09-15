"""
AgraX — backfill a range of report dates.

ingest.py pulls one report date per run, so a gap in the table stays a gap.
This walks a date range and runs the same ingest for each day, which is how
you recover history after an outage — or after the old purge_old_rows deleted
everything but the newest date per slug.

Weekends and federal holidays are skipped: USDA Market News publishes terminal
and shipping point reports on business days only, so requesting a Saturday
just burns API calls to be told there is nothing.

Nothing here is a different code path from the daily run. It calls ingest.run()
with each date, so a backfilled row is byte-identical to one ingested live —
same parser, same row_hash, same upsert. Re-running a date already present is
therefore harmless: the upsert matches on row_hash and updates in place.

Run
---
    python backfill.py 2026-09-04 2026-09-14     # inclusive range
    python backfill.py 2026-09-04                # from that date to today
    python backfill.py --days 14                 # last 14 days
    python backfill.py 2026-09-04 --include-weekends

Expect roughly 45 USDA calls per date, so a two-week backfill is ~600 calls
and takes a few minutes. There is a pause between dates to stay well inside
the MARS rate limit.
"""

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta

import ingest

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agrax.backfill")

# Federal holidays when Market News does not publish. Extend as needed —
# a missed holiday only costs one wasted pass, not bad data.
HOLIDAYS_2026 = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12",
    "2026-11-11", "2026-11-26", "2026-12-25",
}


def parse_day(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        sys.exit(f"Bad date {s!r}. Use YYYY-MM-DD.")


def business_days(start: date, end: date, include_weekends: bool):
    d = start
    while d <= end:
        iso = d.isoformat()
        if include_weekends or (d.weekday() < 5 and iso not in HOLIDAYS_2026):
            yield d
        d += timedelta(days=1)


def main():
    ap = argparse.ArgumentParser(description="Backfill USDA report dates.")
    ap.add_argument("start", nargs="?", help="first date, YYYY-MM-DD")
    ap.add_argument("end", nargs="?", help="last date, YYYY-MM-DD (default: today)")
    ap.add_argument("--days", type=int, help="backfill the last N days instead")
    ap.add_argument("--include-weekends", action="store_true",
                    help="also try Saturdays, Sundays and holidays")
    ap.add_argument("--pause", type=float, default=2.0,
                    help="seconds between dates (default 2)")
    args = ap.parse_args()

    today = date.today()
    if args.days:
        start, end = today - timedelta(days=args.days), today
    elif args.start:
        start = parse_day(args.start)
        end = parse_day(args.end) if args.end else today
    else:
        sys.exit("Give a start date or --days. See --help.")

    if start > end:
        sys.exit("Start date is after end date.")

    days = list(business_days(start, end, args.include_weekends))
    if not days:
        sys.exit("No publishing days in that range.")

    log.info("=" * 70)
    log.info("Backfilling %s to %s", start.isoformat(), end.isoformat())
    log.info("%d publishing day(s); weekends and holidays %s",
             len(days), "included" if args.include_weekends else "skipped")
    log.info("=" * 70)

    results, total = [], 0
    for i, d in enumerate(days, 1):
        iso = d.isoformat()
        log.info("")
        log.info("--- [%d/%d] %s (%s) ---", i, len(days), iso, d.strftime("%A"))
        try:
            n = ingest.run(iso) or 0
            total += n
            results.append((iso, n, None))
        except Exception as e:
            log.error("  Failed on %s: %s", iso, e)
            results.append((iso, 0, str(e)))

        if i < len(days):
            time.sleep(args.pause)

    log.info("")
    log.info("=" * 70)
    log.info("BACKFILL SUMMARY")
    log.info("=" * 70)
    log.info("%-14s %10s  %s", "DATE", "ROWS", "STATUS")
    for iso, n, err in results:
        if err:
            status = "FAILED: " + err[:50]
        elif n == 0:
            # Not an error. USDA sometimes publishes nothing for a date, and
            # a day that legitimately has no report should look different from
            # one that broke.
            status = "no rows returned"
        else:
            status = "ok"
        log.info("%-14s %10s  %s", iso, f"{n:,}", status)

    ok = sum(1 for _, n, e in results if n and not e)
    log.info("")
    log.info("%d of %d dates loaded, %s rows upserted in total",
             ok, len(results), f"{total:,}")

    if ok == 0:
        log.error("Nothing loaded. Check MARS_API_KEY and the slug IDs.")
        return 1

    log.info("")
    log.info("Week-over-week and price history need two dates per line, so "
             "those fill in as soon as a second date lands for each.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
