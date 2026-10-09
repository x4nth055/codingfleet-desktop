'use strict';
// The intelligence pill's tooltip in the model picker: intelligence, speed and
// cost bars, green for the best and red for the worst of the known models.
// Run with: npx electron test/stats-tip.cjs   (MODELS_JSON=path for a real /v1/models answer)
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const model = (id, name, provider, ii, tps, credits, extra = {}) => ({
  id, name, legacy: false, credits_per_20k_tokens: credits, context_window: 200000, supports_vision: true,
  unlimited: false, intelligence_index: ii, output_tokens_per_second: tps,
  provider: { name: provider, logo_url: null }, family: null, effort: { label: 'Standard', rank: 0 }, ...extra,
});
const MODELS = process.env.MODELS_JSON
  ? JSON.parse(fs.readFileSync(process.env.MODELS_JSON, 'utf8')).models
  : [
    model('smart', 'Smart Slow', 'Acme', 55, 40, 40),
    model('fast', 'Fast Cheap', 'Acme', 30, 300, 1),
    model('mid', 'Middle', 'Bolt', 42, null, 3),
    model('incl', 'Included', 'Bolt', 38, 120, 2, { unlimited: true }),
  ];
const PICK = process.env.PICK || 'Middle';

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-stats-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 760,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      $('settings').hidden = true;
      S.settings.hasKey = true;
      S.current = 'stats';
      S.sessions = [{ id: 'stats', title: 'Pick a model', executor: 'client', created_at: new Date().toISOString() }];
      S.loaded.add('stats');
      S.init.state.sessions.stats = { cwd: 'C:/workspace/app' };
      S.models = ${JSON.stringify(MODELS)};
      modelsLoadedAt = Date.now();
      // An Unlimited plan, signed in through the browser: its unlimited models cost no credits here.
      S.credits = { plan: { name: 'Unlimited', unlimited_models: true }, key: { client: 'desktop' } };
      renderSidebar(); renderMain();
      openModelMenu();
      const costOf = async (name) => {
        const pill = [...document.querySelectorAll('#modelList .menu-item')].find((r) => r.textContent.includes(name)).querySelector('.pill.iq');
        pill.dispatchEvent(new MouseEvent('mouseenter'));
        const text = [...document.querySelectorAll('.stats-tip .st-row')][2].children[2].textContent;
        hideStatsTip();
        return text;
      };
      const includedCost = ${process.env.MODELS_JSON ? 'null' : "await costOf('Included')"};
      const rows = [...document.querySelectorAll('#modelList .menu-item')];
      const row = rows.find((r) => r.textContent.includes(${JSON.stringify(PICK)}));
      const pill = row.querySelector('.pill.iq');
      pill.scrollIntoView({ block: 'center' });
      // A scroll hides the card: let this one land first.
      await new Promise((r) => setTimeout(r, 300));
      pill.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 250));
      const card = document.querySelector('.stats-tip');
      return {
        title: card.querySelector('.st-title').textContent,
        rows: [...card.querySelectorAll('.st-row')].map((r) => [r.children[0].textContent, r.children[2].textContent,
          (r.querySelector('.st-fill') || {}).style ? r.querySelector('.st-fill').style.width : null]),
        nativeTitle: pill.title,
        includedCost,
      };
    })()`);
    console.log(JSON.stringify(result));
    assert.equal(result.rows.length, 3);
    assert.equal(result.nativeTitle, '', 'no second, native tooltip');
    if (!process.env.MODELS_JSON) {
      assert.deepEqual(result.rows.map((r) => r[0]), ['Intelligence', 'Speed', 'Cost']);
      assert.equal(result.rows[1][1], 'Unknown', 'an unknown speed says so');
      assert.equal(result.rows[2][1], '3 cr');
      assert.equal(result.includedCost, 'Unlimited', 'a model the plan includes says Unlimited');
    }
    for (const theme of ['dark', 'light', 'hacker']) {
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true;`);
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      const shot = path.join(os.tmpdir(), `codingfleet-stats-tip-${theme}.png`);
      fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      console.log(`screenshot: ${shot}`);
    }
    console.log('PASS stats tooltip');
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((err) => { console.error(err); app.exit(1); });
