// Following a run another client started in the open session: the phone, the
// web chat, the app on another computer.
//
// The session already reads as "working somewhere else" (S.remoteBusy,
// 02-state.js), with the prompt box held as it always was. This draws that
// run's text and tool calls under the transcript while it works, from the
// events the main process reads (src/core/watch.js). Nothing more: no tool of
// it is run here and it cannot be stopped from here. A message typed while it
// works steers it, as it does from the phone or the web chat. When it ends
// the transcript is read again from the server, so the saved turn, with the
// other client's message above it, replaces what was drawn.
//
// Kept apart from S.running on purpose: a run of this app has approvals, undo,
// file changes and a recovery journal, and a watched run has none of them.

S.watching = new Map();   // session id -> { runId, turnStart, status, ended }
S.watched = new Map();    // session id -> the run last followed to its end
S.watchFailed = new Map(); // session id -> { runId, tries, until }: a run that could not be followed

// How often one run is tried before this window only waits for its end.
const WATCH_TRIES = 3;

function watchOf(sessionId) {
  return S.watching.get(sessionId) || null;
}

// The run a message typed now would steer: the one followed in this session.
function watchedRunId(sessionId) {
  const watch = sessionId ? watchOf(sessionId) : null;
  return watch && !watch.ended ? watch.runId : null;
}

// The prompt box says what Enter does, and that changes with a watch.
function refreshPromptFor(sessionId) {
  if (sessionId !== S.current) return;
  renderComposer();
  updateSendButton();
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
  // It could not be followed a moment ago: not again at once, and not for ever.
  const failed = S.watchFailed.get(sessionId);
  if (failed && failed.runId === runId && (failed.tries >= WATCH_TRIES || Date.now() < failed.until)) return;
  if (current) dropWatch(sessionId);
  const watch = { runId, turnStart: transcriptOf(sessionId).length, status: null, ended: false };
  S.watching.set(sessionId, watch);
  beginWatch(sessionId, watch);
  if (sessionId === S.current) updateRemoteWorking();
  refreshPromptFor(sessionId);
}

// The saved part of a turn still being worked on (fromHistory, 09-navigation.js).
// The run is replayed from its start, so that part would be there twice.
function dropUnfinished(items) {
  let end = items.length;
  while (end && items[end - 1].unfinished) end -= 1;
  const dropped = end !== items.length;
  items.length = end;
  return dropped;
}

function redrawKeepingPlace() {
  const box = $('transcript');
  const stick = nearBottom();
  const offset = box ? box.scrollTop : 0;
  renderTranscript();
  if (box && !stick) box.scrollTop = offset;
}

async function beginWatch(sessionId, watch) {
  const mine = () => watchOf(sessionId) === watch;
  // The other client's message first: this window did not send it, so it is
  // read from the server. Failing that, the run is drawn under what is shown.
  let items = null;
  try {
    const data = await call(cf.messages, sessionId);
    if (mine() && !S.running.has(sessionId)) items = rebuiltTranscript(sessionId, data);
  } catch { /* the transcript stays as it is */ }
  if (!mine()) return;
  if (items) S.transcripts.set(sessionId, items);
  const dropped = dropUnfinished(transcriptOf(sessionId));
  watch.turnStart = transcriptOf(sessionId).length;
  if ((items || dropped) && sessionId === S.current) redrawKeepingPlace();
  let ok = false;
  try {
    ok = await call(cf.watchRun, { sessionId, runId: watch.runId });
  } catch { ok = false; }
  if (ok || !mine()) return;
  // False: a run of this app is going there, or being picked up again.
  S.watching.delete(sessionId);
  eraseWatched(sessionId, watch);
  if (sessionId === S.current) updateRemoteWorking();
  refreshPromptFor(sessionId);
}

// Stop following, and take back what was drawn. A session that is no longer
// on screen, a run of this app starting, a run picked up again after a restart.
function dropWatch(sessionId) {
  const watch = watchOf(sessionId);
  if (!watch) return;
  S.watching.delete(sessionId);
  if (typeof cf.unwatchRun === 'function') call(cf.unwatchRun, sessionId).catch(() => {});
  eraseWatched(sessionId, watch);
  refreshPromptFor(sessionId);
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
      refreshPromptFor(sessionId);
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
  const done = ended || watch.ended;
  let givenUp = false;
  if (done) {
    // Followed to its end: not to be followed again while the server still lists it.
    S.watched.set(sessionId, watch.runId);
    S.watchFailed.delete(sessionId);
  } else {
    // Lost before its end: what was drawn is a part, and the next look starts
    // over. The next look is the regular one, a few seconds on, and after a
    // few of them this run is only waited for: asking again at once would
    // open one connection after another for as long as the run goes on.
    eraseWatched(sessionId, watch);
    const failed = S.watchFailed.get(sessionId);
    const tries = failed && failed.runId === watch.runId ? failed.tries + 1 : 1;
    S.watchFailed.set(sessionId, { runId: watch.runId, tries, until: Date.now() + 4000 * tries });
    givenUp = tries >= WATCH_TRIES;
  }
  if (sessionId !== S.current) return;
  updateRemoteWorking();
  refreshPromptFor(sessionId);
  // The turn is over, or about to be: read the session again now, which
  // puts the saved turn in place of the drawn one once the server is idle.
  if (done) checkCurrentSession();
  // Not followed any more: what the server has saved of it so far is shown.
  else if (givenUp) reloadTranscript(sessionId);
}
