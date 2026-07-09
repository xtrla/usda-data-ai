/* ================================================================
   agraX — DATA UTILS
   Pure functions that shape raw produce_prices rows into UI data.
   ================================================================ */

// Compute a "mostly" price from a row using the same rules used everywhere.
// Returns null if no meaningful price found.
function rowMostly(row) {
  const mLow = num(row.price_mostly_low);
  const mHigh = num(row.price_mostly_high);
  if (mLow != null && mHigh != null) return (mLow + mHigh) / 2;
  if (mLow != null) return mLow;
  if (mHigh != null) return mHigh;
  const low = num(row.price_low);
  const high = num(row.price_high);
  if (low != null && high != null) return (low + high) / 2;
  if (low != null) return low;
  if (high != null) return high;
  return null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Group rows by a key. Returns Map<key, rows[]>.
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

// Aggregate rows for a single commodity into a single record.
// Uses median of mostly prices, min low, max high.
function aggregateCommodity(rows) {
  const mostlies = rows.map(rowMostly).filter((x) => x != null).sort((a, b) => a - b);
  const lows = rows.map((r) => num(r.price_low)).filter((x) => x != null);
  const highs = rows.map((r) => num(r.price_high)).filter((x) => x != null);
  const mid = mostlies.length ? mostlies[Math.floor(mostlies.length / 2)] : null;
  return {
    mostly: mid,
    low: lows.length ? Math.min(...lows) : null,
    high: highs.length ? Math.max(...highs) : null,
    lotCount: rows.length,
    origins: uniq(rows.map((r) => r.origin).filter(Boolean)),
    packs: uniq(rows.map((r) => r.package).filter(Boolean)),
  };
}

function uniq(arr) { return Array.from(new Set(arr)); }

// Compute % change between today and previous mostly.
// Returns { pct, dir } where dir is 'up' | 'down' | 'flat' | null.
function delta(todayMostly, prevMostly) {
  if (todayMostly == null || prevMostly == null || prevMostly === 0) return { pct: null, dir: null };
  const pct = ((todayMostly - prevMostly) / prevMostly) * 100;
  const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
  return { pct, dir };
}

// Format helpers
function fmtPrice(v) {
  if (v == null) return '—';
  return '$' + v.toFixed(2);
}
function fmtPct(pct) {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
function fmtDelta(pct) {
  if (pct == null) return { text: '—', dir: null };
  const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  return { text: `${arrow} ${Math.abs(pct).toFixed(1)}%`, dir };
}

// Category → CSS modifier class
function catClass(commodity_type) {
  const map = {
    vegetables: 'veg',
    fruits: 'fruit',
    onions_potatoes: 'op',
    nuts: 'nut',
  };
  return map[commodity_type] || 'veg';
}
function catLabel(commodity_type) {
  const map = {
    vegetables: 'Vegetables',
    fruits: 'Fruits',
    onions_potatoes: 'Onions & Potatoes',
    nuts: 'Nuts',
  };
  return map[commodity_type] || commodity_type || 'Other';
}

// Market mood classification given aggregate change %
function moodFromAvgChg(avgChg) {
  if (avgChg == null) return { label: 'Steady', mod: 'steady', score: 50 };
  if (avgChg < -3) return { label: 'Easing', mod: 'down', score: 30 };
  if (avgChg > 3) return { label: 'Climbing', mod: 'up', score: 70 };
  return { label: 'Steady', mod: 'steady', score: 50 };
}

// ── WATCHLIST (localStorage, keyed by commodity name) ──
const WATCH_KEY = 'agrax:watchlist';
function watchList() {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); }
  catch { return []; }
}
function watchToggle(name) {
  const list = watchList();
  const idx = list.indexOf(name);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(name);
  localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  return list;
}
function watchHas(name) { return watchList().includes(name); }

// ── SELECTED MARKET / DATE (localStorage) ──
const SEL_MARKET_KEY = 'agrax:market';
const SEL_DATE_KEY = 'agrax:date';
function selMarket() { return localStorage.getItem(SEL_MARKET_KEY) || 'New York'; }
function setSelMarket(m) { localStorage.setItem(SEL_MARKET_KEY, m); }
function selDate() { return localStorage.getItem(SEL_DATE_KEY) || null; }
function setSelDate(d) { localStorage.setItem(SEL_DATE_KEY, d); }

// Expose
if (typeof window !== 'undefined') {
  window.agraxUtil = {
    rowMostly, num, groupBy, aggregateCommodity, uniq,
    delta, fmtPrice, fmtPct, fmtDelta,
    catClass, catLabel, moodFromAvgChg,
    watchList, watchToggle, watchHas,
    selMarket, setSelMarket, selDate, setSelDate,
  };
}
