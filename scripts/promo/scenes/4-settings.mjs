// Scene 4: a quick look around: MCP connectors, then the three themes.
import { click, sleep, moveTo, showCursor, js } from '../drive.mjs';

export async function scene({ mark = () => {} } = {}) {
  await showCursor(true);
  await js('window.__cursorTo(900, 620, 1)');
  await sleep(600);
  await click('button[title="Settings"]', { ms: 900 });
  await sleep(700);
  await click('#settingsTabs [data-tab="mcp"]', { ms: 700 });
  await sleep(500);
  mark('mcp');
  for (const group of ['Developer Tools', 'Docs & Knowledge']) {
    await click('#settings button, #settings summary, #settings .mcp-group-head', { text: group, ms: 600 });
    await sleep(900);
  }
  mark('mcp-open');
  await sleep(1200);
  await click('#settingsTabs [data-tab="preferences"]', { ms: 700 });
  await sleep(800);
  mark('themes');
  for (const theme of ['Hacker', 'Light', 'Dark']) {
    await click('#settings button, #settings .theme-card', { text: theme, ms: 600 });
    mark(`theme-${theme.toLowerCase()}`);
    await sleep(1700);
  }
  await moveTo([1400, 500], { ms: 700 });
  await sleep(800);
}
