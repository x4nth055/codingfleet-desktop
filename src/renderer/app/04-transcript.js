'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Drawing a conversation: messages, the thread rail, the token footer, sub-agents.

// ── Transcript ─────────────────────────────────────────────────────────────
function renderMain() {
  renderTopbar();
  renderTranscript();
  renderComposer();
}

function renderTranscript() {
  const box = $('transcript');
  box.replaceChildren();
  if (!S.current) {
    box.append(renderEmpty());
    return;
  }
  const column = el('div', 'column');
  column.id = 'column';
  if (!S.loaded.has(S.current) && !loadFailures.has(S.current)) {
    column.append(el('div', 'loading', 'Loading session…'));
  } else {
    for (const item of transcriptOf(S.current)) column.append(renderItem(item));
    if (S.running.has(S.current)) column.append(renderWorking(S.current));
    else if (S.remoteBusy.has(S.current)) column.append(renderRemoteWorking());
  }
  box.append(column);
  box.scrollTop = box.scrollHeight;
  updateScrollButton();
  renderThreadNav();
}

function renderEmpty() {
  const box = el('div', 'empty');
  const logo = el('div', 'empty-logo');
  logo.innerHTML = LOGO;
  box.append(
    logo,
    el('h1', null, 'What should we work on?'),
    el('p', null, 'CodingFleet reads, edits and runs code in the folder you choose. It asks before it runs a command or changes a file.'),
  );

  const card = el('button', 'folder-card');
  const text = el('div', 'fc-text');
  if (S.draftSandbox) {
    text.append(
      el('div', 'fc-title', 'Cloud sandbox'),
      el('div', 'fc-path', "Runs on CodingFleet's servers, not on this computer"),
    );
    card.append(icon('sparkle'), text, el('span', 'fc-change', 'Change'));
  } else {
    text.append(
      el('div', 'fc-title', S.draftCwd ? baseName(S.draftCwd) : 'Choose a project folder'),
      el('div', 'fc-path', S.draftCwd || 'The agent works inside this folder'),
    );
    card.append(icon('folder'), text, el('span', 'fc-change', S.draftCwd ? 'Change' : 'Browse'));
  }
  card.addEventListener('click', openFolderMenu);
  box.append(card);

  const suggestions = el('div', 'suggestions');
  for (const idea of ['Explain how this project is organized', 'Find and fix a bug', 'Write tests for the main module']) {
    const chip = el('button', 'suggestion', idea);
    chip.addEventListener('click', () => {
      $('prompt').value = idea;
      rememberDraft();
      autosize();
      updateSendButton();
      $('prompt').focus();
    });
    suggestions.append(chip);
  }
  box.append(suggestions);
  return box;
}

const nearBottom = () => {
  const box = $('transcript');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 160;
};
const scrollToBottom = () => {
  const box = $('transcript');
  box.scrollTop = box.scrollHeight;
  updateScrollButton();
};

// ── Thread navigation ─────────────────────────────────────────────────────
// One tick per prompt on the right edge; hovering shows the prompts, a click
// goes to one. The tick of the prompt being read is lit as the page scrolls.
function navItems() {
  if (!S.current || !S.loaded.has(S.current)) return [];
  return transcriptOf(S.current).filter((i) => i.type === 'user' && !i.steer && i.node && i.node.isConnected);
}

