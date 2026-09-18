# AgraX navigation audit — September 18, 2026

## Scope

Inspected live Home, Browse, About, Watchlist and all nine legacy `/app` routes present in the frontend. Compared destinations and controls against source. Changes below are local only; production has not been deployed. `/concept` is excluded because the live design is the chosen launch design.

## Repaired locally

- Homepage city links now include the selected market. All twelve destinations were browser-tested against their terminal heading: New York, Los Angeles, Chicago, Philadelphia, Miami, Boston, Atlanta, Baltimore, Detroit, Columbia, Asheville and Raleigh.
- All six popular commodity links preserve a search query. Bell peppers searches the report vocabulary using `bell`.
- All four category links apply the appropriate USDA category filter.
- Homepage Search submits the entered text; Enter supports suggestions and a general-search fallback. Both home search inputs now bind suggestions.
- Browse defaults to New York when no valid market is specified, rather than alphabetical Asheville.
- Browse Home is an actual link.
- Understand the source opens About.
- Browse updates its URL with market, commodity, search, category, origin, price-source filters and older-print selection. Reload and copied URLs retain these selections. Sort, page number and expanded rows are not serialized.
- Choosing a global search suggestion clears conflicting table filters before opening its commodity.

## Remaining launch issues

| Area | Finding | Evidence / next step |
|---|---|---|
| Watchlist | About's live `/watchlist` link returns 404. | Browser-confirmed. Local Vercel configuration rewrites it to Browse, which still is not a watchlist. Implement the feature or remove its invitation before launch. |
| Main navigation | Movers, Watchlist, Reports and Sign in appear interactive but have no handlers on Home/Browse. | Rendered DOM and templates. Connect real destinations or remove unavailable actions. |
| Reports | Today's reports chips show codes but do not open full reports. | Browse template has no href/click handler for report chips. Connect verified source documents. |
| Newsletter | Sign me up has no subscription action. | Homepage explicitly labels this a disconnected signup preview. Requires a subscription integration. |
| About | Contact us, Advertise and live Subscribe lack working actions; search is not connected. Privacy/Terms have no document links. | Live DOM and local static page. Local About differs from live: it has an unbound Sign in anchor instead of Subscribe. |
| Commodity actions | Watch, Set alert, Watch this price, Export and Get a rate are decorative controls. | Browse template has no handlers for these actions. |
| Price details | Cross-terminal rows reference `m.onSelect`, but the supplied data has no such callback. Earlier prints and the extra movement control also lack actions. | Controller/data/template inspection. Requires specific navigation or disclosure behavior. |
| Shipping coverage | Explore price details opens terminal Browse rather than a dedicated shipping-point page. | Current intended destination needs resolving; legacy shipping route also redirects to Browse. |
| Legacy routes | `/app`, `/app/shipping`, `/app/movement`, `/app/markets`, `/app/markets/compare`, `/app/markets/city`, `/app/watchlist`, `/app/alerts` converge on Browse. | Browser visits and redirect files. Specialized route names do not deliver specialized features. |
| Legacy commodity | `/app/commodity` without parameters displays No commodity specified; its Subscribe link goes to Browse. | Browser and template inspection. Not a working subscription entry point. |

## Validation

- JavaScript syntax checks passed for both changed controllers.
- Browser tests passed for all 12 city destinations, six popular commodities and four categories; all tested filters returned results.
- Search button with `tomatoes` returned four matching commodity groups.
- Changing New York to Chicago retained the category and survived reload.
- Desktop and mobile city/category destination lists are identical. No separate mobile viewport interaction test was available in this browser session.
- Static internal asset/link target check for Home, Browse, About and legacy commodity found no missing local targets except the separately tracked Watchlist route.
- No browser console errors were observed in the final commodity/category test pass.

This is a navigation audit, not certification of accounts, payments, subscription delivery or data accuracy. Unimplemented controls remain visible and are not considered repaired.
