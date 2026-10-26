'use strict';
// A streamed answer is drawn block by block (streamMarkdown): it must come out
// as the same markup as the whole text drawn at once (setMarkdown), at every
// frame and at the end. A sub-agent writing does not redraw its row in the
// transcript, and the panel draws only its newest paragraph.
// Run with: npx electron test/markdown-stream.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-markdown-stream-')));

const fence = '```';
const SAMPLES = {
  everything: [
    '# Plan', '', 'First **bold** and `code`, then a [link](https://example.com).', '',
    '1. One', '2. Two with a step:', '', `   ${fence}js`, '   const x = 1;', `   ${fence}`, '', '3. Three', '',
    '> A quote', '> over two lines', '', '---', '',
    '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '',
    `${fence}python`, 'def f(x):', '    return x * 2', fence, '',
    '- [ ] a task', '- [x] done', '', 'The end.',
  ].join('\n'),
  setext: 'A paragraph that becomes a heading\n===\n\nThen text.\n\nAnother\n---\n\nAnd more.',
  laterLink: 'See [the docs][d] and [more][m].\n\nSome text between.\n\n[d]: https://example.com/docs\n[m]: https://example.com/more "More"',
  rawHtml: '<details>\n<summary>More</summary>\n\nHidden **text** here.\n\n</details>\n\nAfter it.\n\nUse <b>bold\n\nnext paragraph.',
  images: '![chart](https://files.codingfleet.com/a.png)\n\nText.\n\n![chart](https://files.codingfleet.com/a.png)\n\n'
    + '![x](https://elsewhere.example/b.png)\n\n![x](https://elsewhere.example/b.png)\n\n![local](out/plot.png)',
  openFence: `Here is the file:\n\n${fence}ts\nexport const a = 1;\nexport function f() {\n  return a;\n}\n`,
  unlabelled: `Look:\n\n${fence}\n${'def step(items, limit=10):\n    return [x for x in items if x.score > limit]\n'.repeat(30)}${fence}\n\nAnd prose after.`,
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));

    // Every frame of every sample, in steps of a few sizes.
    const frames = await js(`(() => {
      const samples = ${JSON.stringify(SAMPLES)};
      const whole = (text) => { const n = document.createElement('div'); setMarkdown(n, text); return n.innerHTML; };
      const out = [];
      for (const [name, text] of Object.entries(samples)) {
        for (const step of [1, 7, 61]) {
          const node = document.createElement('div');
          for (let at = step; at < text.length + step; at += step) {
            const part = text.slice(0, at);
            streamMarkdown(node, part, true);
            // An unlabelled block of code is drawn from an older guess while it is written.
            if (name !== 'unlabelled' && node.innerHTML !== whole(part)) {
              out.push(name + ' differs at ' + part.length + ' (step ' + step + ')');
              break;
            }
          }
          streamMarkdown(node, text, false);
          if (node.innerHTML !== whole(text)) out.push(name + ' differs at the end (step ' + step + ')');
          if (!node.mdFinal) out.push(name + ' not final at the end');
        }
      }
      return out;
    })()`);
    assert.deepEqual(frames, [], frames.join('\n'));

    // Guessing the language of an unlabelled block is not done on every frame.
    const guesses = await js(`(() => {
      const text = ${JSON.stringify(SAMPLES.unlabelled)};
      let calls = 0;
      const auto = hljs.highlightAuto;
      hljs.highlightAuto = (...args) => { calls++; return auto.apply(hljs, args); };
      const node = document.createElement('div');
      let frames = 0;
      for (let at = 5; at < text.length + 5; at += 5) { streamMarkdown(node, text.slice(0, at), true); frames++; }
      streamMarkdown(node, text, false);
      hljs.highlightAuto = auto;
      return { calls, frames };
    })()`);
    assert.ok(guesses.calls < 20, `guessed ${guesses.calls} times over ${guesses.frames} frames`);

    // The transcript: text streamed through run events, closed by a tool call.
    const run = await js(`(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      $('settings').hidden = true;
      S.settings.hasKey = true;
      S.current = 'stream';
      S.sessions = [{ id: 'stream', title: 'Streaming', executor: 'client', created_at: new Date().toISOString() }];
      S.loaded.add('stream');
      S.init.state.sessions.stream = { cwd: 'C:/workspace/app' };
      S.running.set('stream', { started: Date.now(), turnStart: 0 });
      renderMain();
      const emit = (event, data = {}) => onRunEvent({ sessionId: 'stream', event, data });
      const text = ${JSON.stringify(SAMPLES.unlabelled)};
      for (let at = 0; at < text.length; at += 40) {
        emit('text.delta', { text: text.slice(at, at + 40) });
        if (at % 400 === 0) await frame();
      }
      await frame();
      const markdown = document.querySelector('.msg.assistant .markdown');
      const kept = markdown.firstElementChild;
      emit('tool.call', { id: 't1', name: 'fs_read', executor: 'client', arguments: { path: 'a.js' } });
      await frame();
      const after = document.querySelector('.msg.assistant .markdown');
      const whole = document.createElement('div');
      setMarkdown(whole, text);
      return { same: after.innerHTML === whole.innerHTML, final: after.mdFinal, sameNode: after === markdown,
        firstBlockKept: after.firstElementChild === kept };
    })()`);
    assert.equal(run.same, true, 'the closed answer is what the whole text draws');
    assert.equal(run.final, true);
    assert.equal(run.sameNode, true, 'the answer is not drawn anew');
    assert.equal(run.firstBlockKept, true, 'a finished block is kept as it was');

    // A sub-agent writing: its row stays, the panel draws only its paragraph.
    const agent = await js(`(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const emit = (event, data = {}) => onRunEvent({ sessionId: 'stream', event, data });
      emit('text.delta', { text: 'Handing this to a sub-agent.' });
      emit('tool.call', { id: 'SPAWN', name: 'spawn_agent', arguments: { role: 'Worker', task: 'Write docs' } });
      emit('subagent.started', { agent_id: 'A', role: 'Worker', call_id: 'SPAWN', task: 'Write docs' });
      emit('subagent.text', { agent_id: 'A', text: 'First paragraph.\\n\\n' });
      await frame();
      const row = document.querySelector('.agent-tool');
      const card = $('agentsPanel').querySelector('.ap-card');
      const paragraph = $('agentsPanel').querySelector('.msg.assistant');
      for (const word of ['Second ', 'paragraph ', 'grows.']) {
        emit('subagent.text', { agent_id: 'A', text: word });
        await frame();
      }
      const grown = {
        rowKept: document.querySelector('.agent-tool') === row,
        cardKept: $('agentsPanel').querySelector('.ap-card') === card,
        paragraphKept: $('agentsPanel').querySelector('.msg.assistant') === paragraph,
        text: $('agentsPanel').querySelector('.msg.assistant .markdown').textContent.trim(),
      };
      emit('tool.call', { id: 'c1', agent_id: 'A', name: 'fs_read', executor: 'client', arguments: { path: 'a.js' } });
      await frame();
      emit('subagent.text', { agent_id: 'A', text: 'After the step.' });
      await frame();
      const items = [...$('agentsPanel').querySelectorAll('.ap-body > .msg.assistant, .ap-body > .tool, .ap-body > .tool-group')]
        .map((n) => n.classList.contains('assistant') ? 'text:' + n.textContent.trim() : 'tool');
      emit('subagent.status', { agent_id: 'A', state: 'started', kind: 'thinking' });
      await frame();
      return { grown, afterToolPanelKeptParagraph: $('agentsPanel').querySelector('.msg.assistant') === paragraph,
        items, rowMeta: document.querySelector('.agent-tool .tool-meta').textContent };
    })()`);
    assert.equal(agent.grown.rowKept, true, 'the row is not drawn again for text');
    assert.equal(agent.grown.cardKept, true, 'the panel is not drawn again for text');
    assert.equal(agent.grown.paragraphKept, true, 'the paragraph is updated in place');
    assert.equal(agent.grown.text, 'First paragraph.\n\nSecond paragraph grows.'.replace('\n\n', '\n'));
    assert.equal(agent.afterToolPanelKeptParagraph, true, 'a finished paragraph moves into the redrawn panel');
    assert.deepEqual(agent.items, ['text:First paragraph.\nSecond paragraph grows.', 'tool', 'text:After the step.']);
    assert.equal(agent.rowMeta, 'Thinking…', 'the row still follows the sub-agent');
    console.log('PASS markdown streaming: same markup as a whole draw, sub-agent text drawn in place');
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((err) => { console.error(err); app.exit(1); });
