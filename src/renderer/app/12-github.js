'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Pull requests, above the prompt.

// ── Pull requests ──────────────────────────────────────────────────────────
// A folder whose repository is on GitHub gets a second pill beside the
// uncommitted changes. Through the GitHub CLI it lists the open pull requests
// and the one for the branch checked out. Until `gh` is there and signed in,
// the same pill walks through installing it and signing in. Reviewing and
// opening a pull request is work for the agent: the buttons write the request
// into the prompt, where it can be read and changed before it is sent.
ICON.github = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
ICON.pr = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M6 8.4v7.2M18 15.6V9a3 3 0 0 0-3-3h-4.5"/><path d="M13 3.5 10.5 6 13 8.5"/></svg>';
ICON.external = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>';

const GH_HIDDEN_KEY = 'cf.githubSetupHidden';
const GH_PULLS_FRESH_MS = 30_000;     // a menu opened within this reuses the list
const GH_PULLS_REFRESH_MS = 3 * 60_000;

const GH = {
  status: null,       // what github:status said for `statusFor`
  statusFor: '',       // cleared to ask again; the status stays on screen meanwhile
  shownFor: '',        // the folder `status` is about
  statusLoading: '',
  pulls: null,        // what github:pulls said for `pullsFor`
  pullsFor: '',
  pullsAt: 0,
  pullsLoading: false,
  pullsError: null,
  stage: null,        // 'install' | 'signin' while one runs
  line: '',           // the installer's last words
  code: null,         // { code, url } while GitHub waits for it
  error: null,
  setupHidden: (() => { try { return localStorage.getItem(GH_HIDDEN_KEY) === '1'; } catch { return false; } })(),
};

if (typeof cf.onGithubProgress === 'function') {
  cf.onGithubProgress(({ stage, line, code, url, message }) => {
    if (stage === 'install' && line) GH.line = line;
    if (stage === 'code') GH.code = { code, url, message };
    renderGithub();
  });
}

const ghTarget = () => (typeof gitTarget === 'function' ? gitTarget() : null);
const ghTag = (target) => `${target.sessionId || 'draft'}|${target.cwd}`;
const ghArg = (target) => (target.sessionId ? { sessionId: target.sessionId, cwd: target.cwd } : { cwd: target.cwd });

// Asked for with every paint of the composer: cheap unless the folder changed.
function ensureGithub() {
  const target = ghTarget();
  if (!target || typeof cf.githubStatus !== 'function') {
    GH.status = null;
    GH.statusFor = '';
    GH.shownFor = '';
    renderGithub();
    return;
  }
  const tag = ghTag(target);
  if (GH.statusFor === tag) {
    maybeLoadPulls();
    renderGithub();
    return;
  }
  if (GH.statusLoading === tag) return;
  GH.statusLoading = tag;
  // Another folder's answer goes at once. The same folder's stays until the
  // new one comes: a menu open through a sign-in does not blink shut.
  if (GH.status && GH.shownFor !== tag) {
    GH.status = null;
    GH.pulls = null;
    renderGithub();
  }
  call(cf.githubStatus, ghArg(target)).then((status) => {
    if (GH.statusLoading === tag) GH.statusLoading = '';
    const now = ghTarget();
    if (!now || ghTag(now) !== tag) return;
    GH.status = status;
    GH.statusFor = tag;
    GH.shownFor = tag;
    maybeLoadPulls();
    renderGithub();
  }).catch(() => {
    if (GH.statusLoading === tag) GH.statusLoading = '';
  });
}

// Asked again after an install or a sign-in, or by the refresh button.
function reloadGithub() {
  GH.statusFor = '';
  GH.pullsFor = '';
  GH.pullsAt = 0;
  ensureGithub();
}

const ghReady = () => Boolean(GH.status && GH.status.repo && GH.status.installed && GH.status.signedIn);

