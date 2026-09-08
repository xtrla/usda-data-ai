"""
AgraX — find the real MARS slug IDs for a report code.

Several slug IDs in ingest.py and ingest_movement.py were estimated by hand
and return 404, which means those reports silently never load. Guessing
again is not a fix; the MARS API publishes a table of contents listing every
report with its true slug_id and slug_name, so this asks it directly.

Runs in GitHub Actions where MARS_API_KEY already exists as a secret, so
nobody has to handle the key locally.

Run
---
    python find_slugs.py                  # movement reports (the 404s)
    python find_slugs.py FV175            # anything matching FV175
    python find_slugs.py Nogales          # match on name instead of code
    python find_slugs.py --all            # dump the whole table of contents

Output is a ready-to-paste slug list. Verify a couple against the site
before pasting them in — a matching name is good evidence, not proof.
"""

import os
import re
import sys

import requests

MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2"
MARS_KEY = os.getenv("MARS_API_KEY")

# The codes currently 404ing, plus the one that works so the output shows a
# known-good line to sanity-check the rest against.
DEFAULT_PATTERNS = ["FV170", "FV171", "FV175", "movement", "shipment"]


def fetch_toc():
    """Every report MARS publishes: slug_id, slug_name, report title."""
    resp = requests.get(MARS_BASE + "/reports", auth=(MARS_KEY, ""), timeout=60)
    if resp.status_code != 200:
        sys.exit(f"MARS returned {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    # The endpoint has returned both a bare list and a wrapped object over
    # time; accept either rather than breaking on a shape change.
    if isinstance(data, dict):
        for key in ("results", "reports", "data"):
            if isinstance(data.get(key), list):
                return data[key]
        return []
    return data if isinstance(data, list) else []


def field(rec, *names):
    """Case-insensitive field lookup — MARS is inconsistent about casing."""
    lowered = {k.lower().replace(" ", "_"): k for k in rec.keys()}
    for n in names:
        k = lowered.get(n)
        if k:
            return rec.get(k)
    for n in names:
        for lk, k in lowered.items():
            if n in lk:
                return rec.get(k)
    return None


def main():
    if not MARS_KEY:
        sys.exit("MARS_API_KEY not set. Run this via the GitHub Actions workflow.")

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_all = "--all" in sys.argv
    patterns = args or DEFAULT_PATTERNS

    print("Fetching the MARS table of contents…")
    toc = fetch_toc()
    if not toc:
        sys.exit("MARS returned an empty table of contents.")
    print(f"{len(toc)} reports published.\n")

    if show_all:
        for rec in sorted(toc, key=lambda r: str(field(r, "slug_name", "name") or "")):
            print(f"{field(rec, 'slug_id', 'id'):>6}  {field(rec, 'slug_name', 'name')}")
        return 0

    print(f"{'SLUG_ID':>8}  {'SLUG_NAME':<16}  REPORT TITLE")
    print("-" * 96)

    seen, hits = set(), 0
    for pat in patterns:
        rx = re.compile(re.escape(pat), re.I)
        for rec in toc:
            slug_id = field(rec, "slug_id", "id")
            slug_name = str(field(rec, "slug_name", "name") or "")
            title = str(field(rec, "report_title", "title", "description") or "")
            if slug_id in seen:
                continue
            if rx.search(slug_name) or rx.search(title):
                seen.add(slug_id)
                hits += 1
                print(f"{slug_id:>8}  {slug_name:<16}  {title[:66]}")

    if not hits:
        print("Nothing matched. Try a broader pattern, or --all to see everything.")
        return 1

    print("\n" + "=" * 96)
    print("Paste the matching entries into MOVEMENT_SLUGS / REGIONAL_MOVEMENT_SLUGS")
    print("in backend/ingest_movement.py, replacing the estimated IDs.")
    print("Cross-check a name or two before trusting the whole list.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
