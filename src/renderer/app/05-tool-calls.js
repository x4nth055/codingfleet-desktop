'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Tool calls, grouped as they ran, with approvals; and the edited-files card.

// ── Tool calls, grouped ────────────────────────────────────────────────────
// The words for tools and approvals live in lib/tool-words.js, where they are tested.
const { VERBS, GROUP_WORDS, ALLOW_LABELS, REASONS, ALWAYS_ASKED, toolSummary, groupSummary } = CF_TOOL_WORDS;

const ACTIVE = ['queued', 'running', 'waiting'];

// A sub-agent waiting for approval makes its spawn_agent row wait too.
function toolWaits(tool) {
  if (tool.status === 'waiting') return true;
  if (tool.name !== 'spawn_agent' || !tool.agentId || !tool.group) return false;
  const agent = agentsOf(tool.group.sessionId).get(tool.agentId);
  return Boolean(agent && agent.status === 'running' && agentWaiting(agent));
}

function groupStatus(tools) {
  if (tools.some(toolWaits)) return 'waiting';
  if (tools.some((t) => t.status === 'running' || t.status === 'queued')) return 'running';
  if (tools.every((t) => t.status === 'cancelled')) return 'cancelled';
  if (tools.every((t) => t.status === 'failed' || t.status === 'denied')) return 'failed';
  return 'done';
}

function statusIcon(status) {
  const box = el('span', 'tool-status');
  if (status === 'running' || status === 'queued') box.append(el('span', 'spinner'));
  else if (status === 'done') box.innerHTML = ICON.check;
  else if (status === 'failed' || status === 'denied') box.innerHTML = ICON.x;
  else if (status === 'cancelled') box.innerHTML = ICON.minus;
  else box.innerHTML = ICON.dot;
  return box;
}

function allTools(sessionId) {
  const main = transcriptOf(sessionId).filter((i) => i.type === 'tools').flatMap((g) => g.tools);
  const nested = [...agentsOf(sessionId).values()]
    .flatMap((a) => a.items.filter((i) => i.type === 'tools').flatMap((g) => g.tools));
  return [...main, ...nested];
}

function findTool(sessionId, id) {
  return allTools(sessionId).find((t) => t.id === id);
}

function addTool(sessionId, tool) {
  const items = transcriptOf(sessionId);
  const last = items[items.length - 1];
  if (last && last.type === 'tools' && !last.history) {
    tool.group = last;
    last.tools.push(tool);
    refreshItem(sessionId, last);
    return;
  }
  assistantStamp(sessionId);
  const group = { type: 'tools', sessionId, tools: [tool], open: false };
  tool.group = group;
  addItem(sessionId, group);
}

function updateTool(sessionId, id, patch) {
  const tool = findTool(sessionId, id);
  if (!tool) return;
  Object.assign(tool, patch);
  refreshItem(sessionId, tool.group);
  if (tool.group.agentId) agentChanged(sessionId, tool.group.agentId);
}

function toolMeta(tool) {
  const args = tool.arguments || {};
  const meta = el('span', 'tool-meta');
  const agent = tool.name === 'spawn_agent' && tool.agentId ? agentsOf(tool.group.sessionId).get(tool.agentId) : null;
  if (agent) {
    if (agentWaiting(agent)) {
      meta.append(el('span', 'waiting-note', 'Needs approval'));
    } else if (agent.status === 'running') {
      meta.textContent = agent.statusText || 'Working…';
    } else {
      const bits = [];
      if (agent.model) bits.push(agent.model);
      if (agent.credits != null) bits.push(`${fmtNum(agent.credits)} ${Number(agent.credits) === 1 ? 'credit' : 'credits'}`);
      meta.textContent = bits.join(' · ');
    }
    return meta;
  }
  if (tool.status === 'waiting') meta.textContent = 'Needs approval';
  else if (tool.status === 'denied') meta.textContent = 'Declined';
  else if (tool.status === 'cancelled') meta.textContent = 'Cancelled';
  else if (tool.name === 'fs_edit' && tool.status !== 'failed') {
    meta.append(el('span', 'add', `+${lineCount(args.new)}`), ' ', el('span', 'del', `−${lineCount(args.old)}`));
  } else if (tool.name === 'fs_write' && typeof args.content === 'string') {
    meta.textContent = `${lineCount(args.content)} lines`;
  } else if (tool.output && typeof tool.output === 'object' && tool.output.exit_code != null && tool.output.exit_code !== 0) {
    meta.append(el('span', 'bad', `exit ${tool.output.exit_code}`));
  }
  return meta;
}