function maybeLoadPulls({ force = false } = {}) {
  if (!ghReady() || GH.pullsLoading) return;
  const target = ghTarget();
  if (!target) return;
  const tag = ghTag(target);
  const fresh = GH.pullsFor === tag && Date.now() - GH.pullsAt < (force ? GH_PULLS_FRESH_MS : GH_PULLS_REFRESH_MS);
  // A branch switched under the list makes its "this branch" part wrong.
  const branch = S.git && S.git.repo && S.git.repo.branch;
  const moved = GH.pulls && branch && GH.pulls.branch && branch !== GH.pulls.branch;
  if (fresh && !moved) return;
  GH.pullsLoading = true;
  if (GH.pullsFor !== tag) GH.pulls = null;
  renderGithub();
  call(cf.githubPulls, ghArg(target)).then((pulls) => {
    const now = ghTarget();
    if (!now || ghTag(now) !== tag) return;
    GH.pulls = pulls;
    GH.pullsFor = tag;
    GH.pullsError = null;
  }).catch((err) => {
    GH.pullsError = err.message;
    GH.pullsFor = tag;
  }).finally(() => {
    GH.pullsAt = Date.now();
    GH.pullsLoading = false;
    renderGithub();
  });
}

// The agent pushed a branch or the user committed: the list may have moved.
function githubGitChanged() {
  if (ghReady() && Date.now() - GH.pullsAt > 15_000) {
    GH.pullsAt = 0;
    maybeLoadPulls();
  }
}

// ── The pill ───────────────────────────────────────────────────────────────
function prState(pr) {
  if (pr.state === 'MERGED') return { text: 'Merged', tone: 'merged' };
  if (pr.state === 'CLOSED') return { text: 'Closed', tone: 'closed' };
  if (pr.draft) return { text: 'Draft', tone: 'draft' };
  if (pr.decision === 'APPROVED') return { text: 'Approved', tone: 'good' };
  if (pr.decision === 'CHANGES_REQUESTED') return { text: 'Changes requested', tone: 'bad' };
  return { text: 'Open', tone: 'open' };
}

function renderGithub() {
  const box = $('github');
  if (!box) return;
  const status = GH.status;
  // Only a GitHub repository gets the pill; any other folder has no use for it.
  if (!status || !status.repo) {
    box.hidden = true;
    $('githubMenu').hidden = true;
    return;
  }
  box.hidden = false;
  const pill = $('githubPill');
  const parts = [];
  const setup = !status.installed || !status.signedIn;
  pill.classList.toggle('gh-quiet', setup && GH.setupHidden && !GH.stage);

  if (GH.stage === 'install') {
    parts.push(el('span', 'spinner small'), el('span', null, 'Installing GitHub CLI…'));
    pill.title = 'Installing the GitHub CLI';
  } else if (GH.stage === 'signin') {
    parts.push(el('span', 'spinner small'), el('span', null, GH.code && GH.code.code ? `Enter ${GH.code.code} on GitHub` : 'Signing in to GitHub…'));
    pill.title = 'Waiting for you to approve on github.com';
  } else if (setup && GH.setupHidden) {
    parts.push(icon('github'));
    pill.title = 'Pull requests: set up GitHub';
  } else if (!status.installed) {
    parts.push(icon('github'), el('span', null, 'Set up pull requests'));
    pill.title = 'Review and open pull requests from here, with the GitHub CLI';
  } else if (!status.signedIn) {
    parts.push(icon('github'), el('span', null, 'Sign in to GitHub'));
    pill.title = 'Sign in to review and open pull requests from here';
  } else {
    parts.push(icon('github'));
    const pulls = GH.pulls;
    const current = pulls && pulls.current;
    if (current && current.state === 'OPEN') {
      const state = prState(current);
      parts.push(el('span', 'gh-number', `#${current.number}`), el('span', `gh-state ${state.tone}`, state.text));
    } else {
      parts.push(el('span', null, 'Pull requests'));
    }
    if (pulls) {
      const forMe = pulls.prs.filter((pr) => pr.askedOfMe).length;
      if (forMe) parts.push(el('span', 'gh-count for-me', `${forMe} for you`));
      else if (!current || current.state !== 'OPEN') parts.push(el('span', 'gh-count', String(pulls.prs.length)));
    } else if (GH.pullsLoading) {
      parts.push(el('span', 'spinner small'));
    }
    pill.title = `${status.repo.slug} on GitHub${status.user ? `, signed in as ${status.user}` : ''}`;
  }
  parts.push(icon('caret', 'icon caret'));
  pill.replaceChildren(...parts);
  if (!$('githubMenu').hidden) renderGithubMenu();
}

