'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. MCP integrations, remote and local.

// ── MCP integrations ───────────────────────────────────────────────────────
let mcpState = null;
let localChecked = false;
const mcpOpen = new Set(['local']);

async function renderMcpPane() {
  const pane = $('mcpPane');
  if (!mcpState) {
    pane.replaceChildren(paneHead('MCP integrations'), el('div', 'pane-empty', 'Loading…'));
    try {
      mcpState = await call(cf.mcpGet);
    } catch (err) {
      pane.replaceChildren(paneHead('MCP integrations'), el('div', 'pane-empty', err.message));
      return;
    }
  }
  const scroll = pane.scrollTop;
  pane.replaceChildren(paneHead('MCP integrations',
    'Give the agent more tools. Remote servers are called by CodingFleet during a run. Local servers run on this '
    + 'computer, for sessions in a folder. Tokens and environment values are stored encrypted here and sent only '
    + 'with your runs.'));
  const status = el('div', 'pane-status');
  pane.append(status);

  const catalog = window.MCP_CATALOG || { categories: [], connectors: {} };
  const byCatalog = new Map(mcpState.remote.filter((r) => r.catalog).map((r) => [r.catalog, r]));
  const onCount = (keys) => keys.filter((k) => (byCatalog.get(k) || {}).enabled).length;

  const section = (id, title, count, on, build) => {
    const details = el('details', 'mcp-cat');
    details.open = mcpOpen.has(id);
    details.addEventListener('toggle', () => {
      if (details.open) mcpOpen.add(id);
      else mcpOpen.delete(id);
    });
    const summary = el('summary');
    summary.append(chevron(), el('span', 'mcp-cat-name', title));
    if (on) summary.append(el('span', 'mcp-on', `${on} on`));
    if (count != null) summary.append(el('span', 'mcp-count', String(count)));
    details.append(summary);
    const body = el('div', 'mcp-cat-body');
    build(body);
    details.append(body);
    pane.append(details);
  };

  // Local servers
  const localOn = mcpState.local.filter((l) => l.enabled).length;
  section('local', 'Local servers (this computer)', mcpState.local.length, localOn, (body) => {
    if (!mcpState.local.length) {
      body.append(el('div', 'mcp-note', 'No local servers yet. Add one that starts with a command, such as '
        + '"npx -y @modelcontextprotocol/server-memory".'));
    }
    for (const server of mcpState.local) body.append(localServerItem(server, pane));
    body.append(localServerForm(null, pane));
  });

  // Built-in remote servers, by category
  for (const cat of catalog.categories) {
    const keys = Object.keys(catalog.connectors).filter((k) => catalog.connectors[k].category === cat.id);
    if (!keys.length) continue;
    section(cat.id, cat.name, keys.length, onCount(keys), (body) => {
      for (const key of keys) body.append(catalogItem(key, catalog.connectors[key], byCatalog.get(key), pane));
    });
  }

  // Custom remote servers
  const custom = mcpState.remote.filter((r) => !r.catalog);
  section('custom', 'Your remote servers', custom.length, custom.filter((r) => r.enabled).length, (body) => {
    for (const server of custom) body.append(customItem(server, pane));
    body.append(customForm(pane));
  });
  pane.scrollTop = scroll;
  applyStatus(pane);
  // Once per opening: say at once whether the local servers start.
  if (!localChecked && mcpState.local.some((l) => l.enabled)) {
    localChecked = true;
    checkLocalServers(pane);
  }
}

async function mcpAction(pane, fn, arg, okText = 'Saved') {
  paneStatus(pane, 'Saving…');
  try {
    mcpState = await call(fn, arg);
    paneStatus(pane, okText, 'ok');
    renderMcpPane();
    return true;
  } catch (err) {
    paneStatus(pane, err.message, 'error');
    return false;
  }
}

function mcpBadge(color, name) {
  const badge = el('span', 'mcp-badge', name.slice(0, 1).toUpperCase());
  badge.style.setProperty('--badge', color || 'var(--accent)');
  return badge;
}

function mcpSwitch(checked, onChange) {
  const toggle = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked, input));
  toggle.append(input, el('span', 'switch-track'));
  return toggle;
}

