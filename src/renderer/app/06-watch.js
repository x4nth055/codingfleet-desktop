// Following a run another client started in the open session: the phone, the
// web chat, the app on another computer.
//
// The session already reads as "working somewhere else" (S.remoteBusy,
// 02-state.js), with the prompt box held as it always was. This draws that
// run's text and tool calls under the transcript while it works, from the
// events the main process reads (src/core/watch.js). Nothing more: no tool of
// it is run here, it cannot be stopped or steered from here, and when it ends
// the transcript is read again from the server, so the saved turn, with the
// other client's message above it, replaces what was drawn.
//
// Kept apart from S.running on purpose: a run of this app has approvals, undo,
// file changes and a recovery journal, and a watched run has none of them.

S.watching = new Map();   // session id -> { runId, turnStart, status, ended }
S.watched = new Map();    // session id -> the run last followed to its end

function watchOf(sessionId) {
  return S.watching.get(sessionId) || null;
}

// Take back what a watch drew: the server replays a run from its start.
function eraseWatched(sessionId, watch) {
  closeLiveText(sessionId);
  const items = transcriptOf(sessionId);
  if (items.length > watch.turnStart) items.length = watch.turnStart;
  watch.status = null;
  if (sessionId === S.current) renderTranscript();
}

function startWatch(sessionId, runId) {
  if (!sessionId || !runId || typeof cf.watchRun !== 'function') return;
  if (S.running.has(sessionId) || S.watched.get(sessionId) === runId) return;
  // Not before the session's history is in: it would be loaded over what is drawn.
  if (!S.loaded.has(sessionId) || S.loading.has(sessionId)) return;
  const current = watchOf(sessionId);
  if (current && current.runId === runId) return;
  if (current) dropWatch(sessionId);
  const watch = { runId, turnStart: transcriptOf(sessionId).length, status: null, ended: false };
  S.watching.set(sessionId, watch);
  const forget = () => {
    if (watchOf(sessionId) !== watch) return;
    S.watching.delete(sessionId);
    eraseWatched(sessionId, watch);
  };
  // False: a run of this app is going there, or being picked up again.
  call(cf.watchRun, { sessionId, runId }).then((ok) => { if (!ok) forget(); }).catch(forget);
  if (sessionId === S.current) updateRemoteWorking();
}

// Stop following, and take back what was drawn. A session that is no longer
// on screen, a run of this app starting, a run picked up again after a restart.
function dropWatch(sessionId) {
  const watch = watchOf(sessionId);
  if (!watch) return;
  S.watching.delete(sessionId);
  if (typeof cf.unwatchRun === 'function') call(cf.unwatchRun, sessionId).catch(() => {});
  eraseWatched(sessionId, watch);
}

function dropWatchesExcept(sessionId) {
  for (const id of [...S.watching.keys()]) if (id !== sessionId) dropWatch(id);
}

function remoteWorkingHint(sessionId) {
  const watch = watchOf(sessionId);
  if (!watch) return 'This view updates when it finishes';
  return watch.status === 'thinking' ? 'Thinking…' : 'Live';
}

function updateRemoteWorking() {
  const hint = document.querySelector('.working.remote .hint');
  if (hint && S.current) hint.textContent = remoteWorkingHint(S.current);
}

function onWatchEvent(payload) {
  const { sessionId, runId, event, data } = payload || {};
  const watch = watchOf(sessionId);
  if (!watch || watch.runId !== runId) return;
  // A sub-agent's own steps: the call that started it is the card shown here.
  if (event.startsWith('subagent.') || (data && data.agent_id)) return;
  switch (event) {
    case 'watch.reconnecting':
      eraseWatched(sessionId, watch);
      break;
    case 'status':
      if (data.state === 'started') watch.status = data.kind;
      else if (watch.status === data.kind) watch.status = null;
      if (sessionId === S.current) updateRemoteWorking();
      break;
    case 'notice':
      addItem(sessionId, { type: 'notice', text: data.message });
      break;
    case 'text.delta':
      if (watch.status === 'thinking') {
        watch.status = null;
        if (sessionId === S.current) updateRemoteWorking();
      }
      appendText(sessionId, data.text || '');
      break;
    case 'tool.call':
      closeLiveText(sessionId);
      // Shown, never run: not even one meant for a computer, which is another one.
      if (!findTool(sessionId, data.id)) {
        addTool(sessionId, { id: data.id, name: data.name, arguments: data.arguments || {}, status: 'running', watched: true });
      }
      break;
    case 'tool.result': {
      const tool = findTool(sessionId, data.id);
      if (tool) updateTool(sessionId, data.id, { status: data.ok ? 'done' : 'failed', output: data.output });
      break;
    }
    case 'session.title': {
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session && data.title) {
        session.title = data.title;
        renderSidebar();
        if (sessionId === S.current) renderTopbar();
      }
      break;
    }
    case 'run.ended':
      watch.ended = true;
      break;
    case 'watch.closed':
      finishWatch(sessionId, watch, Boolean(data && data.ended));
      break;
    default:
      break;
  }
}

function finishWatch(sessionId, watch, ended) {
  if (watchOf(sessionId) !== watch) return;
  S.watching.delete(sessionId);
  closeLiveText(sessionId);
  if (ended || watch.ended) {
    // Followed to its end: not to be followed again while the server still lists it.
    S.watched.set(sessionId, watch.runId);
  } else {
    // Lost before its end: what was drawn is a part, and the next look starts over.
    eraseWatched(sessionId, watch);
  }
  if (sessionId === S.current) {
    updateRemoteWorking();
    // The turn is over, or about to be: read the session again now, which
    // puts the saved turn in place of the drawn one once the server is idle.
    checkCurrentSession();
  }
}
