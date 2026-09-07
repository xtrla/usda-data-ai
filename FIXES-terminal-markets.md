# Fix: all 12 terminal markets now render

The data was reaching Supabase. It was being lost on the way out, in four
independent places that compounded into "only some markets show."

---

## 1. `frontend/js/mobile-app.js` — the actual cause of the reported symptom

`browse/index.html` loads *two* apps. Below 900px, `mobile-app.js` mounts and
takes over rendering.

The two fetched data completely differently:

- Desktop (`browse/index.html:513`) called `api.reportLatest('terminal')` —
  newest row per SKU per market across a 90-day window. Correct.
- Mobile (`mobile-app.js:load()`) called `API.dates()`, took the top 5 dates,
  and merged `API.reportTerminal(d)` for each.

USDA terminals don't all print on the same day, and ingest (see #4) kept only
one report date per slug. So a fixed 5-date window could only ever cover the
handful of markets whose reports happened to land inside it. Every other market
rendered "no data yet" while its last real price sat in the table.

The empty-market fix had been written and shipped on desktop only.

**Changed:** `load()` now calls `reportLatest('terminal')`, feature-detected,
with the date-merge kept as fallback. Same for shipping-point FOB rows.

Also removed the `reportShippingPoints(S.date)` refetch in `switchMarket()`.
It overwrote the full `/reports/latest` FOB set with a single day's rows,
reintroducing the bug the moment a user tapped a different city. Shipping-point
prices are origin-side and aren't scoped to a terminal market, so the refetch
was pointless as well as harmful.

## 2. `backend/api.py` — `/markets`, `/dates`, `/stats` were truncated

All three ran a bare `.execute()` (or a no-op `.limit(200000)`). Supabase
enforces `db-max-rows` server-side, so each read an arbitrary 1000-row slice.

The endpoint whose entire job is listing markets was the one endpoint that
couldn't see all of them. `/dates` reported whichever date landed in its slice
as "latest," which then fed the mobile date window in #1.

`fetch_all` already existed and documented this exact failure mode. These three
just never called it.

**Changed:** all three now use `fetch_all`.

## 3a. `backend/api.py` — `fetch_all` stopped after one page

Confirmed against the live DB: `/reports/terminal?date=2026-09-04` returned
999 rows; a direct PostgREST `count=exact` on the same filter returned
**6732**. Deterministic across repeated calls, so not a stability problem —
a hard stop.

This project's `db-max-rows` is **999**, not the 1000 the client assumed. The
old termination test was `len(batch) < page_size`, which is true on the very
first page when the server caps below the requested size. `fetch_all` returned
999 of 6732 rows and never requested page two.

**Changed:** the loop now advances the offset by the number of rows the server
actually returned and stops only on an empty batch, which is correct for any
server-side cap. Unit-tested across caps of 1/500/999/1000/5000 and row counts
of 0/1/998/999/1000/6732 — no loss, no duplicates.

## 3b. `backend/api.py` — `fetch_all` paged without an ORDER BY

Postgres gives no ordering guarantee across separate `LIMIT`/`OFFSET` queries.
Paging an unordered result lets the planner hand back the same row on two pages
and no page at all for another. Dropped rows cluster by physical page, so a
whole market could vanish from one request and return on the next — the
"worked yesterday, broken today" flavor of this bug.

**Changed:** `fetch_all` now sorts on `row_hash` (unique) before paging, with a
graceful fallback to unordered if the column isn't available.

Also paged `/story`'s national aggregation and `/wow`'s date + row fetches,
which genuinely exceed 1000 rows. The national story was being written from a
partial slice of the country.

## 4. `backend/ingest.py` — `purge_old_rows` kept one date per slug

It deleted every row for a slug that wasn't the current report date. The table
therefore held exactly one report date per slug, which meant:

- `/wow` and `/history` had no second date to diff against. Week-over-week was
  structurally impossible to compute, not merely broken.
- The frontend's date-merge fallback couldn't reach markets whose single
  retained date fell outside the window.

Prices are published as reported and never revised in place, so retaining
history costs storage and nothing else. Rows are keyed by `row_hash`, so
re-ingesting the same report stays idempotent.

**Changed:** purges by age instead — `RETAIN_DAYS = 400`.

---

## Still open — worth checking before you call this done

`ingest.py` marks the Columbia, Asheville, and Raleigh slug IDs as "estimated"
and "TBD." If those return 404 from USDA, those three markets are a genuine
backend gap that none of the above will fix.

`/reports/diagnose` is already built into `api.py` and needs no credentials.
Hit it after deploying and check the USDA-side row counts for those slugs. If
they're zero, look the real slug IDs up at
<https://mymarketnews.ams.usda.gov/public_data> and replace them in
`REPORT_SLUGS`.

## Verifying the fix

```
GET /markets            -> should list all 12, not a subset
GET /reports/coverage   -> latest_date + row count per market
GET /stats              -> markets: 12
```

Then load `/browse` in a window under 900px wide. The market strip should show
item counts for every city, with older report dates on the quiet ones rather
than "no data yet."

Note that #4 only takes effect for dates ingested *after* deploying. History
already purged is gone; week-over-week will start working once two report dates
have accumulated per slug.
