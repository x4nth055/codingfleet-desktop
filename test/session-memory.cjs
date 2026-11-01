'use strict';
// The sessions the window keeps, in the real window: the five opened last as
// they are, any other packed in memory and read back with no request to the
// server, no session's drawing kept once it is left, and a long session drawn
// from its newest turns, with earlier ones drawn as it is scrolled up.
// Run with: npx electron test/session-memory.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-session-memory-')));

// Sessions m0..m5 are in memory already (120 turns each: prompts, tools with
// output, answers with code, edited files, footers; m0 also has a sub-agent and
// a turn the window drew itself). s6 and s7 are read from the server.
const SETUP = `
  window.frames = (n) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
  window.wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.build = (id, turns) => {
    const code = Array.from({ length: 12 }, (_, i) => 'const value' + i + ' = compute(' + i + ');').join('\\n');
    const items = [{ type: 'note', text: 'Following AGENTS.md from this folder.' }];
    for (let t = 0; t < turns; t++) {
      items.push({ type: 'user', text: id + ' turn ' + t + ': refactor the module — and explain ✓', at: new Date(Date.UTC(2026, 9, 1, 9, t)).toISOString() });
      if (t % 10 === 3) items.push({ type: 'user', text: 'also the docs for ' + t, steer: true });
      items.push({ type: 'stamp', at: new Date(Date.UTC(2026, 9, 1, 9, t, 5)).toISOString() });
      const group = { type: 'tools', sessionId: id, tools: [], open: false };
      for (let k = 0; k < 2; k++) {
        group.tools.push({ id: id + '_' + t + '_' + k, group, name: 'run_command', arguments: { command: 'npm test ' + k },
          status: 'done', output: { stdout: ('PASS test ' + t + '\\n').repeat(40), stderr: '', exit_code: 0 } });
      }
      items.push(group);
      items.push({ type: 'assistant', text: 'Turn ' + t + ' in ' + id + ':\\n\\n\\u0060\\u0060\\u0060js\\n' + code + '\\n\\u0060\\u0060\\u0060\\n\\nDone.' });
      if (t % 20 === 0) items.push({ type: 'files', sessionId: id, files: [{ path: 'a.js', added: 2, removed: 1, binary: false, hunks: [] }], open: new Set([0]), runId: 'r' + t });
      items.push({ type: 'footer', model: 'auto', usage: { credits: 0.25 } });
    }
    return items;
  };
  // The data of a transcript: what a copy holds, nodes and back links aside.
  window.dataOf = (value) => JSON.stringify(value, (key, v) => {
    if (v && typeof v === 'object' && typeof v.nodeType === 'number') return undefined;
    if (key === 'group' && v && v.type === 'tools') return undefined;
    if (v instanceof Set) return [...v];
    return v;
  });
  window.userBubbles = () => document.querySelectorAll('#column .msg.user:not(.steer)').length;
  $('settings').hidden = true;
  const now = Date.now();
  for (let i = 0; i < 8; i++) {
    const id = (i < 6 ? 'm' : 's') + i;
    S.sessions.push({ id, title: i === 0 ? null : 'Session ' + i, executor: 'client',
      created_at: new Date(now - i * 60000).toISOString(), last_used_at: new Date(now - i * 60000).toISOString(),
      last_message_at: '2026-10-01T10:00:00.000Z' });
    S.init.state.sessions[id] = { cwd: 'C:\\\\work\\\\project' + i };
    if (i < 6) {
      S.transcripts.set(id, build(id, 120));
      S.loaded.add(id);
      S.seenAnswer.set(id, '2026-10-01T10:00:00.000Z');
    }
  }
  // m0's sub-agent, and the turn this window drew itself (its last items).
  const m0 = S.transcripts.get('m0');
  ensureAgent('m0', 'a1', { role: 'Reviewer', task: 'Review the parser', status: 'done', loaded: true,
    items: [{ type: 'assistant', text: 'The parser is **fine**.' }] });
  ownTurns.set('m0', { text: 'Done.', items: m0.slice(-4) });
  renderSidebar();
  true;
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1320, height: 860,
    webPreferences: { preload: path.join(__dirname, 'fixtures/memory-preload.js'), backgroundThrottling: false },
  });
  const failures = [];
  let passed = 0;
  const check = (label, ok) => { if (ok) passed++; else failures.push(label); };
  const same = (label, got, want) => check(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
    JSON.stringify(got) === JSON.stringify(want));
  const errors = [];
  const logged = [];
  win.webContents.on('console-message', (event) => {
    logged.push(`[${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    if (event.level === 'error' && !/Content Security Policy/.test(event.message)) errors.push(event.message);
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (err) {
      throw new Error(`${err.message}\n    while running: ${code.trim().slice(0, 200)}`);
    }
  };
  const cdp = win.webContents.debugger;
  // DOM nodes alive, after a full collection: the drawing a session keeps.
  const nodes = async () => {
    await cdp.sendCommand('HeapProfiler.collectGarbage');
    await cdp.sendCommand('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.sendCommand('Performance.getMetrics');
    return metrics.find((m) => m.name === 'Nodes').value;
  };
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    cdp.attach('1.3');
    await cdp.sendCommand('Performance.enable');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await js(SETUP);
    const m0Before = await js(`dataOf(S.transcripts.get('m0'))`);

    // ── Opening sessions in turn ──
    await js(`selectSession('m0').then(() => frames(2))`);
    const oneSession = await nodes();
    const drawnFirst = await js(`({ users: userBubbles(), earlier: $('earlier') && $('earlier').textContent,
      ticks: document.querySelectorAll('#threadNav .tn-item').length })`);
    same('a long session is drawn from its newest 30 turns', drawnFirst, { users: 30, earlier: 'Show 90 earlier turns', ticks: 120 });
    await js(`openPanel('a1'); frames(2)`);
    check('the sub-agent is drawn in the panel', await js(`Boolean(agentsOf('m0').get('a1').items[0].node)`));

    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 's6', 's7']) {
      const before = await js('S.current');
      await js(`selectSession(${JSON.stringify(id)}).then(() => frames(2))`);
      check(`leaving ${before} let go of every node it was drawn as`,
        await js(`(S.transcripts.get(${JSON.stringify(before)}) || []).every((i) => !i.node && !i.navButton)
          && [...(S.agents.get(${JSON.stringify(before)}) || new Map()).values()].every((a) => a.items.every((i) => !i.node))`));
    }
    same('s6 and s7 were read from the server, once each', await js('cf.asked()'), ['s6', 's7']);
    const eightOpened = await nodes();
    check(`the window holds one session's drawing, not eight: ${eightOpened} nodes after eight, ${oneSession} after one`,
      eightOpened < oneSession * 1.5);

    // ── Packed after a moment: all but the five opened last ──
    await js('wait(2000)');
    const kept = await js('sessionMemory()');
    same('the five opened last stay as they are', [...kept.live].sort(), ['m3', 'm4', 'm5', 's6', 's7']);
    same('the others are packed', [...kept.packed].sort(), ['m0', 'm1', 'm2']);
    check(`packed small: ${kept.packedBytes} bytes for ${kept.packedChars} characters`, kept.packedBytes * 5 < kept.packedChars);
    same('a packed session is out of the window\'s state', await js(`[S.transcripts.has('m0'), S.loaded.has('m0'), S.agents.has('m0'), ownTurns.has('m0')]`),
      [false, false, false, false]);
    check('a packed session without a title is still named by its first prompt',
      await js(`sessionLabel(S.sessions.find((s) => s.id === 'm0')) === 'm0 turn 0: refactor the module — and explain ✓'`));
    const sidebarText = await js(`(S.settings.hasKey = true, renderSidebar(), document.getElementById('sessionList').textContent)`);
    check(`and the sidebar shows that name: ${sidebarText.slice(0, 300)}`, sidebarText.includes('m0 turn 0: refactor'));

    // ── A packed session opened again: from memory, as it was ──
    const reopen = await js(`(async () => {
      const t0 = performance.now();
      await selectSession('m0');
      const ms = performance.now() - t0;
      await frames(2);
      const items = S.transcripts.get('m0');
      const groups = items.filter((i) => i.type === 'tools');
      const own = ownTurns.get('m0');
      return {
        ms, loaded: S.loaded.has('m0'), packed: isPacked('m0'), same: dataOf(items),
        groups: groups.every((g) => g.tools.every((t) => t.group === g)),
        sets: items.filter((i) => i.type === 'files').every((i) => i.open instanceof Set && i.open.has(0)),
        own: own && own.items.length === 4 && own.items.every((item, k) => item === items[items.length - 4 + k]),
        agent: agentsOf('m0').get('a1') && agentsOf('m0').get('a1').items[0].text,
        users: userBubbles(),
      };
    })()`);
    same('reopened from memory, with no request', await js('cf.asked()'), ['s6', 's7']);
    check('the reopened session is the same data', reopen.same === m0Before);
    same('and the same links between its objects', [reopen.loaded, reopen.packed, reopen.groups, reopen.sets, reopen.own, reopen.agent, reopen.users],
      [true, false, true, true, true, 'The parser is **fine**.', 30]);
    check(`unpacked quickly: ${Math.round(reopen.ms)} ms`, reopen.ms < 1000);
    await js('wait(2000)');
    same('the one now sixth is packed in its turn', [...(await js('sessionMemory()')).packed].sort(), ['m1', 'm2', 'm3']);

    // ── Reading a packed session without opening it ──
    await js(`exportSession(S.sessions.find((s) => s.id === 'm2'))`);
    const exported = (await js('cf.saved()')).at(-1);
    check('a packed session exports from memory', exported && exported.text.includes('m2 turn 119: refactor'));
    same('with no request', await js('cf.asked()'), ['s6', 's7']);

    // ── A run event for a packed session ──
    await js(`onRunEvent({ sessionId: 'm3', event: 'context.compacted', data: { before_tokens: 9000, after_tokens: 3000 } })`);
    await js('wait(300)');
    const evented = await js(`(() => { const items = S.transcripts.get('m3') || [];
      return { loaded: S.loaded.has('m3'), packed: isPacked('m3'), length: items.length, last: items.at(-1) && items.at(-1).type,
        first: items[1] && items[1].text }; })()`);
    same('it is put back first, then the event added at its end', evented,
      { loaded: true, packed: false, length: 120 * 5 + 12 + 6 + 1 + 1, last: 'compaction', first: 'm3 turn 0: refactor the module — and explain ✓' });
    same('still with no request', await js('cf.asked()'), ['s6', 's7']);

    // ── The newest turns, and the earlier ones on demand ──
    await js(`selectSession('m0').then(() => frames(2))`);
    const scrolled = await js(`(async () => {
      const box = $('transcript');
      box.scrollTop = 0;
      const ref = document.querySelector('#column .msg.user');
      const top = ref.getBoundingClientRect().top;
      await frames(4);
      return { users: userBubbles(), moved: Math.abs(ref.getBoundingClientRect().top - top) };
    })()`);
    check(`scrolling to the top draws earlier turns: ${scrolled.users} prompts drawn`, scrolled.users >= 60);
    check(`and what was on screen stays where it was: moved ${scrolled.moved}px`, scrolled.moved <= 2);
    const jumped = await js(`(async () => {
      // A hidden window does not animate a smooth scroll: where it goes is noted.
      const scrolledTo = [];
      const native = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options) { scrolledTo.push(this); return native.call(this, options); };
      document.querySelector('#threadNav .tn-item').click();
      Element.prototype.scrollIntoView = native;
      await frames(2);
      const first = transcriptOf('m0').find((i) => i.type === 'user');
      return { users: userBubbles(), earlier: Boolean($('earlier')),
        goesThere: scrolledTo.length === 1 && scrolledTo[0] === first.node && first.node.isConnected };
    })()`);
    same('the first prompt\'s tick draws everything down to it and goes there', jumped, { users: 120, earlier: false, goesThere: true });
    await js('renderTranscript(); frames(2)');
    same('a redraw keeps the turns drawn', await js('userBubbles()'), 120);

    // Find searches all of a session, even the turns not drawn.
    await js(`selectSession('m1').then(() => selectSession('m0')).then(() => frames(2))`);
    same('back on a session: its newest 30 turns again', await js('userBubbles()'), 30);
    const found = await js(`(async () => {
      openFind();
      $('findInput').value = 'm0 turn 3:';
      $('findInput').dispatchEvent(new Event('input'));
      await frames(2);
      const out = { matches: FIND.ranges.length, users: userBubbles() };
      closeFind();
      return out;
    })()`);
    same('Find covers the turns not drawn', found, { matches: 1, users: 120 });

    // New turns while the start is not drawn; a redraw of a step not drawn.
    await js(`selectSession('m1').then(() => selectSession('m0')).then(() => frames(2))`);
    const added = await js(`(() => {
      addItem('m0', { type: 'user', text: 'one more turn', at: nowIso() });
      addItem('m0', { type: 'assistant', text: 'And its answer.' });
      const hidden = transcriptOf('m0').find((i) => i.type === 'tools');
      refreshItem('m0', hidden);
      renderTranscript();
      return { users: userBubbles(), last: document.querySelector('#column').lastElementChild.textContent.includes('And its answer.') };
    })()`);
    same('a new turn is drawn under the others, and a redraw keeps it', added, { users: 31, last: true });

    // A session read again after answers came from elsewhere keeps its place.
    await js(`(async () => { S.sessions.find((s) => s.id === 's7').last_message_at = '2026-10-02T10:00:00.000Z';
      await selectSession('s7'); await loadSessions({ quiet: true }).catch(() => {}); noticeNewAnswers(S.sessions.find((s) => s.id === 's7')); await wait(200); })()`);
    same('a changed session is read again, as before', (await js('cf.asked()')).filter((id) => id === 's7').length, 2);

    check(`no errors in the window: ${errors.join(' | ')}`, errors.length === 0);
  } catch (err) {
    failures.push(err.stack || String(err));
  }
  if (failures.length) {
    console.error(`FAILED (${passed} passed):\n - ${failures.join('\n - ')}\nwindow errors: ${errors.join(' | ')}`);
    app.exit(1);
  } else {
    console.log(`PASS session memory: ${passed} checks`);
    app.exit(0);
  }
});
