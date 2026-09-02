/* ================================================================
   AgraX — SHELL (header nav)
   ================================================================
   New design uses a top header, not a sidebar.
   Shell.render() returns the header HTML.
   ================================================================ */

const Shell = {
  render(active = 'browse') {
    return {
      header: `
        <header class="header">
          <div class="header__inner">
            <a href="/" class="header__logo">
              <div class="header__logo-mark">A</div>
              <span class="header__logo-word">AgraX</span>
            </a>
            <nav class="header__nav">
              <a href="/browse" class="header__link${active === 'browse' ? ' style="color:#fff"' : ''}">Browse</a>
              <a href="/app" class="header__link header__link--pro${active === 'pro' ? ' style="color:#fff"' : ''}">Pro</a>
              <a href="#" class="header__link" id="auth-link">Sign in</a>
            </nav>
          </div>
        </header>
      `,
    };
  },
};

if (typeof window !== 'undefined') window.Shell = Shell;
