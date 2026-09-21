/* Basic consent: no Google requests until the visitor accepts. */
(function () {
  'use strict';
  const id = window.AGRAX_GA_ID;
  if (!/^G-[A-Z0-9]+$/.test(id || '') || !['www.agra-x.com','agra-x.com'].includes(location.hostname)) return;
  // Never measure token-bearing subscription or authentication pages.
  if (location.pathname.startsWith('/newsletter') || /(?:token|code|access_token|refresh_token)=/i.test(location.search + location.hash)) return;
  const key = 'agrax-analytics-consent-v1';
  let choice = null, started = false;
  try { choice = localStorage.getItem(key); } catch (_) {}
  window.dataLayer = window.dataLayer || [];
  const gtag = function () { window.dataLayer.push(arguments); };
  window.gtag = gtag;
  gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  function start() {
    if (started) return;
    started = true;
    gtag('consent','update',{analytics_storage:'granted'});
    gtag('js',new Date());
    // Strip queries, fragments and referrers: these may contain emails or auth codes.
    gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:location.origin+location.pathname,page_referrer:'',page_title:'AgraX '+location.pathname});
    gtag('event','page_view',{page_location:location.origin+location.pathname,page_referrer:'',page_title:'AgraX '+location.pathname});
    const script = document.createElement('script'); script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.append(script);
  }
  const panel = document.createElement('section');
  panel.className = 'analytics-choice'; panel.setAttribute('aria-label','Analytics preferences');
  panel.innerHTML = '<p>Allow usage analytics to help improve AgraX? <a href="/privacy">Privacy</a></p><div><button type="button" data-accept>Allow analytics</button><button type="button" data-decline>Decline</button></div>';
  function choose(value) {
    choice = value;
    try { localStorage.setItem(key,value); } catch (_) {}
    panel.hidden = true;
    if(value === 'granted') { window['ga-disable-'+id] = false; start(); gtag('consent','update',{analytics_storage:'granted'}); }
    else { window['ga-disable-'+id] = true; gtag('consent','update',{analytics_storage:'denied'}); }
  }
  panel.querySelector('[data-accept]').onclick = () => choose('granted');
  panel.querySelector('[data-decline]').onclick = () => choose('denied');
  panel.hidden = choice === 'granted' || choice === 'denied';
  document.body.append(panel);
  const settings = document.createElement('button'); settings.type = 'button';
  settings.className = 'analytics-settings'; settings.textContent = 'Analytics preferences';
  settings.onclick = () => { panel.hidden = false; panel.querySelector('button').focus(); };
  (document.querySelector('footer') || document.body).append(settings);
  if(choice === 'granted') start();
})();
