/* ================================================================
   agraX — AUTH UI
   ================================================================
   Renders the auth bar (top-right corner) and login/signup modal.
   Depends on auth.js being loaded first.
   ================================================================ */

const authUI = (() => {
  // ── Inject CSS ──
  const style = document.createElement('style');
  style.textContent = `
    /* Auth bar */
    .agrax-auth-bar {
      display: flex; align-items: center; gap: 10px;
      font-family: 'Inter', system-ui, sans-serif; font-size: 13px;
    }
    .agrax-auth-bar .user-email {
      color: #9ca3a8; font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
    }
    .agrax-auth-bar .pro-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      background: rgba(194,65,12,.1); color: #C2410C;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .08em;
    }
    .agrax-auth-bar button {
      padding: 6px 14px; border-radius: 6px; font-size: 12px;
      font-weight: 500; cursor: pointer; border: none;
      font-family: 'Inter', system-ui, sans-serif;
    }
    .agrax-auth-bar .btn-login {
      background: transparent; color: #9ca3a8; border: 1px solid #3a3d3e;
    }
    .agrax-auth-bar .btn-login:hover { color: #fff; border-color: #555; }
    .agrax-auth-bar .btn-signup {
      background: #C2410C; color: #fff;
    }
    .agrax-auth-bar .btn-signup:hover { background: #128a3e; }
    .agrax-auth-bar .btn-logout {
      background: transparent; color: #636a70; border: 1px solid #2a2d30;
      font-size: 11px; padding: 4px 10px;
    }
    .agrax-auth-bar .btn-logout:hover { color: #fff; }
    .agrax-auth-bar .btn-pro {
      background: #C2410C; color: #fff; font-size: 11px;
    }

    /* Modal overlay */
    .agrax-auth-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,.5); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none; transition: opacity .2s;
    }
    .agrax-auth-overlay.open { opacity: 1; pointer-events: all; }

    /* Modal */
    .agrax-auth-modal {
      background: #fff; border-radius: 12px; padding: 32px;
      width: 380px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0,0,0,.2);
      position: relative;
    }
    .agrax-auth-modal .close-btn {
      position: absolute; top: 12px; right: 16px;
      background: none; border: none; font-size: 20px; color: #8b8f80;
      cursor: pointer;
    }
    .agrax-auth-modal .close-btn:hover { color: #1a1e16; }
    .agrax-auth-modal .modal-logo {
      font-size: 22px; font-weight: 700; letter-spacing: -.04em;
      color: #0F1B14; margin-bottom: 4px;
    }
    .agrax-auth-modal .modal-logo span { color: #C2410C; }
    .agrax-auth-modal h2 {
      font-size: 18px; font-weight: 600; color: #1a1e16; margin-bottom: 4px;
    }
    .agrax-auth-modal .modal-sub {
      font-size: 13px; color: #8b8f80; margin-bottom: 20px;
    }
    .agrax-auth-modal label {
      display: block; font-size: 12px; font-weight: 500; color: #4a5045;
      margin-bottom: 4px; margin-top: 12px;
    }
    .agrax-auth-modal input[type="email"],
    .agrax-auth-modal input[type="password"] {
      width: 100%; padding: 10px 12px; border: 1px solid #E2E3DD;
      border-radius: 6px; font-size: 14px; color: #1a1e16;
      font-family: 'Inter', system-ui, sans-serif;
      outline: none; background: #FAFAF8;
    }
    .agrax-auth-modal input:focus { border-color: #C2410C; }
    .agrax-auth-modal .submit-btn {
      width: 100%; padding: 10px; border: none; border-radius: 6px;
      background: #C2410C; color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer; margin-top: 20px;
      font-family: 'Inter', system-ui, sans-serif;
    }
    .agrax-auth-modal .submit-btn:hover { background: #128a3e; }
    .agrax-auth-modal .submit-btn:disabled {
      background: #ccc; cursor: not-allowed;
    }
    .agrax-auth-modal .toggle-mode {
      text-align: center; margin-top: 16px; font-size: 13px; color: #8b8f80;
    }
    .agrax-auth-modal .toggle-mode a {
      color: #C2410C; text-decoration: none; font-weight: 500; cursor: pointer;
    }
    .agrax-auth-modal .toggle-mode a:hover { text-decoration: underline; }
    .agrax-auth-modal .auth-error {
      background: rgba(185,28,28,.08); color: #B91C1C; padding: 8px 12px;
      border-radius: 6px; font-size: 12px; margin-top: 12px; display: none;
    }
    .agrax-auth-modal .auth-success {
      background: rgba(194,65,12,.08); color: #C2410C; padding: 8px 12px;
      border-radius: 6px; font-size: 12px; margin-top: 12px; display: none;
    }
    .agrax-auth-modal .forgot-link {
      display: block; text-align: right; font-size: 11px; color: #8b8f80;
      margin-top: 6px; cursor: pointer; text-decoration: none;
    }
    .agrax-auth-modal .forgot-link:hover { color: #C2410C; }
  `;
  document.head.appendChild(style);

  // ── Create modal HTML ──
  const overlay = document.createElement('div');
  overlay.className = 'agrax-auth-overlay';
  overlay.innerHTML = `
    <div class="agrax-auth-modal">
      <button class="close-btn" onclick="agraxAuthUI.close()">×</button>
      <div class="modal-logo">agra<span>X</span></div>
      <h2 id="auth-modal-title">Sign in</h2>
      <p class="modal-sub" id="auth-modal-sub">Access your watchlist, alerts, and Pro features.</p>
      <form id="agrax-auth-form" onsubmit="return agraxAuthUI.handleSubmit(event)">
        <label for="auth-email">Email</label>
        <input type="email" id="auth-email" placeholder="you@company.com" required />
        <label for="auth-password">Password</label>
        <input type="password" id="auth-password" placeholder="••••••••" required minlength="6" />
        <a class="forgot-link" id="auth-forgot" onclick="agraxAuthUI.handleForgot()">Forgot password?</a>
        <button type="submit" class="submit-btn" id="auth-submit-btn">Sign in</button>
      </form>
      <div class="auth-error" id="auth-error"></div>
      <div class="auth-success" id="auth-success"></div>
      <div class="toggle-mode" id="auth-toggle">
        Don't have an account? <a onclick="agraxAuthUI.setMode('signup')">Sign up free</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  let mode = 'login'; // 'login' | 'signup'

  function setMode(m) {
    mode = m;
    const title = document.getElementById('auth-modal-title');
    const sub = document.getElementById('auth-modal-sub');
    const btn = document.getElementById('auth-submit-btn');
    const toggle = document.getElementById('auth-toggle');
    const forgot = document.getElementById('auth-forgot');
    const errEl = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');

    errEl.style.display = 'none';
    successEl.style.display = 'none';

    if (m === 'signup') {
      title.textContent = 'Create an account';
      sub.textContent = 'Free forever. Upgrade to Pro anytime.';
      btn.textContent = 'Create account';
      toggle.innerHTML = 'Already have an account? <a onclick="agraxAuthUI.setMode(\'login\')">Sign in</a>';
      forgot.style.display = 'none';
    } else {
      title.textContent = 'Sign in';
      sub.textContent = 'Access your watchlist, alerts, and Pro features.';
      btn.textContent = 'Sign in';
      toggle.innerHTML = 'Don\'t have an account? <a onclick="agraxAuthUI.setMode(\'signup\')">Sign up free</a>';
      forgot.style.display = 'block';
    }
  }

  function open(initialMode = 'login') {
    setMode(initialMode);
    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';
    overlay.classList.add('open');
  }

  function close() {
    overlay.classList.remove('open');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const btn = document.getElementById('auth-submit-btn');
    const errEl = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');

    errEl.style.display = 'none';
    successEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';

    try {
      if (mode === 'signup') {
        await auth.signUp(email, password);
        successEl.textContent = 'Account created! Check your email to confirm, then sign in.';
        successEl.style.display = 'block';
        btn.textContent = 'Create account';
        btn.disabled = false;
      } else {
        await auth.logIn(email, password);
        close();
      }
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong. Try again.';
      errEl.style.display = 'block';
      btn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      btn.disabled = false;
    }
  }

  async function handleForgot() {
    const email = document.getElementById('auth-email').value.trim();
    const errEl = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');

    if (!email) {
      errEl.textContent = 'Enter your email address first.';
      errEl.style.display = 'block';
      return;
    }

    try {
      await auth.resetPassword(email);
      successEl.textContent = 'Password reset link sent to ' + email;
      successEl.style.display = 'block';
      errEl.style.display = 'none';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  // ── Render auth bar into a container element ──
  function renderBar(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    function update({ user, profile }) {
      if (user) {
        const proTag = profile?.subscription_status === 'active'
          ? '<span class="pro-badge">Pro</span>'
          : '<button class="btn-pro" onclick="agraxAuthUI.goToPro()">Go Pro</button>';
        container.innerHTML = `
          <div class="agrax-auth-bar">
            <span class="user-email">${user.email}</span>
            ${proTag}
            <button class="btn-logout" onclick="agraxAuth.logOut()">Log out</button>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="agrax-auth-bar">
            <button class="btn-login" onclick="agraxAuthUI.open('login')">Sign in</button>
            <button class="btn-signup" onclick="agraxAuthUI.open('signup')">Sign up free</button>
          </div>
        `;
      }
    }

    if (auth) {
      auth.onChange(update);
    } else {
      // Auth not available, show signup buttons anyway
      container.innerHTML = `
        <div class="agrax-auth-bar">
          <button class="btn-login" onclick="agraxAuthUI.open('login')">Sign in</button>
          <button class="btn-signup" onclick="agraxAuthUI.open('signup')">Sign up free</button>
        </div>
      `;
    }
  }

  async function goToPro() {
    const user = auth.getUser();
    if (!user) {
      open('signup');
      return;
    }

    try {
      const res = await fetch(window.AGRAX_API_BASE + '/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, email: user.email }),
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert('Could not start checkout. Please try again.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Could not start checkout. Please try again.');
    }
  }

  return {
    open,
    close,
    setMode,
    handleSubmit,
    handleForgot,
    renderBar,
    goToPro,
  };
})();

if (typeof window !== 'undefined') window.agraxAuthUI = authUI;
