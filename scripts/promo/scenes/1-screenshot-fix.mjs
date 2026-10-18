// Scene 1: paste a screenshot of a broken phone layout; the agent fixes the
// CSS, starts the dev server in the background and checks its own work.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ctl } from '../ctl.mjs';
import { click, moveTo, type, key, waitFor, sleep, js, showCursor } from '../drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BROKEN = path.join(HERE, '..', 'assets', 'wayfare-broken.png');

export async function scene({ mark = () => {} } = {}) {
  await showCursor(true);
  await js(`window.__cursorTo(900, 620, 1)`);
  await sleep(600);
  // A new session in the project folder.
  await click('#newSession, .new-session, button', { text: 'New session' });
  await sleep(900);
  await click('#prompt', { ms: 700 });
  // Paste the screenshot from the clipboard.
  await ctl('clipboard', { image: BROKEN });
  await sleep(250);
  await key('V', ['control']);
  await sleep(1100);
  mark('pasted');
  await type('The trip page is broken on iPhone, the Book button is cut off. Fix it and check it on a phone screen.', { cps: 24 });
  await sleep(500);
  await key('Enter');
  mark('sent');

  // First edit: allow every file change of this session.
  await waitFor("document.querySelector('.approval')", { timeout: 30000 });
  await sleep(1600);
  mark('first-approval');
  await click('.approval .btn', { text: 'Allow all file changes' });
  // The two commands: the dev server (background) and the snapshot.
  for (let i = 0; i < 2; i++) {
    await waitFor("document.querySelector('.approval .btn.primary')", { timeout: 30000 });
    await sleep(1100);
    mark(`command-${i + 1}`);
    await click('.approval .btn.primary', { ms: 450 });
  }
  await waitFor("!document.querySelector('.working')", { timeout: 60000 });
  mark('done');
  await sleep(900);
  // Open the steps that hold the agent's own phone screenshot.
  await click('.tool-group .tool-head', { text: 'Ran 2 commands' });
  await sleep(800);
  await click('.tool', { text: 'View image' });
  await sleep(500);
  await js(`document.querySelector('.tool img')?.scrollIntoView({ block: 'center', behavior: 'smooth' })`);
  await sleep(900);
  mark('checked');
  await moveTo([1500, 560], { ms: 900 });
  await sleep(2500);
}
