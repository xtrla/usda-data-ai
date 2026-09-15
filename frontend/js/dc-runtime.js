/* AgraX — template runtime for the Claude Design export.
 *
 * The design was authored in Claude Design, which renders <sc-for>, <sc-if>
 * and {{ bindings }} with its own runtime. convert.py rewrote those into
 * data-for / data-if / data-on-* directives so the markup survives intact;
 * this walks that markup and fills it from real data.
 *
 * The rule this exists to enforce: the design's inline styles are never
 * retyped. Anything that changes how the page looks belongs in the export,
 * not here. This file only supplies values and wires events.
 */
(function () {
  'use strict';

  function get(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    var parts = String(path).split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function interpolate(text, scope) {
    return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, path) {
      var v = get(scope, path);
      // Deliberately render empty rather than "undefined" or "null" — a
      // missing figure must never print as a word on a prices page.
      return v == null ? '' : String(v);
    });
  }

  function render(node, scope) {
    // Depth-first over a live tree, so child directives see the scope their
    // parent loop established.
    var children = Array.prototype.slice.call(node.childNodes);

    for (var i = 0; i < children.length; i++) {
      var el = children[i];

      if (el.nodeType === 3) {                       // text
        if (el.nodeValue.indexOf('{{') > -1) {
          el.nodeValue = interpolate(el.nodeValue, scope);
        }
        continue;
      }
      if (el.nodeType !== 1) continue;

      if (el.tagName === 'TEMPLATE') {
        var forPath = el.getAttribute('data-for');
        var ifPath = el.getAttribute('data-if');

        if (forPath) {
          var list = get(scope, forPath) || [];
          var as = el.getAttribute('data-as');
          var frag = document.createDocumentFragment();
          for (var j = 0; j < list.length; j++) {
            var childScope = Object.create(scope);
            childScope[as] = list[j];
            childScope.$index = j;
            var clone = el.content.cloneNode(true);
            render(clone, childScope);
            frag.appendChild(clone);
          }
          el.parentNode.replaceChild(frag, el);
          continue;
        }

        if (ifPath) {
          /* The wide/narrow branches are the two hand-built layouts from the
           * design, not a fluid grid. Both are rendered and a media query
           * picks one, rather than JavaScript choosing at load.
           *
           * Choosing in JS meant the layout was only correct for the width
           * the page happened to open at: resizing across the breakpoint, or
           * rotating a phone, left the wrong layout in place until reload.
           * Letting CSS decide also means the right layout is correct before
           * any script runs, and stays correct if the script fails.
           *
           * Cost is both layouts existing in the DOM. Worth it — they are
           * genuinely different designs, and only one is ever painted. */
          if (ifPath === 'wide' || ifPath === 'narrow') {
            var branch = el.content.cloneNode(true);
            render(branch, scope);
            var wrap = document.createElement('div');
            wrap.className = 'dc-' + ifPath;
            wrap.appendChild(branch);
            el.parentNode.replaceChild(wrap, el);
            continue;
          }

          if (get(scope, ifPath)) {
            var c = el.content.cloneNode(true);
            render(c, scope);
            el.parentNode.replaceChild(c, el);
          } else {
            el.parentNode.removeChild(el);
          }
          continue;
        }
      }

      // Attribute interpolation, including style and href.
      var attrs = Array.prototype.slice.call(el.attributes || []);
      for (var k = 0; k < attrs.length; k++) {
        var a = attrs[k];
        if (a.value.indexOf('{{') > -1) {
          el.setAttribute(a.name, interpolate(a.value, scope));
        }
      }

      // Events: data-on-click="handlerName" resolves against the scope, so a
      // row's own handler closes over that row's data.
      ['click', 'change', 'input'].forEach(function (evt) {
        var h = el.getAttribute('data-on-' + evt);
        if (!h) return;
        var fn = get(scope, h);
        if (typeof fn === 'function') {
          el.addEventListener(evt, fn);
          el.removeAttribute('data-on-' + evt);
        }
      });

      var dv = el.getAttribute('data-value');
      if (dv) {
        var val = get(scope, dv);
        el.value = val == null ? '' : val;
        el.removeAttribute('data-value');
      }

      render(el, scope);
    }
  }

  /* Mount a converted template into a container with the given data. */
  window.DC = {
    mount: function (container, templateHTML, data) {
      var host = document.createElement('div');
      host.innerHTML = templateHTML;
      render(host, data);
      container.innerHTML = '';
      while (host.firstChild) container.appendChild(host.firstChild);
    },
    render: render
  };
})();