function openGithubMenu() {
  if (!GH.status || !GH.status.repo) return;
  closeMenus();
  const menu = $('githubMenu');
  menu.style.left = `${Math.max(0, $('github').offsetLeft)}px`;
  maybeLoadPulls({ force: true });
  renderGithubMenu();
  menu.hidden = false;
}

// ── The menu ───────────────────────────────────────────────────────────────
function ghHead(title, sub, extra = []) {
  const head = el('div', 'changes-head');
  const main = el('div', 'mi-main');
  main.append(el('div', 'ch-title', title));
  if (sub) main.append(el('div', 'ch-sub', sub));
  head.append(icon('github', 'icon gh-head-icon'), main, ...extra);
  return head;
}

function ghButton(label, className, run) {
  const button = el('button', `btn ${className || ''}`.trim(), label);
  button.addEventListener('click', run);
  return button;
}

function renderGithubMenu() {
  const menu = $('githubMenu');
  const status = GH.status;
  if (!status || !status.repo) {
    menu.hidden = true;
    return;
  }
  const keep = menu.querySelector('.menu-list');
  const scroll = keep ? keep.scrollTop : 0;
  if (GH.stage === 'install') menu.replaceChildren(...ghInstalling());
  else if (GH.stage === 'signin') menu.replaceChildren(...ghSigningIn());
  else if (!status.installed) menu.replaceChildren(...ghInstallOffer());
  else if (!status.signedIn) menu.replaceChildren(...ghSignInOffer());
  else menu.replaceChildren(...ghPullsView());
  const list = menu.querySelector('.menu-list');
  if (list) list.scrollTop = scroll;
}

function ghError() {
  return GH.error ? el('div', 'gh-error', GH.error) : null;
}

function ghNotNow() {
  return ghButton('Not now', '', () => {
    GH.setupHidden = true;
    try { localStorage.setItem(GH_HIDDEN_KEY, '1'); } catch { /* this run only */ }
    closeMenus();
    renderGithub();
  });
}

function ghInstallOffer() {
  const status = GH.status;
  const body = el('div', 'gh-body');
  body.append(
    el('p', null, `Review pull requests on ${status.repo.slug} and open new ones without leaving the app.`),
    el('p', 'gh-muted', 'This uses the GitHub CLI (gh), GitHub’s own command-line tool. Your GitHub sign-in stays with it; this app never sees it.'),
  );
  const error = ghError();
  if (error) body.append(error);
  const actions = el('div', 'gh-actions');
  if (status.installer) {
    const how = status.installer === 'winget' ? 'winget. Windows may ask for permission.' : 'Homebrew.';
    body.append(el('p', 'gh-muted', `Installs with ${how}`));
    actions.append(ghButton('Install GitHub CLI', 'primary', installGithub));
  } else {
    actions.append(ghButton('Get GitHub CLI', 'primary', () => window.open('https://cli.github.com/')));
    actions.append(ghButton('I installed it', '', () => { GH.error = null; reloadGithub(); }));
  }
  actions.append(el('div', 'bar-spacer'), ghNotNow());
  return [ghHead('Pull requests', `${status.repo.slug} · step 1 of 2`), body, actions];
}

function ghInstalling() {
  const body = el('div', 'gh-body');
  const row = el('div', 'gh-wait');
  row.append(el('span', 'spinner small'), el('span', null, 'Installing the GitHub CLI…'));
  body.append(row, el('div', 'gh-line', GH.line || 'Starting the installer'));
  return [ghHead('Pull requests', `${GH.status.repo.slug} · step 1 of 2`), body];
}

function ghSignInOffer() {
  const status = GH.status;
  const body = el('div', 'gh-body');
  body.append(
    el('p', null, 'Sign in to GitHub once. GitHub shows a page where you enter a short code.'),
    el('p', 'gh-muted', `The GitHub CLI${status.version ? ` ${status.version}` : ''} keeps the sign-in, and git uses it to push your branches.`),
  );
  const error = ghError();
  if (error) body.append(error);
  const actions = el('div', 'gh-actions');
  actions.append(ghButton('Sign in to GitHub', 'primary', signInGithub), el('div', 'bar-spacer'), ghNotNow());
  return [ghHead('Pull requests', `${status.repo.slug} · step 2 of 2`), body, actions];
}

