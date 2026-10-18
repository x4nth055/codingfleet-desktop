// Scene 2: a slow endpoint on GPT-6 Luna. The agent measures, finds the N+1
// query, is steered mid-run, fixes it and proves it with the benchmark.
import { click, type, key, waitFor, sleep, moveTo, showCursor, js } from '../drive.mjs';

export async function scene({ mark = () => {} } = {}) {
  await showCursor(true);
  await js('window.__cursorTo(900, 620, 1)');
  await sleep(500);
  await click('button', { text: 'New session' });
  await sleep(700);
  // The project, then the model.
  await click('#folderButton', { ms: 600 });
  await sleep(500);
  await click('#folderList button, #folderList .menu-item', { text: 'storefront-api' });
  await sleep(600);
  await click('#modelButton', { ms: 600 });
  await sleep(500);
  mark('models');
  await type('luna', { cps: 9 });
  await sleep(700);
  await click('#modelList .model-row, #modelList button', { text: 'GPT-6 Luna' });
  await sleep(600);
  await click('#prompt', { ms: 600 });
  await type("GET /orders got slow after yesterday's deploy, p99 is over 3 seconds. Find out why and fix it.", { cps: 26 });
  await sleep(400);
  await key('Enter');
  mark('sent');

  // The benchmark: commands are fine for this session.
  await waitFor("document.querySelector('.approval')", { timeout: 30000 });
  await sleep(1300);
  await click('.approval .btn', { text: 'Allow all commands' });
  mark('bench');

  // The agent explains the N+1; a correction while it works.
  await waitFor("document.querySelector('#transcript').textContent.includes('in one query each instead')", { timeout: 60000 });
  await sleep(600);
  await click('#prompt', { ms: 700 });
  mark('steer');
  await type('Keep the response shape exactly the same, the mobile app depends on it.', { cps: 24 });
  await sleep(300);
  await key('Enter');
  mark('steered');

  // The edit, shown before it is made.
  await waitFor("document.querySelector('.approval')", { timeout: 30000 });
  await sleep(2200);
  mark('edit');
  await click('.approval .btn.primary', { ms: 500 });
  await waitFor("!document.querySelector('.working')", { timeout: 90000 });
  mark('done');
  await moveTo([1250, 700], { ms: 900 });
  await sleep(3500);
  // Changed your mind? The whole run goes back in one click.
  await click('.undo-button', { ms: 800 });
  await sleep(900);
  mark('undo-confirm');
  await click('button', { text: 'Undo the run', ms: 500 });
  await waitFor("document.querySelector('#transcript').textContent.includes('Undone')", { timeout: 15000 });
  mark('undone');
  await moveTo([1250, 760], { ms: 900 });
  await sleep(2500);
}