function catalogItem(key, info, saved, pane) {
  const item = el('div', 'mcp-item');
  const head = el('div', 'mcp-item-head');
  const text = el('div', 'mcp-item-text');
  const title = el('div', 'mcp-item-name', info.name);
  const auth = { none: 'No key needed', optional: 'Key optional', required: 'API key' }[info.authMode] || '';
  title.append(el('span', `mcp-pill${info.authMode === 'required' ? '' : ' free'}`, auth));
  text.append(title, el('div', 'mcp-item-desc', info.description));
  const base = () => ({
    id: saved && saved.id, catalog: key, key, name: info.name, url: info.url,
    authHeader: info.authHeaderName || null, tools: info.tools && info.tools.length ? info.tools : null,
  });
  const toggle = mcpSwitch(saved && saved.enabled, async (on, input) => {
    if (on && info.authMode === 'required' && !(saved && saved.hasToken)) {
      input.checked = false;
      tokenBox.hidden = false;
      paneStatus(pane, `${info.name} needs a token. Paste it below, then turn it on.`, 'error');
      tokenInput.focus();
      return;
    }
    await mcpAction(pane, cf.mcpSaveRemote, { ...base(), enabled: on });
  });
  head.append(mcpBadge(info.color, info.name), text, toggle);
  item.append(head);

  const tokenBox = el('div', 'mcp-token');
  tokenBox.hidden = info.authMode === 'none';
  const tokenInput = el('input');
  tokenInput.type = 'password';
  tokenInput.placeholder = saved && saved.hasToken ? 'Token saved. Paste a new one to replace it.' : (info.tokenPlaceholder || 'Token');
  tokenInput.autocomplete = 'off';
  const saveToken = el('button', 'btn small', 'Save token');
  saveToken.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token && info.authMode === 'required') {
      paneStatus(pane, 'Paste the token first.', 'error');
      return;
    }
    await mcpAction(pane, cf.mcpSaveRemote, { ...base(), token, enabled: Boolean(token) || (saved && saved.enabled) });
  });
  const row = el('div', 'mcp-token-row');
  row.append(tokenInput, saveToken);
  if (saved && saved.hasToken) {
    const clear = el('button', 'btn small', 'Remove');
    clear.addEventListener('click', () => mcpAction(pane, cf.mcpSaveRemote, {
      ...base(), token: '', enabled: info.authMode === 'required' ? false : saved.enabled,
    }));
    row.append(clear);
  }
  const help = el('div', 'mcp-help');
  help.innerHTML = DOMPurify.sanitize(info.tokenHelp || '', { ALLOWED_TAGS: ['a', 'strong', 'code'], ALLOWED_ATTR: ['href'] });
  tokenBox.append(row, help);
  item.append(tokenBox);
  return item;
}

function customItem(server, pane) {
  const item = el('div', 'mcp-item');
  const head = el('div', 'mcp-item-head');
  const text = el('div', 'mcp-item-text');
  const title = el('div', 'mcp-item-name', server.name);
  if (server.hasToken) title.append(el('span', 'mcp-pill free', 'Token saved'));
  text.append(title, el('div', 'mcp-item-desc mono', server.url));
  const remove = el('button', 'icon-button danger');
  remove.title = 'Remove this server';
  remove.innerHTML = ICON.trash;
  remove.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Remove this server?', text: `${server.name} and its token are removed from this computer.`, confirm: 'Remove', danger: true })) {
      mcpAction(pane, cf.mcpDeleteRemote, server.id, 'Removed');
    }
  });
  const toggle = mcpSwitch(server.enabled, (on) => mcpAction(pane, cf.mcpSaveRemote, { ...server, enabled: on }));
  head.append(mcpBadge(null, server.name), text, remove, toggle);
  item.append(head);
  return item;
}

function field(label, input, hint) {
  const box = el('label', 'mcp-field');
  box.append(el('span', 'mcp-field-label', label), input);
  if (hint) box.append(el('span', 'mcp-field-hint', hint));
  return box;
}

function textInput(placeholder, value = '', type = 'text') {
  const input = el('input');
  input.type = type;
  input.placeholder = placeholder;
  input.value = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

function customForm(pane) {
  const form = el('details', 'mcp-form');
  form.append(el('summary', null, '+ Add a remote server'));
  const name = textInput('My server');
  const url = textInput('https://example.com/mcp');
  const token = textInput('Optional', '', 'password');
  const header = textInput('Authorization');
  const add = el('button', 'btn primary small', 'Add server');
  add.addEventListener('click', () => mcpAction(pane, cf.mcpSaveRemote, {
    name: name.value, url: url.value, token: token.value, authHeader: header.value.trim() || null, enabled: true,
  }, 'Added'));
  const grid = el('div', 'mcp-grid');
  grid.append(field('Name', name), field('Server URL', url, 'Streamable HTTP, https only.'),
    field('Token', token, 'Sent as "Authorization: Bearer <token>".'),
    field('Header name', header, 'Only if the server wants the token in its own header.'));
  const actions = el('div', 'mcp-actions');
  actions.append(add);
  form.append(grid, actions);
  return form;
}

// "npx -y pkg --flag 'a b'" as a list of arguments.
function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(line || '')))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

