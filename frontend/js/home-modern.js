(function () {
  'use strict';

  var api = window.agraxAPI;
  var D = window.agraxData;
  var U = window.agraxUtil;
  var state = { terminal: [], fob: [], dates: [], market: '' };

  function $ (selector) { return document.querySelector(selector); }
  function esc(value) { var el = document.createElement('span'); el.textContent = value == null ? '' : String(value); return el.innerHTML; }
  function money(value) { return value == null ? '—' : '$' + Number(value).toFixed(2); }
  function latest(rows) { return (rows || []).reduce(function (result, row) { return !result || String(row.report_date || '') > String(result.report_date || '') ? row : result; }, null); }
  function currentRows(rows) { return rows.some(function (row) { return row.is_current !== undefined; }) ? rows.filter(function (row) { return row.is_current; }) : rows; }
  function marketRows() { return currentRows(state.terminal).filter(function (row) { return row.market === state.market; }); }
  function sourceLabel(src) { return src === 'mostly' ? 'Mostly price' : src === 'mid-range' ? 'Reported range' : 'Reported print'; }

  function populateMarkets() {
    var markets = Array.from(new Set(state.terminal.map(function (row) { return row.market; }).filter(Boolean))).sort();
    state.market = markets.indexOf('New York') >= 0 ? 'New York' : (markets[0] || '');
    var select = $('#home-market');
    select.innerHTML = markets.map(function (market) { return '<option value="' + esc(market) + '">' + esc(market) + '</option>'; }).join('');
    select.value = state.market;
    select.addEventListener('change', function () { state.market = select.value; render(); });
  }

  function representativeRows(rows) {
    var groups = {};
    rows.forEach(function (row) { if (row.commodity) (groups[row.commodity] = groups[row.commodity] || []).push(row); });
    return Object.keys(groups).map(function (name) {
      var list = groups[name];
      var row = list.find(function (item) { return D.priceOf(item).price != null; }) || list[0];
      return { name: name, rows: list, row: row, price: D.priceOf(row), count: list.length };
    }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  function signal(rows) {
    var candidate = rows.find(function (row) { return /higher|lower/i.test(String(row.movement || row.trend || '')); }) || rows[0];
    if (!candidate) return { title: 'Today’s terminal report is being prepared.', detail: 'The latest USDA market lines will appear here as soon as they are available.', row: null };
    var direction = /lower/i.test(String(candidate.movement || candidate.trend || '')) ? 'lower' : /higher/i.test(String(candidate.movement || candidate.trend || '')) ? 'higher' : 'active';
    return {
      title: (candidate.commodity || 'Market activity') + ' is reporting ' + direction + '.',
      detail: [candidate.variety, candidate.origin, candidate.package, candidate.size].filter(Boolean).join(' · ') || 'Review the published line and its market context.',
      row: candidate
    };
  }

  function render() {
    var rows = marketRows();
    var current = latest(rows);
    var reportDate = current && current.report_date ? U.fmtDate(current.report_date) : 'Latest report';
    var commodities = new Set(rows.map(function (row) { return row.commodity; }).filter(Boolean));
    var featured = signal(rows);
    var featurePrice = featured.row ? D.priceOf(featured.row) : { price: null, src: '' };
    $('#home-stamp').textContent = reportDate + ' · USDA AMS terminal report';
    $('#home-brief-date').textContent = state.market ? state.market + ' terminal · ' + reportDate : 'Loading report';
    $('#home-market-label').textContent = state.market ? state.market + ' terminal' : 'Selected terminal';
    $('#home-signal-title').textContent = featured.title;
    $('#home-signal-detail').textContent = featured.detail;
    $('#home-signal-price').textContent = money(featurePrice.price);
    $('#home-signal-basis').textContent = sourceLabel(featurePrice.src);
    $('#home-signal-count').textContent = rows.length ? rows.length.toLocaleString() : '—';
    $('#home-signal-commodities').textContent = commodities.size ? commodities.size.toLocaleString() : '—';
    $('#home-brief-link').href = '/browse?market=' + encodeURIComponent(state.market || '');
    $('#home-brief-link-secondary').href = '/browse?market=' + encodeURIComponent(state.market || '');

    var fob = D.fobIndex(state.fob);
    var opportunities = representativeRows(rows).slice(0, 4).map(function (item) {
      var matched = fob.exact(item.row);
      var spread = matched && item.price.price != null ? item.price.price - matched.price : null;
      return '<article class="ag-opportunity"><div><div class="ag-opportunity-name">' + esc(item.name) + '</div><span class="ag-opportunity-meta">' + esc([item.row.variety, item.row.origin, item.row.package, item.row.size].filter(Boolean).join(' · ') || item.count + ' price lines') + '</span></div><div class="ag-opportunity-price"><span class="ag-mono">' + money(item.price.price) + (matched ? ' / ' + money(matched.price) : '') + '</span><span class="ag-opportunity-meta">' + (spread == null ? 'FOB not matched' : (spread >= 0 ? '+' : '−') + '$' + Math.abs(spread).toFixed(2) + ' terminal / FOB') + '</span></div><span class="ag-basis ' + (item.price.src === 'mid-range' ? 'ag-basis--range' : '') + '"><i></i>' + sourceLabel(item.price.src) + '</span></article>';
    }).join('');
    $('#home-opportunities').innerHTML = opportunities || '<div class="ag-empty">No current price lines are available for this market.</div>';
    $('#home-opportunity-context').textContent = state.market ? state.market + ' terminal · current report' : 'Current report';
  }

  function boot() {
    Promise.all([
      api.reportCurrent('terminal').catch(function () { return []; }),
      api.reportLatest('shipping_point').catch(function () { return []; })
    ]).then(function (result) {
      state.terminal = result[0] || [];
      state.fob = result[1] || [];
      populateMarkets();
      render();
    }).catch(function () { $('#home-opportunities').innerHTML = '<div class="ag-empty">We could not load USDA prices right now.</div>'; });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
