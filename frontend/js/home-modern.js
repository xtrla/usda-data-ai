(function () {
  'use strict';

  var api = window.agraxAPI;
  var D = window.agraxData;
  var U = window.agraxUtil;
  var state = { terminal: [], fob: [], dates: [], market: '' };

  function $ (selector) { return document.querySelector(selector); }
  function esc(value) { var el = document.createElement('span'); el.textContent = value == null ? '' : String(value); return el.innerHTML; }
  function latest(rows) { return (rows || []).reduce(function (result, row) { return !result || String(row.report_date || '') > String(result.report_date || '') ? row : result; }, null); }
  function currentRows(rows) { return rows.some(function (row) { return row.is_current !== undefined; }) ? rows.filter(function (row) { return row.is_current; }) : rows; }
  function marketRows() { return currentRows(state.terminal).filter(function (row) { return row.market === state.market; }); }

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

  function render() {
    var rows = marketRows();
    var searchMarket = $('#overview-search-market');
    if (searchMarket) searchMarket.value = state.market || '';
    var current = latest(rows);
    var reportDate = current && current.report_date ? U.fmtDate(current.report_date) : 'Latest report';
    var commodities = new Set(rows.map(function (row) { return row.commodity; }).filter(Boolean));
    $('#home-stamp').textContent = reportDate + ' · USDA AMS terminal report';
    $('#home-market-label').textContent = state.market ? state.market + ' terminal' : 'Selected terminal';
    $('#home-signal-count').textContent = rows.length ? rows.length.toLocaleString() : '—';
    $('#home-signal-commodities').textContent = commodities.size ? commodities.size.toLocaleString() : '—';
    $('#home-brief-link').href = '/browse?market=' + encodeURIComponent(state.market || '');

    var fob = D.fobIndex(state.fob);
    $('#home-opportunities').innerHTML = window.agraxTable.table(representativeRows(rows).slice(0, 8).map(function (item) { return item.row; }), fob, 'Commodity prices');
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
