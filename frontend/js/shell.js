/* ================================================================
   agraX — SHELL RENDERER
   Every app page uses this exact shell. Pass the active route.
   ================================================================ */

const NAV = [
  { id: 'dashboard',    href: '/app/',                 label: 'Dashboard',        ico: '◐' },
  { id: 'markets',      href: '/app/markets',          label: 'Terminal markets', ico: '◈' },
  { id: 'shipping',     href: '/app/shipping',         label: 'Shipping points',  ico: '➜' },
  { id: 'movement',     href: '/app/movement',         label: 'Movement',         ico: '◆' },
  { id: 'watchlist',    href: '/app/watchlist',        label: 'Watchlist',        ico: '★' },
  { id: 'alerts',       href: '/app/alerts',           label: 'Alerts',           ico: '⚡', badge: 0 },
];

const NAV_INSIGHTS = [
  { id: 'reports',      href: '/app/reports',          label: 'Reports',          ico: '◇' },
  { id: 'exports',      href: '/app/exports',          label: 'Exports',          ico: '↗' },
];

const MOBILE_TABS = [
  { id: 'dashboard', href: '/app/',          label: 'Home',      ico: '◐' },
  { id: 'markets',   href: '/app/markets',   label: 'Markets',   ico: '◈' },
  { id: 'movement',  href: '/app/movement',  label: 'Movement',  ico: '◆' },
  { id: 'watchlist', href: '/app/watchlist', label: 'Watchlist', ico: '★' },
  { id: 'alerts',    href: '/app/alerts',    label: 'Alerts',    ico: '⚡' },
];

function _navItem(item, active) {
  const cls = 'side__item' + (item.id === active ? ' is-active' : '');
  const badge = item.badge ? `<span class="side__badge">${item.badge}</span>` : '';
  return `<a href="${item.href}" class="${cls}"><span class="side__ico">${item.ico}</span>${item.label}${badge}</a>`;
}
function _tabItem(item, active) {
  const cls = 'mtabs__tab' + (item.id === active ? ' is-active' : '');
  return `<a href="${item.href}" class="${cls}"><span class="mtabs__ico">${item.ico}</span>${item.label}</a>`;
}

const Shell = {
  render(active = 'dashboard') {
    return {
      mtop: `
        <div class="mtop">
          <a href="/" class="mtop__logo-link"><img src="/assets/agrax-logo-white.png" alt="agraX" class="mtop__logo-img" /></a>
          <div class="mtop__btn mtop__btn--bell" role="button" aria-label="Notifications">🔔</div>
          <div class="mtop__btn mtop__btn--last" role="button" aria-label="Menu">☰</div>
        </div>
      `,
      side: `
        <aside class="side">
          <a href="/" class="side__logo">
            <img src="/assets/agrax-logo-white.png" alt="agraX" class="side__logo-img" />
          </a>
          <div class="side__section">Workspace</div>
          ${NAV.map(i => _navItem(i, active)).join('')}
          <div class="side__section">Insights</div>
          ${NAV_INSIGHTS.map(i => _navItem(i, active)).join('')}
          <div class="side__trial">
            <div class="side__trial-tag">Trial</div>
            <div style="font-weight:600">11 days left</div>
            <a href="/app/upgrade" style="color:var(--dark-fg-muted);font-size:11px;margin-top:2px;display:block">Upgrade to Pro →</a>
          </div>
          <div class="side__user">
            <div class="side__avatar">MR</div>
            <div>
              <div style="font-size:12px;font-weight:500;color:#fff">Marcus R.</div>
              <div style="font-size:10.5px;color:var(--muted)">Placeholder Foods</div>
            </div>
          </div>
        </aside>
      `,
      mtabs: `
        <nav class="mtabs">
          ${MOBILE_TABS.map(i => _tabItem(i, active)).join('')}
        </nav>
      `,
    };
  },
};

if (typeof window !== 'undefined') window.Shell = Shell;
