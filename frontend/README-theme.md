# AgraX — frontend build

A static, framework-free implementation of AgraX, matched pixel-for-pixel to the approved design handoff (Desktop.html). No Tailwind, no shadcn, no framework opinions. Every visual value is locked in `styles/tokens.css` and every component reads from those tokens.

## Design system

**Color**: Dark header `#0F1B14`, blue accent `#1D4ED8`, amber Pro `#E0912F`, directional green/red `#0F7A3D`/`#C42B1B`.
**Typography**: Figtree (UI sans), Roboto Mono (all prices & data). Weights 400–800.
**Surfaces**: White cards, `#FAFBF8` subtle backgrounds, hairline `#DFE2DA` borders.

## The rule

**If you're about to hardcode a color, font size, spacing, or radius anywhere outside `tokens.css` — stop.** Either add a new token first, or use an existing one.

## Structure

```
index.html                  public landing / homepage
browse/index.html           public browse — sidebar + FOB→terminal price table
app/
  index.html                Pro morning brief (logged-in)
  commodity/index.html      commodity detail page
  markets/                  terminal market pages (legacy, needs redesign)
  shipping/                 shipping point page (legacy, needs redesign)
  watchlist/                watchlist (legacy, needs redesign)
  movement/                 movement placeholder
  alerts/                   alerts placeholder
styles/
  tokens.css                ⭐ DESIGN TOKENS — single source of truth
  components.css            ⭐ ALL COMPONENTS
js/
  config.js                 API base URL + Supabase + Stripe keys
  api.js                    API client (wraps backend/api.py)
  util.js                   Data helpers, formatters, localStorage
  shell.js                  Header renderer
  auth.js                   Supabase auth logic
  auth-ui.js                Auth modal UI
assets/
  agrax-logo-white.png      Logo (white, for dark surfaces)
  agrax-logo-black.png      Logo (black, for light surfaces)
  hero-field.png            Hero background image
```

## Running locally

```bash
# Backend
cd backend && pip install -r requirements.txt
export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
uvicorn api:app --reload --port 8000

# Frontend (any static server)
cd frontend && python -m http.server 3000
```

## Pages status

**Redesigned** (matches new design handoff):
- Homepage, Browse, Commodity Detail, Pro Morning Brief

**Legacy** (still old green theme, needs migration):
- Terminal Markets, Shipping Points, Watchlist, Movement, Alerts

**Pending backend**:
- `/history` — works but needs more data coverage
- `/movement/summary` — implemented but sparse
- Alerts CRUD — not yet built