function renderTool(tool) {
  if (tool.name === 'spawn_agent' && tool.agentId) return renderAgentTool(tool);
  const node = el('div', `tool ${tool.status}${tool.open ? ' open' : ''}`);
  const head = el('button', 'tool-head');
  const [verb, target] = toolSummary(tool);
  head.append(statusIcon(tool.status), el('span', 'tool-verb', verb), el('span', 'tool-target', firstLine(target)), toolMeta(tool), chevron());
  head.addEventListener('click', () => {
    tool.open = !tool.open;
    refreshItem(tool.group.sessionId, tool.group);
  });
  node.append(head);
  if (tool.open) node.append(toolBody(tool));
  if (tool.status === 'waiting') node.append(approvalBar(tool));
  return node;
}

function renderGroup(group) {
  if (group.tools.length === 1) return renderTool(group.tools[0]);
  const status = groupStatus(group.tools);
  const open = group.open || status === 'waiting';
  const node = el('div', `tool-group ${status}${open ? ' open' : ''}`);
  const head = el('button', 'tool-head');
  head.append(statusIcon(status), el('span', 'group-summary', groupSummary(group.tools)));
  if (status === 'running' || status === 'waiting') {
    const live = [...group.tools].reverse().find((t) => ACTIVE.includes(t.status));
    if (live) {
      const [verb, target] = toolSummary(live);
      head.append(el('span', 'tool-target', `${verb} ${firstLine(target)}`));
    }
  }
  const meta = el('span', 'tool-meta');
  const failed = group.tools.filter((t) => t.status === 'failed' || t.status === 'denied').length;
  if (status === 'waiting') meta.textContent = 'Needs approval';
  else if (failed && status !== 'failed') meta.append(el('span', 'bad', `${failed} failed`));
  else meta.textContent = `${group.tools.length} steps`;
  head.append(meta, chevron());
  head.addEventListener('click', () => {
    group.open = !open;
    refreshItem(group.sessionId, group);
  });
  node.append(head);
  if (open) {
    const body = el('div', 'group-body');
    for (const tool of group.tools) body.append(renderTool(tool));
    node.append(body);
  }
  return node;
}

function codeBlock(text) {
  const block = el('pre', 'code');
  block.textContent = clipText(text);
  return block;
}

function outputBlock(output) {
  if (output == null) return null;
  if (typeof output === 'string') return codeBlock(output);
  if (typeof output === 'object' && ('stdout' in output || 'stderr' in output)) {
    const block = el('pre', 'code');
    if (output.stdout) block.append(document.createTextNode(clipText(output.stdout)));
    if (output.stderr) {
      if (output.stdout) block.append('\n');
      block.append(el('span', 'err', clipText(output.stderr)));
    }
    if (!output.stdout && !output.stderr) {
      block.append(el('span', 'quiet', output.exit_code === 0 ? '(no output)' : `(exit ${output.exit_code})`));
    }
    return block;
  }
  return codeBlock(JSON.stringify(output, null, 2));
}

