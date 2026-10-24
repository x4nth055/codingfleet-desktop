'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Settings > Coding agents: the coding CLIs found
// on this computer (Codex, Claude Code, ...), what CodingFleet agents may do
// with each, and the log of what they ran (main/coding-agents.js).

let codingAgentsView = null;
let codingAgentsWired = false;

const CA_ACCESS = [
  ['off', 'Off', 'CodingFleet agents may not start it.'],
  ['ask', 'Ask each time', 'You approve every run. "Allow all" does not cover it.'],
  ['allowed', 'Allowed', 'It runs without asking. Commands that can delete data still ask.'],
];

const CA_STATUS = {
  running: ['Running', 'live'],
  done: ['Done', 'ok'],
  failed: ['Failed', 'bad'],
  stopped: ['Stopped', 'muted'],
  refused: ['Refused: off', 'muted'],
  declined: ['You declined', 'muted'],
};

async function renderCodingAgentsPane() {
  const pane = $('codingAgentsPane');
  if (!codingAgentsWired) {
    codingAgentsWired = true;
    cf.onCodingAgents((view) => {
      codingAgentsView = view;
      if (!$('settings').hidden && settingsTab === 'codingAgents') drawCodingAgents();
    });
  }
  if (!codingAgentsView) {
    pane.replaceChildren(codingAgentsHead(), el('div', 'pane-empty', 'Looking for coding agents…'));
    try {
      codingAgentsView = await call(cf.codingAgents);
    } catch (err) {
      pane.lastChild.textContent = err.message;
      return;
    }
    // Nothing checked yet on this computer: check now.
    if (!codingAgentsView.detected && !codingAgentsView.detecting) call(cf.detectCodingAgents).catch(() => {});
  }
  drawCodingAgents();
}

function codingAgentsHead() {
  return paneHead('Coding agents on this computer',
    'Codex, Claude Code and the other coding CLIs installed here. Choose what CodingFleet agents may do with '
    + 'each one: they run it like any other command, wait for it, and you can follow it in the conversation. '
    + 'Each CLI runs with your own sign-in and plan; CodingFleet never reads or keeps their credentials.');
}

function drawCodingAgents() {
  const pane = $('codingAgentsPane');
  const view = codingAgentsView;
  const scroll = pane.scrollTop;
  pane.replaceChildren(codingAgentsHead());

  const bar = el('div', 'ca-bar');
  const checked = view.detected && view.detected.checkedAt;
  bar.append(el('span', 'ca-checked', view.detecting ? 'Checking this computer…'
    : checked ? `Checked ${relAgo(new Date(checked).toISOString())}` : 'Not checked yet'));
  const refresh = el('button', 'btn small', view.detecting ? 'Checking…' : 'Check again');
  refresh.disabled = view.detecting;
  refresh.addEventListener('click', () => {
    call(cf.detectCodingAgents).catch((err) => paneStatus(pane, err.message, 'error'));
  });
  bar.append(refresh);
  pane.append(bar);

  const found = new Map(((view.detected && view.detected.clis) || []).map((d) => [d.id, d]));
  const installed = view.catalog.filter((cli) => (found.get(cli.id) || {}).installed);
  const missing = view.catalog.filter((cli) => !(found.get(cli.id) || {}).installed);

  if (!view.detected) {
    pane.append(el('div', 'pane-empty', 'Looking for coding agents…'));
  } else if (!installed.length) {
    pane.append(el('div', 'pane-empty', 'No coding CLI was found on this computer. Install one below, then '
      + 'click Check again.'));
  }
  for (const cli of installed) pane.append(codingAgentCard(pane, cli, found.get(cli.id), view.prefs[cli.id]));

  if (view.detected && missing.length) {
    pane.append(el('div', 'pane-section', 'Not found on this computer'));
    const list = el('div', 'ca-missing');
    for (const cli of missing) {
      const row = el('div', 'ca-missing-row');
      const text = el('div', 'set-text');
      text.append(el('span', 'ca-missing-name', cli.name), el('span', 'ca-vendor', cli.vendor));
      const d = found.get(cli.id);
      if (d && d.note) text.append(el('div', 'set-desc', d.note));
      const link = el('a', 'byok-link', 'How to install');
      link.href = cli.install;
      link.target = '_blank';
      row.append(text, link);
      list.append(row);
    }
    pane.append(list);
  }

  pane.append(codingAgentsLog(pane, view.log || []));
  const foot = el('div', 'pane-foot');
  foot.append(el('div', 'pane-status'),
    el('span', 'ca-foot-note', '"Tell new sessions" applies to sessions you start from now on.'));
  pane.append(foot);
  applyStatus(pane);
  pane.scrollTop = scroll;
}

function signInLine(d) {
  if (d.signedIn === true) {
    const bits = ['Signed in', d.method, d.plan && `${d.plan} plan`, d.account].filter(Boolean);
    return [bits.join(' · '), 'ok'];
  }
  if (d.signedIn === false) return ['Not signed in', 'bad'];
  return [d.method ? `Sign-in not known · ${d.method}` : 'Sign-in not known', 'muted'];
}