function ghSigningIn() {
  const body = el('div', 'gh-body');
  const actions = el('div', 'gh-actions');
  if (GH.code && GH.code.code) {
    body.append(el('p', null, 'Enter this code on GitHub, then approve:'));
    const code = el('div', 'gh-code', GH.code.code);
    body.append(code);
    const open = ghButton('Copy code and open GitHub', 'primary', async () => {
      try { await call(cf.githubOpenDevice, GH.code); } catch (err) { showBanner(err.message); }
      open.textContent = 'Copied. Paste it on GitHub';
    });
    actions.append(open);
  } else if (GH.code) {
    // The code was not recognized: gh's own words carry it.
    body.append(el('p', null, 'GitHub CLI says:'), el('pre', 'gh-said', GH.code.message || ''));
    actions.append(ghButton('Open GitHub', 'primary', () => call(cf.githubOpenDevice, { url: GH.code.url }).catch(() => {})));
  } else {
    const row = el('div', 'gh-wait');
    row.append(el('span', 'spinner small'), el('span', null, 'Asking GitHub for a code…'));
    body.append(row);
  }
  const wait = el('div', 'gh-wait gh-muted');
  if (GH.code) wait.append(el('span', 'spinner small'), el('span', null, 'Waiting for you to approve on github.com…'));
  body.append(wait);
  actions.append(el('div', 'bar-spacer'), ghButton('Cancel', '', () => cf.githubCancelSignIn()));
  return [ghHead('Sign in to GitHub', GH.status.repo.slug), body, actions];
}

async function installGithub() {
  GH.stage = 'install';
  GH.line = '';
  GH.error = null;
  renderGithub();
  try {
    await call(cf.githubInstall);
  } catch (err) {
    GH.error = err.message;
  }
  GH.stage = null;
  reloadGithub();
  renderGithub();
}

async function signInGithub() {
  GH.stage = 'signin';
  GH.code = null;
  GH.error = null;
  renderGithub();
  try {
    await call(cf.githubSignIn);
    GH.setupHidden = false;
    try { localStorage.removeItem(GH_HIDDEN_KEY); } catch { /* fine */ }
  } catch (err) {
    if (!/cancelled/i.test(err.message)) GH.error = err.message;
  }
  GH.stage = null;
  GH.code = null;
  reloadGithub();
  renderGithub();
}

async function signOutGithub() {
  try {
    await call(cf.githubSignOut);
  } catch (err) {
    showBanner(err.message);
  }
  GH.pulls = null;
  reloadGithub();
}

// ── Signed in: the list ────────────────────────────────────────────────────
function ghPullsView() {
  const status = GH.status;
  const pulls = GH.pulls;
  const again = el('button', 'icon-button');
  again.title = 'Check again';
  again.append(GH.pullsLoading ? el('span', 'spinner small') : icon('refresh'));
  again.addEventListener('click', () => { GH.pullsAt = 0; maybeLoadPulls(); });
  const head = ghHead(status.repo.slug, status.user ? `Signed in as ${status.user}` : 'Signed in', [again]);

  const list = el('div', 'menu-list');
  if (!pulls && GH.pullsError) {
    list.append(el('div', 'gh-error', GH.pullsError));
  } else if (!pulls) {
    list.append(el('div', 'menu-empty', 'Loading pull requests…'));
  } else {
    if (GH.pullsError) list.append(el('div', 'gh-error', GH.pullsError));
    list.append(...ghThisBranch(pulls));
    const others = pulls.prs.filter((pr) => !pulls.current || pr.number !== pulls.current.number);
    list.append(el('div', 'menu-group', others.length ? `Open pull requests · ${others.length}` : 'Open pull requests'));
    if (!others.length) list.append(el('div', 'menu-empty', 'No other open pull requests.'));
    for (const pr of others) list.append(ghPrRow(pr));
  }

  const foot = el('div', 'changes-foot');
  const who = el('span', 'ch-path', status.version ? `GitHub CLI ${status.version}` : 'GitHub CLI');
  const out = el('button', 'btn small', 'Sign out');
  out.addEventListener('click', signOutGithub);
  const site = el('button', 'btn small', 'Open on GitHub');
  site.addEventListener('click', () => window.open(`${status.repo.url}/pulls`));
  foot.append(who, out, site);
  return [head, list, foot];
}

