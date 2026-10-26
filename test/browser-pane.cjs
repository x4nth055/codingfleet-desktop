'use strict';
// The browser pane's page is drawn by the main process over #browserHost, so
// the window tells it where that is: after anything moves the pane, and not on
// every frame while nothing does.
// Run with: npx electron test/browser-pane.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-pane-')));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1320, height: 860,
    webPreferences: { preload: path.join(__dirname, 'fixtures/browser-pane-preload.js'), backgroundThrottling: false },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js(`
      $('settings').hidden = true;
      S.settings.hasKey = true;
      renderSidebar(); renderMain();
      window.frames = (n) => new Promise((resolve) => {
        const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve());
        step();
      });
      window.wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // Until the pane is no longer followed. A hidden window can be down to a
      // frame a second, so only the checks that it stops wait for this.
      window.settled = async () => {
        await frames(2);
        for (let i = 0; i < 80 && BROWSER.frame; i++) await frames(1);
      };
      // Where the pane is, and the last place the main process was told.
      window.where = async () => {
        const r = $('browserHost').getBoundingClientRect();
        const last = (await cf.layouts()).at(-1);
        const round = (rect) => [rect.x ?? rect.left, rect.y ?? rect.top, rect.width, rect.height].map(Math.round);
        return { told: round(last.rect), is: round(r), visible: last.visible, count: (await cf.layouts()).length,
          following: BROWSER.frame !== 0 };
      };
      true;
    `);
    // Wait for the page state (wireBrowser) before opening the pane.
    await js('wait(100)');

    const opened = await js('(async () => { openBrowserPanel({ focus: false }); await frames(2); return where(); })()');
    assert.equal(opened.visible, true, 'the pane is shown');
    assert.deepEqual(opened.told, opened.is, 'the main process knows where it is');

    const idle = await js(`(async () => {
      await settled();
      const before = await where();
      await frames(5);
      return { before, after: await where() };
    })()`);
    assert.equal(idle.after.following, false, 'nothing moves: no frame loop');
    assert.equal(idle.after.count, idle.before.count, 'and nothing sent');

    const slid = await js(`(async () => {
      const before = await where();
      setSidebarHidden(true);
      await wait(350);
      await frames(2);
      const after = await where();
      setSidebarHidden(false);
      await wait(350);
      await settled();
      return { before, after, back: await where() };
    })()`);
    assert.ok(slid.after.is[0] < slid.before.is[0], 'the sidebar shutting moves the pane');
    assert.deepEqual(slid.after.told, slid.after.is, 'the sidebar shut');
    assert.deepEqual(slid.back.told, slid.back.is, 'and open again');
    assert.equal(slid.back.following, false, 'then it stops');

    // Moving without changing size, the way a slide does: followed frame by
    // frame. A hidden window has few frames, so the slide is stepped by hand.
    const glided = await js(`(async () => {
      const app = document.querySelector('.app');
      app.style.transition = 'transform 1s linear';
      app.style.transform = 'translateX(60px)';
      const slide = app.getAnimations().find((a) => a.transitionProperty === 'transform');
      slide.pause();
      const steps = [];
      for (const at of [100, 250, 400, 550, 700, 850]) {
        slide.currentTime = at;
        await frames(2);
        const now = await where();
        steps.push({ told: now.told[0], is: now.is[0] });
      }
      slide.finish();
      await frames(2);
      const after = await where();
      app.style.transform = '';
      for (const animation of app.getAnimations()) animation.finish();
      await frames(2);
      app.style.transition = '';
      return { steps, after, back: await where() };
    })()`);
    assert.equal(new Set(glided.steps.map((s) => s.is)).size, glided.steps.length, 'the pane moved at every step');
    for (const step of glided.steps) assert.equal(step.told, step.is, `followed to ${step.is}`);
    assert.deepEqual(glided.after.told, glided.after.is, 'to where it stopped');
    assert.deepEqual(glided.back.told, glided.back.is);

    const resized = await js(`(async () => {
      TERM.height = 420;
      applyTerminalSize();
      await frames(2);
      const taller = await where();
      setTerminalPosition('right');
      await frames(2);
      const right = await where();
      return { taller, right };
    })()`);
    assert.deepEqual(resized.taller.told, resized.taller.is, 'a taller panel');
    assert.deepEqual(resized.right.told, resized.right.is, 'the panel on the right');

    win.setContentSize(1100, 800);
    const smaller = await js('(async () => { await frames(2); return where(); })()');
    assert.deepEqual(smaller.told, smaller.is, 'a smaller window');

    const covered = await js(`(async () => {
      $('settings').hidden = false;
      await frames(2);
      const open = await where();
      $('settings').hidden = true;
      await frames(2);
      const closed = await where();
      closeTerminalPanel();
      await settled();
      return { open, closed, hidden: await where() };
    })()`);
    assert.equal(covered.open.visible, false, 'a dialog hides the page');
    assert.equal(covered.closed.visible, true, 'and shows it again once closed');
    assert.equal(covered.hidden.visible, false, 'a closed pane hides the page');
    assert.equal(covered.hidden.following, false);
    console.log('PASS browser pane: followed when it moves, idle otherwise');
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((err) => { console.error(err); app.exit(1); });