function renderThreadNav() {
  const nav = $('threadNav');
  nav.replaceChildren();
  const prompts = navItems();
  nav.hidden = prompts.length < 2;
  if (nav.hidden) return;
  for (const item of prompts) {
    const text = String(item.text || '').replace(/\s+/g, ' ').trim();
    const button = el('button', 'tn-item');
    button.title = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    button.append(el('span', 'tn-text', text || 'Message'), el('span', 'tn-tick'));
    button.addEventListener('click', () => item.node.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    item.navButton = button;
    nav.append(button);
  }
  updateThreadNavActive();
}

function updateThreadNavActive() {
  const nav = $('threadNav');
  if (nav.hidden) return;
  const box = $('transcript');
  const line = box.getBoundingClientRect().top + box.clientHeight * 0.35;
  const prompts = navItems().filter((i) => i.navButton);
  let active = prompts[0];
  for (const item of prompts) {
    if (item.node.getBoundingClientRect().top <= line) active = item;
  }
  // At the very bottom the last prompt is the one being read.
  if (nearBottom() && box.scrollHeight > box.clientHeight) active = prompts[prompts.length - 1];
  for (const item of prompts) item.navButton.classList.toggle('active', item === active);
}

let navFrame = 0;
function onTranscriptScroll() {
  updateScrollButton();
  if (navFrame) return;
  navFrame = requestAnimationFrame(() => {
    navFrame = 0;
    updateThreadNavActive();
  });
}

// The button back to the newest message, shown only when there is one to go to.
function updateScrollButton() {
  const button = $('scrollDown');
  if (button) button.hidden = !S.current || nearBottom();
}

function addItem(sessionId, item) {
  transcriptOf(sessionId).push(item);
  if (sessionId !== S.current) return;
  const column = $('column');
  if (!column) return;
  const stick = nearBottom();
  const node = renderItem(item);
  const working = column.querySelector('.working');
  if (working) column.insertBefore(node, working);
  else column.append(node);
  if (stick) scrollToBottom();
  if (item.type === 'user') renderThreadNav();
}

function refreshItem(sessionId, item) {
  if (sessionId !== S.current || !item || !item.node || !item.node.isConnected) return;
  const stick = nearBottom();
  const old = item.node;
  old.replaceWith(renderItem(item));
  if (stick) scrollToBottom();
}

function stamp(at, side) {
  const node = el('div', `stamp ${side}`, fmtStamp(at));
  node.title = new Date(at).toLocaleString();
  return node;
}

function renderItem(item) {
  let node;
  switch (item.type) {
    case 'user': {
      node = el('div', `msg user${item.steer ? ' steer' : ''}`);
      const wrap = el('div', 'user-wrap');
      if (item.at) wrap.append(stamp(item.at, 'user'));
      if (item.steer) wrap.append(el('div', 'steer-label', 'Sent while working'));
      if (item.files && item.files.length) {
        const files = el('div', 'msg-files');
        for (const file of item.files) {
          if (showsAsImage(file)) {
            files.append(imageCard(file));
          } else {
            files.append(attachmentChip({ ...file, status: file.deleted ? 'error' : 'ready',
              error: file.deleted ? 'Deleted' : null }, { removable: false }));
          }
        }
        wrap.append(files);
      }
      wrap.append(el('div', 'bubble', item.text));
      node.append(wrap);
      break;
    }
    case 'stamp':
      node = stamp(item.at, 'assistant');
      break;
    case 'assistant': {
      node = el('div', 'msg assistant');
      const body = el('div', 'markdown');
      setMarkdown(body, item.text);
      node.append(body);
      break;
    }
    case 'tools':
      node = renderGroup(item);
      break;
    case 'files':
      node = renderFiles(item);
      break;
    case 'notice':
      node = el('div', 'notice', item.text);
      break;
    case 'compaction':
      node = compactionChip(item);
      break;
    case 'error':
      node = el('div', 'error-card');
      node.append(el('span', null, item.text));
      break;
    case 'note':
      node = el('div', 'note-card');
      node.append(icon('file'), el('span', null, item.text));
      break;
    case 'load-error': {
      const failure = loadFailures.get(item.sessionId) || { message: 'Something went wrong.', next: null };
      node = el('div', 'error-card load-error');
      const text = el('div', 'load-error-text');
      text.append(el('strong', null, 'This session could not be loaded.'), el('span', null, failure.message));
      const side = el('div', 'load-error-side');
      side.append(el('span', 'retry-in', S.loading.has(item.sessionId) ? 'Trying again…' : retryText(failure)));
      const retry = el('button', 'btn', 'Try again');
      retry.addEventListener('click', () => retryNow(item.sessionId));
      side.append(retry);
      node.append(text, side);
      break;
    }
    case 'footer':
      node = renderFooter(item);
      break;
    default:
      node = el('div');
  }
  item.node = node;
  return node;
}

// What the working line says, from the run's latest status event.
const STATUS_LABELS = {
  thinking: 'Thinking…',
  compacting: 'Compacting the conversation…',
  writing_code: 'Writing code…',
  writing_file: 'Writing a file…',
  editing_file: 'Editing a file…',
  writing_query: 'Writing a query…',
};

function workingText(run) {
  if (!run) return 'Working…';
  if (run.stopping) return 'Stopping…';
  return STATUS_LABELS[run.status] || 'Working…';
}

function updateWorkingLabel(sessionId) {
  if (sessionId !== S.current) return;
  const label = document.querySelector('.working .shimmer');
  if (label) label.textContent = workingText(S.running.get(sessionId));
}

function renderWorking(sessionId) {
  const run = S.running.get(sessionId);
  const node = el('div', 'working');
  node.append(el('span', 'spinner'), el('span', 'shimmer', workingText(run)), el('span', 'hint', ''));
  return node;
}

function renderRemoteWorking() {
  const node = el('div', 'working remote');
  node.append(el('span', 'spinner'), el('span', 'shimmer', 'Working in another window…'),
    el('span', 'hint', 'This view updates when it finishes'));
  return node;
}

setInterval(() => {
  const run = S.current && S.running.get(S.current);
  const clock = document.querySelector('.working .hint');
  if (run && clock) clock.textContent = fmtDuration((Date.now() - run.started) / 1000);
}, 1000);

// The assistant's side of a turn gets one timestamp, above its first output.
function assistantStamp(sessionId) {
  const run = S.running.get(sessionId);
  if (!run || run.stamped) return;
  run.stamped = true;
  addItem(sessionId, { type: 'stamp', at: nowIso() });
}

// Streamed text is re-rendered at most once a frame.
// Web-chat chip markup, as an older server can still send it as text.
const LEAKED_MARKUP = /replace>>>>>|<span class='(custom-tooltip|tool-done-chip)/;

function appendText(sessionId, text) {
  if (LEAKED_MARKUP.test(text)) return;
  const items = transcriptOf(sessionId);
  const last = items[items.length - 1];
  if (last && last.type === 'assistant' && last.live) {
    last.text += text;
    if (!last.scheduled) {
      last.scheduled = true;
      requestAnimationFrame(() => {
        last.scheduled = false;
        if (sessionId !== S.current || !last.node || !last.node.isConnected) return;
        const stick = nearBottom();
        setMarkdown(last.node.querySelector('.markdown'), last.text);
        if (stick) scrollToBottom();
      });
    }
    return;
  }
  if (!text.trim()) return;
  assistantStamp(sessionId);
  addItem(sessionId, { type: 'assistant', text, live: true });
}

function closeLiveText(sessionId) {
  for (const item of transcriptOf(sessionId)) {
    if (item.type === 'assistant') item.live = false;
  }
}

// ── Footer with the token breakdown ────────────────────────────────────────
// What a run's price means, on hover: why a run cost nothing, above all.
function creditsWhy(usage, modelName) {
  const plan = (S.credits && S.credits.plan && S.credits.plan.name) || '';
  const planText = `Included in your ${plan || 'Unlimited'} plan: this model costs no credits in this app `
    + 'and on the web (fair use applies).';
  if (usage.billing === 'plan') return planText;
  if (usage.billing === 'byok') return 'Paid with your own API key for this provider: no credits.';
  if (usage.billing === 'free') return 'A free model: no credits.';
  if (Number(usage.credits) !== 0) return 'Credits this run cost. Your weekly allowance is used first, then your credits.';
  // A run loaded from the history does not say why; the model does.
  const model = S.models.find((m) => m.name === modelName || m.id === modelName);
  if (planIncludes(model)) return planText;
  if (model && !model.credits_per_20k_tokens) return 'A free model: no credits.';
  return 'This run cost no credits.';
}

function creditsLabel(usage, modelName) {
  const label = el('span', 'has-tip credits-label');
  label.tabIndex = 0;
  const n = Number(usage.credits);
  label.append(el('span', 'tip-anchor', `${fmtNum(usage.credits)} ${n === 1 ? 'credit' : 'credits'}`));
  const tip = el('span', 'tip tip-text', creditsWhy(usage, modelName));
  label.append(tip);
  return label;
}

function renderFooter(item) {
  const node = el('div', 'turn-footer');
  const usage = item.usage;
  if (item.model) node.append(el('span', null, modelLabel(item.model)));
  if (usage) {
    if (usage.credits != null) node.append(creditsLabel(usage, item.model));
    // Anthropic reports its cache tokens beside the prompt and OpenAI-compatible
    // providers report them inside it; COST knows which, so the total is right
    // for both. See promptParts in cost.js.
    const entry = entryOf(item.model);
    const parts = COST.promptParts(usage, {
      modelId: item.model, provider: entry && entry.provider ? entry.provider.name : '',
    });
    const output = usage.completion_tokens || 0;
    const total = parts.prompt + output;
    const tokens = el('span', 'has-tip');
    tokens.tabIndex = 0;
    tokens.append(el('span', 'tip-anchor', fmtTokens(total)));
    const tip = el('span', 'tip');
    const rows = [
      ['Input (not cached)', parts.fresh],
      ['Cache read', parts.cacheRead],
      ['Cache write', parts.cacheWrite],
      ['Output', output],
    ];
    if (usage.reasoning_tokens) rows.push(['of which reasoning', usage.reasoning_tokens, 'sub']);
    rows.push(['Total', total, 'total']);
    if (usage.context_tokens) rows.push(['Context used', usage.context_tokens, 'sub']);
    for (const [label, value, kind] of rows) {
      const line = el('span', `tip-row${kind ? ` ${kind}` : ''}`);
      line.append(el('span', null, label), el('b', null, fmtNum(value)));
      tip.append(line);
    }
    tokens.append(tip);
    node.append(tokens);
    if (usage.time_taken) node.append(el('span', null, fmtDuration(usage.time_taken)));
  }
  if (item.note) node.append(el('span', null, item.note));
  return node;
}

// ── Sub-agents ─────────────────────────────────────────────────────────────
// With parallel_agents the agent hands tasks to sub-agents. Each is one row in
// the transcript; its own work (text, tool calls, approvals) is shown in the
// panel on the right, which opens by itself when one starts, as in the web chat.
function agentsOf(sessionId) {
  if (!S.agents.has(sessionId)) S.agents.set(sessionId, new Map());
  return S.agents.get(sessionId);
}

function agentWaiting(agent) {
  return agent.items.some((i) => i.type === 'tools' && i.tools.some((t) => t.status === 'waiting'));
}

function agentState(agent) {
  if (agent.status === 'running' && agentWaiting(agent)) return 'waiting';
  return agent.status;
}

const AGENT_STATE_LABELS = {
  running: 'Working', waiting: 'Needs approval', done: 'Done', failed: 'Failed', cancelled: 'Stopped',
};

function ensureAgent(sessionId, id, fields = {}) {
  const agents = agentsOf(sessionId);
  let agent = agents.get(id);
  if (!agent) {
    agent = { id, sessionId, role: 'Sub-agent', task: '', model: null, status: 'running', items: [],
      credits: null, summary: '', callId: null, loaded: true, taskOpen: false };
    agents.set(id, agent);
  }
  Object.assign(agent, fields);
  return agent;
}

function parentToolOf(agent) {
  const tools = transcriptOf(agent.sessionId).filter((i) => i.type === 'tools').flatMap((g) => g.tools);
  return tools.find((t) => (agent.callId && t.id === agent.callId) || t.agentId === agent.id) || null;
}

// Something about a sub-agent changed: its row in the transcript and the panel.
let panelFrame = 0;
function agentChanged(sessionId, agentId) {
  const agent = agentsOf(sessionId).get(agentId);
  if (!agent) return;
  const parent = parentToolOf(agent);
  if (parent) refreshItem(sessionId, parent.group);
  if (sessionId !== S.current || !S.panel.open) return;
  if (panelFrame) return;
  panelFrame = requestAnimationFrame(() => {
    panelFrame = 0;
    renderPanel();
  });
}

function agentAppendText(agent, text) {
  if (!text) return;
  const last = agent.items[agent.items.length - 1];
  if (last && last.type === 'assistant') last.text += text;
  else agent.items.push({ type: 'assistant', text });
}

function agentAddTool(agent, tool) {
  const last = agent.items[agent.items.length - 1];
  if (last && last.type === 'tools') {
    tool.group = last;
    last.tools.push(tool);
    return;
  }
  const group = { type: 'tools', sessionId: agent.sessionId, agentId: agent.id, tools: [tool], open: false };
  tool.group = group;
  agent.items.push(group);
}

// ── Panel width ────────────────────────────────────────────────────────────
// The panel on the right can be widened with its two header buttons or by
// dragging its left edge. The chosen width is remembered between runs.
const PANEL_WIDTH_KEY = 'cf.panel-width';
const PANEL_MIN_WIDTH = 280;
const PANEL_STEP = 80;
let panelWidth = null;      // px once the user has chosen one; null = the default

const panelWidthMax = () => Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.8));

