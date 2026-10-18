// Scene 3: four sub-agents, each on a different low-cost model, move a
// JavaScript codebase to strict TypeScript in parallel.
import { click, type, key, waitFor, sleep, moveTo, showCursor, js, scrollToText } from '../drive.mjs';

export async function scene({ mark = () => {} } = {}) {
  await showCursor(true);
  await js('window.__cursorTo(900, 620, 1)');
  await sleep(500);
  await click('button', { text: 'New session' });
  await sleep(700);
  await click('#folderButton', { ms: 600 });
  await sleep(500);
  await click('#folderList button, #folderList .menu-item', { text: 'invoicely' });
  await sleep(600);
  await click('#modelButton', { ms: 600 });
  await sleep(400);
  await type('haiku', { cps: 9 });
  await sleep(600);
  await click('#modelList .model-row, #modelList button', { text: 'Claude Haiku 5.5' });
  await sleep(500);
  // A big mechanical job: no need to approve every file.
  await click('#permButton', { ms: 600 });
  await sleep(600);
  mark('permissions');
  await click('#permList button, #permList .menu-item', { text: 'Auto-approve' });
  await sleep(500);
  await click('#prompt', { ms: 600 });
  await type('Move the whole codebase to strict TypeScript. Split the work across sub-agents.', { cps: 26 });
  await sleep(400);
  await key('Enter');
  mark('sent');

  await waitFor("document.querySelector('#transcript').textContent.includes('type errors')", { timeout: 60000 });
  mark('baseline');
  await waitFor("document.querySelectorAll('.agent-panel, #agentPanel, .ap-body').length", { timeout: 30000 }).catch(() => {});
  mark('fleet');
  await sleep(1600);
  // Each sub-agent on its own model.
  for (const tab of ['src/auth', 'src/notify', 'src/utils']) {
    await click('.ap-tab', { text: tab, ms: 550 });
    await sleep(1300);
  }
  mark('fleet-busy');
  await waitFor("!document.querySelector('.working')", { timeout: 120000 });
  mark('done');
  await sleep(1200);
  // Back to the conversation, at the agent's summary.
  await click('button[title="Close the panel"]', { ms: 600 });
  await sleep(600);
  await scrollToText('All four are back', { offset: 40, ms: 1100 });
  mark('summary');
  await moveTo([1250, 760], { ms: 900 });
  await sleep(3000);
}
