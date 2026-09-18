/* Account data only; UI lives in account-ui.js. No account data is cached locally. */
(function () {
  'use strict';
  const listeners = new Set();
  let client, user = null, watch = [], watchError = '', revision = 0, recovery = false;
  const pending = new Set();
  let watchLoad = Promise.resolve(), loading = false;
  function emit() { listeners.forEach(fn => fn()); }
  function requireClient() {
    if (!client) throw Error('Accounts are temporarily unavailable. Please reload and try again.');
    return client;
  }
  function requireUser() {
    requireClient();
    if (!user) throw Error('Sign in to save your preferences and watchlist.');
    return user.id;
  }
  async function loadWatch() {
    const id = user && user.id, version = ++revision;
    watch = []; watchError = ''; loading = !!id; emit();
    if (!id) return;
    try {
      const result = await client.from('watchlist_items').select('commodity').eq('user_id', id).order('created_at');
      if (result.error) throw result.error;
      if (version !== revision) return;
      watch = [...new Set((result.data || []).map(row => row.commodity))];
    } catch (error) {
      if (version !== revision) return;
      watchError = 'Your watchlist could not load. Please try again.';
    }
    if (version === revision) { loading = false; emit(); }
  }
  function accept(next) {
    const changed = (user && user.id) !== (next && next.id);
    user = next;
    if (changed) watchLoad = loadWatch();
    else emit();
    return watchLoad;
  }
  const ready = (async () => {
    try {
      if (!window.supabase || !window.AGRAX_SUPABASE_URL || !window.AGRAX_SUPABASE_ANON_KEY) return;
      client = window.supabase.createClient(window.AGRAX_SUPABASE_URL, window.AGRAX_SUPABASE_ANON_KEY);
      // Keep this callback synchronous: SDK calls inside it can deadlock token refresh.
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') recovery = true;
        setTimeout(() => accept(session ? session.user : null), 0);
      });
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      await accept(result.data.session ? result.data.session.user : null);
    } catch (error) { client = null; user = null; watch = []; emit(); }
  })();
  window.agraxAccount = {
    ready,
    user: () => user,
    recovery: () => recovery,
    preferredMarket: () => user && user.user_metadata && user.user_metadata.preferred_market || '',
    initialMarket(markets, explicit) {
      if (explicit && markets.includes(explicit)) return explicit;
      const preferred = user && user.user_metadata && user.user_metadata.preferred_market;
      if (!explicit && markets.includes(preferred)) return preferred;
      return markets.includes('New York') ? 'New York' : markets[0];
    },
    watch: () => watch.slice(),
    watchError: () => watchError,
    has: name => watch.includes(name),
    pending: name => loading || pending.has(name),
    loading: () => loading,
    onChange(fn) { listeners.add(fn); fn(); return () => listeners.delete(fn); },
    refreshWatch: () => (watchLoad = loadWatch()),
    async signUp(email, password, market) {
      const result = await requireClient().auth.signUp({ email, password, options: {
        emailRedirectTo: location.origin + '/', data: { preferred_market: market }
      } });
      if (result.error) throw result.error;
      if (result.data.session) await accept(result.data.user);
      return !!result.data.session;
    },
    async signInWithGoogle() {
      requireClient();
      // Check before navigating so a disabled provider does not strand users on an error page.
      const settingsResponse = await fetch(window.AGRAX_SUPABASE_URL + '/auth/v1/settings', {
        headers: { apikey: window.AGRAX_SUPABASE_ANON_KEY }
      });
      if (!settingsResponse.ok) throw Error('Google sign-in is temporarily unavailable. Please try email sign-in.');
      const settings = await settingsResponse.json();
      if (!settings.external || !settings.external.google) {
        throw Error('Google sign-in is not available yet. Please use email for now.');
      }
      // Return to the same page so a buyer keeps their current market/filter URL.
      const redirect = new URL(location.pathname || '/', location.origin);
      redirect.search = location.search || '';
      redirect.searchParams.set('account', 'google');
      const result = await requireClient().auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: redirect.href }
      });
      if (result.error) throw result.error;
    },
    async signIn(email, password) {
      const result = await requireClient().auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      await accept(result.data.user);
    },
    async signOut() {
      const result = await requireClient().auth.signOut();
      if (result.error) throw result.error;
      await accept(null);
    },
    async saveMarket(market) {
      requireUser();
      const result = await client.auth.updateUser({ data: { preferred_market: market } });
      if (result.error) throw result.error;
      await accept(result.data.user);
    },
    async resetPassword(email) {
      const result = await requireClient().auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?account=recovery' });
      if (result.error) throw result.error;
    },
    async changePassword(password) {
      requireUser();
      const result = await client.auth.updateUser({ password });
      if (result.error) throw result.error;
      recovery = false; emit();
    },
    async toggle(name) {
      const id = requireUser();
      await watchLoad;
      if (!user || user.id !== id) throw Error("Your session changed. Please try again.");
      if (pending.has(name)) return;
      if (watchError) throw Error(watchError);
      const removing = watch.includes(name);
      pending.add(name); emit();
      try {
        const result = removing
          ? await client.from('watchlist_items').delete().eq('user_id', id).eq('commodity', name)
          : await client.from('watchlist_items').insert({ user_id: id, commodity: name });
        if (result.error) throw result.error;
        if (!user || user.id !== id) return;
        watch = removing ? watch.filter(item => item !== name) : [...new Set(watch.concat(name))];
      } finally { pending.delete(name); emit(); }
    }
  };
})();