// What view_image looked at, shown where the agent looked at it: a file in the
// folder, read through the main process, or a picture on the web.
function toolImage(source) {
  const src = String(source == null ? '' : source);
  if (!src) return null;
  const img = el('img', 'tool-image');
  img.decoding = 'async';
  img.setAttribute('src', src);
  img.alt = src;
  img.title = src;
  if (adoptLocalImage(img)) return img;
  if (!/^https?:\/\//i.test(src)) return null;
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

// A picture already in hand, shown in a tool step.
function shownImage(url, name) {
  const img = el('img', 'tool-image ready');
  img.decoding = 'async';
  img.src = url;
  img.alt = name || 'Screenshot';
  return img;
}

function toolBody(tool) {
  const body = el('div', 'tool-body');
  const args = tool.arguments || {};
  const section = (label, node) => {
    if (node) body.append(el('div', 'tool-label', label), node);
  };
  switch (tool.name) {
    case 'run_command':
      section('Command', codeBlock(args.command));
      break;
    case 'execute_code':
      if (args.code) section(args.filename || 'Code', codeBlock(args.code));
      if (args.command) section('Command', codeBlock(args.command));
      break;
    case 'fs_edit': {
      const diff = el('pre', 'code');
      for (const line of String(args.old == null ? '' : args.old).split('\n')) diff.append(el('span', 'del', `- ${line}\n`));
      for (const line of String(args.new == null ? '' : args.new).split('\n')) diff.append(el('span', 'add', `+ ${line}\n`));
      section(args.path || 'Edit', diff);
      break;
    }
    case 'fs_write':
      section(args.path || 'File', codeBlock(args.content));
      break;
    case 'fs_read':
    case 'fs_glob':
      break;
    case 'view_image':
      section(args.source || 'Image', toolImage(args.source));
      break;
    case 'take_screenshot':
      // The picture comes from the main process when the call runs, so there
      // is nothing to show for a past run.
      if (tool.image) section(tool.imageTitle || 'Screenshot', shownImage(tool.image));
      break;
    default:
      if (Object.keys(args).length) section('Arguments', codeBlock(JSON.stringify(args, null, 2)));
  }
  if (tool.output !== undefined) section('Result', outputBlock(tool.output));
  else if (tool.history) body.append(el('div', 'tool-label', 'Results are not kept for past runs'));
  else body.append(el('div', 'tool-label', 'Waiting for the result…'));
  return body;
}

function approvalBar(tool) {
  const bar = el('div', 'approval');
  const retry = tool.reason === 'retry interrupted tool';
  bar.append(el('span', 'approval-text', `CodingFleet ${REASONS[tool.reason] || 'wants to use a tool'}.`));
  const decide = (decision) => async () => {
    tool.status = decision === 'deny' ? 'denied' : 'queued';
    refreshItem(tool.group.sessionId, tool.group);
    if (tool.group.agentId) agentChanged(tool.group.sessionId, tool.group.agentId);
    await cf.decide({ callId: tool.id, decision });
  };
  const deny = el('button', 'btn danger', retry ? 'Do not retry' : 'Deny');
  deny.addEventListener('click', decide('deny'));
  const always = el('button', 'btn', ALLOW_LABELS[tool.reason] || 'Allow all calls this session');
  always.addEventListener('click', decide('allow-session'));
  const allow = el('button', 'btn primary', retry ? 'Retry tool' : 'Allow');
  allow.addEventListener('click', decide('allow'));
  if (retry) bar.append(deny, allow);
  else if (ALWAYS_ASKED.has(tool.reason)) {
    // Asked every time, even in auto mode: there is no "allow all" for these.
    bar.classList.add('risky');
    bar.append(el('span', 'approval-note', 'Always asked'), deny, allow);
  } else bar.append(deny, always, allow);
  return bar;
}

// ── Edited files ───────────────────────────────────────────────────────────
// Undo puts every file in this card back to the version from before the run.
// A file touched since the run is kept: the second press is the one that
// overwrites it, and it says so first.
function undoButton(item) {
  const button = el('button', 'btn small undo-button', 'Undo');
  button.title = 'Put these files back the way they were before this run';
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const count = item.files.length;
    const ok = await confirmDialog({
      title: `Undo ${count} file change${count === 1 ? '' : 's'}?`,
      text: 'Each file goes back to the version from before this run. Anything you edited '
        + 'since the run is left alone.',
      confirm: 'Undo the run',
    });
    if (!ok) return;
    await runUndo(item, false);
  });
  return button;
}

