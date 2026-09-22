'use strict';
// How a transcript rebuilt from history places a turn's tool calls: only runs
// of calls with no text between them share a group, and a turn this window
// drew itself keeps the arrangement it drew.
// Run with: npx electron test/transcript.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-transcript-')));

// Four paragraphs, the way an agent writes between its tool runs.
const LINES = [
  'Now let me make the sidebar change:',
  'Now the helper:',
  'Now the fix:',
  'Now the tests:',
];
const answer = LINES.join('\n\n');
const endOf = (index) => LINES.slice(0, index + 1).join('\n\n').length;
const AT = [endOf(0), endOf(1), endOf(2), answer.length];

const TOOL = (name, text_offset) => {
  const tool = { name, arguments: {}, ok: true };
  if (text_offset != null) tool.text_offset = text_offset;
  return tool;
};

const MESSAGES = [
  { role: 'user', text: 'Rework the sidebar.', created_at: '2026-09-22T10:00:00Z' },
  {
    role: 'assistant',
    created_at: '2026-09-22T10:11:55Z',
    text: answer,
    tools: [
      // Two calls before any text: one group.
      TOOL('fs_glob', 0),
      TOOL('run_command', 0),
      // Then a paragraph, then two calls made together: another group.
      TOOL('fs_read', AT[0]),
      TOOL('fs_read', AT[0]),
      // A paragraph each time: a group of its own per paragraph.
      TOOL('fs_edit', AT[1]),
      TOOL('run_command', AT[2]),
      // A call with no place at all (it sent no mark) joins what precedes it.
      TOOL('view_image'),
    ],
  },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false },
  });
  let failures = 0;
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    const out = await win.webContents.executeJavaScript(`(() => {
      const out = [];
      const check = (label, ok) => { if (!ok) out.push(label); };
      const shape = (items) => items.map((item) => item.type === 'tools'
        ? 'tools:' + item.tools.map((t) => t.name).join('+') : item.type);
      const same = (label, got, want) => check(label + ': ' + got.join(' | '), JSON.stringify(got) === JSON.stringify(want));

      const items = fromHistory('t', ${JSON.stringify(MESSAGES)}, []);
      same('a rebuilt turn keeps its shape', shape(items), [
        'user', 'stamp',
        'tools:fs_glob+run_command',
        'assistant',
        'tools:fs_read+fs_read',
        'assistant',
        'tools:fs_edit',
        'assistant',
        'tools:run_command+view_image',
        'assistant',
      ]);
      check('the text between the runs is all there',
            items.filter((i) => i.type === 'assistant').map((i) => i.text).join(' ') === ${JSON.stringify(LINES.join(' '))});

      // A turn this window streamed itself keeps what it drew, instead of
      // being re-drawn from that flat copy.
      const drawn = [
        { type: 'stamp', at: '2026-09-22T10:00:00Z' },
        { type: 'assistant', text: 'Drawing it as it happened.' },
        { type: 'tools', sessionId: 't', open: false, tools: [{ name: 'fs_read', status: 'done', arguments: {} }] },
      ];
      ownTurns.set('t', { text: 'Drawing it as it happened.', items: drawn });
      const kept = rebuiltTranscript('t', { messages: [
        { role: 'user', text: 'Rework the sidebar.' },
        { role: 'assistant', text: 'Something else entirely.' },
        { role: 'user', text: 'Again.' },
        { role: 'assistant', text: 'Earlier text.\\n\\nDrawing it as it happened.' },
      ] });
      same('what this window drew is kept, after the turns before it', shape(kept),
           ['user', 'assistant', 'user', 'stamp', 'assistant', 'tools:fs_read']);

      // Another window's turn replaces it: the flat copy is read instead.
      const flat = rebuiltTranscript('t', { messages: [
        { role: 'user', text: 'Rework the sidebar.' },
        { role: 'assistant', text: 'An answer this window never streamed.' },
      ] });
      same('another window\\'s turn falls back to the server copy', shape(flat), ['user', 'assistant']);
      check('and the drawn turn is forgotten', !ownTurns.has('t'));

      // The reload the app does by itself when a run finishes has to go through
      // the same rebuild, not straight to the server's flat copy -- that flip
      // is exactly what this is here to stop.
      ownTurns.set('t', { text: 'Drawing it as it happened.', items: drawn });
      S.current = 't';
      return reloadTranscript('t').then(() => {
        same('a finished turn keeps what this window drew',
             shape(S.transcripts.get('t') || []), ['user', 'stamp', 'assistant', 'tools:fs_read']);
        return out;
      });
    })()`);
    if (out.length) { failures = out.length; console.log('FAILED:\n - ' + out.join('\n - ')); }
    else console.log('transcript placement: ok');
  } catch (err) {
    failures = 1;
    console.log('FAILED:', err.message);
  }
  app.exit(failures ? 1 : 0);
});
