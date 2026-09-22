/* One shared, single-row header for every public page. */
(function () {
  'use strict';
  if (document.querySelector('.agrax-header')) return;
  var header = document.createElement('header');
  header.className = 'agrax-header';
  header.innerHTML = '<div class="agrax-header-inner"><a class="agrax-brand" href="/" aria-label="AgraX home"><span aria-hidden="true"></span></a><button class="agrax-search-toggle" type="button" aria-label="Open search" aria-expanded="false" aria-controls="agrax-header-search"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button><div class="account-actions agrax-mobile-account" data-account-actions data-header-account></div><button class="agrax-menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="agrax-navigation"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><nav id="agrax-navigation" class="agrax-navigation" aria-label="Main navigation" hidden><form id="agrax-header-search" action="/browse" method="get" role="search"><input name="q" type="search" placeholder="Search produce" aria-label="Search commodities"><button type="submit" aria-label="Search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button></form><a href="/">Home</a><a href="/browse">Browse prices</a><a href="/about">About the data</a><a href="/privacy">Privacy</a><div class="account-actions" data-account-actions></div></nav></div>';
  document.body.prepend(header);
  var path = location.pathname.replace(/\/$/, '') || '/';
  header.querySelectorAll('nav > a').forEach(function (link) {
    if (link.getAttribute('href') === path) link.setAttribute('aria-current', 'page');
  });
  var toggle = header.querySelector('.agrax-menu-toggle');
  var menu = header.querySelector('.agrax-navigation');
  var search = header.querySelector('form');
  var searchToggle = header.querySelector('.agrax-search-toggle');
  var mobile = window.matchMedia('(max-width: 899px)');
  function close(focus) {
    menu.hidden = mobile.matches;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    if (focus && mobile.matches) toggle.focus();
  }
  function closeSearch(focus) {
    search.classList.remove('is-open');
    header.classList.remove('search-expanded');
    searchToggle.setAttribute('aria-expanded', 'false');
    searchToggle.setAttribute('aria-label', 'Open search');
    if (focus && mobile.matches) searchToggle.focus();
  }
  function layout() {
    close(false); closeSearch(false);
    if (mobile.matches) header.querySelector('.agrax-header-inner').append(search);
    else menu.prepend(search);
  }
  layout();
  mobile.addEventListener('change', layout);
  searchToggle.addEventListener('click', function () {
    var opening = !search.classList.contains('is-open');
    close(false); closeSearch(false);
    if (opening) {
      search.classList.add('is-open');
      header.classList.add('search-expanded');
      searchToggle.setAttribute('aria-expanded', 'true');
      searchToggle.setAttribute('aria-label', 'Close search');
      search.querySelector('input').focus();
    }
  });
  toggle.addEventListener('click', function () {
    closeSearch(false);
    var opening = menu.hidden;
    menu.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
  });
  document.addEventListener('click', function (event) { if (!header.contains(event.target)) { close(false); closeSearch(false); } });
  header.addEventListener('keydown', function (event) { if (event.key === 'Escape') { if (search.classList.contains('is-open')) closeSearch(true); else close(true); event.preventDefault(); } });
  header.addEventListener('focusout', function (event) { if (event.relatedTarget && !header.contains(event.relatedTarget)) { close(false); closeSearch(false); } });
})();
