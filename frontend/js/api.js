/* ================================================================
   agraX — API CLIENT
   Wraps every endpoint from backend/api.py. No invented endpoints.
   Config: set window.AGRAX_API_BASE before including this script,
   or override via localStorage.setItem('agrax_api_base', '...')
   ================================================================ */

const API_BASE = (() => {
  const fromLS = typeof localStorage !== 'undefined' && localStorage.getItem('agrax_api_base');
  if (fromLS) return fromLS.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.AGRAX_API_BASE) return window.AGRAX_API_BASE.replace(/\/$/, '');
  return 'http://localhost:8000';
})();

async function _fetch(path, { signal } = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

const api = {
  base: API_BASE,

  // GET / — health
  health: () => _fetch('/'),

  // GET /dates → [{date, count}]
  dates: () => _fetch('/dates'),

  // GET /commodities/by-date/{date} → raw produce_prices rows
  commoditiesByDate: (date) => _fetch(`/commodities/by-date/${encodeURIComponent(date)}`),

  // GET /search?q=&limit=
  search: (q, limit = 100) =>
    _fetch(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // GET /markets → [{market, type, count}]
  markets: () => _fetch('/markets'),

  // GET /reports/terminal?date=
  reportTerminal: (date) =>
    _fetch(`/reports/terminal${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // GET /reports/shipping-points?date=
  reportShippingPoints: (date) =>
    _fetch(`/reports/shipping-points${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // GET /reports/trends?date= — National Trends commentary
  reportTrends: (date) =>
    _fetch(`/reports/trends${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // GET /history?commodity=&market=&variety=&origin=&size=&package=&days=
  history: (params = {}) => {
    const q = Object.entries(params)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return _fetch(`/history${q ? `?${q}` : ''}`);
  },

  // GET /movement/latest
  movementLatest: () => _fetch('/movement/latest'),

  // GET /movement/summary/{date}
  movementSummary: (date) => _fetch(`/movement/summary/${encodeURIComponent(date)}`),

  // GET /stats → {total_records, commodities, markets, dates}
  stats: () => _fetch('/stats'),

  // GET /market-summary?market=&date=
  marketSummary: (market, date) => {
    const params = [];
    if (market) params.push(`market=${encodeURIComponent(market)}`);
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    return _fetch(`/market-summary${params.length ? '?' + params.join('&') : ''}`);
  },

  // GET /wow?market= — week-over-week price changes per commodity
  wow: (market) =>
    _fetch(`/wow${market ? `?market=${encodeURIComponent(market)}` : ''}`),

  // GET /movers?market=&limit= — biggest movers with representative SKU
  movers: (market, limit = 6) =>
    _fetch(`/movers?market=${encodeURIComponent(market || 'New York')}&limit=${limit}`),

  // GET /story?market= — AI-generated story of the day
  story: (market) =>
    _fetch(`/story${market ? `?market=${encodeURIComponent(market)}` : ''}`),
};

// Expose globally for non-module scripts
if (typeof window !== 'undefined') window.agraxAPI = api;
