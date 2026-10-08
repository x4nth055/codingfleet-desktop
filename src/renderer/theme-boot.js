'use strict';
// Runs before the page paints, so the window never flashes the wrong theme.
(function () {
  const THEMES = ['dark', 'light', 'hacker'];
  const asked = new URLSearchParams(location.search).get('theme');
  const theme = THEMES.includes(asked) ? asked : 'dark';
  document.documentElement.dataset.theme = theme;
  const link = document.getElementById('hljsTheme');
  if (link) link.href = link.dataset[theme] || link.href;
  // The sidebar's width as the user left it, before the first paint. The
  // window clamps it again once it knows its own size (03-sidebar.js).
  try {
    const width = Number(localStorage.getItem('cf.sidebar-width'));
    if (Number.isFinite(width) && width >= 220 && width <= 480) {
      document.documentElement.style.setProperty('--sidebar-width', `${Math.round(width)}px`);
    }
  } catch { /* the usual width, then */ }
})();
