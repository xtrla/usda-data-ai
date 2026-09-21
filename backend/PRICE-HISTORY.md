# Price history

Forward archive begins **2026-09-20**, using USDA report dates in the America/New_York reporting calendar. No older USDA fetch/backfill is part of this feature. Scheduled ingestion runs retain the existing morning/midday/afternoon workflow. Automatic seven-day backfill is disabled.

## Storage and identity

Apply `migrations/008_price_history.sql` before deploying the API/frontend. It is additive and repeatable, and does not move the cutoff on rerun. The `produce_prices` insert/update trigger archives each eligible row in the same transaction. Failure to capture rejects that source write. Current-table retention/deletion cannot remove the archive.

Each series uses source report, market/type/category, commodity, variety, origin, package, size, grade, organic, properties, appearance, quality, quality note, condition, qualifiers, notes and additional source dimensions. Comparisons are case-sensitive; no fuzzy matching. Qualified numerical price comments retain the qualifier in identity without treating the changing price itself as a new specification. Other descriptive changes conservatively form a different series.

All prices and the raw source record are retained. No currency/unit conversions, interpolation, or price averaging are written. Invalid/future dates, negative prices and reversed ranges are rejected. Terminal report dates must match the original source record. No quote is stamped with today's date merely because it was fetched today.

The append-only revision log retains corrections. The current read selects the latest revision per series/report date, never averages corrections. Identical retries do not duplicate revisions. An advisory transaction lock serializes competing writes. If an older source payload is ingested after a correction it becomes the latest observed revision: USDA does not provide an authoritative revision sequence here. Original observations remain auditable. Operationally, avoid overlapping/backdated reimports and verify corrections against the source.

## API/UI

`GET /history?quote_id=<row_hash>&days=30` resolves the full identity server-side. It returns `start_date`, `series_key`, `found`, and `observations`. Days must be 1–366. Unknown quotes return 404; archive/database failures return 503 without a misleading fallback to current prices.

The chart shows a **calculated low–high midpoint**, a low–high band, and reported mostly marks. The adjacent list shows original numerical ranges. Incomplete ranges have no midpoint; missing report dates are not manufactured. A single report date shows its value with a collecting-history explanation, not a trend. Sample preview is restricted to localhost and explicitly marked as synthetic.

## Validation

Python: `python -m unittest discover -s backend/tests -p 'test_*.py'` (Python 3.10+).

JS: `node --test backend/tests/test_quote_history.cjs`.

Database: `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node backend/tests/test_history_archive.mjs`.

Set `QUOTE_FIXTURE_PATH` to the JSON output of `build_row` for the committed `tests/fixtures/ny-vegetables-2026-09-17.json` fixture to also replay 379 captured records through the archive and run `test_quote_display.cjs`. No synthetic fixtures are written to production.

Verify capture with `pg_trigger` (`archive_price_write` on `produce_prices`), inspect `price_history_settings`, and compare eligible source rows to revisions after the next successful ingestion. Ingestion now exits with an error if a configured price report fails transformation or writing, so Actions does not silently show success for partial writes. Missing publisher reports and ingestion outages cannot create observations; guaranteed gap recovery/backfill is intentionally deferred.
