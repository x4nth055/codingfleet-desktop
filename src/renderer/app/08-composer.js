'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The composer: voice, the cost estimate, the prompt, the git and background pills.

// ── Voice input ────────────────────────────────────────────────────────────
// Click the microphone to record, click again to stop; the text is typed into
// the composer where the cursor is. The recording goes to CodingFleet to be
// transcribed and is not kept.
const MAX_RECORDING_MS = 120_000;
const voice = {
  recorder: null, stream: null, chunks: [], state: 'idle', started: 0, timer: null, cancelled: false,
  sendAfter: false, // Send was pressed while recording: send once the words are in
};

function renderMic() {
  const button = $('micButton');
  if (!button) return;
  button.classList.toggle('recording', voice.state === 'recording');
  button.classList.toggle('busy', voice.state === 'transcribing');
  button.disabled = voice.state === 'transcribing';
  if (voice.state === 'recording') {
    const secs = Math.floor((Date.now() - voice.started) / 1000);
    button.replaceChildren(el('span', 'rec-dot'), el('span', 'rec-time',
      `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`));
    button.title = 'Stop and type what you said (Esc cancels)';
  } else if (voice.state === 'transcribing') {
    button.replaceChildren(el('span', 'spinner small'));
    button.title = 'Turning your recording into text…';
  } else {
    button.replaceChildren(icon('mic'));
    button.title = 'Voice input';
  }
}

async function toggleVoice() {
  if (voice.state === 'recording') return stopVoice();
  if (voice.state !== 'idle') return undefined;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showBanner(err && err.name === 'NotFoundError'
      ? 'No microphone was found.'
      : 'The microphone could not be used. Check that Windows lets apps use it (Settings → Privacy → Microphone).');
    return undefined;
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  Object.assign(voice, { recorder, stream, chunks: [], state: 'recording', started: Date.now(), cancelled: false });
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) voice.chunks.push(event.data); });
  recorder.addEventListener('stop', finishVoice);
  recorder.start(1000);
  updateSendButton();
  voice.timer = setInterval(() => {
    if (Date.now() - voice.started >= MAX_RECORDING_MS) stopVoice();
    else renderMic();
  }, 500);
  renderMic();
  return undefined;
}

function stopVoice(cancel = false) {
  if (voice.state !== 'recording') return;
  voice.cancelled = cancel;
  if (cancel) voice.sendAfter = false;
  clearInterval(voice.timer);
  voice.recorder.stop();
  for (const track of voice.stream.getTracks()) track.stop();
}

async function finishVoice() {
  const { chunks, recorder, cancelled } = voice;
  Object.assign(voice, { recorder: null, stream: null, chunks: [], state: cancelled ? 'idle' : 'transcribing' });
  renderMic();
  updateSendButton();
  if (cancelled || !chunks.length) {
    voice.state = 'idle';
    voice.sendAfter = false;
    renderMic();
    updateSendButton();
    return;
  }
  let heard = false;
  const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
  try {
    const data = new Uint8Array(await blob.arrayBuffer());
    const result = await call(cf.transcribe, { data, type: blob.type });
    heard = Boolean(insertIntoPrompt((result && result.text) || ''));
  } catch (err) {
    showBanner(`Your recording could not be turned into text: ${err.message}`);
  } finally {
    voice.state = 'idle';
    renderMic();
    updateSendButton();
  }
  const send = voice.sendAfter;
  voice.sendAfter = false;
  if (send && heard) sendMessage();
  else if (send) showBanner('Nothing was heard in your recording, so nothing was sent.');
}

// Send while recording: stop, type the words, then send. While the words
// are still on their way, it sends once they arrive.
function sendAfterVoice() {
  if (voice.state === 'idle') return false;
  voice.sendAfter = true;
  if (voice.state === 'recording') stopVoice();
  updateSendButton();
  return true;
}

function insertIntoPrompt(text) {
  text = text.trim();
  if (!text) return false;
  const prompt = $('prompt');
  const start = prompt.selectionStart ?? prompt.value.length;
  const end = prompt.selectionEnd ?? prompt.value.length;
  const before = prompt.value.slice(0, start);
  const after = prompt.value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const tail = after && !/^\s/.test(after) ? ' ' : '';
  prompt.value = before + lead + text + tail + after;
  const caret = (before + lead + text).length;
  prompt.focus();
  prompt.setSelectionRange(caret, caret);
  rememberDraft();
  autosize();
  updateSendButton();
  return true;
}

