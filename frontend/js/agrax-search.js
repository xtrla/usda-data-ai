/* AgraX — search suggestions.
 *
 * Typing "hass" should offer Hass avocados, not make the reader work out that
 * Hass is a variety of a commodity called Avocados. USDA's own vocabulary is
 * what buyers use out loud — variety names, origins and pack sizes — so the
 * index covers all of them and every suggestion resolves to a real commodity
 * page.
 *
 * Built from the rows already loaded for the page. No extra request, and no
 * separate list that could drift out of step with the prices on screen.
 */
(function () {
  'use strict';

  var MID = '\u00b7';

  function norm(v) {
    return String(v == null ? '' : v).trim().toLowerCase();
  }

  /* One entry per thing a person might type, pointing at the commodity that
   * holds it. Varieties are scoped to their commodity because "Gala" means
   * apples and nothing else — a global variety list would offer matches that
   * lead nowhere. */
  function buildIndex(rows) {
    var byCommodity = {};

    rows.forEach(function (r) {
      var com = r.commodity;
      if (!com) return;
      var e = byCommodity[com];
      if (!e) {
        e = byCommodity[com] = {
          commodity: com, market: r.market, count: 0,
          varieties: {}, origins: {}
        };
      }
      e.count++;
      if (r.variety) e.varieties[r.variety] = (e.varieties[r.variety] || 0) + 1;
      if (r.origin) e.origins[r.origin] = (e.origins[r.origin] || 0) + 1;
    });

    var entries = [];
    Object.keys(byCommodity).forEach(function (com) {
      var e = byCommodity[com];

      entries.push({
        kind: 'commodity',
        label: com,
        sub: e.count + ' prices',
        commodity: com,
        market: e.market,
        haystack: norm(com),
        weight: e.count
      });

      Object.keys(e.varieties).forEach(function (v) {
        entries.push({
          kind: 'variety',
          label: v,
          sub: com + '  ' + MID + '  ' + e.varieties[v] + ' prices',
          commodity: com,
          market: e.market,
          haystack: norm(v) + ' ' + norm(com),
          weight: e.varieties[v]
        });
      });

      Object.keys(e.origins).forEach(function (o) {
        entries.push({
          kind: 'origin',
          label: com + ' from ' + o,
          sub: e.origins[o] + ' prices',
          commodity: com,
          market: e.market,
          haystack: norm(o) + ' ' + norm(com),
          weight: e.origins[o]
        });
      });
    });

    return entries;
  }

  /* Rank matches so the useful one is first.
   *
   * A prefix match beats a match in the middle: someone typing "app" wants
   * Apples, not Pineapple. Within the same tier the better-covered item wins,
   * since a commodity with 97 prices is more likely the intended one than a
   * variety with 1. */
  function search(entries, query, limit) {
    var q = norm(query);
    if (q.length < 2) return [];

    var scored = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var pos = e.haystack.indexOf(q);
      if (pos < 0) continue;

      var score = 0;
      if (e.haystack.indexOf(q) === 0) score += 1000;              // starts with
      else if (e.haystack.indexOf(' ' + q) > -1) score += 500;     // starts a word
      if (e.kind === 'commodity') score += 200;                    // prefer the page itself
      score += Math.min(e.weight, 100);
      score -= Math.min(pos, 50);

      scored.push({ entry: e, score: score });
    }

    scored.sort(function (a, b) {
      return b.score - a.score || a.entry.label.localeCompare(b.entry.label);
    });

    // One suggestion per commodity+kind so the list isn't three near-identical
    // rows for the same thing.
    var seen = {}, out = [];
    for (var j = 0; j < scored.length && out.length < (limit || 8); j++) {
      var e2 = scored[j].entry;
      var key = e2.kind + '|' + e2.commodity + '|' + e2.label;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(e2);
    }
    return out;
  }

  window.agraxSearch = { buildIndex: buildIndex, search: search };
})();

/* Attach suggestion dropdowns to every search input on the page.
 *
 * Runs outside the template renderer on purpose. The page re-renders on every
 * filter and sort, and re-rendering an input the person is typing into would
 * drop focus and the caret. Binding once and re-scanning after each render
 * keeps typing uninterrupted.
 */
(function () {
  'use strict';

  var index = [];
  var onPick = null;

  function close(box) { box.removeAttribute('data-open'); box.innerHTML = ''; }

  function ensureBox(input) {
    var host = input.parentNode;
    if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var box = host.querySelector('.agx-sug');
    if (!box) {
      box = document.createElement('div');
      box.className = 'agx-sug';
      host.appendChild(box);
    }
    return box;
  }

  function render(input, box, results) {
    if (!results.length) { close(box); return; }
    box.innerHTML = '';
    results.forEach(function (e, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'agx-sug__item';
      if (i === 0) b.setAttribute('data-active', '');
      b.innerHTML = '<span class="agx-sug__label"></span><span class="agx-sug__sub"></span>';
      b.querySelector('.agx-sug__label').textContent = e.label;
      b.querySelector('.agx-sug__sub').textContent = e.sub;
      // mousedown, not click: the input's blur would close the box first.
      b.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        close(box);
        input.value = e.label;
        if (onPick) onPick(e);
      });
      box.appendChild(b);
    });
    box.setAttribute('data-open', '');
  }

  function bind(input) {
    if (input.__agxBound) return;
    input.__agxBound = true;
    var box = ensureBox(input);

    input.addEventListener('input', function () {
      render(input, box, window.agraxSearch.search(index, input.value, 8));
    });
    input.addEventListener('focus', function () {
      if (input.value) render(input, box, window.agraxSearch.search(index, input.value, 8));
    });
    input.addEventListener('blur', function () { setTimeout(function () { close(box); }, 120); });

    input.addEventListener('keydown', function (ev) {
      var items = Array.prototype.slice.call(box.querySelectorAll('.agx-sug__item'));
      if (!items.length) return;
      var at = items.findIndex(function (it) { return it.hasAttribute('data-active'); });
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (at > -1) items[at].removeAttribute('data-active');
        var next = ev.key === 'ArrowDown'
          ? (at + 1) % items.length
          : (at <= 0 ? items.length - 1 : at - 1);
        items[next].setAttribute('data-active', '');
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        (items[at > -1 ? at : 0]).dispatchEvent(new MouseEvent('mousedown'));
      } else if (ev.key === 'Escape') {
        close(box);
      }
    });
  }

  window.agraxSearch.attach = function (rows, pick) {
    index = window.agraxSearch.buildIndex(rows || []);
    onPick = pick;
    document.querySelectorAll('[data-search-input]').forEach(bind);
  };

  window.agraxSearch.rebind = function () {
    document.querySelectorAll('[data-search-input]').forEach(bind);
  };
})();