// The branch checked out: its pull request, or the offer to open one.
function ghThisBranch(pulls) {
  const group = el('div', 'menu-group', 'This branch');
  if (pulls.branch) group.append(el('span', 'gh-branch', pulls.branch));
  const parts = [group];
  if (pulls.current) {
    parts.push(ghPrRow(pulls.current, { here: true }));
    if (pulls.current.state === 'OPEN') return parts;
  }
  const box = el('div', 'gh-create');
  const text = el('div', 'mi-main');
  const uncommitted = S.git && S.git.files ? S.git.files.length : 0;
  const onBase = !pulls.branch || pulls.branch === pulls.base;
  const bits = [];
  if (pulls.ahead) bits.push(`${pulls.ahead} commit${pulls.ahead === 1 ? '' : 's'} ahead of ${pulls.base}`);
  if (uncommitted) bits.push(`${uncommitted} uncommitted file${uncommitted === 1 ? '' : 's'}`);
  const nothing = !pulls.ahead && !uncommitted;
  text.append(
    el('div', 'mi-name', 'Open a pull request'),
    el('div', 'mi-sub', nothing ? `Nothing here that is not on ${pulls.base || 'the default branch'} yet.`
      : `${bits.join(' · ')}${onBase ? ' · the agent will make a branch' : ''}`),
  );
  const button = ghButton('Create PR', 'small primary', () => {
    closeMenus();
    promptFor(CF_PR_PROMPTS.createPrompt(pulls.repo, { base: pulls.base, onBase }));
  });
  button.disabled = nothing;
  box.append(icon('pr'), text, button);
  parts.push(box);
  return parts;
}

function ghPrRow(pr, { here = false } = {}) {
  const row = el('div', `gh-pr${pr.askedOfMe ? ' for-me' : ''}`);
  const text = el('div', 'mi-main');
  const name = el('div', 'mi-name');
  name.append(el('span', 'gh-number', `#${pr.number}`), ` ${pr.title}`);
  name.title = pr.title;
  const sub = el('div', 'mi-sub');
  const state = prState(pr);
  // "Open" goes without saying in a list of open pull requests.
  if (state.tone !== 'open' || here) sub.append(el('span', `gh-state ${state.tone}`, state.text));
  if (pr.askedOfMe) sub.append(el('span', 'gh-state for-me', 'Review requested'));
  sub.append(` ${pr.author || 'unknown'} · ${pr.head} → ${pr.base} · `,
    el('span', 'add', `+${pr.additions}`), ' ', el('span', 'del', `−${pr.deletions}`),
    ` · ${relTime(pr.updatedAt)}`);
  text.append(name, sub);

  const actions = el('div', 'gh-row-actions');
  if (pr.state === 'OPEN') {
    const review = ghButton(pr.mine || here ? 'Check' : 'Review', 'small', () => {
      closeMenus();
      promptFor(CF_PR_PROMPTS.reviewPrompt(GH.status.repo, pr, { own: pr.mine || here }));
    });
    review.title = pr.mine || here ? 'Have the agent look over your pull request before others do'
      : 'Have the agent review this pull request';
    actions.append(review);
  }
  const open = el('button', 'icon-button');
  open.title = 'Open on GitHub';
  open.append(icon('external'));
  open.addEventListener('click', () => window.open(pr.url));
  actions.append(open);
  row.append(icon('pr'), text, actions);
  return row;
}

// ── What the agent is asked ────────────────────────────────────────────────
// Written into the prompt, not sent: it can be read, changed, or added to.
function promptFor(text) {
  const prompt = $('prompt');
  const had = prompt.value.trim();
  prompt.value = had ? `${text}\n\n${had}` : text;
  rememberDraft();
  autosize();
  updateSendButton();
  prompt.focus();
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  $('hint').textContent = 'Press Enter to start';
}

// Now and then while the window is in use, so the counts do not go stale.
setInterval(() => {
  if (document.hasFocus() && !$('github').hidden) maybeLoadPulls();
}, GH_PULLS_REFRESH_MS);

// Back from a terminal where `gh` was installed or signed in by hand: look again.
window.addEventListener('focus', () => {
  if (GH.status && GH.status.repo && !ghReady() && !GH.stage) reloadGithub();
});
