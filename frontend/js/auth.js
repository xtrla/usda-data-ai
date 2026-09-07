/* ================================================================
   agraX — AUTH MODULE
   ================================================================
   Uses Supabase Auth for email/password authentication.
   Manages session state and Pro subscription gating.
   
   Dependencies: config.js must be loaded first (provides
   AGRAX_SUPABASE_URL and AGRAX_SUPABASE_ANON_KEY).
   
   Supabase JS SDK loaded via CDN in HTML files:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
   ================================================================ */

const auth = (() => {
  // ── Supabase client ──
  const supabaseUrl = window.AGRAX_SUPABASE_URL;
  const supabaseKey = window.AGRAX_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[auth] Missing Supabase config. Auth disabled.');
    return null;
  }

  // The SDK comes from a CDN, which can be blocked or simply slow. Bailing
  // out here leaves window.agraxAuth null and the app in local-only mode,
  // instead of throwing and taking every later script down with it.
  if (!window.supabase || !window.supabase.createClient) {
    console.warn('[auth] Supabase SDK not loaded. Auth disabled.');
    return null;
  }

  let sb;
  try {
    sb = window.supabase.createClient(supabaseUrl, supabaseKey);
  } catch (e) {
    console.warn('[auth] Could not create Supabase client:', e);
    return null;
  }

  // ── State ──
  let currentUser = null;
  let currentProfile = null;
  let listeners = [];

  // ── Notify listeners on auth change ──
  function notify() {
    listeners.forEach(fn => fn({ user: currentUser, profile: currentProfile }));
  }

  // ── Fetch profile from profiles table ──
  async function fetchProfile(userId) {
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) {
        console.warn('[auth] Profile fetch error:', error.message);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[auth] Profile fetch exception:', e);
      return null;
    }
  }

  // ── Initialize: check existing session ──
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      currentProfile = await fetchProfile(session.user.id);
      notify();
    }

    // Listen for auth state changes (login, logout, token refresh)
    sb.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        currentUser = session.user;
        currentProfile = await fetchProfile(session.user.id);
      } else {
        currentUser = null;
        currentProfile = null;
      }
      notify();
    });
  }

  // ── Sign up with email/password ──
  async function signUp(email, password) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + '/app',
      }
    });
    if (error) throw error;
    return data;
  }

  // ── Log in with email/password ──
  async function logIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    currentUser = data.user;
    currentProfile = await fetchProfile(data.user.id);
    notify();
    return data;
  }

  // ── Log out ──
  async function logOut() {
    await sb.auth.signOut();
    currentUser = null;
    currentProfile = null;
    notify();
  }

  // ── Password reset ──
  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/auth/reset',
    });
    if (error) throw error;
  }

  // ── Check if user is Pro ──
  function isPro() {
    return currentProfile?.subscription_status === 'active';
  }

  // ── Get current user ──
  function getUser() {
    return currentUser;
  }

  // ── Get current profile ──
  function getProfile() {
    return currentProfile;
  }

  // ── Subscribe to auth changes ──
  function onChange(fn) {
    listeners.push(fn);
    // Immediately call with current state
    fn({ user: currentUser, profile: currentProfile });
    // Return unsubscribe function
    return () => { listeners = listeners.filter(f => f !== fn); };
  }

  // ── Get Supabase client (for direct queries if needed) ──
  function getClient() {
    return sb;
  }

  // ── Auto-init ──
  init().catch(function (e) { console.warn('[auth] init failed:', e); });

  return {
    signUp,
    logIn,
    logOut,
    resetPassword,
    isPro,
    getUser,
    getProfile,
    getClient,
    onChange,
  };
})();

// Expose globally
if (typeof window !== 'undefined') window.agraxAuth = auth;