function codingAgentCard(pane, cli, d, pref) {
  const card = el('div', 'set-row stack ca-card');
  card.dataset.cli = cli.id;
  const head = el('div', 'ca-head');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title');
  title.append(el('span', null, cli.name), el('span', 'ca-vendor', cli.vendor));
  if (d.version) title.append(el('span', 'ca-version', `v${d.version}`));
  text.append(title);
  const [status, kind] = signInLine(d);
  text.append(el('div', `ca-signin ${kind}`, status));
  if (d.note) text.append(el('div', 'set-desc', d.note));
  head.append(text);
  if (d.signedIn !== true && cli.signIn) {
    const signIn = el('button', 'btn small', 'Sign in…');
    signIn.title = `Opens a terminal and runs: ${cli.signIn}`;
    signIn.addEventListener('click', () => runInNewTerminal(cli.signIn));
    head.append(signIn);
  }
  card.append(head);
  card.append(el('div', 'set-desc ca-note', cli.note));
  if (d.path) {
    const where = el('div', 'set-desc ca-path', d.path);
    where.title = d.path;
    card.append(where);
  }

  const access = el('div', 'ca-control');
  const accessText = el('div', 'set-text');
  const current = CA_ACCESS.find(([value]) => value === pref.access) || CA_ACCESS[1];
  accessText.append(el('div', 'ca-label', 'CodingFleet agents may start it'), el('div', 'set-desc', current[2]));
  const seg = el('div', 'seg');
  for (const [value, label] of CA_ACCESS) {
    const button = el('button', `seg-btn${pref.access === value ? ' active' : ''}`, label);
    button.dataset.access = value;
    button.addEventListener('click', () => saveCodingAgent(pane, { id: cli.id, access: value }));
    seg.append(button);
  }
  access.append(accessText, seg);
  card.append(access);

  const tell = switchRow({
    title: 'Tell new sessions about it',
    desc: `New sessions in a folder get instructions to use it when you ask, or for a large task: ${cli.headless}`,
    checked: pref.tellAgent && pref.access !== 'off',
    disabled: pref.access === 'off',
    onChange: (on) => saveCodingAgent(pane, { id: cli.id, tellAgent: on }),
  });
  tell.classList.add('ca-tell');
  card.append(tell);
  return card;
}

async function saveCodingAgent(pane, change) {
  try {
    codingAgentsView = await call(cf.setCodingAgent, change);
    paneStatus(pane, 'Saved', 'ok');
  } catch (err) {
    paneStatus(pane, err.message, 'error');
  }
  drawCodingAgents();
}

function codingAgentsLog(pane, entries) {
  const box = el('div', 'ca-log');
  const head = el('div', 'ca-log-head');
  head.append(el('div', 'pane-section', 'Activity'));
  if (entries.length) {
    const clear = el('button', 'btn small', 'Clear');
    clear.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Clear the activity log?',
        text: 'The list of coding agent runs on this computer is deleted. Your sessions are not changed.',
        confirm: 'Clear',
        danger: true,
      });
      if (!ok) return;
      try {
        codingAgentsView = await call(cf.clearCodingAgentsLog);
      } catch (err) {
        paneStatus(pane, err.message, 'error');
      }
      drawCodingAgents();
    });
    head.append(clear);
  }
  box.append(head);
  if (!entries.length) {
    box.append(el('div', 'ca-log-empty', 'Nothing yet. Every run a CodingFleet agent starts, or tries to start, shows here.'));
    return box;
  }
  const names = new Map(codingAgentsView.catalog.map((cli) => [cli.id, cli.name]));
  for (const entry of entries) {
    const row = el('div', 'ca-log-row');
    const [label, kind] = CA_STATUS[entry.status] || [entry.status, 'muted'];
    const top = el('div', 'ca-log-top');
    top.append(
      el('span', 'ca-log-cli', (entry.clis || []).map((id) => names.get(id) || id).join(', ')),
      el('span', `ca-log-status ${kind}`, label + (entry.exitCode != null && entry.status === 'failed' ? ` (exit ${entry.exitCode})` : '')),
      el('span', 'ca-log-when', [relAgo(new Date(entry.at).toISOString()),
        entry.ms != null ? fmtDuration(entry.ms / 1000) : null, entry.background ? 'background' : null].filter(Boolean).join(' · ')),
    );
    const cmd = el('div', 'ca-log-cmd', entry.command);
    cmd.title = entry.command;
    const where = el('div', 'ca-log-where', [entry.session ? `Session: ${entry.session}` : null, entry.cwd].filter(Boolean).join(' · '));
    row.append(top, cmd, where);
    if (entry.sessionId) {
      row.classList.add('link');
      row.title = 'Open this session';
      row.addEventListener('click', () => {
        closeSettings();
        selectSession(entry.sessionId);
      });
    }
    box.append(row);
  }
  return box;
}

// A CLI's own sign-in, in a new terminal: its sign-in happens in its own flow,
// never through this app.
async function runInNewTerminal(command) {
  closeSettings();
  setPanelView('terminal');
  TERM.open = true;
  termStore('open', 1);
  renderTerminalPanel();
  try {
    const view = await call(cf.createTerminal, { cwd: terminalCwd() });
    const tab = makeTab(view);
    showTerminal(tab.id);
    // The shell needs a moment before it reads what is typed.
    setTimeout(() => cf.writeTerminal(view.id, `${command}\r`), 600);
  } catch (err) {
    flashHint(`Could not start a terminal: ${err.message}`);
  }
}
