(function () {
  'use strict';

  var api = window.agraxAPI;
  var D = window.agraxData;
  var U = window.agraxUtil;
  var state = { terminal: [], fob: [], market: '', query: '', categories: {}, origins: {}, bases: {} };

  function $ (selector) { return document.querySelector(selector); }
  function esc(value) { var el = document.createElement('span'); el.textContent = value == null ? '' : String(value); return el.innerHTML; }
  function money(value) { return value == null ? '—' : '$' + Number(value).toFixed(2); }
  function currentRows(rows) { return rows.some(function (row) { return row.is_current !== undefined; }) ? rows.filter(function (row) { return row.is_current; }) : rows; }
  function latestDate(rows) { return rows.reduce(function (max, row) { return !max || String(row.report_date || '') > max ? String(row.report_date || '') : max; }, ''); }
  function active(group) { return Object.keys(group).filter(function (key) { return group[key]; }); }
  function labelCategory(value) { return { fruits: 'Fruits', vegetables: 'Vegetables', onions_potatoes: 'Onions & potatoes', nuts: 'Nuts' }[value] || value || 'Other'; }
  function sourceLabel(value) { return value === 'mostly' ? 'Mostly' : value === 'mid-range' ? 'Mid-range' : 'Reported'; }

  function marketRows() { return currentRows(state.terminal).filter(function (row) { return row.market === state.market; }); }
  function filteredRows() {
    var categories = active(state.categories), origins = active(state.origins), bases = active(state.bases), query = state.query.trim().toLowerCase();
    return marketRows().filter(function (row) {
      var source = D.priceOf(row).src;
      if (categories.length && categories.indexOf(row.commodity_type) < 0) return false;
      if (origins.length && origins.indexOf(row.origin) < 0) return false;
      if (bases.length && bases.indexOf(source) < 0) return false;
      if (!query) return true;
      return [row.commodity, row.variety, row.origin, row.package, row.size].join(' ').toLowerCase().indexOf(query) >= 0;
    });
  }

  function buildChecks(element, group, entries) {
    element.innerHTML = entries.map(function (entry) {
      var on = !!group[entry.key];
      return '<button class="ag-check" type="button" data-key="' + esc(entry.key) + '" aria-pressed="' + on + '"><i class="ag-check-box">' + (on ? '✓' : '') + '</i>' + esc(entry.label) + '<span class="ag-check-count">' + entry.count + '</span></button>';
    }).join('');
    element.querySelectorAll('button').forEach(function (button) { button.addEventListener('click', function () { var key = button.dataset.key; group[key] = !group[key]; render(); }); });
  }

  function renderFilters(rows) {
    function counts(key, label) {
      var value = {};
      rows.forEach(function (row) { var k = key(row); if (k) value[k] = (value[k] || 0) + 1; });
      return Object.keys(value).sort(function (a, b) { return value[b] - value[a]; }).slice(0, 8).map(function (k) { return { key: k, label: label(k), count: value[k] }; });
    }
    buildChecks($('#browse-categories'), state.categories, counts(function (row) { return row.commodity_type; }, labelCategory));
    buildChecks($('#browse-origins'), state.origins, counts(function (row) { return row.origin; }, function (value) { return value; }));
    buildChecks($('#browse-bases'), state.bases, counts(function (row) { return D.priceOf(row).src; }, sourceLabel));
  }

  function render() {
    var all = marketRows();
    var rows = filteredRows();
    var reportDate = latestDate(all);
    var fob = D.fobIndex(state.fob);
    $('#browse-market-name').textContent = state.market || 'Terminal market';
    $('#browse-market-meta').textContent = reportDate ? 'Most recent report: ' + U.fmtDate(reportDate) : 'Loading report';
    $('#browse-report-date').textContent = reportDate ? U.fmtDate(reportDate) + ' ▾' : 'Latest report ▾';
    $('#browse-count').textContent = rows.length.toLocaleString() + ' price lines';
    $('#browse-note-copy').textContent = all.length ? 'Showing current printed lines; older prices are not blended into today’s report.' : 'Loading the latest USDA report.';
    renderFilters(all);
    var html = rows.slice(0, 80).map(function (row) {
      var price = D.priceOf(row), matched = fob.exact(row), spread = matched && price.price != null ? price.price - matched.price : null;
      var detail = [row.variety, row.origin, row.package, row.size, row.quality_note].filter(Boolean).join(' · ') || 'USDA market line';
      return '<tr><td><span class="ag-product">' + esc(row.commodity || 'Unspecified') + '</span><span class="ag-product-detail">' + esc(detail) + '</span></td><td class="ag-mono">' + money(price.price) + '</td><td class="ag-mono">' + (matched ? money(matched.price) : '—') + '</td><td class="ag-mono ag-up">' + (spread == null ? '—' : (spread >= 0 ? '+' : '−') + '$' + Math.abs(spread).toFixed(2)) + '</td><td><span class="ag-basis ' + (price.src === 'mid-range' ? 'ag-basis--range' : '') + '"><i></i>' + sourceLabel(price.src) + '</span></td><td><button type="button" class="ag-inspect" data-row="' + esc(D.rowKey(row)) + '">Inspect</button></td></tr>';
    }).join('');
    $('#browse-table-body').innerHTML = html || '<tr><td colspan="6"><div class="ag-empty">No prices match these filters.</div></td></tr>';
    $('#browse-table-foot').textContent = rows.length > 80 ? 'Showing the first 80 matching price lines. Refine your filters to narrow the report.' : 'Every line preserves its report date, origin, pack, grade and published price method.';
  }

  function boot() {
    function clearFilters() { state.categories = {}; state.origins = {}; state.bases = {}; state.query = ''; $('#browse-query').value = ''; render(); }
    $('#browse-query').addEventListener('input', function (event) { state.query = event.target.value; render(); });
    $('#browse-clear').addEventListener('click', clearFilters);
    $('#browse-clear-side').addEventListener('click', clearFilters);
    Promise.all([api.reportCurrent('terminal').catch(function () { return []; }), api.reportLatest('shipping_point').catch(function () { return []; })]).then(function (result) {
      state.terminal = result[0] || [];
      state.fob = result[1] || [];
      var markets = Array.from(new Set(state.terminal.map(function (row) { return row.market; }).filter(Boolean))).sort();
      var requested = new URLSearchParams(window.location.search).get('market');
      state.market = markets.indexOf(requested) >= 0 ? requested : (markets.indexOf('New York') >= 0 ? 'New York' : markets[0]);
      var select = $('#browse-market');
      select.innerHTML = markets.map(function (market) { return '<option value="' + esc(market) + '">' + esc(market) + '</option>'; }).join('');
      select.value = state.market;
      select.addEventListener('change', function () { state.market = select.value; state.categories = {}; state.origins = {}; state.bases = {}; render(); });
      render();
    }).catch(function () { $('#browse-table-body').innerHTML = '<tr><td colspan="6"><div class="ag-empty">We could not load USDA prices right now.</div></td></tr>'; });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
