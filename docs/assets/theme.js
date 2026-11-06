(function () {
  const key = 'camera-docs-theme';
  const modes = ['system', 'dark', 'light'];
  const root = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  function storedPreference() {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  }

  function resolvedTheme(preference) {
    if (preference === 'dark' || preference === 'light') return preference;
    return mq.matches ? 'dark' : 'light';
  }

  function apply(preference) {
    const pref = modes.includes(preference) ? preference : 'system';
    const theme = resolvedTheme(pref);
    root.dataset.theme = theme;
    root.dataset.themePreference = pref;

    const group = document.getElementById('theme-toggle');
    if (!group) return;

    group.setAttribute('aria-label', 'Color theme');
    group.querySelectorAll('[data-theme-mode]').forEach((btn) => {
      const active = btn.dataset.themeMode === pref;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
  }

  function setPreference(preference) {
    localStorage.setItem(key, preference);
    apply(preference);
  }

  function isSegmentedControl(el) {
    return Boolean(el && el.querySelector('[data-theme-mode]'));
  }

  function ensureControl() {
    const existing = document.getElementById('theme-toggle');
    if (existing && !isSegmentedControl(existing)) {
      // Drop the legacy single sun/moon button so System/Dark/Light can mount.
      existing.remove();
    } else if (isSegmentedControl(existing)) {
      apply(storedPreference());
      return;
    }

    const group = document.createElement('div');
    group.id = 'theme-toggle';
    group.className = 'theme-toggle';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Color theme');

    const labels = {
      system: 'System',
      dark: 'Dark',
      light: 'Light',
    };

    modes.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-toggle__option';
      btn.dataset.themeMode = mode;
      btn.textContent = labels[mode];
      btn.setAttribute('aria-label', labels[mode] + ' theme');
      btn.addEventListener('click', () => setPreference(mode));
      group.appendChild(btn);
    });

    document.body.appendChild(group);
    apply(storedPreference());
  }

  function onSystemChange() {
    if (storedPreference() === 'system') apply('system');
  }

  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onSystemChange);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(onSystemChange);
  }

  apply(storedPreference());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureControl);
  } else {
    ensureControl();
  }
  window.addEventListener('hashchange', ensureControl);
})();
