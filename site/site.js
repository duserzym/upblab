(() => {
  const root = document.documentElement;
  const key = 'upblab-manual-theme';
  let theme = 'system';
  try { theme = localStorage.getItem(key) || 'system'; } catch { /* Storage may be unavailable. */ }
  if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = theme;
    const dark = theme === 'dark' || theme === 'system' && preference.matches;
    document.querySelectorAll('picture source[data-dark]').forEach(source => {
      source.media = dark ? 'all' : 'not all';
    });
  };
  root.classList.add('js');
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    const select = document.querySelector('#theme');
    select.value = theme;
    select.addEventListener('change', () => {
      theme = select.value;
      try {
        if (theme === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, theme);
      } catch { /* Keep the selection for this page when storage is unavailable. */ }
      apply();
    });
    const toggle = document.querySelector('.nav-toggle');
    const sidebar = document.querySelector('.sidebar');
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    sidebar.addEventListener('keydown', event => {
      if (event.key === 'Escape' && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
    preference.addEventListener('change', apply);
  });
})();
