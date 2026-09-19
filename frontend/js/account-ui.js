(function () {
  'use strict';
  const account = window.agraxAccount;
  const markets = ['New York','Los Angeles','Chicago','Philadelphia','Miami','Boston','Atlanta','Baltimore','Detroit','Columbia','Asheville','Raleigh'];
  const dialog = document.createElement('dialog');
  dialog.className = 'account-dialog';
  dialog.setAttribute('aria-labelledby', 'account-title');
  document.body.append(dialog);
  let mode = 'login', opener, pendingSave = null, busy = false;
  function element(tag, text, attrs = {}) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }
  function button(text, action, className = 'account-link') {
    const el = element('button', text, {type:'button', class:className});
    el.addEventListener('click', action); return el;
  }
  function status(message, error = false) {
    const el = dialog.querySelector('[role=status]');
    if (el) { el.textContent = message; el.dataset.error = String(error); }
  }
  function marketField(form, value) {
    const label = element('label', 'Preferred market');
    const select = element('select', '', {name:'market'});
    select.append(element('option', 'Choose a market (optional)', {value:''}));
    const choices = [...new Set(markets.concat(value || []))];
    choices.forEach(name => select.append(element('option', name, {value:name})));
    select.value = value || '';
    label.append(select); form.append(label);
  }
  function field(form, name, labelText, type, autocomplete) {
    const label = element('label', labelText);
    const input = element('input', '', {name, type, required:'', autocomplete});
    if (type === 'password') input.minLength = 8;
    label.append(input); form.append(label);
  }
  function drawWatch() {
    const list = dialog.querySelector('.account-watch-list');
    if (!list) return;
    list.replaceChildren();
    if (account.loading()) { list.append(element('p', 'Loading your watchlist…')); return; }
    if (account.watchError()) {
      status(account.watchError(), true);
      list.append(button('Try again', async () => { await account.refreshWatch(); drawWatch(); }));
      return;
    }
    status('');
    if (!account.watch().length) list.append(element('p', 'No saved commodities yet. Browse prices and use the star beside a commodity to add it.'));
    account.watch().forEach(name => {
      const li = element('li');
      const query = new URLSearchParams({c:name});
      if (account.preferredMarket()) query.set('market', account.preferredMarket());
      li.append(element('a', name, {href:'/browse?' + query}));
      const remove = button('Remove', async () => {
        remove.disabled = true;
        try { await account.toggle(name); drawWatch(); }
        catch (error) { status('Could not remove this commodity. Please try again.', true); remove.disabled = false; }
      });
      remove.setAttribute('aria-label', 'Remove ' + name); li.append(remove); list.append(li);
    });
  }
  function render() {
    dialog.replaceChildren();
    dialog.classList.toggle('account-dialog--auth', mode === 'login' || mode === 'signup');
    dialog.append(button('×', () => dialog.close(), 'account-close'));
    dialog.firstChild.setAttribute('aria-label', 'Close account dialog');
    dialog.append(element('div','Your AgraX', {class:'account-eyebrow'}));
    const titles = {login:'Sign in', signup:'Create account', settings:'Your account', watchlist:'My watchlist', reset:'Reset your password', recovery:'Choose a new password'};
    dialog.append(element('h2', titles[mode], {id:'account-title'}));
    if (mode === 'watchlist') {
      dialog.append(element('p', 'Your saved commodities, ready to explore in your preferred market.'), element('ul','',{class:'account-watch-list'}), element('p','',{role:'status',class:'account-status'}));
      drawWatch(); return;
    }
    const copy = {login:'Sign in to your saved markets and watchlist.',signup:'Save your watchlist and preferred market, ready for your next visit.',settings:account.user() ? account.user().email : '',reset:'Enter your email and we’ll send a password reset link.',recovery:'Use at least 8 characters.'};
    if (!['login','signup'].includes(mode)) dialog.append(element('p', copy[mode]));
    if (mode === 'login' || mode === 'signup') {
      const google = button('Continue with Google', async () => {
        if (busy) return;
        busy = true; google.disabled = true; status('Opening Google…');
        try {
          await account.ready;
          const market = dialog.querySelector('select[name=market]');
          sessionStorage.setItem('agrax:google-intent', JSON.stringify({
            commodity: pendingSave, market: market ? market.value : '', created: Date.now()
          }));
          await account.signInWithGoogle();
        } catch (error) {
          try { sessionStorage.removeItem('agrax:google-intent'); } catch (_) {}
          status(error.message || 'Google sign-in is unavailable. Please try email sign-in.', true);
        } finally { busy = false; google.disabled = false; }
      }, 'account-google');
      dialog.append(google, element('div', 'or continue with email', {class:'account-divider'}));
    }
    const form = element('form');
    if (['login','signup','reset'].includes(mode)) field(form,'email','Email address','email','email');
    if (['login','signup','recovery'].includes(mode)) field(form,'password','Password','password',mode === 'login' ? 'current-password':'new-password');
    // Existing accounts may have passwords accepted by the earlier signup form.
    if (mode === 'login') form.elements.password.minLength = 1;
    if (mode === 'signup' || mode === 'settings') marketField(form, account.preferredMarket());
    const labels = {login:'Sign in',signup:'Create account',settings:'Save preferences',reset:'Send reset link',recovery:'Save password'};
    form.append(element('button',labels[mode],{type:'submit',class:'account-primary'}));
    dialog.append(form, element('p','',{role:'status',class:'account-status'}));
    if (mode === 'login' || mode === 'signup') {
      const privacy = element('p', '', {class:'account-privacy'});
      privacy.append(element('a', 'Privacy policy', {href:'/privacy',target:'_blank',rel:'noopener'}));
      dialog.append(privacy);
    }
    if (mode === 'login') {
      dialog.append(button('Create an account',() => open('signup')),element('br'),button('Forgot password?',() => open('reset')));
    } else if (mode === 'signup' || mode === 'reset') dialog.append(button('Back to sign in',() => open('login')));
    if (mode === 'settings') dialog.append(button('Sign out',async () => {
      try { await account.signOut(); dialog.close(); } catch (error) { status(error.message,true); }
    }));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true; status('Please wait…');
      const data = new FormData(form), submittedMode = mode;
      try {
        await account.ready;
        if (submittedMode === 'signup') {
          const signedIn = await account.signUp(data.get('email').trim(),data.get('password'),data.get('market'));
          if (signedIn) await finishSignIn();
          else status('Check your email for a confirmation link, then sign in.');
        } else if (submittedMode === 'login') {
          await account.signIn(data.get('email').trim(),data.get('password')); await finishSignIn();
        } else if (submittedMode === 'settings') {
          await account.saveMarket(data.get('market')); status('Saved. Browse will open in this market on your next visit.');
        } else if (submittedMode === 'reset') {
          await account.resetPassword(data.get('email').trim()); status('If an account exists for this email, you’ll receive a reset link.');
        } else if (submittedMode === 'recovery') {
          await account.changePassword(data.get('password')); status('Password saved. You can close this window.');
        }
      } catch (error) { status(error.message || 'Something went wrong. Please try again.',true); }
      finally { busy = false; submit.disabled = false; }
    });
  }
  function styleAuth() {
    if (!['login','signup'].includes(mode)) return;
    const panel = element('div','',{class:'account-auth-panel'});
    const close = dialog.querySelector('.account-close');
    [...dialog.children].forEach(child => { if(child !== close) panel.append(child); });
    const brand = element('div','',{class:'account-auth-brand','aria-label':'AgraX'});
    panel.prepend(brand);
    const googleIcon = element('span', '', {class:'account-provider-icon', 'aria-hidden':'true'});
    googleIcon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.05a10 10 0 0 0 0 9.04l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.59C7.19 7.71 9.4 5.95 12 5.95Z"/></svg>';
    panel.querySelector('.account-google').prepend(googleIcon);
    const form = panel.querySelector('form');
    form.hidden = true;
    const divider = panel.querySelector('.account-divider');
    divider.textContent = 'or';
    const email = button('Continue with email',()=>{
      form.hidden = false; email.hidden = true;
      form.querySelector('input').focus();
    },'account-email');
    const emailIcon = element('span', '', {class:'account-provider-icon', 'aria-hidden':'true'});
    emailIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
    email.prepend(emailIcon);
    divider.after(email);
    const visual = element('aside','',{class:'account-auth-visual'});
    visual.append(element('h2','Know your produce market.'),element('p','Wholesale prices, origins, and specifications—from USDA market reports.'));
    dialog.append(visual,panel);
  }
  async function finishSignIn() {
    if (pendingSave) {
      const name = pendingSave; pendingSave = null;
      if (!account.has(name)) await account.toggle(name);
    }
    dialog.close();
  }
  function open(next) {
    if (busy) return;
    if (['settings','watchlist'].includes(next) && !account.user()) next = 'login';
    mode = next;
    if (!dialog.open) opener = document.activeElement;
    render();
    styleAuth();
    if (!dialog.open) dialog.showModal();
  }
  dialog.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus(); });
  let menuSequence = 0;
  function mount() {
    document.querySelectorAll('[data-account-actions]').forEach(host => {
      const key = account.user() ? 'signed-in' : 'signed-out';
      if (host.dataset.accountState === key) return;
      host.dataset.accountState = key;
      host.replaceChildren();
      const toggle = button('',()=>{
        if(menu.matches(':popover-open')) menu.hidePopover(); else menu.showPopover();
      },'account-avatar');
      toggle.setAttribute('aria-label','Account menu');
      toggle.setAttribute('aria-expanded','false');
      toggle.innerHTML='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2Z"/></svg>';
      const menu=element('div','',{class:'account-menu',popover:'auto'});
      const id='account-menu-'+(++menuSequence);menu.id=id;toggle.setAttribute('aria-controls',id);
      menu.addEventListener('toggle',()=>{
        const expanded=menu.matches(':popover-open');toggle.setAttribute('aria-expanded',String(expanded));
        if(expanded){const rect=toggle.getBoundingClientRect();menu.style.top=(rect.bottom+8)+'px';menu.style.left=Math.max(12,Math.min(rect.right-240,innerWidth-252))+'px';}
      });
      const action=(label,next)=>button(label,()=>{menu.hidePopover();open(next);},'account-menu-item');
      if(account.user()) {
        menu.append(action('Account settings','settings'),action('My watchlist','watchlist'));
        menu.append(button('Sign out',async()=>{try{await account.signOut();menu.hidePopover();}catch(error){menu.hidePopover();open('settings');status(error.message,true);}},'account-menu-item'));
        host.append(button('My watchlist',()=>open('watchlist')),toggle,menu);
      } else {
        menu.append(action('Sign in','login'),action('Create an account','signup'));
        host.append(toggle,menu,button('Create account',()=>open('signup'),'account-primary'));
      }
      const links=element('div','',{class:'account-menu-links'});
      links.append(element('a','About the data',{href:'/about'}),element('a','Privacy policy',{href:'/privacy'}));menu.append(links);
    });
    document.querySelectorAll('[data-watch-commodity]').forEach(host => {
      const name = host.dataset.watchCommodity;
      let control = host.querySelector('button');
      if (!control) {
        control = button('',async event => {
          event.stopPropagation();
          if (!account.user()) { pendingSave = name; open('signup'); return; }
          try { await account.toggle(name); }
          catch (error) { open('watchlist'); status('Could not save this commodity. Please try again.',true); }
        },'watch-button');
        control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z"/></svg>';
        // Stop the containing commodity row's expand action.
        host.addEventListener('click', event => event.stopPropagation());
        host.append(control);
      }
      control.setAttribute('aria-label',(account.has(name) ? 'Remove ' : 'Save ') + name + (account.has(name) ? ' from watchlist' : ' to watchlist'));
      control.setAttribute('aria-pressed',String(account.has(name)));
      control.disabled = account.pending(name);
    });
  }
  account.onChange(() => {
    mount();
    if (account.recovery() && mode !== 'recovery') open('recovery');
    if (dialog.open && mode === 'watchlist') drawWatch();
  });
  document.addEventListener('DOMContentLoaded',mount);
  // The SDK restores the OAuth session before account.ready resolves.
  async function completeGoogleReturn() {
    const url = new URL(location.href);
    if (url.searchParams.get('account') !== 'google') return;
    await account.ready;
    url.searchParams.delete('account');
    history.replaceState(null, '', url.pathname + url.search);
    let intent;
    try {
      intent = JSON.parse(sessionStorage.getItem('agrax:google-intent') || 'null');
      sessionStorage.removeItem('agrax:google-intent');
    } catch (_) { intent = null; }
    if (!account.user()) {
      open('login'); status('Google sign-in was not completed. Please try again or use email.', true); return;
    }
    try {
      if (intent && Date.now() - intent.created < 15 * 60 * 1000 && Date.now() >= intent.created) {
        if (intent.market) await account.saveMarket(intent.market);
        if (intent.commodity && !account.has(intent.commodity)) await account.toggle(intent.commodity);
      }
      if (!account.preferredMarket()) {
        open('settings'); status('Welcome! Choose your preferred market to make Browse your own.');
      }
    } catch (error) {
      open('settings'); status('You’re signed in, but we could not finish saving your choices. Please try again.', true);
    }
  }
  completeGoogleReturn();
  window.agraxAccountUI = {mount,open};
})();
