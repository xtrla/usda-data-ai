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

## Navigation cleanup
- Report library, homepage reports and footer reports open `/?view=reports`, with market/category filters inside the dashboard. Reports open inline and retain Print / Save PDF.
- General `/reports` bookmarks forward to the dashboard. Explicit dated archive links retain the existing exact-date viewer.
- Report emails opens the existing subscription dialog; token-bearing preference links remain unchanged. About and Privacy remain standalone information pages.

## Public-theme audit — October 17, 2026
- Root and Browse: current dashboard; report library remains in workspace.
- Dated email reports: shared black header, compact white report surface, skeleton loading, original report date preserved in category navigation and print view.
- Subscription confirmation and management: shared header/theme; private hash tokens and explicit confirmation/unsubscribe actions retained. No production subscription was altered during this audit.
- Welcome-email subscription anchor: compatibility handler opens current subscription dialog.
- Privacy and 404: utility theme. About: existing dashboard theme.
- Legacy app routes and commodity bookmarks: dashboard redirect preserving query/hash; commodity maps to c with market or search without market. Markets directory redirects to dashboard.
- Old concept, next and debug routes: hosting redirects to homepage; source retained for local reference.
- Account, subscription and analytics dialogs: compact theme styling; OAuth and recovery destinations reviewed in source, no real account flow submitted.
- Email frame: black header and neutral background. Existing sent emails cannot be restyled; their dated destinations are updated.