function storedPanelWidth() {
  if (panelWidth != null) return panelWidth;
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) panelWidth = saved;
  } catch { /* nothing remembered */ }
  return panelWidth;
}

function applyPanelWidth(px) {
  panelWidth = Math.round(Math.min(panelWidthMax(), Math.max(PANEL_MIN_WIDTH, px)));
  document.documentElement.style.setProperty('--agents-panel-width', `${panelWidth}px`);
  return panelWidth;
}

function savePanelWidth() {
  try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* kept for this run only */ }
}

function restorePanelWidth() {
  const saved = storedPanelWidth();
  if (saved != null) applyPanelWidth(saved);
}

function stepPanelWidth(direction) {
  const panel = $('agentsPanel');
  const current = panelWidth != null ? panelWidth
    : panel && !panel.hidden ? Math.round(panel.getBoundingClientRect().width) : 380;
  applyPanelWidth(current + direction * PANEL_STEP);
  savePanelWidth();
}

// Dragging the edge: the pointer events live on the document, so the drag
// survives the panel being re-rendered while a sub-agent is working.
function startPanelDrag(event) {
  const panel = $('agentsPanel');
  if (!panel || event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = Math.round(panel.getBoundingClientRect().width);
  document.body.classList.add('panel-resizing');
  const move = (e) => {
    e.preventDefault();
    applyPanelWidth(startWidth + (startX - e.clientX));
  };
  const up = () => {
    document.body.classList.remove('panel-resizing');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    savePanelWidth();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}

function openPanel(agentId) {
  S.panel = { open: true, agentId: agentId || S.panel.agentId };
  renderPanel();
  const agent = S.current && agentsOf(S.current).get(S.panel.agentId);
  if (agent && !agent.loaded) loadAgent(agent);
}

function closePanel() {
  S.panel = { open: false, agentId: S.panel.agentId };
  renderPanel();
}

async function loadAgent(agent) {
  if (agent.loading) return;
  agent.loading = true;
  try {
    const data = await call(cf.agent, { sessionId: agent.sessionId, agentId: agent.id });
    Object.assign(agent, {
      role: data.role || agent.role,
      task: data.task || '',
      model: data.model || agent.model,
      credits: data.credits,
      summary: data.summary || '',
      status: data.error ? 'failed' : 'done',
      items: data.text ? [{ type: 'assistant', text: data.text, history: true }] : [],
      loaded: true,
    });
  } catch (err) {
    agent.items = [{ type: 'error', text: `Could not load this sub-agent: ${err.message}` }];
    agent.loaded = true;
  } finally {
    agent.loading = false;
  }
  agentChanged(agent.sessionId, agent.id);
}

function renderAgentTool(tool) {
  const agent = agentsOf(tool.group.sessionId).get(tool.agentId);
  const state = agent ? agentState(agent) : tool.status;
  const iconState = state === 'waiting' ? 'waiting' : state === 'running' ? 'running'
    : state === 'done' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
  const node = el('div', `tool agent-tool ${iconState}`);
  const head = el('button', 'tool-head');
  head.title = 'Open in the sub-agents panel';
  const role = (agent && agent.role) || (tool.arguments && tool.arguments.role) || 'Sub-agent';
  const verb = el('span', 'tool-verb');
  verb.append(icon('robot'), ` ${role}`);
  verb.style.display = 'inline-flex';
  verb.style.alignItems = 'center';
  verb.style.gap = '6px';
  head.append(statusIcon(iconState), verb,
    el('span', 'tool-target', firstLine((tool.arguments && tool.arguments.task) || '')),
    toolMeta(tool), el('span', 'tool-open-panel', 'View'));
  head.addEventListener('click', () => openPanel(tool.agentId));
  node.append(head);
  return node;
}

function renderPanel() {
  const panel = $('agentsPanel');
  const app = document.querySelector('.app');
  const agents = S.current ? [...agentsOf(S.current).values()] : [];
  const show = S.panel.open && agents.length > 0;
  panel.hidden = !show;
  app.classList.toggle('with-panel', show);
  if (!show) return;
  if (!agents.some((a) => a.id === S.panel.agentId)) S.panel.agentId = agents[agents.length - 1].id;
  const agent = agents.find((a) => a.id === S.panel.agentId);

  const keepScroll = panel.querySelector('.ap-body');
  const wasAtBottom = keepScroll ? keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 80 : true;
  const oldTop = keepScroll ? keepScroll.scrollTop : 0;
  const sameAgent = panel.dataset.agent === agent.id;

  panel.replaceChildren();
  panel.dataset.agent = agent.id;
  const grip = el('div', 'ap-resizer');
  grip.title = 'Drag to resize the panel';
  grip.addEventListener('pointerdown', startPanelDrag);
  panel.append(grip);
  const head = el('div', 'ap-head drag');
  const close = el('button', 'icon-button');
  close.title = 'Close the panel';
  close.innerHTML = ICON.x;
  close.addEventListener('click', closePanel);
  const widthGroup = el('div', 'ap-width');
  const narrower = el('button', 'icon-button');
  narrower.title = 'Make the panel narrower';
  narrower.innerHTML = ICON.narrower;
  narrower.addEventListener('click', () => stepPanelWidth(-1));
  const wider = el('button', 'icon-button');
  wider.title = 'Make the panel wider';
  wider.innerHTML = ICON.wider;
  wider.addEventListener('click', () => stepPanelWidth(1));
  widthGroup.append(narrower, wider);
  head.append(icon('robot', 'icon'), el('span', 'ap-title', 'Sub-agents'),
    el('span', 'ap-count', String(agents.length)), el('div', 'top-spacer'), widthGroup, close);
  head.querySelector('.icon').style.cssText = 'width:16px;height:16px;color:var(--accent)';
  panel.append(head);

  if (agents.length > 1) {
    const tabs = el('div', 'ap-tabs');
    for (const item of agents) {
      const tab = el('button', `ap-tab${item.id === agent.id ? ' selected' : ''}`);
      tab.title = item.task || item.role;
      tab.append(el('span', `agent-dot ${agentState(item)}`), el('span', null, item.role));
      tab.addEventListener('click', () => openPanel(item.id));
      tabs.append(tab);
    }
    panel.append(tabs);
  }

  const body = el('div', 'ap-body');
  const card = el('div', 'ap-card');
  const role = el('div', 'ap-role');
  const state = agentState(agent);
  role.append(icon('robot'), el('span', null, agent.role),
    el('span', `ap-state ${state}`, AGENT_STATE_LABELS[state] || state));
  card.append(role);
  const meta = el('div', 'ap-meta');
  if (agent.model) meta.append(el('span', null, agent.model));
  if (agent.credits != null) meta.append(el('span', null, `${fmtNum(agent.credits)} ${Number(agent.credits) === 1 ? 'credit' : 'credits'}`));
  if (meta.childNodes.length) card.append(meta);
  if (agent.task) {
    card.append(el('div', 'ap-label', 'Task'));
    const task = el('div', `ap-task${agent.taskOpen ? ' open' : ''}`, agent.task);
    card.append(task);
    if (agent.task.length > 280) {
      const toggle = el('button', 'ap-task-toggle', agent.taskOpen ? 'Show less' : 'Show all');
      toggle.addEventListener('click', () => {
        agent.taskOpen = !agent.taskOpen;
        renderPanel();
      });
      card.append(toggle);
    }
  }
  body.append(card);

  if (!agent.loaded) {
    body.append(el('div', 'ap-empty', 'Loading…'));
  } else {
    for (const item of agent.items) body.append(renderItem(item));
    if (!agent.items.length && agent.status !== 'running') {
      body.append(el('div', 'ap-empty', 'This sub-agent left no transcript.'));
    }
  }
  if (agent.status === 'running') {
    const working = el('div', 'ap-working');
    working.append(el('span', 'spinner'), el('span', 'shimmer',
      state === 'waiting' ? 'Waiting for your approval…' : (agent.statusText || 'Working…')));
    body.append(working);
  }
  if (agent.summary && agent.status !== 'running') body.append(el('div', 'ap-summary', agent.summary));
  panel.append(body);
  body.scrollTop = !sameAgent || wasAtBottom ? body.scrollHeight : oldTop;
}

function onAgentEvent(sessionId, event, data) {
  const agentId = data.agent_id;
  if (!agentId) return;
  const agents = agentsOf(sessionId);
  const opening = !agents.has(agentId);
  switch (event) {
    case 'subagent.started': {
      const agent = ensureAgent(sessionId, agentId, {
        role: data.role || 'Sub-agent', task: data.task || '', model: data.model || null,
        callId: data.call_id || null, status: 'running',
      });
      const parent = parentToolOf(agent);
      if (parent) {
        parent.agentId = agentId;
        refreshItem(sessionId, parent.group);
      }
      // As in the web chat: the panel opens when a sub-agent starts.
      if (sessionId === S.current && (opening && (!S.panel.open || !agents.get(S.panel.agentId)))) openPanel(agentId);
      break;
    }
    case 'subagent.text':
      agentAppendText(ensureAgent(sessionId, agentId), data.text || '');
      break;
    case 'subagent.status': {
      const agent = ensureAgent(sessionId, agentId);
      agent.statusText = data.state === 'started' ? (STATUS_LABELS[data.kind] || null) : null;
      break;
    }
    case 'subagent.done': {
      const agent = ensureAgent(sessionId, agentId);
      Object.assign(agent, {
        status: data.cancelled ? 'cancelled' : data.ok === false ? 'failed' : 'done',
        credits: data.credits != null ? data.credits : agent.credits,
        summary: data.summary || '',
        model: data.model || agent.model,
        statusText: null,
      });
      break;
    }
    case 'tool.call': {
      const agent = ensureAgent(sessionId, agentId);
      if (!findTool(sessionId, data.id)) {
        agentAddTool(agent, {
          id: data.id, name: data.name, arguments: data.arguments || {},
          status: data.executor === 'client' ? 'queued' : 'running',
          ...S.running.get(sessionId)?.replayTools?.get(data.id),
        });
      }
      break;
    }
    case 'tool.result': {
      const tool = findTool(sessionId, data.id);
      if (tool) {
        tool.status = tool.status === 'denied' ? 'denied' : data.ok ? 'done' : 'failed';
        tool.output = data.output;
      }
      break;
    }
    default:
      return;
  }
  agentChanged(sessionId, agentId);
}
