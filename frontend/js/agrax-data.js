/* AgraX — data layer.
 *
 * Maps the live API onto the exact shapes the Claude Design templates expect.
 * Every field name here comes from the export's bindings; nothing is invented
 * to make a screen look fuller.
 *
 * The rule that governs this whole file: a value we cannot trace to a USDA
 * report is rendered as an em dash, never as a plausible-looking number. The
 * design has a slot for "price basis" and one for a long-form origin; USDA
 * publishes neither the way the mockup implied, so those are filled from what
 * the report actually says or left blank.
 */
(function () {
  'use strict';

  var api = window.agraxAPI;
  var U = window.agraxUtil;

  var DASH = '\u2014';
  var MID = '\u00b7';

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function money(n) { return n == null ? DASH : '$' + n.toFixed(2); }

  /* Which published figure a price came from.
   *
   * USDA prints a "mostly" range (what most of the market traded at), a
   * low-to-high range, or a single value. These are not interchangeable and
   * the design gives each its own dot colour, so the basis travels with the
   * price rather than being flattened to one number. */
  function priceOf(row) {
    var mLo = num(row.price_mostly_low), mHi = num(row.price_mostly_high);
    if (mLo != null && mHi != null) {
      return { price: (mLo + mHi) / 2, src: 'mostly',
               basis: 'Mostly range, midpoint of $' + mLo.toFixed(2) + '\u2013$' + mHi.toFixed(2) };
    }
    if (mLo != null) return { price: mLo, src: 'mostly', basis: 'Mostly, as reported' };
    var lo = num(row.price_low), hi = num(row.price_high);
    if (lo != null && hi != null) {
      if (lo === hi) return { price: lo, src: 'reported', basis: 'Single reported price' };
      return { price: (lo + hi) / 2, src: 'mid-range',
               basis: 'Midpoint of reported $' + lo.toFixed(2) + '\u2013$' + hi.toFixed(2) };
    }
    if (lo != null) return { price: lo, src: 'reported', basis: 'Low only, as reported' };
    if (hi != null) return { price: hi, src: 'reported', basis: 'High only, as reported' };
    return { price: null, src: DASH, basis: 'No price published' };
  }

  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  /* Pack descriptions are free text and USDA does not write them the same way
   * in both report families: a terminal report prints "2 layer cartons" where
   * the shipping point report for the identical pack prints "cartons 2 layer".
   * Comparing the raw strings therefore failed on essentially every row and
   * the FOB column came back empty across the board.
   *
   * Sorting the words makes the comparison order-independent without loosening
   * what counts as a match: "2 layer cartons" and "cartons 2 layer" agree,
   * while "1 layer cartons" and "2 layer cartons" still do not. */
  function packNorm(v) {
    return norm(v).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
      .filter(Boolean).sort().join(' ');
  }

  /* A published line's identity. grade and quality_note are included because
   * USDA prints the same pack at different grades and with qualifiers like
   * "fine appearance" at genuinely different prices. Leaving either out
   * collapses real prices into one. */
  function rowKey(r) {
    if (r.row_hash) return r.row_hash;
    return [r.market, r.commodity, r.variety, r.origin, r.grade,
            r.package, r.size, r.quality_note].map(norm).join('~');
  }

  function toneOf(rows) {
    var mv = norm(rows[0] && (rows[0].movement || rows[0].trend));
    if (mv.indexOf('higher') > -1 || mv === 'up') return 'up';
    if (mv.indexOf('lower') > -1 || mv === 'down') return 'down';
    return 'flat';
  }

  function toneChip(t) {
    if (t === 'up')   return { up: true,  down: false, flat: false, label: 'Higher',
                               chipBg: '#E8F3EB', chipFg: '#186B39', chipBd: '#CFE4D6' };
    if (t === 'down') return { up: false, down: true,  flat: false, label: 'Lower',
                               chipBg: '#FBEDE8', chipFg: '#A8451F', chipBd: '#F0D8CE' };
    return { up: false, down: false, flat: true, label: 'Steady',
             chipBg: '#F0F1EC', chipFg: '#4A5148', chipBd: '#E2E4DC' };
  }

  /* ── FOB MATCHING ──
   * Shipping point rows carry the same variety / pack / size fields terminal
   * rows do, so a spread is only shown when those actually agree. The older
   * behaviour took the first shipping-point row for the district and printed
   * it beside any pack, which meant the spread on screen could be the gap
   * between two different products. A dash is the honest answer instead. */
  function fobIndex(fobRows) {
    var exact = {}, byOriginCom = {};
    (fobRows || []).forEach(function (r) {
      if (norm(r.market) === 'national trends') return;
      var p = priceOf(r);
      if (p.price == null) return;
      var k = [norm(r.commodity), norm(r.origin), norm(r.variety),
               packNorm(r.package), norm(r.size)].join('~');
      if (!exact[k]) exact[k] = { price: p.price, district: r.market || r.origin };
      var k2 = [norm(r.commodity), norm(r.origin)].join('~');
      (byOriginCom[k2] = byOriginCom[k2] || []).push({ price: p.price, district: r.market || r.origin });
    });
    return {
      exact: function (row) {
        return exact[[norm(row.commodity), norm(row.origin), norm(row.variety),
                      packNorm(row.package), norm(row.size)].join('~')] || null;
      },
      districtsFor: function (commodity, origin) {
        return byOriginCom[[norm(commodity), norm(origin)].join('~')] || [];
      }
    };
  }

  /* ── PUBLIC SHAPES ── */

  var D = {
    DASH: DASH,

    priceOf: priceOf,
    rowKey: rowKey,
    toneChip: toneChip,
    fobIndex: fobIndex,
    num: num,
    money: money,

    /* Commodity rows for the browse table. */
    commodityRows: function (rows, opts) {
      var byCom = {};
      rows.forEach(function (r) {
        (byCom[r.commodity] = byCom[r.commodity] || []).push(r);
      });
      return Object.keys(byCom).map(function (name) {
        var list = byCom[name];
        var origins = [];
        list.forEach(function (r) {
          if (r.origin && origins.indexOf(r.origin) === -1) origins.push(r.origin);
        });
        var chip = toneChip(toneOf(list));
        return {
          name: name,
          rows: list,
          skuCount: list.length,
          skusTxt: String(list.length),
          origins: origins.slice(0, 3).join(' ' + MID + ' '),
          up: chip.up, down: chip.down, flat: chip.flat,
          toneTxt: chip.label,
          chipBg: chip.chipBg, chipFg: chip.chipFg, chipBd: chip.chipBd
        };
      });
    },

    /* Price rows inside a commodity. */
    skuRows: function (list, fob) {
      return list.map(function (r) {
        var p = priceOf(r);
        var f = fob ? fob.exact(r) : null;
        var spread = (f && p.price != null) ? p.price - f.price : null;
        return {
          key: rowKey(r),
          raw: r,
          variety: r.variety || DASH,
          origin: r.origin || DASH,
          // USDA publishes the origin as a state or country and nothing
          // finer, so this is the same string rather than a growing district.
          originLong: r.origin || DASH,
          pack: r.package || DASH,
          size: r.size || '',
          packSize: [r.package, r.size].filter(Boolean).join('  ') || DASH,
          gradeSize: [r.grade || 'No grade marks', r.size].filter(Boolean).join(' ' + MID + ' '),
          quality: r.quality_note || '',
          // Shown in its own column. USDA prints the same pack at a base
          // price and again at "fine appearance" or "fair quality", and those
          // are different prices for different goods — an empty cell says the
          // print carried no qualifier, which is itself information.
          qualityTxt: r.quality_note || DASH,
          basis: p.basis,
          src: p.src,
          mostly: p.src === 'mostly',
          midRange: p.src === 'mid-range',
          reported: p.src === 'reported',
          termTxt: money(p.price),
          termValue: p.price,
          fobTxt: f ? money(f.price) : DASH,
          fobValue: f ? f.price : null,
          fobDistrict: f ? f.district : null,
          spreadTxt: spread == null ? DASH : (spread >= 0 ? '+' : '\u2212') + money(Math.abs(spread)).slice(1),
          markupTxt: spread == null ? DASH : (spread >= 0 ? '+$' : '\u2212$') + Math.abs(spread).toFixed(2),
          markupPctTxt: (spread == null || !f || !f.price) ? DASH
            : (spread >= 0 ? '+' : '\u2212') + Math.abs(spread / f.price * 100).toFixed(1) + '%',
          reportDate: r.report_date,
          meta: [r.variety, r.origin, r.package, r.size, r.quality_note]
                  .filter(Boolean).join(' ' + MID + ' '),
          // The inline table row prints one combined column under the header
          // "Variety · origin · pack · size", so it needs a single string.
          // Falls back to the pack when USDA states no variety — Asheville
          // prints Mexican 48s with no variety at all, and an empty cell
          // would read as missing data rather than as a real published line.
          label: ([r.variety, r.origin, r.package, r.size, r.quality_note]
                   .filter(Boolean).join(' ' + MID + ' ')) || DASH
        };
      });
    },

    /* Movement band on the commodity header.
     *
     * Reported by commodity and origin, never by pack, so this belongs at the
     * commodity level. Origins that also appear in the prices above are drawn
     * in colour; the rest stay grey. The two facts sit side by side and the
     * reader draws their own conclusion — this never labels volume as supply
     * tightening or loosening. */
    movement: function (rows, pricedOrigins) {
      var empty = {
        has: false, none: true,
        emptyTxt: 'No shipment volume published for this commodity.',
        rows: [], totalTxt: DASH, changeTxt: '', prevTxt: '', dateTxt: '',
        footnote: '', legendTxt: '', up: false, down: false, flat: true
      };
      if (!rows || !rows.length) return empty;

      var byDate = {};
      rows.forEach(function (r) {
        var d = r.report_date;
        var lbs = num(r.total_pounds) || (num(r.units_10k) || 0) * 10000;
        var loads = num(r.package_count);
        var qty = loads != null ? loads : (lbs ? lbs / 40000 : 0);
        if (!d || qty <= 0) return;
        if (!byDate[d]) byDate[d] = { date: d, total: 0, origins: {} };
        byDate[d].total += qty;
        var o = r.origin_name || r.origin_code || 'Unknown';
        byDate[d].origins[o] = (byDate[d].origins[o] || 0) + qty;
      });

      var dates = Object.keys(byDate).sort().reverse();
      if (!dates.length) return empty;

      var cur = byDate[dates[0]], prev = dates[1] ? byDate[dates[1]] : null;
      var list = Object.keys(cur.origins).map(function (n) {
        return { name: n, loads: cur.origins[n] };
      }).sort(function (a, b) { return b.loads - a.loads; }).slice(0, 5);
      var max = list.length ? list[0].loads : 1;

      var priced = (pricedOrigins || []).map(norm);
      var chg = prev ? cur.total - prev.total : null;
      var pct = (prev && prev.total) ? chg / prev.total * 100 : null;

      return {
        has: true, none: false, emptyTxt: '',
        totalTxt: Math.round(cur.total).toLocaleString(),
        up: chg != null && chg > 0, down: chg != null && chg < 0,
        flat: chg == null || chg === 0,
        changeTxt: chg == null ? '' :
          (chg >= 0 ? '+' : '\u2212') + Math.abs(Math.round(chg)).toLocaleString() +
          (pct == null ? '' : '  ' + MID + '  ' + (pct >= 0 ? '+' : '\u2212') + Math.abs(pct).toFixed(1) + '%'),
        prevTxt: prev ? 'vs ' + U.fmtDate(prev.date) + ' (' + Math.round(prev.total).toLocaleString() + ')' : '',
        // Movement publishes a day behind prices. Saying so stops the older
        // date reading as stale data on our side.
        dateTxt: U.fmtDate(cur.date) + ' ' + MID + ' latest published',
        legendTxt: 'Origins also priced above',
        footnote: U.fmtDate(cur.date) + ' ' + MID + ' National truck and rail arrivals as reported by USDA. ' +
                  'Not specific to any one pack or terminal.',
        rows: list.map(function (o) {
          var isPriced = priced.indexOf(norm(o.name)) > -1;
          return {
            origin: o.name,
            loadsTxt: Math.round(o.loads).toLocaleString(),
            pctTxt: (18 + (o.loads / max) * 82).toFixed(1) + '%',
            barColor: isPriced ? '#186B39' : '#D5D8D0',
            nameColor: isPriced ? '#171A16' : '#8A8F86'
          };
        })
      };
    },

    /* Price history for one published line, newest first. */
    history: function (rows, fobRows) {
      var fobByDate = {};
      (fobRows || []).forEach(function (r) {
        var p = priceOf(r);
        if (p.price != null && r.report_date && !fobByDate[r.report_date]) {
          fobByDate[r.report_date] = p.price;
        }
      });
      var seen = {}, out = [];
      (rows || []).forEach(function (r) {
        var d = r.report_date;
        if (!d || seen[d]) return;
        var p = priceOf(r);
        if (p.price == null) return;
        seen[d] = 1;
        out.push({
          date: U.fmtDate(d),
          rawDate: d,
          term: money(p.price),
          termValue: p.price,
          fob: fobByDate[d] != null ? money(fobByDate[d]) : DASH,
          fobValue: fobByDate[d] != null ? fobByDate[d] : null
        });
      });
      return out.sort(function (a, b) { return String(b.rawDate).localeCompare(String(a.rawDate)); });
    },

    /* Same published line across terminals, cheapest first. */
    acrossTerminals: function (allRows, row, currentMarket) {
      var want = [norm(row.variety), norm(row.origin), norm(row.grade),
                  norm(row.package), norm(row.size), norm(row.quality_note)].join('~');
      var byMarket = {};
      allRows.forEach(function (r) {
        if (r.commodity !== row.commodity) return;
        var k = [norm(r.variety), norm(r.origin), norm(r.grade),
                 norm(r.package), norm(r.size), norm(r.quality_note)].join('~');
        if (k !== want) return;
        var p = priceOf(r);
        if (p.price == null) return;
        if (!byMarket[r.market] || r.report_date > byMarket[r.market].date) {
          byMarket[r.market] = { price: p.price, date: r.report_date };
        }
      });
      var list = Object.keys(byMarket).map(function (m) {
        return { name: m, price: byMarket[m].price, active: m === currentMarket };
      }).sort(function (a, b) { return a.price - b.price; });

      return list.map(function (m, i) {
        return {
          rank: String(i + 1).padStart(2, '0'),
          name: m.name,
          priceTxt: money(m.price),
          active: m.active
        };
      });
    },

    spreadAcross: function (list) {
      var ps = list.map(function (m) { return num(String(m.priceTxt).replace('$', '')); })
                   .filter(function (p) { return p != null; });
      if (ps.length < 2) return DASH;
      return (Math.max.apply(null, ps) - Math.min.apply(null, ps)).toFixed(2);
    }
  };

  window.agraxData = D;
})();
