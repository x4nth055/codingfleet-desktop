'use strict';
// Runs before the page paints, so the window never flashes the wrong theme.
(function () {
  const THEMES = ['dark', 'light', 'hacker'];
  const asked = new URLSearchParams(location.search).get('theme');
  const theme = THEMES.includes(asked) ? asked : 'dark';
  document.documentElement.dataset.theme = theme;
  const link = document.getElementById('hljsTheme');
  if (link) link.href = link.dataset[theme] || link.href;
  // The fonts chosen in Preferences (fonts.css has the faces).
  try {
    const font = localStorage.getItem('cf.font');
    const mono = localStorage.getItem('cf.mono-font');
    if (['inter', 'geist', 'plex', 'system'].includes(font)) document.documentElement.dataset.font = font;
    if (['jetbrains', 'geist-mono', 'fira-code', 'system'].includes(mono)) document.documentElement.dataset.monoFont = mono;
  } catch { /* the usual fonts, then */ }
  // The sidebar hidden, if it was when the app closed (03-sidebar.js).
  try {
    if (localStorage.getItem('cf.sidebar-hidden') === '1') document.documentElement.classList.add('sidebar-hidden');
  } catch { /* shown, then */ }
  // The sidebar's width as the user left it, before the first paint. The
  // window clamps it again once it knows its own size (03-sidebar.js).
  try {
    const width = Number(localStorage.getItem('cf.sidebar-width'));
    if (Number.isFinite(width) && width >= 220 && width <= 480) {
      document.documentElement.style.setProperty('--sidebar-width', `${Math.round(width)}px`);
    }
  } catch { /* the usual width, then */ }
})();