async function runUndo(item, force) {
  try {
    const result = await call(cf.undoRun, { runId: item.runId, force });
    const done = result.restored.length;
    const conflicts = result.skipped.filter((s) => s.conflict);
    const other = result.skipped.filter((s) => !s.conflict);
    if (done) item.undone = `Undone (${done} file${done === 1 ? '' : 's'})`;
    refreshItem(item.sessionId, item);

    if (conflicts.length) {
      const names = conflicts.map((s) => s.path).join(', ');
      const force2 = await confirmDialog({
        title: `Keep your later edits to ${conflicts.length} file${conflicts.length === 1 ? '' : 's'}?`,
        text: `${names} changed after the run, so ${conflicts.length === 1 ? 'it was' : 'they were'} left alone. `
          + 'Undoing anyway overwrites what you did since.',
        confirm: 'Overwrite anyway',
        danger: true,
      });
      if (force2) return runUndo(item, true);
    }
    if (other.length) {
      showBanner(`Could not undo ${other.map((s) => `${s.path} (${s.reason})`).join(', ')}.`);
    } else if (done && !conflicts.length) {
      hideBanner();
    }
  } catch (err) {
    showBanner(err.message);
  }
}

function renderFiles(item) {
  const node = el('div', 'files-card');
  const added = item.files.reduce((sum, f) => sum + f.added, 0);
  const removed = item.files.reduce((sum, f) => sum + f.removed, 0);
  const head = el('div', 'files-head');
  const count = item.files.length;
  head.append(icon('file'), el('span', 'files-title', `Edited ${count} file${count === 1 ? '' : 's'}`),
    el('span', 'add', `+${added}`), el('span', 'del', `−${removed}`));
  if (item.runId && !item.undone) head.append(el('span', 'bar-spacer'), undoButton(item));
  if (item.undone) head.append(el('span', 'bar-spacer'), el('span', 'files-undone', item.undone));
  node.append(head);

  item.files.forEach((file, index) => {
    const open = item.open.has(index);
    const row = el('button', `file-row${open ? ' open' : ''}`);
    const slash = file.path.lastIndexOf('/');
    const name = el('span', 'file-name');
    if (slash >= 0) name.append(el('span', 'file-dir', file.path.slice(0, slash + 1)));
    name.append(file.path.slice(slash + 1));
    row.append(name);
    if (file.created) row.append(el('span', 'file-badge', 'new'));
    if (file.binary) row.append(el('span', 'file-badge', 'no diff'));
    const stats = el('span', 'file-stats');
    stats.append(el('span', 'add', `+${file.added}`), el('span', 'del', `−${file.removed}`));
    row.append(stats, chevron());
    row.addEventListener('click', () => {
      if (open) item.open.delete(index);
      else item.open.add(index);
      refreshItem(item.sessionId, item);
    });
    node.append(row);
    if (open) node.append(renderDiff(file));
  });
  return node;
}

function renderDiff(file) {
  const box = el('div', 'diff');
  if (file.binary) {
    box.append(el('div', 'diff-note', 'A binary or very large file: no line diff.'));
    return box;
  }
  file.hunks.forEach((hunk, index) => {
    if (index > 0) box.append(el('div', 'diff-gap', '⋯'));
    for (const line of hunk.lines) {
      const kind = line.t === '+' ? 'add' : line.t === '-' ? 'del' : 'ctx';
      const row = el('div', `dl ${kind}`);
      row.append(
        el('span', 'ln', line.old == null ? '' : line.old),
        el('span', 'ln', line.new == null ? '' : line.new),
        el('span', 'sign', line.t === '+' ? '+' : line.t === '-' ? '−' : ''),
        el('span', 'dtext', line.text),
      );
      box.append(row);
    }
  });
  if (file.truncated) box.append(el('div', 'diff-note', 'The diff is cut here: the change is too long to show.'));
  return box;
}
