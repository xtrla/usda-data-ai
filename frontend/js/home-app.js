/* AgraX — home page controller.
 *
 * Feeds the Claude Design home template from the live API. No figure on this
 * page is hardcoded: the design's own sample data was stripped at build time,
 * so anything not yet loaded shows a dash rather than a plausible stand-in.
 *
 * Renders in passes. The page is mostly static markup, so blocking the first
 * paint on the price request — which returns thousands of rows — meant a blank
 * screen. The shell paints immediately and each figure replaces its dash as
 * that request lands.
 */
(function () {
  'use strict';

  var api = window.agraxAPI;
  var D = window.agraxData;
  var DASH = '\u2014';
  var MID = '\u00b7';

  var POPULAR = ['Avocados', 'Tomatoes', 'Romaine', 'Onions', 'Strawberries', 'Bell peppers'];

  // USDA's own four report groupings, in the order the design lays them out.
  var CATEGORIES = [
    { key: 'fruits',          field: 'catFruit' },
    { key: 'vegetables',      field: 'catVegetables' },
    { key: 'onions_potatoes', field: 'catOnions' },
    { key: 'nuts',            field: 'catNuts' }
  ];

  // Same market order as browse: alphabetical opened on one of the smallest
  // terminals in the system.
  var MARKET_PRIORITY = [
    'New York', 'Los Angeles', 'Chicago', 'Philadelphia', 'Miami',
    'Boston', 'Atlanta', 'Dallas', 'Baltimore', 'Detroit',
    'St. Louis', 'Columbia'
  ];

  function marketRank(n) {
    var i = MARKET_PRIORITY.indexOf(n);
    return i === -1 ? MARKET_PRIORITY.length : i;
  }

  function fmt(n) { return n == null ? DASH : Number(n).toLocaleString(); }

  var SCOPE, TPL, HOST;

  function emptyScope() {
    var scope = {
      wide: true, narrow: true,
      query: '',
      onQuery: function (e) { scope.query = e.target.value; },
      onSearch: function (e) {
        e.preventDefault();
        window.location.href = '/browse?q=' + encodeURIComponent(scope.query.trim());
      },
      stamp: '',
      popular: POPULAR.map(function (n) {
        return { name: n, href: '/browse?q=' + encodeURIComponent(n === 'Bell peppers' ? 'bell' : n) };
      }),

      stats: [
        { value: DASH, label: 'Commodities',        note: 'reporting today' },
        { value: DASH, label: 'Prices published',   note: 'across terminals' },
        { value: DASH, label: 'Shipping districts', note: 'FOB at origin' },
        { value: DASH, label: 'Loads tracked',      note: 'latest movement report' }
      ],

      /* The three numbered "what AgraX covers" stages. The metric under each
       * is live, so the page never claims coverage it does not have — the
       * previous build advertised 31 shipping districts when six were
       * loading. */
      stations: [
        { n: '01', stage: 'At origin', title: 'Shipping point prices',
          body: 'See prices at origin and compare matched specifications against terminal market prices.',
          metric: DASH + ' districts reporting', cta: 'Explore price details', href: '/browse' },
        { n: '02', stage: 'At the terminal', title: 'Terminal markets',
          body: 'Wholesale produce prices across major US cities, with variety, pack, size and grade as reported.',
          metric: DASH + ' city terminals', cta: 'Find your market', href: '/browse' },
        { n: '03', stage: 'Behind the number', title: 'The detail behind the number',
          body: 'Original report dates, origins and price methods stay attached to every market line.',
          metric: 'USDA AMS, daily', cta: 'Understand the source', href: '/about' }
      ],

      terminals: [],
      catFruit: DASH, catVegetables: DASH, catOnions: DASH, catNuts: DASH,
      coverDistricts: DASH, coverTerminals: DASH
    };
    return scope;
  }

  var pending = false;
  function paint() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      window.DC.mount(HOST, TPL, SCOPE);
      // Inputs are replaced on every render, so rebind the suggestions.
      if (window.agraxSearch) window.agraxSearch.rebind();
    });
  }

  function applyTerminalRows(rows) {
    if (window.agraxSearch) {
      window.agraxSearch.attach(rows, function (hit) {
        window.location.href = '/browse?market=' + encodeURIComponent(hit.market || '') +
                               '&c=' + encodeURIComponent(hit.commodity);
      });
    }

    var byMarket = {}, commodities = {}, byCat = {};
    rows.forEach(function (r) {
      if (r.market) byMarket[r.market] = (byMarket[r.market] || 0) + 1;
      if (r.commodity) {
        commodities[r.commodity] = 1;
        var c = r.commodity_type || 'vegetables';
        (byCat[c] = byCat[c] || {})[r.commodity] = 1;
      }
    });

    SCOPE.terminals = Object.keys(byMarket)
      .sort(function (a, b) {
        return marketRank(a) - marketRank(b) || byMarket[b] - byMarket[a] || a.localeCompare(b);
      })
      .map(function (m) {
        return { name: m, lines: fmt(byMarket[m]), href: '/browse?market=' + encodeURIComponent(m) };
      });

    CATEGORIES.forEach(function (c) {
      var n = Object.keys(byCat[c.key] || {}).length;
      SCOPE[c.field] = n ? String(n) : DASH;
    });

    var nCom = Object.keys(commodities).length;
    var nTerm = SCOPE.terminals.length;
    SCOPE.stats[0].value = fmt(nCom);
    SCOPE.stats[1].value = fmt(rows.length);
    SCOPE.stats[1].note = 'across ' + nTerm + ' terminals';
    SCOPE.coverTerminals = String(nTerm);
    SCOPE.stations[1].metric = nTerm + ' city terminals';
    paint();
  }

  function boot() {
    var tpl = document.getElementById('page-template');
    HOST = document.getElementById('page-root');
    if (!tpl || !HOST) return;
    TPL = tpl.innerHTML;
    SCOPE = emptyScope();
    HOST.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.defaultPrevented && e.target.matches('[data-search-input]')) {
        SCOPE.query = e.target.value;
        SCOPE.onSearch(e);
      }
    });

    paint();   // shell first; nothing below blocks it

    api.dates().then(function (dates) {
      var latest = dates && dates.length ? dates[0].date : null;
      if (!latest) return;
      var f = window.agraxUtil.fmtDate;
      SCOPE.stamp = f(latest) + ' ' + MID + ' prints posted';
      paint();
    }).catch(function () {});

    (api.reportCurrent ? api.reportCurrent('terminal') : api.reportLatest('terminal'))
      .then(applyTerminalRows)
      .catch(function () {
        api.reportLatest('terminal').then(applyTerminalRows).catch(function () {});
      });

    api.reportLatest('shipping_point').then(function (fobRows) {
      var d = {};
      (fobRows || []).forEach(function (r) {
        var n = r.market || r.origin;
        if (n && n !== 'National Trends') d[n] = 1;
      });
      var count = Object.keys(d).length;
      if (!count) return;
      SCOPE.stats[2].value = fmt(count);
      SCOPE.coverDistricts = String(count);
      SCOPE.stations[0].metric = count + ' districts reporting';
      paint();
    }).catch(function () {});

    api.movementLatest().then(function (mv) {
      // package_count is null on the national report, which reports in
      // units_10k. Reading only the first left this as a dash while the
      // movement table held thousands of rows.
      var total = 0;
      (mv && mv.rows ? mv.rows : []).forEach(function (r) {
        var c = D.num(r.package_count);
        if (c != null && c > 0) { total += c; return; }
        var u = D.num(r.units_10k);
        if (u != null && u > 0) total += (u * 10000) / 40000;
      });
      total = Math.round(total);
      if (total > 0) { SCOPE.stats[3].value = fmt(total); paint(); }
    }).catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