const joinArgs = (args) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');

function localServerItem(server, pane) {
  const item = el('div', 'mcp-item');
  const head = el('div', 'mcp-item-head');
  const text = el('div', 'mcp-item-text');
  text.append(el('div', 'mcp-item-name', server.name),
    el('div', 'mcp-item-desc mono', [server.command, joinArgs(server.args)].filter(Boolean).join(' ')));
  const state = el('div', 'mcp-state');
  const known = localStatus.get(server.id);
  if (!server.enabled) state.textContent = 'Off';
  else if (!known) state.textContent = 'Not checked yet';
  else if (known.error) {
    state.textContent = known.error;
    state.classList.add('bad');
  } else {
    state.textContent = `${known.tools.length} tool${known.tools.length === 1 ? '' : 's'}: ${known.tools.slice(0, 8).join(', ')}${known.tools.length > 8 ? '…' : ''}`;
    state.classList.add('good');
  }
  text.append(state);
  const edit = el('button', 'icon-button');
  edit.title = 'Edit';
  edit.innerHTML = ICON.edit;
  const remove = el('button', 'icon-button danger');
  remove.title = 'Remove this server';
  remove.innerHTML = ICON.trash;
  remove.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Remove this server?', text: `${server.name} is stopped and removed from this computer.`, confirm: 'Remove', danger: true })) {
      localStatus.delete(server.id);
      mcpAction(pane, cf.mcpDeleteLocal, server.id, 'Removed');
    }
  });
  const toggle = mcpSwitch(server.enabled, async (on) => {
    if (await mcpAction(pane, cf.mcpSaveLocal, { ...server, enabled: on }) && on) checkLocalServers(pane);
  });
  head.append(mcpBadge('#3ecf8e', server.name), text, edit, remove, toggle);
  item.append(head);
  const form = localServerForm(server, pane);
  form.hidden = true;
  edit.addEventListener('click', () => { form.hidden = !form.hidden; });
  item.append(form);
  return item;
}

const localStatus = new Map();

async function checkLocalServers(pane) {
  paneStatus(pane, 'Starting local servers…');
  try {
    const results = await call(cf.mcpLocalStatus);
    for (const result of results) localStatus.set(result.id, result);
    const failed = results.filter((r) => r.error).length;
    paneStatus(pane, failed ? `${failed} local server${failed === 1 ? '' : 's'} could not start.` : 'Local servers are ready.',
      failed ? 'error' : 'ok');
  } catch (err) {
    paneStatus(pane, err.message, 'error');
  }
  renderMcpPane();
}

function localServerForm(server, pane) {
  const editing = Boolean(server);
  const form = editing ? el('div', 'mcp-form open') : el('details', 'mcp-form');
  if (!editing) form.append(el('summary', null, '+ Add a local server'));
  const name = textInput('memory', editing ? server.name : '');
  const command = textInput('npx', editing ? server.command : '');
  const args = textInput('-y @modelcontextprotocol/server-memory', editing ? joinArgs(server.args) : '');
  const env = el('textarea', 'mcp-env');
  env.rows = 3;
  env.spellcheck = false;
  env.placeholder = editing && server.envKeys.length
    ? `Saved: ${server.envKeys.join(', ')}. Type NAME=value lines to replace them.`
    : 'NAME=value, one per line';
  const save = el('button', 'btn primary small', editing ? 'Save' : 'Add server');
  save.addEventListener('click', async () => {
    const ok = await mcpAction(pane, cf.mcpSaveLocal, {
      id: editing ? server.id : undefined,
      name: name.value, command: command.value, args: splitArgs(args.value), env: env.value,
      enabled: editing ? server.enabled : true,
    }, editing ? 'Saved' : 'Added');
    if (ok) checkLocalServers(pane);
  });
  const grid = el('div', 'mcp-grid');
  grid.append(field('Name', name), field('Command', command, 'The program that starts the server.'),
    field('Arguments', args), field('Environment', env, 'Stored encrypted. Never shown again.'));
  const actions = el('div', 'mcp-actions');
  if (editing && server.envKeys.length) {
    const clear = el('button', 'btn small', 'Clear environment');
    clear.addEventListener('click', () => mcpAction(pane, cf.mcpSaveLocal, { ...server, clearEnv: true }));
    actions.append(clear);
  }
  if (!editing && mcpState.local.some((l) => l.enabled)) {
    const check = el('button', 'btn small', 'Check servers');
    check.addEventListener('click', () => checkLocalServers(pane));
    actions.append(check);
  }
  actions.append(save);
  form.append(grid, actions);
  return form;
}