// ── What a run will cost ───────────────────────────────────────────────────
// An estimate, not a quote. An agentic run makes several model calls, each
// re-sending the conversation, and nobody knows in advance how many. Two ways
// to guess, best first:
//   history  what this session's earlier runs on this model actually cost,
//            scaled by how much the conversation has grown since
//   model    the model's published price times an assumed number of steps
// Above WARN_CREDITS the composer stops and offers cheaper models instead.
// The arithmetic lives in cost.js, which has no state and its own tests.
// Kept behind COST: app.js has its own fromHistory, for transcripts.
const COST = window.CF_COST;
const { WARN_CREDITS, ASSUMED_STEPS } = COST;
const roundCredits = COST.round;

const modelById = (id) => S.models.find((m) => m.id === id) || null;

// What a model costs here: nothing when the plan covers it or it is free.
function effectiveRate(model) {
  if (!model) return null;
  if (planIncludes(model)) return 0;
  return model.credits_per_20k_tokens || 0;
}

function contextTokensOf(sessionId) {
  const session = sessionId ? S.sessions.find((s) => s.id === sessionId) : null;
  return (session && session.context && session.context.tokens) || 0;
}

// What this session's past runs on this model really cost, scaled to the
// conversation's size now. Nothing to say until a run has finished.
// modelId null means any model: on Auto the server picks per message, so what
// the session has cost so far is the only honest guide.
function historyEstimate(sessionId, modelId, contextNow) {
  if (!sessionId) return null;
  const sameModel = (i) => !modelId || !i.model || i.model === modelId
    || modelLabel(i.model) === modelLabel(modelId);
  const past = transcriptOf(sessionId)
    .filter((i) => i.type === 'footer' && i.usage && Number(i.usage.credits) > 0 && sameModel(i))
    .slice(-3)
    .map((i) => ({ credits: Number(i.usage.credits), contextTokens: i.usage.context_tokens || 0 }));
  return COST.fromHistory(past, contextNow);
}

/** @returns {{known: boolean, credits?: number, basis?: string, model?: object}} */
function estimateRun({ sessionId, modelId, promptText }) {
  // "Auto" is the server's choice, made per message, so there is no price list
  // to read. What this session has already cost is the one honest guide.
  if (!modelId || modelId === 'auto') {
    const past = historyEstimate(sessionId, null, contextTokensOf(sessionId));
    return past ? { known: true, ...past, model: null } : { known: false, basis: 'auto' };
  }
  const model = modelById(modelId);
  if (!model) return { known: false, basis: 'unknown' };
  const contextNow = contextTokensOf(sessionId);
  if (effectiveRate(model) === 0) {
    return { known: true, credits: 0, basis: planIncludes(model) ? 'plan' : 'free', model };
  }
  const guess = historyEstimate(sessionId, modelId, contextNow)
    || COST.fromModelPrice({ rate: effectiveRate(model), contextTokens: contextNow, promptText });
  return guess ? { known: true, ...guess, model } : { known: false, basis: 'unknown' };
}

// The smartest models that cost less than this one. Plan-covered models count
// as free, so they come out on top when the plan includes something good.
function cheaperAlternatives(model, limit = 2) {
  return COST.rankAlternatives(S.models, model, effectiveRate, limit);
}

