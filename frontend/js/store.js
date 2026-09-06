/* ================================================================
   agraX — STORE
   ================================================================
   One interface for watchlist + alert rules that works whether or
   not the visitor has an account.

     signed out → localStorage, alerts unavailable
     signed in  → Supabase, with RLS scoping rows to the user

   On first sign-in any locally-kept watchlist is merged upward, so
   someone who starred commodities before registering doesn't lose
   them. The local copy is kept as a read cache, not cleared, so
   signing out still shows something useful.

   Depends on config.js, and on auth.js when accounts are in play.
   ================================================================ */
(function () {
  'use strict';

  var WATCH_KEY = 'agrax:watchlist';
  var listeners = [];

  var state = {
    ready: false,        // initial load finished
    user: null,
    watch: [],           // array of commodity names
    alerts: [],          // array of alert rule rows
    syncing: false,
    error: null
  };

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { /* a bad listener shouldn't break sync */ }
    });
  }

  function sb() {
    return window.agraxAuth ? window.agraxAuth.getClient() : null;
  }

  // ── LOCAL ──────────────────────────────────────────────
  function localRead() {
    try {
      var v = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function localWrite(list) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // ── CLOUD ──────────────────────────────────────────────
  async function cloudWatch() {
    var c = sb();
    if (!c || !state.user) return [];
    var res = await c.from('watchlist_items')
      .select('commodity')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: true });
    if (res.error) throw res.error;
    return (res.data || []).map(function (r) { return r.commodity; });
  }

  async function cloudAlerts() {
    var c = sb();
    if (!c || !state.user) return [];
    var res = await c.from('alert_rules')
      .select('*')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false });
    if (res.error) throw res.error;
    return res.data || [];
  }

  // Push anything watched locally that isn't in the account yet.
  async function mergeLocalUp(cloud) {
    var local = localRead();
    var missing = local.filter(function (n) { return cloud.indexOf(n) === -1; });
    if (!missing.length) return cloud;
    var c = sb();
    var rows = missing.map(function (n) {
      return { user_id: state.user.id, commodity: n };
    });
    // onConflict matches the unique index, so a double sign-in is a no-op.
    var res = await c.from('watchlist_items')
      .upsert(rows, { onConflict: 'user_id,commodity', ignoreDuplicates: true });
    if (res.error) throw res.error;
    return cloud.concat(missing);
  }

  // ── LOAD ───────────────────────────────────────────────
  async function refresh() {
    state.syncing = true; state.error = null; notify();
    try {
      if (state.user) {
        var w = await cloudWatch();
        w = await mergeLocalUp(w);
        state.watch = w;
        localWrite(w);                       // keep the cache warm
        state.alerts = await cloudAlerts();
      } else {
        state.watch = localRead();
        state.alerts = [];
      }
      state.error = null;
    } catch (e) {
      state.error = e.message || 'Could not sync your account.';
      // Fall back to whatever is on the device rather than showing nothing.
      if (!state.watch.length) state.watch = localRead();
    }
    state.syncing = false;
    state.ready = true;
    notify();
  }

  // ── WATCHLIST ──────────────────────────────────────────
  function has(name) { return state.watch.indexOf(name) > -1; }

  async function toggle(name) {
    var adding = !has(name);

    // Optimistic: the star flips immediately, we reconcile after.
    state.watch = adding
      ? state.watch.concat([name])
      : state.watch.filter(function (n) { return n !== name; });
    localWrite(state.watch);
    notify();

    if (!state.user) return { ok: true, local: true };

    try {
      var c = sb();
      if (adding) {
        var res = await c.from('watchlist_items')
          .upsert({ user_id: state.user.id, commodity: name },
                  { onConflict: 'user_id,commodity', ignoreDuplicates: true });
        if (res.error) throw res.error;
      } else {
        var del = await c.from('watchlist_items')
          .delete()
          .eq('user_id', state.user.id)
          .eq('commodity', name);
        if (del.error) throw del.error;
      }
      return { ok: true };
    } catch (e) {
      // Roll back so the UI never claims a save that didn't happen.
      state.watch = adding
        ? state.watch.filter(function (n) { return n !== name; })
        : state.watch.concat([name]);
      localWrite(state.watch);
      state.error = 'Could not save that. Check your connection.';
      notify();
      return { ok: false, error: state.error };
    }
  }

  // ── ALERTS ─────────────────────────────────────────────
  async function addAlert(rule) {
    if (!state.user) return { ok: false, error: 'Sign in to create alerts.' };
    try {
      var c = sb();
      var res = await c.from('alert_rules').insert({
        user_id: state.user.id,
        commodity: rule.commodity,
        market: rule.market,
        kind: rule.kind,
        threshold: rule.threshold
      }).select().single();
      if (res.error) throw res.error;
      state.alerts = [res.data].concat(state.alerts);
      notify();
      return { ok: true, rule: res.data };
    } catch (e) {
      return { ok: false, error: e.message || 'Could not create that alert.' };
    }
  }

  async function removeAlert(id) {
    if (!state.user) return { ok: false };
    var prev = state.alerts;
    state.alerts = state.alerts.filter(function (a) { return a.id !== id; });
    notify();
    try {
      var res = await sb().from('alert_rules').delete().eq('id', id);
      if (res.error) throw res.error;
      return { ok: true };
    } catch (e) {
      state.alerts = prev; notify();
      return { ok: false, error: e.message };
    }
  }

  function alertsFor(commodity, market) {
    return state.alerts.filter(function (a) {
      return a.commodity === commodity && (!market || a.market === market);
    });
  }

  // ── WIRE TO AUTH ───────────────────────────────────────
  function attach() {
    if (window.agraxAuth && window.agraxAuth.onChange) {
      window.agraxAuth.onChange(function (ctx) {
        var next = ctx.user || null;
        var changed = (next && next.id) !== (state.user && state.user.id);
        state.user = next;
        if (changed || !state.ready) refresh();
        else notify();
      });
    } else {
      // Auth module absent or misconfigured: local-only mode.
      refresh();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  window.agraxStore = {
    state: state,
    onChange: function (fn) {
      listeners.push(fn);
      fn(state);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
      };
    },
    refresh: refresh,
    list: function () { return state.watch.slice(); },
    has: has,
    toggle: toggle,
    addAlert: addAlert,
    removeAlert: removeAlert,
    alertsFor: alertsFor,
    isSignedIn: function () { return !!state.user; }
  };
})();
