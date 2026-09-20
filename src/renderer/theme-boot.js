'use strict';
// Runs before the page paints, so the window never flashes the wrong theme.
(function () {
  const THEMES = ['dark', 'light', 'hacker'];
  const asked = new URLSearchParams(location.search).get('theme');
  const theme = THEMES.includes(asked) ? asked : 'dark';
  document.documentElement.dataset.theme = theme;
  const link = document.getElementById('hljsTheme');
  if (link) link.href = link.dataset[theme] || link.href;
})();
