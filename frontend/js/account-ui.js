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
    dialog.append(button('×', () => dialog.close(), 'account-close'));
    dialog.firstChild.setAttribute('aria-label', 'Close account dialog');
    dialog.append(element('div','Your AgraX', {class:'account-eyebrow'}));
    const titles = {login:'Welcome back.', signup:'Make the market yours.', settings:'Your account', watchlist:'My watchlist', reset:'Reset your password', recovery:'Choose a new password'};
    dialog.append(element('h2', titles[mode], {id:'account-title'}));
    if (mode === 'watchlist') {
      dialog.append(element('p', 'Your saved commodities, ready to explore in your preferred market.'), element('ul','',{class:'account-watch-list'}), element('p','',{role:'status',class:'account-status'}));
      drawWatch(); return;
    }
    const copy = {login:'Sign in to your saved markets and watchlist.',signup:'Save commodities and start every visit in your preferred market. Browsing is always open.',settings:account.user() ? account.user().email : '',reset:'Enter your email and we’ll send a password reset link.',recovery:'Use at least 8 characters.'};
    dialog.append(element('p', copy[mode]));
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
      const privacy = element('p', 'How we handle your information: ', {class:'account-privacy'});
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
    if (!dialog.open) dialog.showModal();
  }
  dialog.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus(); });
  function mount() {
    document.querySelectorAll('[data-account-actions]').forEach(host => {
      const key = account.user() ? 'signed-in' : 'signed-out';
      if (host.dataset.accountState === key) return;
      host.dataset.accountState = key;
      host.replaceChildren();
      if (account.user()) {
        host.append(button('My watchlist',() => open('watchlist')),button('Account',() => open('settings'),'account-primary'));
      } else host.append(button('Sign in',() => open('login')),button('Create account',() => open('signup'),'account-primary'));
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
