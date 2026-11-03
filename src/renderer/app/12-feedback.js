'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. "Give us feedback", under the composer.
//
// A small box for the user's own words, sent to the CodingFleet team with the
// app's version and system and nothing else. What was typed survives closing
// the box until it is sent.
const FEEDBACK_MAX = 5000;
let feedbackDraft = '';

// Sending needs the app's own key, from the browser sign-in: said in words
// about feedback, not the server's words about settings.
function feedbackError(err) {
  if (err.code === 'desktop_key_required') {
    return 'Feedback needs the browser sign-in. Sign in with your browser in Settings, then send it again.';
  }
  return err.message;
}

function openFeedback() {
  if (document.querySelector('.feedback-overlay')) return;
  const overlay = el('div', 'overlay feedback-overlay');
  const modal = el('div', 'modal feedback-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'feedbackTitle');

  const head = el('div', 'feedback-head');
  const words = el('div');
  const title = el('h2', 'feedback-title', 'Give us feedback');
  title.id = 'feedbackTitle';
  words.append(title, el('p', 'feedback-sub',
    'Something broken, confusing or missing? Tell us. It goes straight to the developers who build CodingFleet.'));
  head.append(icon('chat', 'feedback-badge'), words);

  const input = el('textarea', 'feedback-input');
  input.placeholder = 'What happened, or what would make CodingFleet better for you?';
  input.maxLength = FEEDBACK_MAX;
  input.rows = 5;
  input.spellcheck = true;
  input.value = feedbackDraft;

  const email = S.credits && S.credits.account && S.credits.account.email;
  const note = el('p', 'feedback-note', 'Sent with your app version and system, never your chats or files.'
    + (email ? ` We may reply to ${email}.` : ''));
  const status = el('div', 'modal-status');

  const mac = S.init && S.init.platform === 'darwin';
  const keys = el('span', 'feedback-keys', `${mac ? '⌘' : 'Ctrl'} Enter to send`);
  const cancel = el('button', 'btn', 'Cancel');
  const send = el('button', 'btn primary', 'Send feedback');
  const actions = el('div', 'modal-actions');
  actions.append(keys, el('div', 'bar-spacer'), cancel, send);
  modal.append(head, input, note, status, actions);
  overlay.append(modal);

  let sending = false;
  const sync = () => { send.disabled = sending || !input.value.trim(); };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    $('prompt').focus();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  async function submit() {
    if (send.disabled) return;
    sending = true;
    sync();
    send.textContent = 'Sending…';
    status.className = 'modal-status';
    status.textContent = '';
    try {
      await call(cf.sendFeedback, input.value.trim());
    } catch (err) {
      sending = false;
      send.textContent = 'Send feedback';
      sync();
      status.className = 'modal-status error';
      status.textContent = feedbackError(err);
      return;
    }
    feedbackDraft = '';
    const done = el('div', 'feedback-done');
    const ok = el('button', 'btn', 'Close');
    ok.addEventListener('click', close);
    done.append(icon('check', 'feedback-check'), el('h2', 'feedback-title', 'Thank you!'),
      el('p', 'feedback-sub', 'It is on its way to the CodingFleet developers. We read every one.'), ok);
    modal.replaceChildren(done);
    ok.focus();
    setTimeout(() => { if (overlay.isConnected) close(); }, 3200);
  }

  input.addEventListener('input', () => {
    feedbackDraft = input.value;
    sync();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });
  cancel.addEventListener('click', close);
  send.addEventListener('click', submit);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  sync();
  document.body.append(overlay);
  setTimeout(() => input.focus(), 0);
}

{
  const link = $('feedbackLink');
  link.prepend(icon('chat'));
  link.addEventListener('click', openFeedback);
}
