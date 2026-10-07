# Production dashboard

The root homepage and /browse use this dashboard. /next remains the separately labeled design prototype.

## Data
- current.json is a dated public report snapshot, fetched from AgraX's production /reports/current endpoint separately for each terminal market. It contains 7,517 quotes and four real archived histories captured on October 7, 2026.
- The snapshot supplies first paint; the browser refreshes individual markets using a 7-day window, with a 30-day fallback for empty results. Two requests run concurrently. Successful results are reused locally for five minutes. Failed refreshes keep dated data visible and show an update-unavailable notice.
- The snapshot is not regenerated automatically. Runtime refreshes provide subsequent reports; the snapshot remains a dated fallback until the next release. Never describe the snapshot as live data.
- Latest publication is resolved independently per market/source/category. Every quote preserves its actual date, package, size, grade, qualifier, notes, and mostly range.
- History uses the archive endpoint and exact specifications. Comparisons additionally require the same report date. No synthetic prices, shifts, history, or pins are shipped in this production dashboard.
- Account watchlists use the existing account client/UI. Recently viewed items stay on the device. Account routes, report-library pages, subscriptions, consent-based analytics and privacy pages are retained.

## Validation
Run the repository Node runtime against backend/tests_dashboard.cjs. Browser checks cover desktop and mobile search, market selection, real quote selection, archive chart, matching comparison, report-category table, PDF print control, account dialog, pagination and existing /browse links. Authentication and actual watchlist writes were not exercised with a customer's account.
