/* AgraX — home page controller.
 *
 * Supplies the Claude Design home template with live figures. No number on
 * this page is hardcoded: the previous build shipped invented prices and a
 * market delta computed partly from Math.random(), which is the one thing a
 * service promising "every price as reported" cannot do. Anything unavailable
 * renders as a dash.
 */
(function () {
  'use strict';

  var api = window.agraxAPI;
  var D = window.agraxData;
  var DASH = '\u2014';

  var POPULAR = ['Avocados', 'Tomatoes', 'Romaine', 'Onions', 'Strawberries', 'Bell peppers'];

  // USDA's own four report groupings. Not an AgraX taxonomy — each maps to a
  // real report code, which is why there are four and not fifteen.
  var CATEGORY_ORDER = [
    { key: 'fruits',           name: 'Fruit' },
    { key: 'vegetables',       name: 'Vegetables' },
    { key: 'onions_potatoes',  name: 'Onions & Potatoes' },
    { key: 'nuts',             name: 'Nuts' }
  ];

  function fmt(n) { return n == null ? DASH : Number(n).toLocaleString(); }

  function stamp(dateStr) {
    if (!dateStr) return '';
    return window.agraxUtil.fmtDateLong
      ? window.agraxUtil.fmtDateLong(dateStr)
      : window.agraxUtil.fmtDate(dateStr);
  }

  /* The page renders in three passes rather than waiting on every request.
   *
   * Everything below the fold is static markup that lives in the template, so
   * blocking the first paint on four sequential API calls — one of which pages
   * ~7,000 rows server-side — meant a blank screen for as long as the slowest
   * one took. The shell paints immediately with dashes; each figure replaces
   * its dash as that request lands. A dash that resolves is fine; a blank page
   * is not.
   */
  function emptyScope() {
    var scope = {
      // Both true: the runtime renders each branch and a media query shows
      // one. See dc-runtime.js — this is no longer a JS breakpoint.
      wide: true,
      narrow: true,
      query: '',
      onQuery: function (e) { scope.query = e.target.value; },
      stamp: '',
      popular: POPULAR.map(function (n) { return { name: n }; }),
      stats: [
        { value: DASH, label: 'Commodities',        note: 'reporting today' },
        { value: DASH, label: 'Prices published',   note: 'across 12 terminals' },
        { value: DASH, label: 'Shipping districts', note: 'FOB at origin' },
        { value: DASH, label: 'Loads tracked',      note: 'latest movement report' }
      ],
      categories: CATEGORY_ORDER.map(function (c) {
        return { name: c.name, items: '', count: '' };
      }),
      terminals: [],
      // "What AgraX covers" had three more hardcoded figures. Same sources
      // as the hero stats so they cannot drift apart.
      coverCommodities: DASH,
      coverTerminals: DASH,
      coverDistricts: DASH,
      coverLoads: DASH
    };
    return scope;
  }

  var SCOPE, TPL, HOST;

  var pending = false;
  function paint() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      window.DC.mount(HOST, TPL, SCOPE);
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

    SCOPE.terminals = Object.keys(byMarket).sort().map(function (m) {
      return { name: m, count: fmt(byMarket[m]) };
    });

    SCOPE.categories = CATEGORY_ORDER.map(function (c) {
      var names = Object.keys(byCat[c.key] || {}).sort();
      return {
        name: c.name,
        items: names.slice(0, 7).join(' \u00b7 ') || DASH,
        count: names.length ? names.length + ' commodities' : DASH
      };
    });

    SCOPE.stats[0].value = fmt(Object.keys(commodities).length);
    SCOPE.coverCommodities = fmt(Object.keys(commodities).length);
    SCOPE.stats[1].value = fmt(rows.length);
    SCOPE.stats[1].note = 'across ' + SCOPE.terminals.length + ' terminals';
    SCOPE.coverTerminals = String(SCOPE.terminals.length);
    paint();
  }

  function boot() {
    var tpl = document.getElementById('page-template');
    HOST = document.getElementById('page-root');
    if (!tpl || !HOST) return;
    TPL = tpl.innerHTML;
    SCOPE = emptyScope();

    // Pass 1: paint the shell now. Nothing below waits on anything above.
    paint();

    // Pass 2: every request fires at once instead of in a chain.
    api.dates().then(function (dates) {
      var latest = dates && dates.length ? dates[0].date : null;
      if (latest) { SCOPE.stamp = stamp(latest) + ' \u00b7 prints posted'; paint(); }
    }).catch(function () {});

    api.reportLatest('terminal')
      .then(applyTerminalRows)
      .catch(function () {
        // Fall back to a single dated report if the latest-per-line view fails.
        api.dates().then(function (dates) {
          if (dates && dates.length) {
            return api.reportTerminal(dates[0].date).then(applyTerminalRows);
          }
        }).catch(function () {});
      });

    api.reportLatest('shipping_point').then(function (fobRows) {
      var d = {};
      (fobRows || []).forEach(function (r) {
        var n = r.market || r.origin;
        if (n && n !== 'National Trends') d[n] = 1;
      });
      var count = Object.keys(d).length;
      if (count) { SCOPE.stats[2].value = fmt(count); SCOPE.coverDistricts = fmt(count); paint(); }
    }).catch(function () {});

    api.movementLatest().then(function (mv) {
      /* Loads, however the report expresses them.
       *
       * Only package_count was read, but the national movement report
       * (WA_FV170) reports in units_10k and leaves package_count null — so
       * the figure came back zero and rendered as a dash even though the
       * movement table had thousands of rows. One 10k unit is 10,000 lbs;
       * a truckload is about 40,000, hence the divisor. */
      var total = 0;
      (mv && mv.rows ? mv.rows : []).forEach(function (r) {
        var c = D.num(r.package_count);
        if (c != null && c > 0) { total += c; return; }
        var u = D.num(r.units_10k);
        if (u != null && u > 0) total += (u * 10000) / 40000;
      });
      total = Math.round(total);
      if (total > 0) { SCOPE.stats[3].value = fmt(total); SCOPE.coverLoads = fmt(total); paint(); }
    }).catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
