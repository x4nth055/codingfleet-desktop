'use strict';
// A sub-agent's call on this computer is asked about like the main agent's:
// the sub-agents panel opens on it, its approval bar sits in the panel, and
// the buttons and the Alt keys send the answer for that call.
// Run with: npx electron test/subagent-approval.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-subagent-approval-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 860,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js(`
      $('settings').hidden = true;
      S.settings.hasKey = true;
      S.current = 'sub';
      S.sessions = [{ id: 'sub', title: 'Delegated work', executor: 'client', created_at: new Date().toISOString() }];
      S.loaded.add('sub');
      S.init.state.sessions.sub = { cwd: 'C:/workspace/app' };
      S.running.set('sub', { started: Date.now(), turnStart: 0 });
      renderSidebar(); renderMain();
      window.emit = (event, data = {}) => onRunEvent({ sessionId: 'sub', event, data });
      window.frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.panel = () => {
        const node = $('agentsPanel');
        return {
          open: !node.hidden,
          state: node.querySelector('.ap-state')?.textContent || null,
          bars: [...node.querySelectorAll('.approval')].map((bar) =>
            [...bar.querySelectorAll('button')].map((b) => b.firstChild.textContent)),
        };
      };
      window.spawnRow = () => document.querySelector('.agent-tool .tool-meta')?.textContent;
      window.statusOf = (id) => findTool('sub', id)?.status;
      emit('tool.call', { id: 'SPAWN', name: 'spawn_agent', arguments: { role: 'Worker', task: 'Fix the failing build' } });
      emit('subagent.started', { agent_id: 'A', role: 'Worker', call_id: 'SPAWN', task: 'Fix the failing build' });
      true;
    `);

    // 1. An edit: the panel shows the usual three choices, and Allow answers it.
    const edit = await js(`(async () => {
      closePanel();
      emit('tool.call', { id: 'c1', agent_id: 'A', name: 'fs_edit', executor: 'client',
        arguments: { path: 'src/build.js', old: 'broken()', new: 'fixed()' } });
      const queued = statusOf('c1');
      emit('client.approval', { id: 'c1', reason: 'changes files' });
      await frame();
      const asked = { ...panel(), row: spawnRow(), status: statusOf('c1') };
      $('agentsPanel').querySelector('.approval .btn.primary').click();
      await new Promise((r) => setTimeout(r, 30));
      await frame();
      const answered = { ...panel(), status: statusOf('c1'), decisions: await cf.decisions() };
      emit('client.tool_running', { id: 'c1' });
      emit('tool.result', { id: 'c1', agent_id: 'A', name: 'fs_edit', ok: true, output: 'edited' });
      await frame();
      return { queued, asked, answered, done: statusOf('c1'), row: spawnRow() };
    })()`);
    assert.equal(edit.queued, 'queued');
    assert.equal(edit.asked.open, true, 'the panel opens on the agent that asks');
    assert.equal(edit.asked.state, 'Needs approval');
    assert.equal(edit.asked.row, 'Needs approval', 'the spawn_agent row says it waits');
    assert.equal(edit.asked.status, 'waiting');
    assert.deepEqual(edit.asked.bars, [['Deny', 'Allow all file changes this session', 'Allow']]);
    assert.deepEqual(edit.answered.bars, [], 'the bar goes once answered');
    assert.equal(edit.answered.status, 'queued');
    assert.deepEqual(edit.answered.decisions, [{ callId: 'c1', decision: 'allow' }]);
    assert.equal(edit.done, 'done');
    assert.notEqual(edit.row, 'Needs approval');

    // 2. A destructive command: always asked, two choices, and Deny sticks
    // through the declined result the run sends back.
    const risky = await js(`(async () => {
      emit('tool.call', { id: 'c2', agent_id: 'A', name: 'run_command', executor: 'client', arguments: { command: 'rm -rf build' } });
      emit('client.approval', { id: 'c2', reason: 'may delete or overwrite data' });
      await frame();
      const asked = panel();
      const risky = !!$('agentsPanel').querySelector('.approval.risky');
      $('agentsPanel').querySelector('.approval .btn.danger').click();
      await new Promise((r) => setTimeout(r, 30));
      emit('client.tool_denied', { id: 'c2' });
      emit('tool.result', { id: 'c2', agent_id: 'A', name: 'run_command', ok: false, output: 'The user declined this tool call.' });
      // The sub-agent's calls share one group: open it to see each call's line.
      findTool('sub', 'c2').group.open = true;
      renderPanel();
      const meta = [...$('agentsPanel').querySelectorAll('.tool-meta')].map((n) => n.textContent);
      return { asked, risky, status: statusOf('c2'), meta, decisions: await cf.decisions() };
    })()`);
    assert.deepEqual(risky.asked.bars, [['Deny', 'Allow']], 'no "allow all" for a destructive command');
    assert.equal(risky.risky, true);
    assert.equal(risky.status, 'denied');
    assert.ok(risky.meta.includes('Declined'), risky.meta.join(','));
    assert.deepEqual(risky.decisions.at(-1), { callId: 'c2', decision: 'deny' });

    // 3. The keys: the oldest call waiting answers to them, the main agent's
    // first, then the sub-agent's. Alt+A allows it for the session.
    const keys = await js(`(async () => {
      const press = (code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, altKey: true, bubbles: true }));
      emit('tool.call', { id: 'm1', name: 'run_command', executor: 'client', arguments: { command: 'npm test' } });
      emit('client.approval', { id: 'm1', reason: 'runs a command' });
      emit('tool.call', { id: 'c3', agent_id: 'A', name: 'run_command', executor: 'client', arguments: { command: 'npm run build' } });
      emit('client.approval', { id: 'c3', reason: 'runs a command' });
      await frame();
      const keyed = [...document.querySelectorAll('.approval-kbd')].length;
      press('KeyY');
      await new Promise((r) => setTimeout(r, 30));
      const first = { m1: statusOf('m1'), c3: statusOf('c3') };
      press('KeyA');
      await new Promise((r) => setTimeout(r, 30));
      return { keyed, first, second: { c3: statusOf('c3') }, decisions: (await cf.decisions()).slice(-2) };
    })()`);
    assert.equal(keys.keyed, 3, 'only the oldest bar shows its keys');
    assert.deepEqual(keys.first, { m1: 'queued', c3: 'waiting' });
    assert.deepEqual(keys.second, { c3: 'queued' });
    assert.deepEqual(keys.decisions, [{ callId: 'm1', decision: 'allow' }, { callId: 'c3', decision: 'allow-session' }]);

    // 4. A group taller than the panel, for someone following its end: the
    // panel scrolls on to the bar, and the group keeps its height rather than
    // shrinking and clipping the bar away. (Scrolled up, the panel keeps the
    // reader's place, as the conversation does; the Alt keys still answer.)
    const tall = await js(`(async () => {
      const end = $('agentsPanel').querySelector('.ap-body');
      end.scrollTop = end.scrollHeight;
      emit('tool.call', { id: 'c4', agent_id: 'A', name: 'fs_write', executor: 'client',
        arguments: { path: 'src/new-file.js', content: 'export const ok = true;\\n'.repeat(30) } });
      findTool('sub', 'c4').open = true;
      emit('client.approval', { id: 'c4', reason: 'changes files' });
      await frame();
      const body = $('agentsPanel').querySelector('.ap-body');
      const group = findTool('sub', 'c4').group;
      const node = [...body.querySelectorAll('.tool-group')].pop();
      const allow = body.querySelector('.approval .btn.primary');
      const r = allow.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { clipped: node.scrollHeight - node.clientHeight, scrolls: body.scrollHeight > body.clientHeight,
        reachable: allow.contains(hit), open: group.open || groupStatus(group.tools) === 'waiting' };
    })()`);
    assert.equal(tall.open, true);
    assert.equal(tall.scrolls, true, 'the panel scrolls');
    assert.ok(tall.clipped <= 1, `the group is not cut off (${tall.clipped}px hidden)`);
    assert.equal(tall.reachable, true, 'Allow is on screen and clickable');
    for (const theme of ['dark', 'light']) {
      await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; frame();`);
      await js('frame()');
      const shot = path.join(os.tmpdir(), `codingfleet-subagent-approval-${theme}.png`);
      fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      console.log(`screenshot: ${shot}`);
    }
    const clicked = await js(`(async () => {
      const r = $('agentsPanel').querySelector('.approval .btn.primary').getBoundingClientRect();
      document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: statusOf('c4'), last: (await cf.decisions()).at(-1) };
    })()`);
    assert.deepEqual(clicked, { status: 'queued', last: { callId: 'c4', decision: 'allow' } });
    console.log('PASS sub-agent approvals');
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((err) => { console.error(err); app.exit(1); });
