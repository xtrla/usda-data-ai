/* ================================================================
   agraX — MOBILE APP SHELL
   ================================================================
   Mounts a purpose-built mobile UI below 900px. Reuses window.agraxAPI
   and window.agraxUtil; the desktop markup on the page is hidden via
   html[data-m-active] rather than restyled, so the two layouts never
   compete for the same nodes.

   Tabs: Today · Browse · Markets · Watch
   ================================================================ */
(function () {
  'use strict';

  var BREAK = 900;
  if (!window.matchMedia) return;

  var API = window.agraxAPI;
  var U = window.agraxUtil;
  if (!API || !U) return;

  // ── MARKETS ────────────────────────────────────────────
  // The 12 USDA terminal markets AgraX reports on.
  var MARKETS = [
    'Los Angeles', 'Atlanta', 'Chicago', 'Detroit', 'Miami', 'New York',
    'Boston', 'Philadelphia', 'Baltimore', 'Columbia', 'Asheville', 'Raleigh'
  ];
  var MARKET_STATE = {
    'Los Angeles': 'CA', 'Atlanta': 'GA', 'Chicago': 'IL', 'Detroit': 'MI',
    'Miami': 'FL', 'New York': 'NY', 'Boston': 'MA', 'Philadelphia': 'PA',
    'Baltimore': 'MD', 'Columbia': 'SC', 'Asheville': 'NC', 'Raleigh': 'NC'
  };

  var CATS = [
    { key: 'all', label: 'All' },
    { key: 'fruits', label: 'Fruits' },
    { key: 'vegetables', label: 'Vegetables' },
    { key: 'onions_potatoes', label: 'Onions & Potatoes' },
    { key: 'nuts', label: 'Nuts' }
  ];

  var SORTS = [
    { key: 'az', label: 'Commodity A\u2013Z' },
    { key: 'skus', label: 'Most SKUs reporting' },
    { key: 'move', label: 'Biggest move' },
    { key: 'higher', label: 'Trend: higher first' }
  ];

  // ── STATE ──────────────────────────────────────────────
  var S = {
    tab: 'today',
    market: U.selMarket() || 'New York',
    rows: [],
    fob: [],
    date: null,
    dates: [],
    summary: null,
    story: null,
    wow: {},              // commodity -> pct change
    cat: 'all',
    sort: 'az',
    q: '',
    open: {},             // commodity -> expanded?
    loading: true,
    error: null,
    detail: null,         // commodity name shown in the detail sheet
    dlFormat: 'csv',
    dlScope: 'view',
    subscribed: false
  };

  // ── SMALL HELPERS ──────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  // "1 SKU" not "1 SKUs".
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Icons (inline so there is no sprite request on first paint)
  var I = {
    search: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8A8A8A" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
    pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4D7C0F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    caret: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    arrow: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>',
    sort: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="17" x2="10" y2="17"/></svg>',
    dl: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><polyline points="7 11 12 16 17 11"/><path d="M4 20h16"/></svg>',
    share: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>',
    check: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    today: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="14" x2="5" y2="19"/><line x1="10" y1="9" x2="10" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/><line x1="20" y1="11" x2="20" y2="19"/></svg>',
    browse: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
    markets: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    star: function (filled) {
      return '<svg width="23" height="23" viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') +
        '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 3 15 9.5 22 10.3 17 15 18.3 21.5 12 18.2 5.7 21.5 7 15 2 10.3 9 9.5 12 3"/></svg>';
    }
  };

  // ── DATA SHAPING ───────────────────────────────────────
  function dedupe(rows) {
    var seen = {}, out = [];
    rows.sort(function (a, b) {
      return String(b.report_date || '').localeCompare(String(a.report_date || ''));
    });
    rows.forEach(function (r) {
      var k = [r.market, r.commodity, r.variety, r.origin, r.grade, r.package, r.size].join('||');
      if (!seen[k]) { seen[k] = 1; out.push(r); }
    });
    return out;
  }

  function skuPrice(row) {
    var mL = U.num(row.price_mostly_low), mH = U.num(row.price_mostly_high);
    if (mL != null && mH != null) return { price: (mL + mH) / 2, src: 'mostly' };
    if (mL != null) return { price: mL, src: 'mostly' };
    if (mH != null) return { price: mH, src: 'mostly' };
    var lo = U.num(row.price_low), hi = U.num(row.price_high);
    if (lo != null && hi != null) {
      if (lo === hi) return { price: lo, src: 'reported' };
      return { price: (lo + hi) / 2, src: 'mid' };
    }
    if (lo != null) return { price: lo, src: 'reported' };
    if (hi != null) return { price: hi, src: 'reported' };
    return { price: null, src: null };
  }

  function toneOf(rows) {
    for (var i = 0; i < rows.length; i++) {
      var m = String(rows[i].movement || rows[i].trend || '').toLowerCase();
      if (m.indexOf('higher') > -1 || m === 'up') return { label: 'Higher', mod: 'higher' };
      if (m.indexOf('lower') > -1 || m === 'down') return { label: 'Lower', mod: 'lower' };
    }
    return { label: 'Steady', mod: 'steady' };
  }

  function skuLabel(r) {
    var parts = [];
    if (r.variety && String(r.variety).trim() && r.variety !== 'N/A') parts.push(r.variety);
    if (r.origin && String(r.origin).trim() && r.origin !== 'N/A') parts.push(r.origin);
    var tail = [];
    if (r.package && r.package !== 'N/A') tail.push(r.package);
    if (r.size && r.size !== 'N/A') tail.push(r.size);
    if (tail.length) parts.push(tail.join(' '));
    return parts.length ? parts.join(' \u00b7 ') : (r.commodity || 'Reported lot');
  }

  // Rows for the selected market, with a loose fallback if the exact
  // market string in the data differs from our label.
  function marketRows() {
    var m = S.market;
    var out = S.rows.filter(function (r) { return r.market === m; });
    if (!out.length) {
      var key = m.toLowerCase().split(' ')[0];
      out = S.rows.filter(function (r) {
        return r.market && r.market.toLowerCase().indexOf(key) > -1;
      });
    }
    return out;
  }

  // Commodities for the current market, after category/search filters.
  function commodities() {
    var byCom = U.groupBy(marketRows(), function (r) { return r.commodity; });
    var list = [];
    byCom.forEach(function (rows, name) {
      if (S.cat !== 'all') {
        var t = rows[0] && rows[0].commodity_type;
        if (t !== S.cat) return;
      }
      if (S.q) {
        var hay = (name + ' ' + rows.map(function (r) {
          return [r.variety, r.origin, r.package, r.size].join(' ');
        }).join(' ')).toLowerCase();
        if (hay.indexOf(S.q) === -1) return;
      }
      var priced = rows.map(function (r) {
        return { row: r, p: skuPrice(r) };
      }).filter(function (x) { return x.p.price != null; })
        .sort(function (a, b) { return b.p.price - a.p.price; });

      var prices = priced.map(function (x) { return x.p.price; });
      var sorted = prices.slice().sort(function (a, b) { return a - b; });
      list.push({
        name: name,
        rows: rows,
        skus: priced,
        origins: U.uniq(rows.map(function (r) { return r.origin; }).filter(function (o) {
          return o && o !== 'N/A';
        })),
        tone: toneOf(rows),
        type: rows[0] && rows[0].commodity_type,
        date: rows[0] && rows[0].report_date,
        count: rows.length,
        low: prices.length ? Math.min.apply(null, prices) : null,
        high: prices.length ? Math.max.apply(null, prices) : null,
        median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        chg: S.wow[name] != null ? S.wow[name] : null
      });
    });

    var by = {
      az: function (a, b) { return a.name.localeCompare(b.name); },
      skus: function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); },
      move: function (a, b) {
        return Math.abs(b.chg || 0) - Math.abs(a.chg || 0) || a.name.localeCompare(b.name);
      },
      higher: function (a, b) {
        var r = { higher: 0, steady: 1, lower: 2 };
        return r[a.tone.mod] - r[b.tone.mod] || a.name.localeCompare(b.name);
      }
    };
    list.sort(by[S.sort] || by.az);
    return list;
  }

  // Tone per terminal market, derived from the movement field on the rows
  // we already hold. Nothing is invented: a market with no movement text
  // reports as Steady.
  function marketStats() {
    var acc = {};
    S.rows.forEach(function (r) {
      if (!r.market) return;
      var a = acc[r.market] || (acc[r.market] = { coms: {}, prices: 0, up: 0, down: 0 });
      a.coms[r.commodity] = 1;
      a.prices++;
      var m = String(r.movement || r.trend || '').toLowerCase();
      if (m.indexOf('higher') > -1) a.up++;
      else if (m.indexOf('lower') > -1) a.down++;
    });
    Object.keys(acc).forEach(function (k) {
      var a = acc[k];
      a.commodities = Object.keys(a.coms).length;
      a.tone = a.up > a.down ? { label: 'Higher', mod: 'higher' }
        : a.down > a.up ? { label: 'Lower', mod: 'lower' }
        : { label: 'Steady', mod: 'steady' };
    });
    return acc;
  }

  // Selected market leads the list; the rest keep their canonical order.
  function marketsOrdered() {
    return MARKETS.slice().sort(function (a, b) {
      return (b === S.market ? 1 : 0) - (a === S.market ? 1 : 0);
    });
  }

  function chgHTML(pct) {
    if (pct == null) return '';
    var dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
    var sign = pct > 0 ? '+' : '';
    return '<span class="m-chg m-chg--' + dir + '">' + sign + pct.toFixed(1) + '%</span>';
  }

  // ── LOADING ────────────────────────────────────────────
  async function load() {
    S.loading = true; S.error = null; render();
    try {
      var dates = await API.dates();
      if (!dates || !dates.length) throw new Error('No report dates available yet.');
      S.dates = dates;
      S.date = dates[0].date;

      // Merge the five most recent report dates so commodities that
      // didn't print today still appear, then keep the newest per SKU.
      var span = dates.slice(0, 5).map(function (d) { return d.date; });
      var results = await Promise.all(span.map(function (d) {
        return API.reportTerminal(d).catch(function () { return []; });
      }));
      var merged = [];
      results.forEach(function (r) { merged = merged.concat(r || []); });
      S.rows = dedupe(merged);

      S.fob = await API.reportShippingPoints(S.date).catch(function () { return []; });
      S.loading = false;
      render();

      // Secondary data — never blocks the table.
      loadMarketExtras();
    } catch (e) {
      S.loading = false;
      S.error = e.message || 'Could not load market data.';
      render();
    }
  }

  async function loadMarketExtras() {
    var mkt = S.market;
    API.marketSummary(mkt).then(function (s) {
      if (S.market === mkt) { S.summary = s; render(); }
    }).catch(function () {});

    API.story(mkt).then(function (s) {
      if (S.market === mkt) { S.story = s; render(); }
    }).catch(function () {});

    API.wow(mkt).then(function (rows) {
      if (S.market !== mkt) return;
      var map = {};
      (rows || []).forEach(function (r) {
        var pct = r.pct_change != null ? r.pct_change
          : (r.wow_pct != null ? r.wow_pct : r.change_pct);
        if (r.commodity && pct != null) map[r.commodity] = Number(pct);
      });
      S.wow = map;
      render();
    }).catch(function () {});
  }

  function switchMarket(m) {
    if (m === S.market) return;
    S.market = m;
    U.setSelMarket(m);
    S.summary = null; S.story = null; S.wow = {}; S.open = {};
    render();
    loadMarketExtras();
    API.reportShippingPoints(S.date).then(function (f) {
      S.fob = f || []; render();
    }).catch(function () {});
  }

  // ── VIEWS ──────────────────────────────────────────────

  function viewHeader() {
    return '' +
      '<header class="m-header">' +
        '<div class="m-header__top">' +
          '<a class="m-logo" href="/">agra<span>x</span></a>' +
          '<button class="m-market-pill" data-act="markets-sheet">' +
            I.pin +
            '<span class="m-market-pill__name">' + esc(S.market) + '</span>' +
            I.chev +
          '</button>' +
        '</div>' +
        '<div class="m-search">' + I.search +
          '<input id="m-q" type="search" inputmode="search" autocomplete="off" ' +
          'placeholder="Search produce" value="' + esc(S.q) + '" aria-label="Search produce">' +
        '</div>' +
      '</header>';
  }

  function viewHero() {
    var rows = marketRows();
    var byCom = U.groupBy(rows, function (r) { return r.commodity; });
    var s = S.summary || {};
    var tot = (s.tone_higher || 0) + (s.tone_lower || 0) + (s.tone_steady || 0);

    // Average absolute week-over-week move across commodities we have.
    var moves = Object.keys(S.wow).map(function (k) { return Math.abs(S.wow[k]); });
    var avg = moves.length
      ? (moves.reduce(function (a, b) { return a + b; }, 0) / moves.length)
      : null;

    var stats = [
      { v: byCom.size || '\u2014', l: 'Commodities' },
      { v: rows.length || '\u2014', l: 'Prices' },
      { v: tot ? (s.tone_higher || 0) + '/' + tot : '\u2014', l: 'Tone higher' },
      { v: avg != null ? avg.toFixed(1) + '%' : '\u2014', l: 'Avg movement' }
    ];

    return '' +
      '<section class="m-hero">' +
        '<div class="m-hero__bg" style="background-image:url(/assets/hero-field.png)"></div>' +
        '<h1>Commodity data for produce buyers</h1>' +
        '<p class="m-hero__lede">Your supplier checks wholesale prices every morning. Now you can too.</p>' +
        '<p class="m-hero__sub">USDA market prices, origin costs, and shipment volumes \u2014 every weekday.</p>' +
        '<div class="m-stats">' +
          stats.map(function (x) {
            return '<div class="m-stat">' +
              '<div class="m-stat__val">' + esc(x.v) + '</div>' +
              '<div class="m-stat__label">' + x.l + '</div></div>';
          }).join('') +
        '</div>' +
      '</section>';
  }

  function viewStory() {
    if (!S.story) {
      return '<div class="m-story">' +
        '<div class="m-story__eyebrow">Story of the day</div>' +
        '<div class="m-skel" style="height:26px;margin:12px 0 8px"></div>' +
        '<div class="m-skel" style="height:15px;margin-bottom:6px"></div>' +
        '<div class="m-skel" style="height:15px;width:72%"></div></div>';
    }
    if (!S.story.headline) {
      return '<div class="m-story">' +
        '<div class="m-story__eyebrow">Story of the day</div>' +
        '<p class="m-story__body" style="margin-top:10px">' +
          'Today\u2019s story generates once the morning report lands.</p></div>';
    }
    return '' +
      '<div class="m-story">' +
        '<div class="m-story__eyebrow">Story of the day</div>' +
        '<h2 class="m-story__headline">' + esc(S.story.headline) + '</h2>' +
        '<p class="m-story__body">' + esc(S.story.body || '') + '</p>' +
        '<div class="m-story__src">USDA AMS \u00b7 Week of ' +
          esc(U.fmtDate(S.story.report_date || S.date || '')) + '</div>' +
      '</div>';
  }

  function viewMoves() {
    var list = commodities()
      .filter(function (c) { return c.chg != null; })
      .sort(function (a, b) { return Math.abs(b.chg) - Math.abs(a.chg); })
      .slice(0, 6);
    if (!list.length) return '';
    return '' +
      '<section class="m-section">' +
        '<div class="m-section__head">' +
          '<h2 class="m-section__title">This week\u2019s moves</h2>' +
          '<span class="m-section__aside">' + esc(S.market) + '</span>' +
        '</div>' +
        '<div class="m-list" style="border-radius:var(--m-radius);overflow:hidden">' +
          list.map(function (c) {
            return '<button class="m-com__head" data-act="detail" data-com="' + esc(c.name) + '">' +
              '<span>' +
                '<span class="m-com__name">' + esc(c.name) + '</span>' +
                '<span class="m-com__origins">' + esc(c.origins.slice(0, 2).join(' \u00b7 ') || '\u2014') + '</span>' +
              '</span>' +
              '<span class="m-com__right">' +
                '<span class="m-tone m-tone--' + c.tone.mod + '">' + c.tone.label + '</span>' +
                chgHTML(c.chg) +
              '</span></button>';
          }).join('') +
        '</div>' +
      '</section>';
  }

  function viewPills() {
    return '<div class="m-pills" role="group" aria-label="Filter by category">' +
      CATS.map(function (c) {
        return '<button class="m-pill" data-act="cat" data-cat="' + c.key + '" ' +
          'aria-pressed="' + (S.cat === c.key) + '">' + c.label + '</button>';
      }).join('') + '</div>';
  }

  function viewToolbar(list) {
    var prices = list.reduce(function (n, c) { return n + c.count; }, 0);
    return '' +
      '<div class="m-toolbar">' +
        '<span class="m-toolbar__count">' + list.length + ' commodities \u00b7 ' + prices + ' prices</span>' +
        '<button class="m-iconbtn" data-act="sort-sheet" aria-label="Sort commodities">' + I.sort + '</button>' +
        '<button class="m-iconbtn" data-act="dl-dialog" aria-label="Download report">' + I.dl + '</button>' +
        '<button class="m-iconbtn" data-act="share" aria-label="Share this view">' + I.share + '</button>' +
      '</div>';
  }

  function viewCommodity(c) {
    var open = !!S.open[c.name];
    var h = '<div class="m-com" data-open="' + open + '">';

    h += '<button class="m-com__head" data-act="toggle" data-com="' + esc(c.name) + '" ' +
      'aria-expanded="' + open + '">' +
      '<span>' +
        '<span class="m-com__name">' + esc(c.name) + I.caret + '</span>' +
        '<span class="m-com__origins">' + esc(c.origins.slice(0, 3).join(' \u00b7 ') || '\u2014') + '</span>' +
        '<span class="m-com__meta">USDA \u00b7 ' + esc(U.fmtDate(c.date || S.date || '')) + '</span>' +
      '</span>' +
      '<span class="m-com__right">' +
        '<span class="m-tone m-tone--' + c.tone.mod + '">' + c.tone.label + '</span>' +
        '<span class="m-com__skus">' + plural(c.count, 'SKU') + '</span>' +
      '</span></button>';

    if (open) {
      h += '<div class="m-skus">';
      h += c.skus.map(function (x) {
        return '<div class="m-sku">' +
          '<span><span class="m-sku__label">' + esc(skuLabel(x.row)) + '</span>' +
          '<span class="m-sku__tags">' +
            (x.p.src ? '<span class="m-src m-src--' + x.p.src + '">' +
              (x.p.src === 'mid' ? 'mid-range' : x.p.src) + '</span>' : '') +
          '</span></span>' +
          '<span class="m-sku__price">' + U.fmtPrice(x.p.price) + '</span></div>';
      }).join('');
      if (!c.skus.length) {
        h += '<div class="m-sku"><span class="m-sku__label" style="color:var(--text-muted)">' +
          'No prices printed for this commodity today.</span></div>';
      }
      h += '</div>';
      h += '<button class="m-com__more" data-act="detail" data-com="' + esc(c.name) + '">' +
        'View details' + I.arrow + '</button>';
    }
    return h + '</div>';
  }

  function viewMarketCards() {
    var stats = marketStats();
    return '' +
      '<section class="m-section">' +
        '<div class="m-section__head">' +
          '<h2 class="m-section__title">Terminal markets</h2>' +
          '<span class="m-section__aside">12 reporting</span>' +
        '</div>' +
      '</section>' +
      '<div class="m-scroller">' +
        marketsOrdered().map(function (m) {
          var a = stats[m];
          return '<button class="m-mkt" data-act="market" data-market="' + esc(m) + '" ' +
            'aria-pressed="' + (S.market === m) + '">' +
            '<div class="m-mkt__name">' + esc(m) + '</div>' +
            '<div class="m-mkt__sub">' +
              (a ? plural(a.commodities, 'commodity', 'commodities') : 'Not reporting') +
            '</div>' +
            (a ? '<span class="m-tone m-tone--' + a.tone.mod + '">' + a.tone.label + '</span>' : '') +
            '</button>';
        }).join('') +
      '</div>';
  }

  function viewCategoryCards() {
    var rows = marketRows();
    var byType = {};
    rows.forEach(function (r) {
      var t = r.commodity_type || 'other';
      if (!byType[t]) byType[t] = {};
      byType[t][r.commodity] = 1;
    });
    var cards = CATS.filter(function (c) { return c.key !== 'all'; }).map(function (c) {
      var names = Object.keys(byType[c.key] || {}).sort();
      return '<button class="m-cat" data-act="cat-jump" data-cat="' + c.key + '">' +
        '<div class="m-cat__name">' + c.label + '</div>' +
        '<div class="m-cat__count">' + names.length + ' commodities</div>' +
        '<div class="m-cat__items">' +
          esc(names.slice(0, 4).join(', ') || 'None reporting') +
        '</div></button>';
    });
    return '' +
      '<section class="m-section">' +
        '<div class="m-section__head">' +
          '<h2 class="m-section__title">Browse by category</h2>' +
        '</div>' +
      '</section>' +
      '<div class="m-cats">' + cards.join('') + '</div>';
  }

  function viewSubscribe() {
    return '' +
      '<section class="m-section">' +
        '<div class="m-sub">' +
          '<h3>The weekday morning brief</h3>' +
          '<p>Yesterday\u2019s terminal prices and the moves worth knowing, before the market opens.</p>' +
          (S.subscribed
            ? '<div class="m-sub__done">You\u2019re on the list. First brief arrives tomorrow morning.</div>'
            : '<div class="m-sub__row">' +
                '<input id="m-sub-email" type="email" inputmode="email" autocomplete="email" ' +
                  'placeholder="you@company.com" aria-label="Email address">' +
                '<button data-act="subscribe">Subscribe</button>' +
              '</div>') +
        '</div>' +
      '</section>';
  }

  function viewFine() {
    return '<p class="m-fine">Data from the USDA Agricultural Marketing Service, Specialty Crops ' +
      'Terminal Market and Shipping Point reports. AgraX is an independent company and is not ' +
      'affiliated with or endorsed by the USDA.</p>';
  }

  // ── TABS ───────────────────────────────────────────────

  function tabToday() {
    return viewHero() + viewStory() + viewMoves() +
      viewMarketCards() + viewCategoryCards() + viewSubscribe() + viewFine();
  }

  function tabBrowse() {
    if (S.loading) {
      return viewPills() +
        '<div style="padding:20px var(--m-gutter)">' +
        [0, 1, 2, 3, 4, 5].map(function () {
          return '<div class="m-skel" style="height:64px;margin-bottom:10px"></div>';
        }).join('') + '</div>';
    }
    if (S.error) {
      return '<div class="m-empty"><div class="m-empty__title">Market data didn\u2019t load</div>' +
        '<div class="m-empty__body">' + esc(S.error) + '</div>' +
        '<button data-act="reload">Try again</button></div>';
    }
    var list = commodities();
    var body = list.length
      ? '<div class="m-list">' + list.map(viewCommodity).join('') + '</div>'
      : '<div class="m-empty"><div class="m-empty__title">Nothing matches</div>' +
        '<div class="m-empty__body">No commodities in ' + esc(S.market) +
        ' match this search and category.</div>' +
        '<button data-act="clear">Clear search and filters</button></div>';

    return viewPills() + viewToolbar(list) + body +
      viewMarketCards() + viewCategoryCards() + viewSubscribe() + viewFine();
  }

  function tabMarkets() {
    var stats = marketStats();
    return '' +
      '<section class="m-section">' +
        '<div class="m-section__head">' +
          '<h2 class="m-section__title">Terminal markets</h2>' +
          '<span class="m-section__aside">12 reporting</span>' +
        '</div>' +
      '</section>' +
      '<div class="m-list">' +
        marketsOrdered().map(function (m) {
          var a = stats[m];
          return '<button class="m-com__head" data-act="market-go" data-market="' + esc(m) + '">' +
            '<span><span class="m-com__name">' + esc(m) +
              (S.market === m ? '<span class="m-badge-sel">Selected</span>' : '') + '</span>' +
            '<span class="m-com__origins">' + (a
              ? plural(a.commodities, 'commodity', 'commodities') + ' \u00b7 ' + plural(a.prices, 'price')
              : 'No prices loaded') + '</span></span>' +
            '<span class="m-com__right">' +
              (a ? '<span class="m-tone m-tone--' + a.tone.mod + '">' + a.tone.label + '</span>' : '') +
            '</span></button>';
        }).join('') +
      '</div>' + viewFine();
  }

  function tabWatch() {
    var names = U.watchList();
    if (!names.length) {
      return '<div class="m-empty" style="padding-top:70px">' +
        '<div class="m-empty__title">Nothing on your watchlist</div>' +
        '<div class="m-empty__body">Star a commodity from its details to track it here.</div>' +
        '<button data-act="tab" data-tab="browse">Browse commodities</button></div>';
    }
    var all = commodities();
    var picked = all.filter(function (c) { return names.indexOf(c.name) > -1; });
    if (!picked.length) {
      return '<div class="m-empty" style="padding-top:70px">' +
        '<div class="m-empty__title">No prices today</div>' +
        '<div class="m-empty__body">Your ' + names.length + ' watched commodit' +
        (names.length === 1 ? 'y hasn\u2019t' : 'ies haven\u2019t') +
        ' printed in ' + esc(S.market) + ' yet.</div></div>';
    }
    return '<section class="m-section"><div class="m-section__head">' +
      '<h2 class="m-section__title">Watchlist</h2>' +
      '<span class="m-section__aside">' + esc(S.market) + '</span></div></section>' +
      '<div class="m-list">' + picked.map(viewCommodity).join('') + '</div>';
  }

  function viewTabbar() {
    var tabs = [
      { k: 'today', l: 'Today', i: I.today },
      { k: 'browse', l: 'Browse', i: I.browse },
      { k: 'markets', l: 'Markets', i: I.markets },
      { k: 'watch', l: 'Watch', i: I.star(S.tab === 'watch') }
    ];
    return '<nav class="m-tabbar" role="tablist">' +
      tabs.map(function (t) {
        return '<button class="m-tab" role="tab" data-act="tab" data-tab="' + t.k + '" ' +
          'aria-selected="' + (S.tab === t.k) + '">' + t.i + '<span>' + t.l + '</span></button>';
      }).join('') + '</nav>';
  }

  // ── SHEETS ─────────────────────────────────────────────

  function sheetSort() {
    return '' +
      '<div class="m-sheet__grip"></div>' +
      '<div class="m-sheet__head"><h2 class="m-sheet__title">Sort commodities</h2></div>' +
      '<div class="m-sheet__scroll">' +
        SORTS.map(function (s) {
          return '<button class="m-opt" data-act="set-sort" data-sort="' + s.key + '" ' +
            'role="menuitemradio" aria-checked="' + (S.sort === s.key) + '">' +
            '<span>' + s.label + '</span>' +
            (S.sort === s.key ? I.check : '') + '</button>';
        }).join('') +
      '</div>';
  }

  function sheetMarkets() {
    return '' +
      '<div class="m-sheet__grip"></div>' +
      '<div class="m-sheet__head"><h2 class="m-sheet__title">Choose a market</h2></div>' +
      '<div class="m-sheet__scroll">' +
        MARKETS.map(function (m) {
          return '<button class="m-opt" data-act="set-market" data-market="' + esc(m) + '" ' +
            'role="menuitemradio" aria-checked="' + (S.market === m) + '">' +
            '<span>' + esc(m) + '<span class="m-opt__sub">' +
            esc(m + ', ' + (MARKET_STATE[m] || '')) + ' terminal</span></span>' +
            (S.market === m ? I.check : '') + '</button>';
        }).join('') +
      '</div>';
  }

  function sheetDetail() {
    var c = commodities().filter(function (x) { return x.name === S.detail; })[0];
    if (!c) return '<div class="m-sheet__grip"></div><div class="m-sheet__head">' +
      '<h2 class="m-sheet__title">Not reporting</h2></div>';

    var watched = U.watchHas(c.name);
    var fob = S.fob.filter(function (r) { return r.commodity === c.name; });

    // Origin-aware: FOB districts that match an origin seen in the
    // terminal rows sort first, so the shipper you're buying from leads.
    var origins = c.origins.map(function (o) { return String(o).toLowerCase(); });
    fob.sort(function (a, b) {
      var am = origins.some(function (o) {
        return String(a.market || a.origin || '').toLowerCase().indexOf(o.split(',')[0]) > -1;
      });
      var bm = origins.some(function (o) {
        return String(b.market || b.origin || '').toLowerCase().indexOf(o.split(',')[0]) > -1;
      });
      return (bm ? 1 : 0) - (am ? 1 : 0);
    });

    var h = '<div class="m-sheet__grip"></div>';
    h += '<div class="m-sheet__head" style="padding-bottom:0">';
    h += '<div class="m-detail__top">' +
      '<div><h2 class="m-detail__title">' + esc(c.name) + '</h2>' +
      '<div class="m-detail__meta">' + esc(S.market) + ' \u00b7 ' +
      plural(c.count, 'SKU') + ' \u00b7 ' + esc(U.catLabel(c.type)) + '</div></div>' +
      '<button class="m-round" data-act="watch" data-com="' + esc(c.name) + '" ' +
        'aria-pressed="' + watched + '" aria-label="' +
        (watched ? 'Remove from watchlist' : 'Add to watchlist') + '">' + I.star(watched) + '</button>' +
      '<button class="m-round" data-act="close" aria-label="Close details">' + I.close + '</button>' +
      '</div>';
    h += '<div class="m-detail__price">' +
      '<span class="m-detail__range">' +
        (c.low == null ? '\u2014'
          : c.low === c.high ? U.fmtPrice(c.low)
          : U.fmtPrice(c.low) + '\u2013' + U.fmtPrice(c.high)) +
      '</span>' +
      '<span class="m-tone m-tone--' + c.tone.mod + '">' + c.tone.label + '</span></div>';
    h += '<div class="m-detail__median">Median ' + U.fmtPrice(c.median) +
      (c.chg != null ? ' \u00b7 ' + (c.chg > 0 ? '+' : '') + c.chg.toFixed(1) + '% on the week' : '') +
      '</div>';
    h += '</div>';

    h += '<div class="m-sheet__scroll"><div class="m-detail__body">';

    h += '<div class="m-card"><div class="m-card__title">All SKUs \u00b7 ' + esc(S.market) + '</div>';
    h += c.skus.map(function (x) {
      return '<div class="m-row">' +
        '<span><span class="m-sku__label">' + esc(skuLabel(x.row)) + '</span>' +
        '<span class="m-sku__tags">' +
          (x.p.src ? '<span class="m-src m-src--' + x.p.src + '">' +
            (x.p.src === 'mid' ? 'mid-range' : x.p.src) + '</span>' : '') +
        '</span></span>' +
        '<span class="m-sku__price">' + U.fmtPrice(x.p.price) + '</span></div>';
    }).join('') || '<div class="m-row"><span class="m-sku__label" ' +
      'style="color:var(--text-muted)">No prices printed today.</span></div>';
    h += '</div>';

    h += '<div class="m-card"><div class="m-card__title">FOB shipping point</div>';
    h += fob.length ? fob.slice(0, 8).map(function (r) {
      var p = skuPrice(r);
      return '<div class="m-row">' +
        '<span><span class="m-sku__label">' + esc(r.market || r.origin || 'Shipping point') + '</span>' +
        (r.variety || r.package
          ? '<span class="m-com__origins">' + esc([r.variety, r.package].filter(function (v) {
              return v && v !== 'N/A';
            }).join(' \u00b7 ')) + '</span>' : '') +
        '</span>' +
        '<span class="m-sku__price">' + U.fmtPrice(p.price) + '</span></div>';
    }).join('') : '<div class="m-row"><span class="m-sku__label" ' +
      'style="color:var(--text-muted)">No origin prices for ' + esc(c.name) + ' today.</span></div>';
    h += '</div>';

    h += '</div></div>';
    return h;
  }

  function dialogDownload() {
    var list = commodities();
    var viewN = list.reduce(function (n, c) { return n + c.count; }, 0);
    var allN = marketRows().length;
    var opts = [
      { k: 'csv', l: 'CSV', s: 'One row per SKU, all columns' },
      { k: 'pdf', l: 'PDF report', s: 'Formatted, with market tone notes' }
    ];
    return '' +
      '<div class="m-dialog__head">' +
        '<h2 class="m-sheet__title">Download report</h2>' +
        '<div class="m-detail__meta">' + esc(S.market) + ' \u00b7 ' +
          (S.cat === 'all' ? 'All categories' : esc(catName(S.cat))) + ' \u00b7 ' +
          list.length + ' commodities, ' + viewN + ' prices</div>' +
      '</div>' +
      opts.map(function (o) {
        return '<button class="m-opt" data-act="set-format" data-format="' + o.k + '" ' +
          'role="menuitemradio" aria-checked="' + (S.dlFormat === o.k) + '">' +
          '<span>' + o.l + '<span class="m-opt__sub">' + o.s + '</span></span>' +
          (S.dlFormat === o.k ? I.check : '') + '</button>';
      }).join('') +
      (viewN === allN ? '' :
        '<button class="m-opt" data-act="set-scope" data-scope="' +
        (S.dlScope === 'view' ? 'all' : 'view') + '">' +
        '<span>' + (S.dlScope === 'view'
          ? 'Just this view \u2014 ' + plural(viewN, 'price')
          : 'Everything in ' + esc(S.market) + ' \u2014 ' + plural(allN, 'price')) +
        '<span class="m-opt__sub">Tap to switch to ' +
        (S.dlScope === 'view' ? 'all ' + allN : 'the ' + viewN + ' shown') + '</span></span>' +
        I.chev + '</button>') +
      '<div class="m-dialog__actions">' +
        '<button class="m-btn m-btn--ghost" data-act="close">Cancel</button>' +
        '<button class="m-btn m-btn--primary" data-act="do-download">Download</button>' +
      '</div>';
  }

  function catName(k) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].key === k) return CATS[i].label;
    return k;
  }

  // ── OVERLAY PLUMBING ───────────────────────────────────
  var overlay = null;   // 'sort' | 'markets' | 'detail' | 'download'
  var lastFocus = null;

  function openOverlay(kind) {
    lastFocus = document.activeElement;
    overlay = kind;
    renderOverlay();
    document.documentElement.setAttribute('data-m-lock', '');
    requestAnimationFrame(function () {
      var node = el(kind === 'download' ? 'm-dialog' : 'm-sheet');
      var scrim = el('m-scrim');
      if (scrim) scrim.setAttribute('data-show', '');
      if (node) {
        node.setAttribute('data-show', '');
        node.setAttribute('tabindex', '-1');
        node.focus({ preventScroll: true });
      }
    });
  }

  function closeOverlay() {
    var node = el('m-dialog') || el('m-sheet');
    var scrim = el('m-scrim');
    if (node) node.removeAttribute('data-show');
    if (scrim) scrim.removeAttribute('data-show');
    document.documentElement.removeAttribute('data-m-lock');
    var wasDetail = overlay === 'detail';
    overlay = null;
    setTimeout(function () {
      if (!overlay) {
        var host = el('m-overlay');
        if (host) host.innerHTML = '';
        if (wasDetail) S.detail = null;
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
      }
    }, 280);
  }

  function renderOverlay() {
    var host = el('m-overlay');
    if (!host) return;
    if (!overlay) { host.innerHTML = ''; return; }
    var isDialog = overlay === 'download';
    var inner = overlay === 'sort' ? sheetSort()
      : overlay === 'markets' ? sheetMarkets()
      : overlay === 'detail' ? sheetDetail()
      : dialogDownload();
    host.innerHTML =
      '<div class="m-scrim" id="m-scrim" data-act="close"></div>' +
      '<div class="' + (isDialog ? 'm-dialog" id="m-dialog' : 'm-sheet" id="m-sheet') + '" ' +
      'role="dialog" aria-modal="true">' + inner + '</div>';
  }

  // Re-render an open overlay in place, preserving its shown state.
  function refreshOverlay() {
    if (!overlay) return;
    renderOverlay();
    var node = el('m-dialog') || el('m-sheet');
    var scrim = el('m-scrim');
    if (node) node.setAttribute('data-show', '');
    if (scrim) scrim.setAttribute('data-show', '');
  }

  // ── EXPORT ─────────────────────────────────────────────
  function exportRows() {
    if (S.dlScope === 'all') return marketRows();
    var out = [];
    commodities().forEach(function (c) { out = out.concat(c.rows); });
    return out;
  }

  function downloadCSV() {
    var rows = exportRows();
    var cols = ['report_date', 'market', 'commodity', 'variety', 'origin', 'grade',
      'package', 'size', 'price_low', 'price_high', 'price_mostly_low',
      'price_mostly_high', 'movement'];
    var lines = [cols.join(',')];
    rows.forEach(function (r) {
      lines.push(cols.map(function (k) {
        var v = r[k] == null ? '' : String(r[k]);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'agrax-' + U.slugify(S.market) + '-' + (S.date || 'latest') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function downloadPDF() {
    var rows = exportRows();
    var byCom = U.groupBy(rows, function (r) { return r.commodity; });
    var h = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>AgraX \u2014 ' + esc(S.market) + '</title><style>' +
      'body{font:12px -apple-system,system-ui,sans-serif;color:#0A0A0A;padding:28px}' +
      'h1{font-size:19px;margin:0 0 3px}.sub{color:#737373;font-size:11px;margin-bottom:20px}' +
      'h2{font-size:13px;margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid #E4E7DF}' +
      'table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px solid #F2F4EF}' +
      'td.p{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
      '.f{margin-top:26px;font-size:10px;color:#A3A3A3}</style></head><body>';
    h += '<h1>' + esc(S.market) + ' terminal market</h1>';
    h += '<div class="sub">USDA AMS \u00b7 ' + esc(U.fmtDateLong(S.date || '')) +
      ' \u00b7 ' + byCom.size + ' commodities, ' + rows.length + ' prices</div>';
    byCom.forEach(function (rs, name) {
      h += '<h2>' + esc(name) + '</h2><table>';
      rs.forEach(function (r) {
        var p = skuPrice(r);
        h += '<tr><td>' + esc(skuLabel(r)) + '</td><td class="p">' +
          U.fmtPrice(p.price) + '</td></tr>';
      });
      h += '</table>';
    });
    h += '<div class="f">Data from the USDA Agricultural Marketing Service. AgraX is an ' +
      'independent company and is not affiliated with or endorsed by the USDA.</div>';
    h += '<scr' + 'ipt>window.onload=function(){window.print()}</scr' + 'ipt></body></html>';
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write(h); w.document.close();
  }

  async function share() {
    var url = window.location.origin + '/browse?market=' + encodeURIComponent(S.market) +
      (S.cat !== 'all' ? '&cat=' + S.cat : '') + (S.q ? '&q=' + encodeURIComponent(S.q) : '');
    var data = {
      title: 'AgraX \u2014 ' + S.market + ' wholesale prices',
      text: 'Wholesale produce prices at the ' + S.market + ' terminal market.',
      url: url
    };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch (e) { /* user dismissed the share sheet */ }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:' +
      'calc(var(--m-tabbar-h) + 20px);z-index:120;background:#0A0A0A;color:#fff;' +
      'padding:12px 20px;border-radius:10px;font-size:15px;font-weight:500;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.24)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1900);
  }

  async function subscribe() {
    var input = el('m-sub-email');
    if (!input) return;
    var email = input.value.trim();
    if (!email || email.indexOf('@') < 1) { toast('Enter a valid email'); input.focus(); return; }
    S.subscribed = true;
    render();
    try {
      await fetch(API.base + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: 'mobile' })
      });
    } catch (e) { /* address is captured client-side; retry is not worth a scary error */ }
  }

  // ── RENDER ─────────────────────────────────────────────
  var scrollMemo = {};

  function render() {
    var root = el('m-root');
    if (!root) return;
    var body = S.tab === 'today' ? tabToday()
      : S.tab === 'browse' ? tabBrowse()
      : S.tab === 'markets' ? tabMarkets()
      : tabWatch();
    root.innerHTML = viewHeader() + '<main id="m-main">' + body + '</main>' +
      viewTabbar() + '<div id="m-overlay"></div>';
    if (overlay) refreshOverlay();
    revealActivePill();
  }

  // The pill row scrolls horizontally, so a category picked from a card
  // (or a deep link) can land off-screen. Bring it into view.
  function revealActivePill() {
    var row = document.querySelector('.m-pills');
    if (!row) return;
    var active = row.querySelector('.m-pill[aria-pressed="true"]');
    if (!active) return;
    var left = active.offsetLeft - 16;
    var right = active.offsetLeft + active.offsetWidth + 16;
    if (left < row.scrollLeft || right > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.max(0, left);
    }
  }

  // ── EVENTS ─────────────────────────────────────────────
  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act === 'tab') {
      var next = t.getAttribute('data-tab');
      scrollMemo[S.tab] = window.scrollY;
      S.tab = next;
      render();
      window.scrollTo(0, scrollMemo[next] || 0);
      return;
    }
    if (act === 'cat') { S.cat = t.getAttribute('data-cat'); render(); return; }
    if (act === 'cat-jump') {
      S.cat = t.getAttribute('data-cat');
      var wasToday = S.tab !== 'browse';
      S.tab = 'browse';
      render();
      if (wasToday) {
        window.scrollTo(0, 0);
      } else {
        var pills = document.querySelector('.m-pills');
        if (pills) window.scrollTo({ top: pills.offsetTop - 120, behavior: 'smooth' });
      }
      return;
    }
    if (act === 'toggle') {
      var name = t.getAttribute('data-com');
      S.open[name] = !S.open[name];
      var y = window.scrollY;
      render();
      window.scrollTo(0, y);
      return;
    }
    if (act === 'detail') { S.detail = t.getAttribute('data-com'); openOverlay('detail'); return; }
    if (act === 'sort-sheet') { openOverlay('sort'); return; }
    if (act === 'markets-sheet') { openOverlay('markets'); return; }
    if (act === 'dl-dialog') { openOverlay('download'); return; }
    if (act === 'set-sort') { S.sort = t.getAttribute('data-sort'); closeOverlay(); render(); return; }
    if (act === 'set-market') {
      switchMarket(t.getAttribute('data-market'));
      closeOverlay();
      return;
    }
    if (act === 'market' || act === 'market-go') {
      var jump = act === 'market-go' || S.tab !== 'browse';
      switchMarket(t.getAttribute('data-market'));
      if (jump) { S.tab = 'browse'; render(); window.scrollTo(0, 0); }
      return;
    }
    if (act === 'set-format') { S.dlFormat = t.getAttribute('data-format'); refreshOverlay(); return; }
    if (act === 'set-scope') { S.dlScope = t.getAttribute('data-scope'); refreshOverlay(); return; }
    if (act === 'do-download') {
      closeOverlay();
      if (S.dlFormat === 'pdf') downloadPDF(); else downloadCSV();
      return;
    }
    if (act === 'watch') {
      U.watchToggle(t.getAttribute('data-com'));
      refreshOverlay();
      return;
    }
    if (act === 'share') { share(); return; }
    if (act === 'subscribe') { subscribe(); return; }
    if (act === 'clear') { S.q = ''; S.cat = 'all'; render(); return; }
    if (act === 'reload') { load(); return; }
    if (act === 'close') { closeOverlay(); return; }
  }

  var qTimer = null;
  function onInput(e) {
    if (e.target.id !== 'm-q') return;
    var v = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      S.q = v.trim().toLowerCase();
      if (S.q && S.tab !== 'browse') S.tab = 'browse';
      var pos = e.target.selectionStart;
      render();
      var input = el('m-q');
      if (input) {
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(pos, pos); } catch (err) {}
      }
    }, 220);
  }

  function onKey(e) {
    if (e.key === 'Escape' && overlay) { e.preventDefault(); closeOverlay(); }
  }

  // ── MOUNT ──────────────────────────────────────────────
  var mounted = false;
  var mq = window.matchMedia('(max-width: ' + (BREAK - 1) + 'px)');

  function mount() {
    if (mounted) return;
    mounted = true;
    document.documentElement.setAttribute('data-m-active', '');

    var root = document.createElement('div');
    root.id = 'm-root';
    document.body.insertBefore(root, document.body.firstChild);

    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);

    // Deep links from the desktop page / shared URLs
    var p = new URLSearchParams(window.location.search);
    if (p.get('market')) S.market = p.get('market').replace(/, [A-Z]{2}$/, '');
    if (p.get('cat')) S.cat = p.get('cat');
    if (p.get('q')) S.q = p.get('q').toLowerCase();
    // /browse lands on Browse; everything else opens on Today.
    if (/^\/browse/.test(window.location.pathname) || S.q) S.tab = 'browse';

    render();
    load();
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    document.documentElement.removeAttribute('data-m-active');
    document.documentElement.removeAttribute('data-m-lock');
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('keydown', onKey);
    var root = el('m-root');
    if (root) root.remove();
  }

  function sync() { if (mq.matches) mount(); else unmount(); }

  if (mq.addEventListener) mq.addEventListener('change', sync);
  else if (mq.addListener) mq.addListener(sync);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }

  window.agraxMobile = { state: S, render: render, reload: load };
})();