// The pill beside the model button: what this run looks likely to cost. It
// sits next to the model because that is what it depends on, and it stays put
// when the sub-agent panel opens.
function updateCostHint() {
  const pill = $('costPill');
  if (!pill) return;
  const estimate = estimateRun({
    sessionId: S.current, modelId: S.model, promptText: $('prompt').value,
  });
  // Nothing to say yet: Auto before its first run, or a model we do not know.
  if (!estimate.known) {
    pill.hidden = true;
    return;
  }
  const n = roundCredits(estimate.credits);
  pill.hidden = false;
  pill.classList.toggle('high', estimate.credits >= WARN_CREDITS);
  // The pill is a price and nothing else. A word like "Included" took the place
  // of the number, which is the one thing this is here to say.
  if (!estimate.credits) {
    pill.textContent = '0 cr';
    pill.title = estimate.basis === 'plan'
      ? 'Your plan covers this model: this run costs no credits.'
      : 'A free model: this run costs no credits.';
    return;
  }
  pill.textContent = n < 1 ? '≈ <1 cr' : `≈ ${fmtNum(n)} cr`;
  pill.title = `${estimate.basis === 'history'
    ? `A rough estimate from this session's last ${estimate.runs === 1 ? 'run' : `${estimate.runs} runs`}`
    : "A rough estimate from the model's price and a run of about 5 steps"}`
    + ', scaled to how long the conversation is now. The real cost depends on how much '
    + 'work the agent does.';
}

// Above the threshold, offer the smartest cheaper models before spending.
// Resolves 'send', 'cancel', or a model id to switch to and then send.
function costDialog({ estimate, alternatives }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay confirm-overlay');
    const modal = el('div', 'modal cost-modal');
    modal.setAttribute('role', 'alertdialog');
    const credits = roundCredits(estimate.credits);
    modal.append(el('h2', 'confirm-title', `This run could cost about ${fmtNum(credits)} credits`));
    const runs = estimate.runs === 1 ? 'run' : `${estimate.runs} runs`;
    const why = estimate.basis === 'history'
      ? `Based on what this session's last ${runs} cost${estimate.model ? ` on ${modelLabel(estimate.model.id)}` : ''}, `
        + 'and how long the conversation has grown.'
      : `Based on ${modelLabel(estimate.model.id)}'s price and a run of about ${ASSUMED_STEPS} steps.`;
    const pickOne = estimate.model ? '' : ' Choose a model instead of Auto to see cheaper ones suggested here.';
    modal.append(el('p', 'confirm-text',
      `${why} The real cost depends on how much work the agent does.${pickOne}`));

    if (alternatives.length) {
      modal.append(el('div', 'cost-lead', alternatives.length === 1
        ? 'A cheaper model that is nearly as capable:'
        : 'Cheaper models that are nearly as capable:'));
      const list = el('div', 'cost-options');
      for (const alt of alternatives) {
        const row = el('button', 'menu-item cost-option');
        const main = el('div', 'mi-main');
        // The same run, priced at this model instead: the whole point is the gap.
        const ownRate = effectiveRate(estimate.model);
        const would = ownRate ? roundCredits(estimate.credits * (effectiveRate(alt) / ownRate)) : null;
        const less = ownRate ? Math.round((1 - effectiveRate(alt) / ownRate) * 100) : 0;
        main.append(
          el('div', 'mi-name', alt.name),
          el('div', 'mi-sub', would == null ? alt.id
            : `≈ ${fmtNum(would)} credits instead of ${fmtNum(roundCredits(estimate.credits))} — ${less}% less`),
        );
        row.append(main, modelColumns(
          alt.supports_vision,
          alt.intelligence_index || 0,
          planIncludes(alt) ? includedPill() : creditRange([alt]),
        ));
        row.addEventListener('click', () => close(alt.id));
        list.append(row);
      }
      modal.append(list);
    }

    const cancel = el('button', 'btn', 'Cancel');
    const send = el('button', 'btn primary', 'Send anyway');
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel, send);
    modal.append(actions);
    overlay.append(modal);

    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close('cancel');
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close('cancel'));
    send.addEventListener('click', () => close('send'));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close('cancel'); });
    document.body.append(overlay);
    setTimeout(() => send.focus(), 0);
  });
}

/** False when the person decided not to send after seeing the price. */
async function clearedToSpend(sessionId, promptText) {
  const estimate = estimateRun({ sessionId, modelId: S.model, promptText });
  if (!estimate.known || estimate.credits < WARN_CREDITS) return true;
  // On Auto there is no chosen model to be dearer than, so there is nothing to
  // recommend: the warning still stands, without a list.
  const answer = await costDialog({
    estimate, alternatives: estimate.model ? cheaperAlternatives(estimate.model) : [],
  });
  if (answer === 'cancel') return false;
  if (answer !== 'send') {
    chooseModel(answer);
    $('prompt').value = promptText;
    autosize();
  }
  return true;
}

