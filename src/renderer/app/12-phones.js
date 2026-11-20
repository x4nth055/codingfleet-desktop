'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Settings > Phones: linking a phone with a QR
// code, the linked phones, and a message a phone sends for this computer.

// ── Settings > Phones ──────────────────────────────────────────────────────
// The main process (phones.js) talks to the server and makes the QR code: this
// window never sees the key, nor the link code as text.
let phonesView = null;     // { devices, remoteControl, hosting }
let phonesProblem = null;  // why the list could not be read: { kind: 'unavailable' | 'key' | 'error', message }
let phonesLoading = false;
// The phone being linked, if any: { phase, id, qr, expiresAt, every, device, code, known, note, timer, ticker }.
// Phases: starting, code (the QR code is shown), claimed (a phone scanned it),
// answering, finishing (confirmed here, the phone is collecting its key),
// then linked, denied, expired or failed.
let phoneLink = null;

const PLATFORM_NAMES = { android: 'Android', ios: 'iPhone', windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const platformName = (platform) => PLATFORM_NAMES[platform] || '';

const phonesShown = () => !$('settings').hidden && settingsTab === 'phones';

function forgetPhones() {
  stopPhoneLink();
  phonesView = null;
  phonesProblem = null;
  phoneMessages.clear();
}

function phonesProblemOf(err) {
  // A server that does not have phones yet answers 404.
  if (err.status === 404) return { kind: 'unavailable' };
  if (err.code === 'app_key_required') return { kind: 'key' };
  return { kind: 'error', message: err.message };
}

// Draws what is known at once, then reads the list again: a phone can be
// linked or removed from elsewhere.
async function renderPhonesPane() {
  drawPhones();
  if (phonesLoading || !S.settings.hasKey) return;
  phonesLoading = true;
  try {
    phonesView = await call(cf.phones);
    phonesProblem = null;
  } catch (err) {
    if (err.transient && phonesView) {
      // Offline for a moment: the list read before still stands.
      paneStatus($('phonesPane'), err.message, 'error');
    } else {
      phonesProblem = phonesProblemOf(err);
      phonesView = null;
    }
  } finally {
    phonesLoading = false;
  }
  if (phonesShown()) drawPhones();
}

function drawPhones() {
  const pane = $('phonesPane');
  const scroll = pane.scrollTop;
  pane.replaceChildren(paneHead('Phones',
    'Use CodingFleet on your phone. See the sessions of this computer and continue them from there.'));
  const empty = (text) => {
    const box = el('div', 'pane-empty', text);
    pane.append(box);
    return box;
  };
  if (!S.settings.hasKey) {
    empty('Sign in to link a phone.');
    return;
  }
  const problem = phonesProblem;
  if (problem && problem.kind === 'unavailable') {
    empty('Phones are not available yet. They will show here when CodingFleet turns them on.');
    return;
  }
  if (problem && problem.kind === 'key') {
    empty('This app is signed in with a key made for code. Sign in with your browser to link a phone.');
    const account = el('button', 'btn', 'Open Account');
    account.addEventListener('click', () => showSettingsTab('account'));
    pane.append(account);
    return;
  }
  if (!phonesView) {
    empty(problem ? problem.message : 'Loading your devices…');
    if (problem) {
      const retry = el('button', 'btn', 'Try again');
      retry.addEventListener('click', () => {
        phonesProblem = null;
        renderPhonesPane();
      });
      pane.append(retry);
    }
    return;
  }

  pane.append(phoneLinkBox());

  const devices = phonesView.devices || [];
  const phones = devices.filter((device) => device.kind === 'phone');
  pane.append(el('div', 'pane-section', 'Linked phones'));
  if (!phones.length) pane.append(el('div', 'phone-empty', 'No phone is linked yet.'));
  for (const device of phones) pane.append(deviceRow(device));

  // This computer first, then the others signed in to the account.
  const computers = devices.filter((device) => device.kind !== 'phone').sort((a, b) => Number(b.current) - Number(a.current));
  if (computers.length) {
    pane.append(el('div', 'pane-section', 'Computers'));
    for (const device of computers) pane.append(deviceRow(device));
  }

  pane.append(el('div', 'pane-section', 'Remote control'));
  pane.append(switchRow({
    title: 'Phones can use this computer',
    desc: "Linked phones can start and steer sessions in this computer's folders and answer approvals, "
      + 'while the app is open.',
    checked: phonesView.remoteControl,
    onChange: async (on, input) => {
      input.disabled = true;
      try {
        phonesView = await call(cf.setRemoteControl, on);
        S.init.state.remoteControl = on;
        paneStatus(pane, 'Saved.', 'ok');
      } catch (err) {
        paneStatus(pane, err.message, 'error');
      }
      if (phonesShown()) drawPhones();
    },
  }));
  if (phonesView.remoteControl && S.permission === 'auto') {
    const warn = el('div', 'set-row sub warn static');
    const text = el('div', 'set-text');
    text.append(el('div', 'set-desc', 'Auto-approve is on: commands a phone starts run without asking, like yours.'));
    warn.append(text);
    pane.append(warn);
  }

  const foot = el('div', 'pane-foot');
  foot.append(el('div', 'pane-status'));
  pane.append(foot);
  applyStatus(pane);
  pane.scrollTop = scroll;
}

function deviceRow(device) {
  const phone = device.kind === 'phone';
  const row = el('div', 'set-row static phone-row');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title');
  title.append(el('span', null, device.name));
  if (device.current) title.append(el('span', 'pill', 'This computer'));
  // Another computer that is open now and lets phones use it.
  else if (!phone && device.online) title.append(el('span', 'pill', 'Online'));
  const when = device.last_used_at ? `Last used ${relAgo(device.last_used_at)}`
    : device.created_at ? `${phone ? 'Linked' : 'Signed in'} ${relAgo(device.created_at)}` : '';
  text.append(title, el('div', 'set-desc', [platformName(device.platform), when].filter(Boolean).join(' · ')));
  row.append(icon(phone ? 'phone' : 'monitor'), text);
  if (phone) {
    const remove = el('button', 'btn small', 'Remove');
    remove.addEventListener('click', () => removePhone(device));
    row.append(remove);
  }
  return row;
}

async function removePhone(device) {
  const ok = await confirmDialog({
    title: `Remove ${device.name}?`,
    text: 'It is signed out at once. To use it again, link it with a new code.',
    confirm: 'Remove',
    danger: true,
  });
  if (!ok) return;
  const pane = $('phonesPane');
  paneStatus(pane, 'Removing…');
  try {
    phonesView = await call(cf.removePhone, device.id);
    paneStatus(pane, `${device.name} removed.`, 'ok');
  } catch (err) {
    paneStatus(pane, err.message, 'error');
  }
  if (phonesShown()) drawPhones();
}

// ── Linking a phone ────────────────────────────────────────────────────────
function stopPhoneLink() {
  if (phoneLink) {
    clearTimeout(phoneLink.timer);
    clearInterval(phoneLink.ticker);
  }
  phoneLink = null;
}

function redrawPhoneLink() {
  const old = document.getElementById('phoneLinkBox');
  if (old) old.replaceWith(phoneLinkBox());
}

// "2:41", for the time a code has left.
function phoneLinkLeft(link) {
  const seconds = Math.max(0, Math.ceil((link.expiresAt - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const phoneCountdown = (link) => (link.phase === 'code'
  ? `This code works for ${phoneLinkLeft(link)} more.` : `Answer within ${phoneLinkLeft(link)}.`);

// The top of the pane: the button, then the code, then the phone to confirm.
function phoneLinkBox() {
  const link = phoneLink;
  const button = (label, run, className = 'btn') => {
    const node = el('button', className, label);
    node.addEventListener('click', run);
    return node;
  };
  const close = () => {
    // A code still on screen, or a phone not answered yet, is taken back: the
    // picture of it someone may have stops working now.
    if (link && link.id && ['code', 'claimed'].includes(link.phase)) call(cf.cancelPhoneLink, link.id).catch(() => {});
    stopPhoneLink();
    redrawPhoneLink();
  };

  if (!link) {
    const row = el('div', 'set-row static');
    row.id = 'phoneLinkBox';
    const text = el('div', 'set-text');
    text.append(el('div', 'set-title', 'Link a phone'),
      el('div', 'set-desc', 'Scan a code with the CodingFleet app on your phone. You type no password there, '
        + 'and you confirm the phone here.'));
    row.append(text, button('Link a phone', startPhoneLink, 'btn primary'));
    return row;
  }

  const box = el('div', 'phone-link');
  box.id = 'phoneLinkBox';
  const side = el('div', 'phone-link-side');
  const actions = el('div', 'phone-actions');

  if (link.phase === 'starting') {
    side.append(el('div', 'set-title', 'Link a phone'), el('div', 'set-desc', 'Getting a code…'));
    box.append(side);
    return box;
  }

  if (link.phase === 'code') {
    // Black on a white card in every theme: that is what a camera reads.
    const card = el('div', 'phone-qr');
    const picture = el('img');
    picture.alt = 'The QR code that links a phone';
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qr)}`;
    card.append(picture);
    const steps = el('ol', 'phone-steps');
    for (const step of ['Install the CodingFleet app on your phone.', 'Tap "Scan the desktop app’s QR code".', 'Point the camera at this code.']) {
      steps.append(el('li', null, step));
    }
    actions.append(button('Cancel', close));
    side.append(el('div', 'set-title', 'Scan this code with your phone'), steps,
      el('div', 'set-desc phone-countdown', phoneCountdown(link)), actions);
    box.append(card, side);
    return box;
  }

  if (link.phase === 'claimed' || link.phase === 'answering') {
    const busy = link.phase === 'answering';
    const check = el('div', 'phone-check');
    check.append('Check that your phone shows ', el('strong', 'phone-code', link.code || '····'), '.');
    const deny = button('Deny', () => answerPhoneLink(link, 'deny'));
    const approve = button('Link this phone', () => answerPhoneLink(link, 'approve'), 'btn primary');
    deny.disabled = busy;
    approve.disabled = busy;
    actions.append(deny, approve);
    side.append(el('div', 'set-title', link.device.name),
      el('div', 'set-desc', [platformName(link.device.platform), 'wants to link to your account'].filter(Boolean).join(' · ')),
      check,
      el('div', 'set-desc', 'Another number, or not your phone? Deny it.'),
      el('div', 'set-desc phone-countdown', busy ? '' : phoneCountdown(link)), actions);
    box.append(icon('phone', 'phone-badge'), side);
    return box;
  }

  if (link.phase === 'finishing') {
    side.append(el('div', 'set-title', `Linking ${link.device.name}…`),
      el('div', 'set-desc', 'Keep the app open on your phone for a moment.'));
    const badge = el('span', 'phone-badge');
    badge.append(el('span', 'spinner'));
    box.append(badge, side);
    return box;
  }

  if (link.phase === 'linked') {
    actions.append(button('Done', close));
    side.append(el('div', 'set-title', `${link.device.name} is linked`),
      el('div', 'set-desc', 'It is signed in to your account, and can use this computer while the app is open here.'),
      actions);
    box.append(icon('check', 'phone-badge good'), side);
    return box;
  }

  // Expired, denied or failed: nothing was linked, and a new code starts over.
  const title = link.phase === 'denied' ? 'You denied this phone' : link.phase === 'expired' ? 'This code expired'
    : 'The phone was not linked';
  const why = link.phase === 'denied' ? 'Nothing was linked.' : link.phase === 'expired' ? 'A code works for a few minutes.'
    : link.note || 'Something went wrong.';
  actions.append(button('Cancel', close), button('Show a new code', startPhoneLink, 'btn primary'));
  side.append(el('div', 'set-title', title), el('div', 'set-desc', why), actions);
  box.append(side);
  return box;
}

async function startPhoneLink() {
  stopPhoneLink();
  // The phones there are now: the one that is not among them afterwards is the new one.
  const known = new Set(((phonesView && phonesView.devices) || []).map((device) => device.id));
  const link = { phase: 'starting', known, misses: 0 };
  phoneLink = link;
  redrawPhoneLink();
  try {
    const started = await call(cf.linkPhone);
    if (phoneLink !== link) return;
    Object.assign(link, {
      phase: 'code', id: started.id, qr: started.qr,
      expiresAt: Date.now() + started.expires_in * 1000, every: started.interval * 1000,
    });
  } catch (err) {
    if (phoneLink !== link) return;
    if (err.status === 404) {
      stopPhoneLink();
      phonesProblem = { kind: 'unavailable' };
      drawPhones();
      return;
    }
    Object.assign(link, { phase: 'failed', note: err.message });
  }
  redrawPhoneLink();
  if (link.phase !== 'code') return;
  pollPhoneLink(link);
  // The time left, every second; the picture is not drawn again for it.
  link.ticker = setInterval(() => {
    if (phoneLink !== link || !['code', 'claimed', 'answering'].includes(link.phase)) {
      clearInterval(link.ticker);
      return;
    }
    if (link.phase !== 'answering' && Date.now() >= link.expiresAt) {
      endPhoneLink(link, 'expired');
      return;
    }
    const line = document.querySelector('#phoneLinkBox .phone-countdown');
    if (line && link.phase !== 'answering') line.textContent = phoneCountdown(link);
  }, 1000);
}

function endPhoneLink(link, phase, note) {
  clearTimeout(link.timer);
  clearInterval(link.ticker);
  Object.assign(link, { phase, note: note || null });
  redrawPhoneLink();
}

function pollPhoneLink(link) {
  clearTimeout(link.timer);
  link.timer = setTimeout(async () => {
    if (phoneLink !== link) return;
    await checkPhoneLink(link);
    if (phoneLink === link && ['code', 'claimed', 'finishing'].includes(link.phase)) pollPhoneLink(link);
  }, link.every);
}

async function checkPhoneLink(link) {
  let answer;
  try {
    answer = await call(cf.phoneLink, link.id);
  } catch (err) {
    if (phoneLink !== link) return;
    // A dropped connection passes; anything else, or too many in a row, ends it.
    if (!err.transient || ++link.misses > 8) endPhoneLink(link, 'failed', err.message);
    return;
  }
  if (phoneLink !== link) return;
  if (link.phase !== 'finishing') link.misses = 0;
  if (link.phase === 'answering') return; // the answer given here decides
  if (link.phase === 'finishing' && answer.status === 'denied') {
    endPhoneLink(link, 'failed', answer.message || 'The phone was not linked.');
    return;
  }
  if (link.phase === 'finishing') {
    // The phone is on the list once it has its key ("linked"). A server from
    // before that word deletes the link then, so "expired" means done, or that
    // the phone never came: the list tells which.
    let view = null;
    try { view = await call(cf.phones); } catch { /* looked at again on the next turn */ }
    if (phoneLink !== link) return;
    const added = view && view.devices.find((device) => device.kind === 'phone' && !link.known.has(device.id));
    if (added) {
      phonesView = view;
      link.device = { name: added.name, platform: added.platform };
      link.phase = 'linked';
      if (phonesShown()) drawPhones();
    } else if (answer.status !== 'confirmed' && answer.status !== 'linked' && (view || ++link.misses > 8)) {
      endPhoneLink(link, 'failed', 'The phone did not finish. Show a new code and scan it again.');
    }
    return;
  }
  if (answer.status === 'claimed' && link.phase === 'code' && answer.device) {
    Object.assign(link, { phase: 'claimed', device: answer.device, code: answer.confirm_code });
    redrawPhoneLink();
  } else if (answer.status === 'denied' || answer.status === 'expired') {
    endPhoneLink(link, answer.status);
  }
}

async function answerPhoneLink(link, decision) {
  if (phoneLink !== link || link.phase !== 'claimed') return;
  link.phase = 'answering';
  redrawPhoneLink();
  let next = 'expired';
  try {
    const answer = await call(cf.decidePhoneLink, { id: link.id, decision });
    if (answer.status === 'confirmed') next = 'finishing';
    else if (answer.status === 'denied') next = 'denied';
  } catch (err) {
    // 404: the link ran out while the answer was on its way.
    if (err.status !== 404) {
      if (phoneLink !== link) return;
      paneStatus($('phonesPane'), err.message, 'error');
      next = 'claimed';
    }
  }
  if (phoneLink !== link) return;
  if (next === 'finishing' || next === 'claimed') {
    link.phase = next;
    redrawPhoneLink();
    pollPhoneLink(link);
  } else {
    endPhoneLink(link, next);
  }
}

// ── A message from a phone ─────────────────────────────────────────────────
// Which messages a phone sent, while the app runs. The server's history does
// not say, so a conversation read again from it gets its "From" marks here.
const phoneMessages = new Map(); // session id -> [{ text, at, from }]

function notePhoneMessage(sessionId, item) {
  const sent = phoneMessages.get(sessionId) || [];
  sent.push({ text: item.text, at: Date.parse(item.at), from: item.from });
  phoneMessages.set(sessionId, sent.slice(-50));
}

// The same words, sent at about the same time: the server's clock is not this computer's.
function markPhoneMessages(sessionId, items) {
  const sent = phoneMessages.get(sessionId);
  if (!sent) return;
  for (const item of items) {
    if (item.type !== 'user' || item.steer || item.from || !item.at) continue;
    const match = sent.find((message) => message.text === item.text && Math.abs(Date.parse(item.at) - message.at) < 10 * 60000);
    if (match) item.from = match.from;
  }
}

// A linked phone asked for a run on this computer (main: phones.js, which
// checked the command). It is sent the way a message typed here is: the same
// bubble, the same run, the same approvals, in its own session whether or not
// that one is on screen. The composer is not touched: what is being typed
// there stays.
async function runFromPhone(request) {
  const text = String((request && request.message) || '').trim();
  let id = request.sessionId || null;
  let made = false;    // a session was made for this message
  let started = false; // the bubble is in the conversation
  const answer = (ok, error) => cf.phoneRunResult({ requestId: request.requestId, ok, sessionId: id, error });
  try {
    if (!S.settings.hasKey) throw new Error('This computer is signed out.');
    if (!text) throw new Error('The message is empty.');
    let model = request.model || null;
    if (id) {
      if (S.running.has(id) || S.remoteBusy.has(id)) throw new Error('This session is already working. Wait for it to finish.');
      await phoneSessionReady(id);
      const known = S.sessions.find((s) => s.id === id);
      model = model || sessionModel(known) || resolveModel(local(id).model) || newSessionModel();
    } else {
      model = model || newSessionModel();
      const session = await call(cf.createSession, { cwd: request.cwd, model, label: text });
      S.init.state.sessions[session.id] = { cwd: request.cwd, label: text.slice(0, 80) };
      S.sessions.unshift(session);
      S.transcripts.set(session.id, []);
      S.loaded.add(session.id);
      id = session.id;
      made = true;
      if (session.agentsFile) {
        transcriptOf(id).push({ type: 'note', text: `Following ${session.agentsFile} from this folder.` });
      }
      if (session.memoryEntries) {
        transcriptOf(id).push({
          type: 'note',
          text: `Project memory: ${session.memoryEntries} ${session.memoryEntries === 1 ? 'entry' : 'entries'} from earlier sessions here.`,
        });
      }
    }
    if (S.running.has(id)) throw new Error('This session is already working. Wait for it to finish.');
    // The main process stopped waiting: a run started now would be one the phone was told failed.
    if (Date.now() > request.expires) throw new Error('This computer took too long to answer.');
    const bubble = { type: 'user', text, at: nowIso(), files: [], from: request.from || 'Phone' };
    transcriptOf(id).push(bubble);
    dropWatch(id);
    S.running.set(id, { runId: null, started: Date.now(), turnStart: transcriptOf(id).length });
    started = true;
    const session = S.sessions.find((s) => s.id === id);
    if (session) session.last_used_at = nowIso();
    renderSidebar();
    if (id === S.current) renderMain();
    await call(cf.startRun, {
      sessionId: id, message: text, model, executor: 'client', files: Array.isArray(request.files) ? request.files : [],
    });
    S.init.state.sessions[id] = { ...local(id), model };
    notePhoneMessage(id, bubble);
    loadCredits(); // the run now holds one of the account's run slots
    answer(true);
  } catch (err) {
    if (started) {
      S.running.delete(id);
      const items = transcriptOf(id);
      if (items.length && items[items.length - 1].type === 'user') items.pop();
      if (id === S.current) renderMain();
    }
    if (started || made) renderSidebar();
    answer(false, err.message);
  }
}

// The session's history, read before the message goes in: read afterwards, it
// would already hold the message, and the conversation would show it twice.
async function phoneSessionReady(id) {
  for (let turn = 0; turn < 100 && S.loading.has(id); turn++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!S.loaded.has(id) && !S.loading.has(id)) await loadSessionHistory(id);
  if (!S.loaded.has(id) || loadFailures.has(id)) throw new Error('This session could not be opened on the computer.');
}
