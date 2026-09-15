(function () {
  'use strict';
  var columns = ['Commodity', 'Variety', 'Origin', 'Pack', 'Size', 'Grade / condition', 'Terminal', 'Origin FOB', 'Spread', 'Price basis', 'Report date'];
  function esc(value) { var el = document.createElement('span'); el.textContent = value == null || value === '' ? '—' : String(value); return el.innerHTML; }
  function money(value) { return value == null ? '—' : '$' + Number(value).toFixed(2); }
  function rows(items, fob) {
    return items.map(function (row) {
      var price = window.agraxData.priceOf(row), match = fob.exact(row);
      var spread = match && price.price != null ? price.price - match.price : null;
      var basis = price.src === 'mostly' ? 'Mostly' : price.src === 'mid-range' ? 'Mid-range' : 'Reported';
      var values = [row.commodity, row.variety, row.origin, row.package, row.size, [row.grade, row.quality_note].filter(Boolean).join(' / '), money(price.price), match ? money(match.price) : '—', spread == null ? '—' : (spread < 0 ? '−' : '+') + money(Math.abs(spread)), basis, row.report_date];
      return '<tr>' + values.map(function (value, i) { return '<' + (i === 0 ? 'th scope="row"' : 'td') + (i >= 6 && i <= 8 ? ' class="ag-mono table-number"' : '') + '>' + esc(value) + '</' + (i === 0 ? 'th' : 'td') + '>'; }).join('') + '</tr>';
    }).join('');
  }
  function table(items, fob, caption) {
    return '<div class="ag-table-wrap" tabindex="0" role="region" aria-label="' + esc(caption) + ', scroll horizontally for all columns"><table class="ag-price-table commodity-table"><caption class="sr-only">' + esc(caption) + '</caption><thead><tr>' + columns.map(function (name) { return '<th scope="col">' + name + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows(items, fob) || '<tr><td colspan="11">No prices match this selection.</td></tr>') + '</tbody></table></div>';
  }
  window.agraxTable = { table: table };
})();
