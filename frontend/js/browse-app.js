/* AgraX — browse controller.
 *
 * Drives the Claude Design browse template: market strip, overview, filters,
 * commodity table with inline price rows, and the commodity detail view with
 * movement, history and cross-terminal comparison.
 *
 * Two rules run through the whole file:
 *   1. A published price is identified by what it is, never by its position
 *      in a sorted array. The table and the detail view sort differently, so
 *      index-based selection opened the wrong row.
 *   2. Anything not traceable to a USDA report renders as a dash. That covers
 *      an unmatched FOB, a commodity with no movement, and a price with no
 *      prior print to compare against.
 */
(function () {
  'use strict';

  var api = window.agraxAPI;
  var U = window.agraxUtil;
  var D = window.agraxData;
  var DASH = '\u2014';
  var MID = '\u00b7';

  // USDA's own report codes per market. Each chip links to a real document.
  var REPORT_GROUPS = [
    { key: 'fruits',          name: 'Fruit',             suffix: '_FV010' },
    { key: 'vegetables',      name: 'Vegetables',        suffix: '_FV020' },
    { key: 'onions_potatoes', name: 'Onions & Potatoes', suffix: '_FV030' },
    { key: 'nuts',            name: 'Nuts',              suffix: '_FV040' }
  ];

  var S = {
    loading: true,
    loadError: false,
    rows: [],            // all terminal prices, latest per line
    fobRows: [],         // shipping point prices
    market: null,
    markets: [],
    terminalsStatus: "Loading other terminals…",
    terminalsError: false,
    filters: { category: {}, origin: {}, source: {} },
    tableQuery: '',
    sort: 'prices',
    expanded: {},        // commodity -> bool
    openPrice: {},       // commodity -> rowKey of the open price row
    detail: null,        // commodity name when in detail mode
    overviewOpen: true,
    page: 0,
    pageSize: window.matchMedia('(max-width: 767px)').matches ? 50 : 10,
    movementCache: {},
    showOlder: false,
    sheetOpen: false,
    skuSort: null,
    skuSortDir: 1,
    historyCache: {}
  };

  var PAGE_ROOT, TEMPLATE;

  function syncLocation() {
    if (!S.market) return;
    var params = new URLSearchParams();
    params.set('market', S.market);
    if (S.detail) {
      params.set('c', S.detail);
      var existing = new URLSearchParams(window.location.search);
      ['quote_variety','quote_origin'].forEach(function (key) {
        if (existing.has(key)) params.set(key, existing.get(key));
      });
    }
    if (S.tableQuery) params.set('q', S.tableQuery);
    ['category', 'origin', 'source'].forEach(function (group) {
      activeKeys(group).forEach(function (value) { params.append(group, value); });
    });
    if (S.showOlder) params.set('older', '1');
    window.history.replaceState(null, '', window.location.pathname + '?' + params.toString() + window.location.hash);
  }

  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  function marketRows() {
    return S.rows.filter(function (r) { return r.market === S.market; });
  }

  function marketCode(market) {
    // Derived from the report codes already present in the data rather than
    // a hardcoded table, so a market we add later needs no code change.
    var r = S.rows.filter(function (x) { return x.market === market && x.source_report; })[0];
    return r ? String(r.source_report).split('_')[0] : '';
  }

  /* ── FILTERING ── */

  function activeKeys(group) {
    return Object.keys(S.filters[group]).filter(function (k) { return S.filters[group][k]; });
  }

  /* Prices published in this market's latest report.
   *
   * A USDA terminal report is a document with a date on it, so that is the
   * unit shown by default. A line that did not print today has not been
   * repriced; putting last Thursday's number in its place would assert
   * something USDA did not publish. Those lines are still available, dated,
   * behind the "older prints" toggle. */
  function currentRows() {
    var rows = marketRows();
    var hasFlag = rows.some(function (r) { return r.is_current !== undefined; });
    if (!hasFlag) return rows;          // older API shape: show everything
    return S.showOlder ? rows : rows.filter(function (r) { return r.is_current; });
  }

  function olderCount() {
    return marketRows().filter(function (r) { return r.is_current === false; }).length;
  }

  function filteredRows() {
    var rows = currentRows();
    var cats = activeKeys('category');
    var origins = activeKeys('origin');
    var sources = activeKeys('source');

    if (cats.length) {
      rows = rows.filter(function (r) { return cats.indexOf(r.commodity_type) > -1; });
    }
    if (origins.length) {
      rows = rows.filter(function (r) { return origins.indexOf(window.agraxCountryOf(r.origin)) > -1; });
    }
    if (sources.length) {
      rows = rows.filter(function (r) { return sources.indexOf(D.priceOf(r).src) > -1; });
    }
    if (S.tableQuery) {
      var q = norm(S.tableQuery);
      rows = rows.filter(function (r) {
        return norm(r.commodity).indexOf(q) > -1 ||
               norm(r.variety).indexOf(q) > -1 ||
               norm(r.properties).indexOf(q) > -1 ||
               norm(r.notes).indexOf(q) > -1 ||
               norm(r.package).indexOf(q) > -1 ||
               norm(r.origin).indexOf(q) > -1;
      });
    }
    return rows;
  }

  function sortCommodities(list) {
    if (S.sort === 'az') {
      return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    if (S.sort === 'tone') {
      var rank = function (c) { return c.up ? 0 : c.down ? 1 : 2; };
      return list.sort(function (a, b) { return rank(a) - rank(b) || b.skuCount - a.skuCount; });
    }
    // Default: most-traded first, so the top of a 118-row list is the stuff
    // people actually buy rather than whatever starts with A.
    return list.sort(function (a, b) { return b.skuCount - a.skuCount || a.name.localeCompare(b.name); });
  }

  /* ── SCOPE ── */

  function buildFilterGroups() {
    var rows = currentRows();
    function counts(fn) {
      var m = {};
      rows.forEach(function (r) { var k = fn(r); if (k) m[k] = (m[k] || 0) + 1; });
      return m;
    }

    var catNames = { fruits: 'Fruits', vegetables: 'Vegetables',
                     onions_potatoes: 'Onions & Potatoes', nuts: 'Nuts' };
    var catCounts = counts(function (r) { return r.commodity_type; });
    var originCounts = counts(function (r) { return window.agraxCountryOf(r.origin); });
    var srcCounts = counts(function (r) { return D.priceOf(r).src; });

    function opt(group, key, label, count, extra) {
      var o = {
        name: label, label: label, count: String(count),
        filterKind: group, filterKey: key,
        on: !!S.filters[group][key], active: !!S.filters[group][key],
        chipBg: S.filters[group][key] ? '#1F5236' : '#F5F6F2',
        chipFg: S.filters[group][key] ? '#FFFFFF' : '#4A5742',
        chipBd: S.filters[group][key] ? '#1F5236' : '#DCE3D6',
        onToggle: function () {
          S.filters[group][key] = !S.filters[group][key];
          S.page = 0;
          rerender();
        }
      };
      return Object.assign(o, extra || {});
    }

    var groups = [];

    groups.push({
      title: 'Category',
      dirty: activeKeys('category').length > 0,
      onClear: function () { S.filters.category = {}; S.page = 0; rerender(); },
      options: Object.keys(catNames)
        .filter(function (k) { return catCounts[k]; })
        .map(function (k) { return opt('category', k, catNames[k], catCounts[k]); })
    });

    groups.push({
      title: 'Country of origin',
      dirty: activeKeys('origin').length > 0,
      onClear: function () { S.filters.origin = {}; S.page = 0; rerender(); },
      options: Object.keys(originCounts)
        .sort(function (a, b) { return a === 'Not specified' ? 1 : b === 'Not specified' ? -1 : a.localeCompare(b); })
        .map(function (k) { return opt('origin', k, k, originCounts[k]); })
    });

    groups.push({
      title: 'Price source',
      dirty: activeKeys('source').length > 0,
      onClear: function () { S.filters.source = {}; S.page = 0; rerender(); },
      options: ['mostly', 'mid-range', 'reported']
        .filter(function (k) { return srcCounts[k]; })
        .map(function (k) {
          return opt('source', k, k, srcCounts[k], {
            dotMostly: k === 'mostly',
            dotMid: k === 'mid-range',
            dotReported: k === 'reported'
          });
        })
    });

    return groups;
  }

  /* The newest report date present in a set of rows.
   *
   * /reports/latest returns the newest row PER PUBLISHED LINE across a 90-day
   * window, so the rows arrive in no particular date order and rows[0] is
   * whichever line happened to sort first. Reading the header date off it
   * showed Sep 4 while the table actually held prices through Sep 14 — the
   * data was current and the page said otherwise, which is the worst way for
   * this to fail. */
  function latestDateIn(rows) {
    var max = null;
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].report_date;
      if (d && (max === null || d > max)) max = d;
    }
    return max;
  }

  /* How many lines are older than that newest date. A price from last Thursday
   * is still a real price, but the reader has to be able to see it is one. */
  function staleCount(rows, latest) {
    if (!latest) return 0;
    return rows.filter(function (r) {
      return r.report_date && r.report_date !== latest;
    }).length;
  }

  function buildOverview() {
    var rows = marketRows();
    var coms = {};
    var districts = {};
    rows.forEach(function (r) {
      if (r.commodity) coms[r.commodity] = 1;
    });
    S.fobRows.forEach(function (r) {
      var n = r.market || r.origin;
      if (n && n !== 'National Trends') districts[n] = 1;
    });
    var date = (rows[0] && rows[0].market_date) || latestDateIn(rows);
    var older = olderCount();

    return {
      title: (S.market || '') + ' terminal',
      subtitle: rows.length + ' prices reporting across ' + Object.keys(coms).length +
                ' commodities ' + MID + ' USDA AMS terminal market report',
      skusTxt: String(rows.length),
      commoditiesTxt: String(Object.keys(coms).length),
      districtsTxt: String(Object.keys(districts).length),
      dateTxt: date ? U.fmtDate(date) : DASH,
      // Weather is printed in the USDA report header. We do not capture it
      // yet, so it shows as unavailable rather than as a plausible number.
      tempNow: DASH,
      tempRange: DASH,
      precip: 'Not captured',
      staleTxt: older ? older + ' older' : '',
      collapsedMeta: [rows.length + ' prices', Object.keys(coms).length + ' commodities',
                      date ? U.fmtDate(date) : null,
                      older ? older + ' older prints' : null].filter(Boolean).join('  ' + MID + '  ')
    };
  }

  function buildMarketTone() {
    var groups = {};
    currentRows().forEach(function (r) {
      if (r.commodity) (groups[r.commodity] = groups[r.commodity] || []).push(r);
    });
    var count = { higher: 0, steady: 0, lower: 0, other: 0 };
    Object.keys(groups).forEach(function (name) {
      var text = groups[name].map(function (r) { return norm(r.movement || r.trend); }).join(' ');
      var higher = /\bhigher\b|\bup\b/.test(text);
      var lower = /\blower\b|\bdown\b/.test(text);
      if (higher && lower) count.other++;
      else if (higher) count.higher++;
      else if (lower) count.lower++;
      else if (/\bsteady\b|\bunchanged\b/.test(text)) count.steady++;
      else count.other++;
    });
    var total = Object.keys(groups).length;
    return { higher: count.higher, steady: count.steady, lower: count.lower,
      other: count.other, hasOther: count.other > 0,
      segments: [['higher', '#267f78'], ['steady', '#b9c1b2'], ['lower', '#b86c4c'], ['other', '#e5e9e0']].map(function (pair) {
        return { color: pair[1], width: total ? (count[pair[0]] / total * 100) + '%' : '0%' };
      }),
      description: count.higher + ' higher, ' + count.steady + ' steady, ' + count.lower + ' lower, ' + count.other + ' mixed or not reported'
    };
  }

  function buildReports() {
    var rows = marketRows();
    return REPORT_GROUPS.map(function (g) {
      var group = rows.filter(function (r) { return r.commodity_type === g.key; });
      var date = group.map(function (r) { return r.report_date; }).filter(Boolean).sort().pop();
      return {
        name: g.name,
        href: '/reports/?market=' + encodeURIComponent(S.market) + '&category=' + g.key + '&date=' + encodeURIComponent(date || ''),
        dateTxt: date ? U.fmtDate(date) : DASH
      };
    }).filter(function (r) { return r.dateTxt !== DASH; });
  }

  /* Market order.
   *
   * Alphabetical put Asheville first, which is one of the smallest terminals
   * in the system — a buyer opening the page met the market least likely to
   * be theirs. This is the rough order of volume and of how often these
   * markets get quoted in the trade, with anything not listed following by
   * price count so a new terminal still lands somewhere sensible.
   */
  var MARKET_PRIORITY = [
    'New York', 'Los Angeles', 'Chicago', 'Philadelphia', 'Miami',
    'Boston', 'Atlanta', 'Dallas', 'Baltimore', 'Detroit',
    'St. Louis', 'Columbia'
  ];

  function marketRank(name) {
    var i = MARKET_PRIORITY.indexOf(name);
    return i === -1 ? MARKET_PRIORITY.length : i;
  }

  function buildTerminals() {
    var byMarket = {};
    S.rows.forEach(function (r) {
      if (!r.market) return;
      if (!byMarket[r.market]) byMarket[r.market] = [];
      byMarket[r.market].push(r);
    });
    return Object.keys(byMarket).sort(function (a, b) {
      return marketRank(a) - marketRank(b)
          || byMarket[b].length - byMarket[a].length
          || a.localeCompare(b);
    }).map(function (m) {
      var list = byMarket[m];
      var up = 0, down = 0;
      list.forEach(function (r) {
        var mv = norm(r.movement || r.trend);
        if (mv.indexOf('higher') > -1) up++;
        else if (mv.indexOf('lower') > -1) down++;
      });
      var tone = up > down ? 'up' : down > up ? 'down' : 'flat';
      var chip = D.toneChip(tone);
      return {
        name: m,
        skuCount: String(list.length),
        // A tone word, never a single blended price. One number for a whole
        // market would be an average across 180 commodities.
        toneTxt: chip.label,
        selectionTxt: m === S.market ? 'Selected' : chip.label,
        up: chip.up, down: chip.down, flat: chip.flat,
        chipDot: chip.chipFg, color: chip.chipFg,
        active: m === S.market,
        activeFlag: m === S.market ? 'true' : '',
        onSelect: function () {
          S.market = m; S.detail = null; S.page = 0;
          scrollToTop();
          S.expanded = {}; S.openPrice = {};
          rerender();
        }
      };
    });
  }

  function buildCommodityRows() {
    var rows = filteredRows();
    var fob = D.fobIndex(S.fobRows);
    var list = sortCommodities(D.commodityRows(rows));
    var start = S.page * S.pageSize;
    var page = list.slice(start, start + S.pageSize);

    return {
      total: list.length,
      rows: page.map(function (c) {
        return Object.assign({}, c, {
          expanded: false,
          collapsed: true,
          active: S.detail === c.name,
          skus: [],
          moreTxt: c.skuCount > 8 ? (c.skuCount - 8) + ' more prices in the full report' : '',
          skusTxt: String(c.skuCount),
          onToggle: function () { S.detail = c.name; rerender(); },
          onSelect: function () { S.detail = c.name; rerender(); },
          onDetails: function () { S.detail = c.name; rerender(); }
        });
      })
    };
  }

  /* Sorting the price table.
   *
   * Text columns sort alphabetically, price columns numerically — sorting
   * "$9.00" and "$44.75" as strings would put the smaller second. Rows with
   * no value for the active column sort last either way, so an unmatched FOB
   * never displaces a real one.
   */
  var SKU_SORTERS = {
    variety:  function (a, b) { return String(a.variety || '').localeCompare(String(b.variety || '')); },
    origin:   function (a, b) { return String(a.origin || '').localeCompare(String(b.origin || '')); },
    pack:     function (a, b) { return String(a.pack || '').localeCompare(String(b.pack || '')); },
    size:     function (a, b) { return String(a.size || '').localeCompare(String(b.size || ''), undefined, { numeric: true }); },
    quality:  function (a, b) { return String(a.quality || '').localeCompare(String(b.quality || '')); },
    fob:      function (a, b) { return numCmp(a.fobValue, b.fobValue); },
    terminal: function (a, b) { return numCmp(a.termValue, b.termValue); },
    spread:   function (a, b) {
      var sa = (a.fobValue != null && a.termValue != null) ? a.termValue - a.fobValue : null;
      var sb = (b.fobValue != null && b.termValue != null) ? b.termValue - b.fobValue : null;
      return numCmp(sa, sb);
    }
  };

  function numCmp(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;            // missing values sort last
    if (b == null) return -1;
    return a - b;
  }

  function sortSkus(list) {
    if (!S.skuSort || !SKU_SORTERS[S.skuSort]) return list;
    var cmp = SKU_SORTERS[S.skuSort];
    return list.slice().sort(function (a, b) { return cmp(a, b) * S.skuSortDir; });
  }

  function buildSortHandlers() {
    var by = {}, mark = {};
    Object.keys(SKU_SORTERS).forEach(function (k) {
      by[k] = function () {
        // Same column again reverses; a new column starts ascending.
        if (S.skuSort === k) S.skuSortDir = -S.skuSortDir;
        else { S.skuSort = k; S.skuSortDir = 1; }
        rerender();
      };
      mark[k] = S.skuSort === k ? (S.skuSortDir === 1 ? '\u2191' : '\u2193') : '';
    });
    return { by: by, mark: mark };
  }

  /* Cross-terminal and history for one open price row. */
  function attachDetail(s, c) {
    s.terminals = D.acrossTerminals(S.rows, s.raw, S.market);
    s.marketSpreadTxt = D.spreadAcross(s.terminals);
    s.history = S.historyCache[s.key] || [];
    s.chartLowTxt = s.history.length ? s.history[s.history.length - 1].date : '';
    s.chartHighTxt = s.history.length ? s.history[0].date : '';
    // These read "10 prints", "6 earlier prints" and "5 of 12" in the export.
    // Real counts, and empty rather than a guess when history has not loaded.
    s.printsTxt = s.history.length ? s.history.length + ' prints' : '';
    var shown = Math.min(s.history.length, 4);
    s.earlierTxt = s.history.length > shown
      ? (s.history.length - shown) + ' earlier prints' : '';
    s.terminalsTxt = s.terminals.length
      ? s.terminals.length + ' of ' + S.markets.length : '';
    s.termPts = '';
    s.fobPts = '';

    if (!S.historyCache[s.key]) {
      api.history({quote_id: s.raw.row_hash, days: 365}).then(function (hist) {
        S.historyCache[s.key] = D.history(hist.observations, []);
        rerender();
      }).catch(function () { S.historyCache[s.key] = []; });
    }
  }

  function buildDetail() {
    if (!S.detail) return null;
    var rows = filteredRows().filter(function (r) { return r.commodity === S.detail; });
    if (!rows.length) return null;

    var fob = D.fobIndex(S.fobRows);
    var origins = [];
    rows.forEach(function (r) {
      if (r.origin && origins.indexOf(r.origin) === -1) origins.push(r.origin);
    });
    var chip = D.toneChip((function () {
      var mv = norm(rows[0].movement || rows[0].trend);
      return mv.indexOf('higher') > -1 ? 'up' : mv.indexOf('lower') > -1 ? 'down' : 'flat';
    })());

    var skus = sortSkus(D.skuRows(rows, fob));
    var prices = skus.map(function (s) { return s.termValue; })
                     .filter(function (p) { return p != null; });

    return {
      name: S.detail,
      category: rows[0].commodity_type === 'fruits' ? 'Fruits'
              : rows[0].commodity_type === 'vegetables' ? 'Vegetables'
              : rows[0].commodity_type === 'nuts' ? 'Nuts' : 'Onions & Potatoes',
      subtitle: rows.length + ' prices reporting ' + MID + ' ' +
                origins.slice(0, 3).join(' ' + MID + ' ') + ' ' + MID + ' ' +
                S.market + ' terminal, ' + (latestDateIn(rows) ? U.fmtDate(latestDateIn(rows)) : DASH),
      reportingTxt: rows.length + ' prices reporting',
      skuCountTxt: skus.length + ' of ' + rows.length + ' shown',
      origins: origins.join(' ' + MID + ' '),
      skuSpreadTxt: prices.length > 1
        ? (Math.max.apply(null, prices) - Math.min.apply(null, prices)).toFixed(2) : DASH,
      up: chip.up, down: chip.down, flat: chip.flat,
      moreTxt: '',
      skus: skus
    };
  }

  /* ── RENDER ── */

  function buildScope() {
    var table = buildCommodityRows();
    var detail = null;
    var pageCount = Math.max(1, Math.ceil(table.total / S.pageSize));

    var sorters = buildSortHandlers();
    var scope = {
      sortBy: sorters.by,
      sortMark: sorters.mark,
      // Both true: the runtime renders each branch and a media query shows
      // one. See dc-runtime.js — this is no longer a JS breakpoint.
      wide: true,
      narrow: true,

      /* The nav stamp. This was a second hardcoded date, separate from the
       * overview one — fixing the header alone left the top of the page still
       * reading Sep 4. Derived from the same rows so the two can never
       * disagree again. */
      stamp: (function () {
        var d = latestDateIn(S.rows);
        return d ? U.fmtDate(d) + ' ' + MID + ' prints posted' : '';
      })(),

      terminal: S.market,
      terminalShort: S.market,
      terminals: buildTerminals(),
      terminalsStatus: S.terminalsStatus,
      terminalsError: S.terminalsError,
      onRetryTerminals: function () { if (S.reloadMarkets) S.reloadMarkets(); },


      overview: buildOverview(),
      marketTone: buildMarketTone(),
      overviewOpen: S.overviewOpen,
      overviewClosed: !S.overviewOpen,
      overviewToggleTxt: S.overviewOpen ? 'Hide market overview' : 'Show market overview',
      onToggleOverview: function () { S.overviewOpen = !S.overviewOpen; rerender(); },

      reports: buildReports(),
      filterGroups: buildFilterGroups(),
      filterSummary: (function () {
        var all = activeKeys('category').concat(activeKeys('origin')).concat(activeKeys('source'));
        return all.length ? all.join(' ' + MID + ' ') : 'All categories and countries';
      })(),
      onClearAll: function () {
        S.filters = { category: {}, origin: {}, source: {} };
        S.page = 0; rerender();
      },

      browseMode: true,
      detailMode: false,
      commodity: detail,
      movement: detail ? (S.movementCache[S.detail] || { has: false, none: true,
                          emptyTxt: 'Loading movement\u2026', rows: [] }) : { has: false, none: true, rows: [] },

      rows: table.rows,
      skuRows: detail ? detail.skus : [],
      // Name the report being shown. Without this a composite of several
      // dates is indistinguishable from one day's document.
      olderCount: olderCount(),
      showOlder: S.showOlder,
      olderTxt: (function () {
        var n = olderCount();
        if (!n) return '';
        return S.showOlder
          ? 'Showing ' + n + ' line(s) that last printed earlier'
          : n + ' line(s) have not printed since this report';
      })(),
      olderToggleTxt: S.showOlder ? 'Hide' : 'Show',
      onToggleOlder: function () { S.showOlder = !S.showOlder; S.page = 0; rerender(); },

      rowCountTxt: table.total
        ? (S.page * S.pageSize + 1) + '-' + Math.min((S.page + 1) * S.pageSize, table.total) +
          ' of ' + table.total
        : '0 of 0',
      empty: table.total === 0,

      pageTxt: (S.page + 1) + ' / ' + pageCount,
      hasPrev: S.page > 0,
      hasNext: (S.page + 1) * S.pageSize < table.total,
      onPrev: function () { if (S.page > 0) { S.page--; rerender(); } },
      onNext: function () { if ((S.page + 1) * S.pageSize < table.total) { S.page++; rerender(); } },

      tableQuery: S.tableQuery,
      onTableQuery: function (e) { S.tableQuery = e.target.value; S.page = 0; rerender(); },
      query: '',
      onQuery: function () {},

      sortOptions: [
        { label: 'Prices',       active: S.sort === 'prices', onSelect: function () { S.sort = 'prices'; rerender(); } },
        { label: 'A\u2013Z',     active: S.sort === 'az',     onSelect: function () { S.sort = 'az'; rerender(); } },
        { label: 'Market tone',  active: S.sort === 'tone',   onSelect: function () { S.sort = 'tone'; rerender(); } }
      ],

      detailCrumb: detail ? detail.name + ' ' + MID + ' ' + detail.skus.length + ' prices' : '',
      backTxt: 'All commodities',
      onBackToTable: function () { S.detail = null; scrollToTop(); rerender(); },

      siblings: (function () {
        if (!S.detail) return [];
        return sortCommodities(D.commodityRows(filteredRows())).slice(0, 12).map(function (c) {
          return {
            name: c.name, skusTxt: c.skusTxt, active: c.name === S.detail,
            up: c.up, down: c.down, flat: c.flat,
            onSelect: function () { S.detail = c.name; rerender(); }
          };
        });
      })(),
      siblingMeta: (function () {
        var all = activeKeys('category').concat(activeKeys('origin'));
        return (all.length ? all.join(' ' + MID + ' ') : 'All categories') + ' ' + MID + ' ' +
               D.commodityRows(filteredRows()).length + ' commodities';
      })(),

      shareTxt: 'Share',
      onShare: function () {
        if (window.navigator && window.navigator.clipboard) navigator.clipboard.writeText(window.location.href);
      },

      /* Mobile is a separate layout from the design, not a squeezed desktop.
       * It shares rows, terminals, movement and filterGroups — only these few
       * strings and the filter sheet differ, so there is one data path and no
       * chance of the two layouts disagreeing about what the prices are. */
      mSheetOpen: S.sheetOpen,
      onOpenSheet: function () { S.sheetOpen = true; rerender(); },
      onCloseSheet: function () { S.sheetOpen = false; rerender(); },
      mSheetApplyTxt: 'Show ' + table.total + ' ' +
                      (table.total === 1 ? 'commodity' : 'commodities'),
      mSummaryTxt: (function () {
        var o = buildOverview();
        return [S.market ? S.market + ' terminal' : '', o.dateTxt,
                o.commoditiesTxt + ' commodities', o.skusTxt + ' prices']
               .filter(Boolean).join('  ' + MID + '  ');
      })(),
      mDetailSubTxt: detail
        ? detail.skus.length + ' prices ' + MID + ' ' + S.market
        : '',

      /* The mobile overview grid. Same figures as the desktop stat row, in
       * the two-column form the design uses on a phone. Weather comes from
       * the USDA report header, which we do not capture yet, so it shows as
       * unavailable rather than as an invented temperature. */
      mStats: (function () {
        var o = buildOverview();
        return [
          { label: 'Report date',     value: o.dateTxt },
          { label: 'Commodities',     value: o.commoditiesTxt },
          { label: 'Prices reporting', value: o.skusTxt },
          { label: 'Shipping points', value: o.districtsTxt },
          { label: 'Weather 7am',     value: o.tempNow },
          { label: 'Precip',          value: o.precip }
        ];
      })(),

      mTabs: []
    };


    return scope;
  }

  function loadMovement(commodity, detail) {
    var origins = detail ? detail.origins.split(' ' + MID + ' ') : [];
    api.movementForCommodity(commodity, 30).then(function (rows) {
      S.movementCache[commodity] = D.movement(rows, origins);
      rerender();
    }).catch(function () {
      S.movementCache[commodity] = D.movement([], origins);
      rerender();
    });
  }

  /* Where the view should be after the next paint.
   *
   * The table and the detail view are the same page re-rendered, not separate
   * documents, so the browser keeps the scroll position on every change. Open
   * a commodity from halfway down the list and you land halfway down its
   * detail view, below the header and the movement band. A real navigation
   * would have put you at the top, so it has to be done explicitly.
   *
   * Only view changes scroll. Filtering, sorting, paging and expanding a row
   * all leave the position alone — moving the page under someone who just
   * ticked a checkbox is its own kind of broken. */
  var scrollNext = null;

  function scrollToTop() { scrollNext = 'top'; }

  /* Keep the market strip where the reader left it.
   *
   * The strip is rebuilt on every render, so its horizontal scroll resets to
   * zero. Selecting a market near the end of the list threw the strip back to
   * the start, and the pill you had just tapped scrolled out of sight — the
   * selection looked like it had landed on whichever market happened to be
   * first. Restore the position, then make sure the active pill is visible.
   */
  // Use coordinates relative to the scroll container. offsetTop/Left may
  // be relative to the page and can scroll the selected row under the header.
  function restoreStrips() {
    document.querySelectorAll('[data-market-strip]').forEach(function (strip) {
      if (!strip.clientWidth) return;
      if (stripScrollLeft != null) strip.scrollLeft = stripScrollLeft;
      var pill = strip.querySelector('[data-active-pill="true"]');
      if (!pill) return;
      var bounds = strip.getBoundingClientRect(), item = pill.getBoundingClientRect();
      if (stripMarket !== S.market || item.left < bounds.left || item.right > bounds.right) {
        strip.scrollLeft += item.left - bounds.left - (strip.clientWidth - item.width) / 2;
      }
      stripMarket = S.market;
    });
  }
  var stripScrollLeft = null, stripMarket = null;

  function restoreRail() {
    var rail = document.querySelector('[data-market-rail]');
    if (!rail || !rail.clientHeight) return;
    if (railScrollTop != null) rail.scrollTop = railScrollTop;
    var row = rail.querySelector('[data-active-pill="true"]');
    if (!row) return;
    var bounds = rail.getBoundingClientRect(), item = row.getBoundingClientRect();
    if (railMarket !== S.market || item.top < bounds.top || item.bottom > bounds.bottom) {
      rail.scrollTop += item.top - bounds.top - (rail.clientHeight - item.height) / 2;
    }
    railMarket = S.market;
  }
  var railScrollTop = null, railMarket = null;

  window.addEventListener('resize', function () {
    requestAnimationFrame(function () { restoreStrips(); restoreRail(); });
  });

  function captureStrips() {
    var strip = document.querySelector('[data-market-strip]');
    if (strip) stripScrollLeft = strip.scrollLeft;
    var rail = document.querySelector('[data-market-rail]');
    if (rail) railScrollTop = rail.scrollTop;
  }

  function applyScroll() {
    if (!scrollNext) return;
    var target = scrollNext;
    scrollNext = null;
    if (target === 'top') {
      // 'auto' rather than 'smooth': this is a navigation, and animating it
      // means reading the old view scroll past on the way.
      window.scrollTo({ top: 0, behavior: 'auto' });
      // The detail pane can be its own scroll container on narrow screens.
      var pane = document.querySelector('[data-scroll-pane]');
      if (pane) pane.scrollTop = 0;
    }
  }

  var pending = false;
  function rerender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      if (S.loading || S.loadError) {
        PAGE_ROOT.setAttribute('aria-busy', String(S.loading));
        PAGE_ROOT.innerHTML = '<div class="browse-load-state" role="status">' +
          (S.loadError ? '<p>Prices could not load.</p><button type="button" id="retry-prices">Try again</button>' : '<span class="browse-spinner" aria-hidden="true"></span><span>Loading prices</span>') + '</div>';
        var retry = document.getElementById('retry-prices');
        if (retry) retry.onclick = function () { window.location.reload(); };
        return;
      }
      PAGE_ROOT.setAttribute('aria-busy', 'false');
      syncLocation();
      captureStrips();
      window.DC.mount(PAGE_ROOT, TEMPLATE, buildScope());
      if (window.agraxAccountUI) window.agraxAccountUI.mount();
      window.agraxCommodityDialog.render(S.detail, currentRows(), S.market, function () {
        S.detail = null; syncLocation();
      });
      restoreStrips();
      restoreRail();
      applyScroll();
      // Inputs are replaced on every render, so rebind afterwards.
      if (window.agraxSearch) window.agraxSearch.rebind();
    });
  }

  /* Prices are the page, so they are fetched first and painted the moment
   * they land. Shipping-point FOB arrives separately and only adds the FOB
   * and Spread columns — waiting for it before showing any price would hold
   * the whole table hostage to a secondary request. Until it lands those two
   * columns read as dashes, which is what they already do for any pack with
   * no matching origin price. */
  function boot() {
    var tpl = document.getElementById('page-template');
    PAGE_ROOT = document.getElementById('page-root');
    if (!tpl || !PAGE_ROOT) return;
    TEMPLATE = tpl.innerHTML;
    PAGE_ROOT.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.defaultPrevented && e.target.matches('[data-search-input]')) {
        e.preventDefault();
        S.tableQuery = e.target.value.trim();
        S.detail = null;
        S.page = 0;
        rerender();
      }
    });

    var params = new URLSearchParams(window.location.search);
    var wanted = params.get('market');
    if (params.get('c')) S.detail = params.get('c');
    S.tableQuery = params.get('q') || '';
    S.showOlder = params.get('older') === '1';
    ['category', 'origin', 'source'].forEach(function (group) {
      params.getAll(group).forEach(function (value) {
        if (group !== 'category' || REPORT_GROUPS.some(function (g) { return g.key === value; })) {
          S.filters[group][group === 'origin' ? window.agraxCountryOf(value) : value] = true;
        }
      });
    });

    function setMarkets() {
      var markets = {};
      S.rows.forEach(function (r) { if (r.market) markets[r.market] = 1; });
      S.markets = Object.keys(markets).sort();
      if (!S.market) S.market = window.agraxAccount
        ? window.agraxAccount.initialMarket(S.markets, wanted)
        : (wanted && markets[wanted]) ? wanted : (markets['New York'] ? 'New York' : S.markets[0]);
    }

    // Loading is distinct from a genuinely empty report.
    rerender();

    var firstMarket = wanted || (window.agraxAccount && window.agraxAccount.preferredMarket()) || 'New York';
    var savedMarketKey = 'agrax-market-v1:' + api.base + ':' + firstMarket;
    var showingSaved = false;
    try {
      var savedMarket = JSON.parse(sessionStorage.getItem(savedMarketKey) || 'null');
      if (savedMarket && Date.now() - savedMarket.time < 300000 && Array.isArray(savedMarket.rows) && savedMarket.rows.length) {
        S.rows = savedMarket.rows; S.loading = false; showingSaved = true;
        setMarkets(); rerender();
      }
    } catch (_) { /* Storage is optional. */ }
    var pricesReady = api.reportCurrent('terminal', 90, firstMarket);
    pricesReady.then(function (rows) {
      S.loading = false;
      S.rows = rows || [];
      try { sessionStorage.setItem(savedMarketKey, JSON.stringify({time:Date.now(), rows:S.rows})); } catch (_) {}
      setMarkets();
      if (window.agraxSearch) {
        window.agraxSearch.attach(S.rows, function (hit) {
          // Every suggestion resolves to a real commodity page. Switch market
          // too when the match lives in a different one.
          if (hit.market && hit.market !== S.market) S.market = hit.market;
          S.filters = { category: {}, origin: {}, source: {} };
          S.tableQuery = '';
          S.page = 0;
          S.detail = hit.commodity;
          scrollToTop();
          rerender();
        });
      }
      rerender();
    }).catch(function () {
      // A global-date fallback can silently omit markets that last printed
      // on another date. Offer a retry instead of showing incomplete data.
      S.loading = false;
      S.loadError = !showingSaved;
      if (showingSaved) S.terminalsStatus = 'Showing saved prices. Refresh to check for updates.';
      rerender();
    });

    // Load the other terminals after a successful first paint, not only on error.
    S.reloadMarkets = function () {
      S.terminalsStatus = 'Loading other terminals…'; S.terminalsError = false;
      rerender();
      return api.reportCurrent('terminal').then(function (allRows) {
        if (!allRows || !allRows.length) throw new Error('Empty terminal directory');
        S.rows = allRows;
        setMarkets();
        S.terminalsStatus = S.markets.length + ' terminals available';
        S.terminalsError = false;
        if (window.agraxSearch) window.agraxSearch.attach(S.rows, function (hit) {
          if (hit.market) S.market = hit.market;
          S.filters = { category: {}, origin: {}, source: {} };
          S.tableQuery = ''; S.page = 0; S.detail = hit.commodity;
          scrollToTop(); rerender();
        });
        rerender();
      }).catch(function () {
        S.terminalsStatus = 'Other terminals could not load.';
        S.terminalsError = true;
        rerender();
      });
    };
    pricesReady.then(function () { return S.reloadMarkets(); }).catch(function () {});

    // Secondary data starts after terminal prices arrive.
    pricesReady.then(function () { return api.reportLatest('shipping_point'); }).then(function (rows) {
      S.fobRows = rows || [];
      rerender();
    }).catch(function () { S.fobRows = []; });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