// ── Composer ───────────────────────────────────────────────────────────────
// Each session keeps the message typed but not sent, and so does the new
// session. They are kept on this computer, across restarts.
const DRAFTS_KEY = 'cf.drafts';
const drafts = (() => {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {}; } catch { return {}; }
})();
let draftTimer = null;
const draftKey = (id) => id || 'new';

function storeDrafts() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch { /* kept for this run only */ }
  }, 300);
}

// Keeps what the composer holds now as the draft of session `id`.
function rememberDraft(id = S.current) {
  const text = $('prompt').value;
  if (text.trim()) drafts[draftKey(id)] = text;
  else delete drafts[draftKey(id)];
  storeDrafts();
}

function forgetDraft(id) {
  delete drafts[draftKey(id)];
  storeDrafts();
}

function restoreDraft() {
  $('prompt').value = drafts[draftKey(S.current)] || '';
  autosize();
  updateSendButton();
}

function autosize() {
  const prompt = $('prompt');
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 240)}px`;
}

function renderComposer() {
  const session = currentSession();
  const running = Boolean(S.current && S.running.has(S.current));
  const prompt = $('prompt');
  prompt.placeholder = running
    ? 'Send a message to steer the agent while it works…'
    : session ? 'Reply to CodingFleet…' : 'Ask CodingFleet to build, fix or explain something…';

  const sandbox = session ? session.executor !== 'client' : S.draftSandbox;
  const cwd = session ? local(session.id).cwd : (sandbox ? null : S.draftCwd);
  const folder = $('folderButton');
  folder.replaceChildren(
    icon(sandbox ? 'sparkle' : 'folder'),
    el('span', null, sandbox ? 'Cloud sandbox' : cwd ? baseName(cwd) : 'Choose folder'),
    icon('caret', 'icon caret'),
  );
  folder.title = sandbox ? "Tools run on CodingFleet's servers" : (cwd || 'Choose where this session runs');

  const modelButton = $('modelButton');
  modelButton.replaceChildren(...modelButtonParts(S.model));
  modelButton.title = 'Model';

  const effortParts = effortButtonParts(S.model);
  const effortButton = $('effortButton');
  effortButton.hidden = !effortParts;
  if (effortParts) {
    effortButton.replaceChildren(...effortParts);
    effortButton.title = 'Thinking effort';
  }

  $('attachButton').replaceChildren(icon('plus'));
  $('attachButton').setAttribute('aria-label', 'Attach');
  $('permButton').replaceChildren(
    icon(S.permission === 'auto' ? 'bolt' : 'shield'),
    el('span', null, S.permission === 'auto' ? 'Auto-approve' : 'Ask before changes'),
    icon('caret', 'icon caret'),
  );

  $('hint').textContent = running ? 'Enter to steer' : '';
  updateCostHint();
  updateSendButton();
  ensureGit();
  renderBackground();
}

function updateSendButton() {
  updateCostHint();
  const running = Boolean(S.current && S.running.has(S.current));
  const hasText = Boolean($('prompt').value.trim());
  const uploading = S.attachments.some((a) => a.status === 'uploading');
  const send = $('send');
  if (voice.state !== 'idle') {
    // Recording: Send stops it, types the words, and sends them.
    send.classList.remove('stop');
    send.innerHTML = ICON.arrowUp;
    send.disabled = voice.sendAfter;
    send.title = voice.sendAfter ? 'Sends as soon as your words are typed'
      : voice.state === 'recording' ? 'Stop recording and send what you said' : 'Send once your words are typed';
    return;
  }
  const stop = running && !hasText;
  send.classList.toggle('stop', stop);
  send.innerHTML = stop ? ICON.stop : ICON.arrowUp;
  send.title = stop ? 'Stop' : running ? 'Steer (Enter)' : 'Send (Enter)';
  send.disabled = (!stop && !hasText) || S.sending;
  send.title = uploading && !stop ? 'Sends once the files finish uploading' : send.title;
}

// ── Uncommitted changes, above the prompt ─────────────────────────────────
// The folder a session works in may be a git repository. When it is, and when
// something in it is uncommitted, the composer says by how much — "+531 −12" —
// and a click lists the files and shows any one file's diff. A sandbox session
// runs on CodingFleet's servers, so it has no changes here to show.
let gitFetching = null;
let gitRetryAt = 0;
let gitStamp = 0;

// Which folder's changes this window is showing: the session on screen, or the
// folder a new session would start in. Null when there is nothing to look at.
function gitTarget() {
  const session = currentSession();
  if (session) {
    if (session.executor !== 'client') return null;
    const cwd = local(session.id).cwd;
    return cwd ? { sessionId: session.id, cwd } : null;
  }
  if (S.draftSandbox || !S.draftCwd) return null;
  return { sessionId: null, cwd: S.draftCwd };
}

// A session and the folder it works in: moving the session to another folder
// is a different set of changes, even though it is the same session.
const gitTag = (target) => `${target.sessionId || 'draft'}|${target.cwd}`;

function ensureGit() {
  const bar = $('changes');
  if (!bar) return;
  const target = gitTarget();
  if (!target || typeof cf.gitStatus !== 'function') {
    if (S.git) {
      S.git = null;
      S.gitFor = '';
      S.gitDiffs.clear();
    }
    renderChanges();
    return;
  }
  const tag = gitTag(target);
  if (S.gitFor === tag) {
    renderChanges();
    return;
  }
  if (gitFetching === tag || Date.now() < gitRetryAt) return;
  gitFetching = tag;
  // The last folder's count is not this folder's: it goes before the new one
  // arrives, rather than sitting there wrong while the answer travels.
  if (S.git) {
    S.git = null;
    S.gitDiffs.clear();
    renderChanges();
  }
  const arg = target.sessionId ? { sessionId: target.sessionId, cwd: target.cwd } : { cwd: target.cwd };
  call(cf.gitStatus, arg).then((summary) => {
    if (gitFetching === tag) gitFetching = null;
    const now = gitTarget();
    if (!now || gitTag(now) !== tag) return; // the window moved on
    S.gitFor = tag;
    S.git = { ...summary, stamp: ++gitStamp };
    renderChanges();
  }).catch(() => {
    if (gitFetching === tag) gitFetching = null;
    // A folder that vanished, or a slow repository: ask again later, not in a
    // loop while the composer is painted.
    gitRetryAt = Date.now() + 15_000;
  });
}

// ── Background commands ────────────────────────────────────────────────────
// A dev server or watcher the agent started keeps running after its run; the
// pill above the prompt says so and can stop it. The main process owns the
// processes (core/background.js) and says when the list changes.
const backgroundBySession = new Map(); // session id -> jobs, newest first
let backgroundOpen = false;

function onBackgroundChanged({ sessionId, jobs }) {
  backgroundBySession.set(sessionId, jobs || []);
  if (sessionId === S.current) renderBackground();
}

function uptime(since) {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function renderBackground() {
  const box = $('bgJobs');
  if (!box) return;
  const jobs = (S.current && backgroundBySession.get(S.current)) || [];
  const running = jobs.filter((j) => j.status === 'running');
  if (!running.length) {
    box.hidden = true;
    backgroundOpen = false;
    return;
  }
  box.hidden = false;
  const pill = el('button', 'changes-pill bg-pill');
  pill.type = 'button';
  pill.title = 'Commands the agent started in the background. Click to see or stop them.';
  pill.append(el('span', 'bg-dot'), el('span', null,
    `${running.length} running in the background`), icon('caret', 'icon caret'));
  pill.addEventListener('click', () => { backgroundOpen = !backgroundOpen; renderBackground(); });
  const parts = [pill];
  if (backgroundOpen) {
    const list = el('div', 'bg-list');
    for (const job of running) {
      const row = el('div', 'bg-row');
      const text = el('div', 'bg-text');
      text.append(el('code', 'bg-command', job.command), el('span', 'bg-sub',
        `${job.id} · running ${uptime(job.started)}${job.pid ? ` · pid ${job.pid}` : ''}`));
      const last = String(job.tail || '').trim().split(/\r?\n/).pop();
      if (last) text.append(el('span', 'bg-tail', last.slice(0, 200)));
      const stop = el('button', 'btn small danger', 'Stop');
      stop.addEventListener('click', async () => {
        stop.disabled = true;
        stop.textContent = 'Stopping…';
        try { await call(cf.stopBackground, { sessionId: S.current, id: job.id }); } catch (err) { showBanner(err.message); }
      });
      row.append(text, stop);
      list.append(row);
    }
    parts.push(list);
  }
  box.replaceChildren(...parts);
}

// A session opened after the app started: ask once which of its jobs run.
async function loadBackground(sessionId) {
  if (!sessionId || backgroundBySession.has(sessionId) || typeof cf.backgroundJobs !== 'function') return;
  try {
    backgroundBySession.set(sessionId, await call(cf.backgroundJobs, sessionId));
    if (sessionId === S.current) renderBackground();
  } catch { /* the pill stays hidden */ }
}

function renderChanges() {
  const bar = $('changes');
  if (!bar) return;
  const summary = S.git;
  if (!summary || !summary.repo || !summary.files.length) {
    bar.hidden = true;
    if (!$('changesMenu').hidden) $('changesMenu').hidden = true;
    return;
  }
  bar.hidden = false;
  const repo = summary.repo;
  const branch = repo.branch || repo.commit || 'detached';
  const files = summary.files.length;
  const pill = $('changesPill');
  pill.title = `${files} uncommitted file${files === 1 ? '' : 's'} in ${repo.name} (${branch})`
    + `\n+${summary.added} −${summary.removed} lines\nClick to see the files and their diffs`;
  pill.replaceChildren(
    icon('branch'),
    el('span', 'changes-branch', branch),
    el('span', 'changes-files', `${files} file${files === 1 ? '' : 's'}`),
    el('span', 'add', `+${summary.added}`),
    el('span', 'del', `−${summary.removed}`),
  );
  if (!$('changesMenu').hidden && $('changesList').dataset.stamp !== String(summary.stamp)) renderChangesMenu();
}

function openChangesMenu() {
  if (!S.git || !S.git.repo || !S.git.files.length) return;
  closeMenus();
  $('changesMenu').style.left = `${$('changesPill').offsetLeft}px`;
  renderChangesMenu();
  $('changesMenu').hidden = false;
}

function renderChangesMenu() {
  const menu = $('changesMenu');
  const summary = S.git;
  if (!summary || !summary.repo || !summary.files.length) {
    menu.hidden = true;
    return;
  }
  const repo = summary.repo;
  const files = summary.files.length;
  const branch = repo.branch || repo.commit || 'detached';

  const head = $('changesHead');
  const title = el('div', 'mi-main');
  title.append(
    el('div', 'ch-title', `${files} uncommitted file${files === 1 ? '' : 's'}`),
    el('div', 'ch-sub', `${repo.name} · ${branch}${repo.noCommits ? ' · no commits yet' : ''}`),
  );
  const stats = el('span', 'ch-stats');
  stats.append(el('span', 'add', `+${summary.added}`), el('span', 'del', `−${summary.removed}`));
  const again = el('button', 'icon-button');
  again.title = 'Check again';
  again.append(icon('refresh'));
  again.addEventListener('click', () => reloadGit());
  head.replaceChildren(title, stats, again);

  const list = $('changesList');
  const keep = list.scrollTop;
  list.dataset.stamp = String(summary.stamp);
  list.replaceChildren();
  for (const file of summary.files) {
    list.append(changesRow(file));
    if (S.gitOpen.has(file.path)) list.append(gitDiffWrap(file.path));
  }
  if (summary.truncated) {
    list.append(el('div', 'diff-note', `Only the first ${files} changed files are listed.`));
  }
  list.scrollTop = keep;

  const foot = $('changesFoot');
  const where = el('span', 'ch-path', repo.root);
  where.title = repo.root;
  const open = el('button', 'btn small', 'Open folder');
  open.addEventListener('click', () => cf.openFolder(repo.root));
  foot.replaceChildren(where, open);
}

function changesRow(file) {
  const open = S.gitOpen.has(file.path);
  const row = el('button', `file-row${open ? ' open' : ''}`);
  const slash = file.path.lastIndexOf('/');
  const name = el('span', 'file-name');
  if (slash >= 0) name.append(el('span', 'file-dir', file.path.slice(0, slash + 1)));
  name.append(file.path.slice(slash + 1));
  row.append(name);
  if (file.status && file.status !== 'modified') row.append(el('span', 'file-badge', file.status));
  if (file.binary) row.append(el('span', 'file-badge', 'no diff'));
  const stats = el('span', 'file-stats');
  stats.append(el('span', 'add', `+${file.added}`), el('span', 'del', `−${file.removed}`));
  row.append(stats, chevron());
  row.addEventListener('click', () => toggleGitFile(file.path, row));
  return row;
}

function gitDiffWrap(path) {
  const wrap = el('div', 'file-diff');
  wrap.append(gitDiffBox(path));
  return wrap;
}

function toggleGitFile(path, row) {
  const next = row.nextElementSibling;
  const holder = next && next.classList.contains('file-diff') ? next : null;
  if (S.gitOpen.has(path)) {
    S.gitOpen.delete(path);
    row.classList.remove('open');
    if (holder) holder.remove();
    return;
  }
  S.gitOpen.add(path);
  row.classList.add('open');
  row.after(gitDiffWrap(path));
}

function gitDiffBox(path) {
  const known = S.gitDiffs.get(path);
  if (known) return gitDiffNode(known);
  const box = el('div', 'diff');
  box.append(el('div', 'diff-note', 'Loading the diff…'));
  loadGitDiff(path, box);
  return box;
}

// A file whose diff holds no lines — a mode change, most of the time — says so
// rather than unfolding an empty box.
function gitDiffNode(file) {
  if (!file.binary && !file.hunks.length) {
    return el('div', 'diff-note', file.untracked ? 'This file is empty.' : 'No lines changed: only the file’s mode or name.');
  }
  return renderDiff(file);
}

function loadGitDiff(path, box) {
  const target = gitTarget();
  if (!target) return;
  call(cf.gitDiff, { ...target, path }).then((file) => {
    S.gitDiffs.set(path, file);
    if (box.isConnected) box.replaceWith(gitDiffNode(file));
  }).catch((err) => {
    box.replaceChildren(el('div', 'diff-note', err.message));
  });
}

// Asked for by the refresh button, and after the folder changes underfoot.
function reloadGit() {
  S.gitFor = '';
  S.gitDiffs.clear();
  gitRetryAt = 0;
  ensureGit();
}

function onGitChanged({ sessionId, cwd, summary }) {
  const target = gitTarget();
  const tag = `${sessionId || 'draft'}|${cwd}`;
  if (!target || gitTag(target) !== tag) return;
  // A diff already unfolded stays as it is unless the numbers under it moved.
  const before = new Map((S.git && S.git.files ? S.git.files : []).map((f) => [f.path, `${f.added}:${f.removed}`]));
  // A folder that is not a repository has no files list at all.
  const files = (summary && summary.files) || [];
  if (files.length !== before.size
    || files.some((f) => before.get(f.path) !== `${f.added}:${f.removed}`)) {
    S.gitDiffs.clear();
  }
  S.gitFor = tag;
  S.git = { ...summary, stamp: ++gitStamp };
  renderChanges();
}

// `dismiss` changes what the closing button says and does besides closing.
function showBanner(text, actions = [], dismiss = {}) {
  const banner = $('banner');
  banner.replaceChildren(el('span', null, text));
  for (const action of actions) {
    const button = el('button', 'btn', action.label);
    button.addEventListener('click', action.run);
    banner.append(button);
  }
  const close = el('button', 'btn', dismiss.label || 'Dismiss');
  close.addEventListener('click', () => {
    hideBanner();
    if (dismiss.run) dismiss.run();
  });
  banner.append(close);
  banner.hidden = false;
}

function hideBanner() {
  $('banner').hidden = true;
}

async function pickFolder() {
  const dir = await call(cf.pickFolder);
  if (!dir) return null;
  S.draftCwd = dir;
  S.init.state.lastCwd = dir;
  cf.setState({ lastCwd: dir });
  renderMain();
  return dir;
}

async function sendMessage() {
  if (sendAfterVoice()) return;
  const prompt = $('prompt');
  const text = prompt.value.trim();
  if (!text || S.sending) return;
  const typedIn = S.current;
  if (!S.settings.hasKey) {
    openSettings(true);
    return;
  }
  hideBanner();

  if (S.current && S.running.has(S.current)) {
    const id = S.current;
    if (S.attachments.some((a) => a.kind === 'file')) {
      showBanner('Only images can be sent while the agent works. Attach other files to your next message.');
      return;
    }
    prompt.value = '';
    forgetDraft(typedIn);
    autosize();
    updateSendButton();
    let steerFiles = [];
    try {
      steerFiles = await readyAttachments(id);
      if (uploadedIds(steerFiles).length > 3) throw new Error('At most 3 images can be sent while the agent works.');
      await call(cf.steerRun, {
        sessionId: id, message: withReferences(text, steerFiles), files: uploadedIds(steerFiles),
      });
      clearAttachments();
      addItem(id, { type: 'user', text, steer: true, at: nowIso(), files: steerFiles });
    } catch (err) {
      prompt.value = text;
      rememberDraft();
      autosize();
      showBanner(err.message);
    }
    updateSendButton();
    return;
  }

  // A costly run says so before it starts, and offers cheaper models.
  if (!(await clearedToSpend(S.current, text))) return;

  S.sending = true;
  updateSendButton();
  let id = S.current;
  let started = false;
  let sentFiles = [];
  const sendTarget = attachTarget().key;
  try {
    checkAttachments(sendTarget);
    if (!id) {
      // No folder means a cloud sandbox: the tools run on CodingFleet instead.
      const cwd = S.draftSandbox ? null : (S.draftCwd || (await pickFolder()));
      if (!cwd && !S.draftSandbox) return;
      const session = await call(cf.createSession, { cwd, model: S.model, label: text });
      S.init.state.sessions[session.id] = { cwd: cwd || null, label: text.slice(0, 80) };
      S.sessions.unshift(session);
      S.transcripts.set(session.id, []);
      S.loaded.add(session.id);
      id = session.id;
      S.current = id;
      if (session.agentsFile) {
        transcriptOf(id).push({
          type: 'note',
          text: `Following ${session.agentsFile} from this folder.`,
        });
      }
    } else {
      const session = currentSession();
      if (session && session.executor === 'client' && !local(id).cwd) {
        const cwd = await call(cf.pickFolder);
        if (!cwd) return;
        await call(cf.setFolder, { sessionId: id, cwd });
        S.init.state.sessions[id] = { ...local(id), cwd };
      }
    }

    sentFiles = await readyAttachments(id, sendTarget);
    prompt.value = '';
    forgetDraft(typedIn);
    autosize();
    transcriptOf(id).push({ type: 'user', text, at: nowIso(), files: sentFiles });
    clearAttachments();
    S.running.set(id, { runId: null, started: Date.now(), turnStart: transcriptOf(id).length });
    started = true;
    const session = S.sessions.find((s) => s.id === id);
    if (session) {
      session.status = 'active';
      session.last_used_at = nowIso();
    }
    renderSidebar();
    renderMain();
    await call(cf.startRun, {
      sessionId: id, message: withReferences(text, sentFiles), model: S.model,
      executor: session ? session.executor : 'client', files: uploadedIds(sentFiles),
    });
    S.init.state.sessions[id] = { ...local(id), model: S.model };
    loadCredits(); // the run now holds one of the account's run slots
  } catch (err) {
    if (started) {
      S.running.delete(id);
      const items = transcriptOf(id);
      if (items.length && items[items.length - 1].type === 'user') items.pop();
      // Back into the composer, to send again.
      if (sentFiles.length && !S.attachments.length) {
        S.attachments = sentFiles;
        renderAttachments();
      }
      renderMain();
    }
    if (!prompt.value) {
      prompt.value = text;
      rememberDraft();
      autosize();
    }
    showBanner(err.message);
  } finally {
    S.sending = false;
    renderComposer();
  }
}

async function stopRun() {
  const id = S.current;
  const run = id && S.running.get(id);
  if (!run) return;
  run.stopping = true;
  const label = document.querySelector('.working .shimmer');
  if (label) label.textContent = 'Stopping…';
  const res = await cf.cancelRun(id);
  if (!res.ok) {
    run.stopping = false;
    if (label) label.textContent = 'Working…';
    showBanner(res.error.message);
  }
}
