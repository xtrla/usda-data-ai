/* ================================================================
   agraX — HEADER
   ================================================================
   The header markup is static in each page (so it paints instantly
   and is crawlable); this file supplies the three behaviours that
   would otherwise be copy-pasted and drift:

     1. active nav link, derived from the path
     2. the live clock / data-freshness badge
     3. search routing — from any page, submit goes to /browse?q=

   Header markup lives in styles/components.css under "SITE HEADER".
   ================================================================ */
(function () {
  'use strict';

  function markActive() {
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    var links = document.querySelectorAll('.site-header__nav a');
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute('href') || '').replace(/\/$/, '') || '/';
      var on = href === '/' ? path === '/' : path.indexOf(href) === 0;
      links[i].classList.toggle('is-active', on);
      if (on) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  // "Live 10:39 AM ET" — the badge is about data freshness, so it
  // always reads Eastern regardless of where the visitor is.
  function tickClock() {
    var el = document.querySelector('.site-header__live time');
    if (!el) return;
    try {
      var now = new Date();
      var s = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric', minute: '2-digit'
      });
      el.textContent = s + ' ET';
      el.setAttribute('datetime', now.toISOString());
    } catch (e) {
      // Fall back to hiding rather than showing a wrong time.
      var wrap = document.querySelector('.site-header__live');
      if (wrap) wrap.style.display = 'none';
    }
  }

  // On /browse the page owns the input and filters in place. Elsewhere
  // submitting navigates to browse with the query applied.
  function wireSearch() {
    var input = document.getElementById('site-search');
    if (!input) return;
    if (/^\/browse/.test(window.location.pathname)) return;
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = input.value.trim();
      window.location.href = '/browse' + (q ? '?q=' + encodeURIComponent(q) : '');
    });
  }

  // Subscribe opens the modal where one exists, otherwise routes to the
  // page that has it. Previously this did different things per page.
  function wireSubscribe() {
    var btn = document.getElementById('site-subscribe');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var modal = document.getElementById('subscribe-modal');
      if (modal) { modal.style.display = 'flex'; return; }
      window.location.href = '/browse?subscribe=1';
    });
  }

  // Sign in defers to the auth UI when it's present; the link is hidden
  // rather than left dead if accounts aren't available on this page.
  function wireSignIn() {
    var link = document.getElementById('site-signin');
    if (!link) return;
    if (!window.agraxAuth) { link.style.display = 'none'; return; }
    link.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.agraxAuthUI && window.agraxAuthUI.open) window.agraxAuthUI.open();
      else window.location.href = '/browse?signin=1';
    });
    window.agraxAuth.onChange(function (ctx) {
      if (ctx && ctx.user) {
        link.textContent = ctx.user.email.split('@')[0];
        link.title = ctx.user.email;
      } else {
        link.textContent = 'Sign in';
        link.removeAttribute('title');
      }
    });
  }

  function init() {
    markActive();
    wireSubscribe();
    wireSignIn();
    tickClock();
    wireSearch();
    setInterval(tickClock, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
