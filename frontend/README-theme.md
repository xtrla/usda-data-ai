# agraX — frontend build

A static, framework-free implementation of the agraX app, built to match the approved mockups **exactly**. No Tailwind, no shadcn, no framework opinions to drift away from. Every visual value is locked in `public/styles/tokens.css` and every component reads from those tokens.

## The rule

**If you're about to hardcode a color, font size, spacing, or radius anywhere outside `tokens.css` — stop.** Either add a new token to `tokens.css` first, or use an existing one. This is the only way to prevent aesthetic drift.

## Structure

```
public/
  index.html                 landing entry (links to /app)
  styles/
    tokens.css               ⭐ SINGLE SOURCE OF TRUTH — all colors/type/spacing/shadows/gradients
    components.css           ⭐ ALL COMPONENTS — cards, sidebar, tables, chips, buttons, alerts, etc.
  js/
    api.js                   API client — one method per FastAPI endpoint in backend/api.py
    util.js                  data-shape helpers, watchlist localStorage, formatters
    shell.js                 shared shell renderer (sidebar, mobile top bar, bottom tabs)
  app/
    index.html               dashboard
    markets/index.html       terminal markets (commodity-first split view)
    shipping/index.html      shipping points (FOB)
    watchlist/index.html     watchlist
    movement/index.html      placeholder — backend endpoint pending
    alerts/index.html        placeholder — backend endpoint pending
vercel.json                  routing config
```

## Running locally

You need the backend running for data. From the existing repo root:

```bash
# Terminal 1 — backend
cd backend
pip install -r requirements.txt
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
uvicorn api:app --reload --port 8000

# Terminal 2 — frontend (any static server works)
cd public
python -m http.server 3000
# open http://localhost:3000/
```

The frontend defaults to `http://localhost:8000` for the API. Override with:
```js
localStorage.setItem('agrax_api_base', 'https://your-api.railway.app')
```
or set `window.AGRAX_API_BASE` before `api.js` loads.

## Deploying to Vercel

Point Vercel at this project. The included `vercel.json` sets `outputDirectory: "public"` and configures the `/app/*` rewrites. Set an environment variable or edit the frontend to point at your live API URL.

## What's wired vs. what's pending

Wired to real data (via existing `backend/api.py`):
- **Dashboard** — verdict, mood gauge, KPIs, watchlist, best-buy, alerts (all derived from `/reports/terminal` + `/dates`)
- **Terminal markets** — commodity-first split view, cross-market table, category filter, search (uses `/reports/terminal`)
- **Shipping points** — FOB split view (uses `/reports/shipping-points`)
- **Watchlist** — stored in `localStorage`, joined with today's data

Placeholder pages (backend endpoints don't exist yet):
- **Movement** — needs `/movement/summary/{date}` (migration already in `migration_movement.sql`)
- **Alerts** — needs `/alerts` CRUD endpoints + Supabase table
- **Commodity detail** — needs `/history/{commodity}` for the 90-day chart

## Design token discipline

Every value in the mockups is captured as a variable in `tokens.css`. Rules:

1. **Colors**: use `var(--pop)` / `var(--pop-*)`, `var(--ink)`, `var(--sub)`, `var(--muted)`. Never `#15A24A` inline.
2. **Fonts**: `var(--font-body)` (Inter) for UI, `var(--font-mono)` (JetBrains Mono) for every number.
3. **Radii**: `var(--r-card)`, `var(--r-btn)`, `var(--r-pill)`. Never hardcoded.
4. **Shadows**: only the pre-defined `--shadow-*` set. No black `box-shadow` values.
5. **Gradients**: the `--grad-*` set covers every gradient in the mockups. Add new ones to tokens.css if needed.

If Claude (or a designer) is about to add a "just a slight tweak" of any of these — add it as a proper token first.

## Component naming

BEM-ish, no framework classes:
- `.card`, `.card--mint`, `.card--dark` — surfaces
- `.side`, `.side__item`, `.side__item.is-active` — sidebar
- `.mtop`, `.mtabs` — mobile chrome
- `.clist`, `.cl-item` — commodity list
- `.cmp`, `.cmp__head`, `.cmp__summary` — cross-market panel
- `.chip`, `.chip.is-active` — pills
- `.btn`, `.btn--dark`, `.btn--ghost`, `.btn--tiny` — buttons
- `.alert--pos`, `.alert--neg` — alert notification pills
- `.chg-up`, `.chg-down`, `.chg-flat` — table delta cells

## Backend changes needed to complete

Add these to `backend/api.py` (all straightforward Supabase queries against the existing `produce_prices` and `movement_data` tables):

```python
@app.get("/history/{commodity}")
def get_history(commodity: str, market: str = None, days: int = 90):
    # Return time series for the commodity detail page.

@app.get("/movement/summary/{date}")
def get_movement_summary(date: str):
    # Return {total_lbs, by_mode, by_origin, top_commodities} for movement page.

@app.get("/alerts")           # user's alert rules
@app.post("/alerts")          # create rule
@app.delete("/alerts/{id}")   # delete rule
    # Requires a new `alerts` table in Supabase, keyed by user_id.
```

Once those exist, the placeholder pages will drop in seamlessly.
