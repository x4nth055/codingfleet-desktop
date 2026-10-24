'use strict';
// What the window calls each tool call and each approval: the words only, no
// DOM. The window loads this before its own scripts, the tests require it —
// among other things to check that it asks about exactly the calls the
// guard in src/core/guard.js says must always be asked about.
(function (root) {
  const VERBS = {
    run_command: (a) => [a.background ? 'Run in background' : 'Run', a.command],
    read_background: (a) => ['Read background output', a.id],
    stop_background: (a) => ['Stop background command', a.id],
    execute_code: (a) => [a.command ? 'Run' : 'Write', a.filename || a.command],
    fs_read: (a) => ['Read', a.path],
    fs_write: (a) => ['Write', a.path],
    fs_edit: (a) => ['Edit', a.path],
    fs_glob: (a) => ['Search files', a.pat],
    web_search: (a) => ['Search the web', a.query || a.q],
    spawn_agent: (a) => ['Delegate', a.role ? `${a.role}: ${a.task || ''}` : a.task],
    get_url_content: (a) => ['Fetch', a.url || (Array.isArray(a.urls) ? a.urls.join(', ') : '')],
    retrieve_chat_context: (a) => ['Search past chats', a.query],
    update_memory: () => ['Update memory', ''],
    credit_status: () => ['Check credits', ''],
    view_image: (a) => ['View image', a.source],
    take_screenshot: (a) => ['Take a screenshot', a.window ? `window: ${a.window}` : 'the screen'],
    computer: (a) => computerWords(a),
    browser: (a) => browserWords(a),
    generate_image: (a) => ['Generate image', a.prompt],
    read_file: (a) => ['Read attachment', a.path || a.file_id],
  };

  // verb, singular, plural, and whether repeat calls on one path count once.
  const GROUP_WORDS = {
    fs_read: ['Read', 'file', 'files', true],
    fs_write: ['Wrote', 'file', 'files', true],
    fs_edit: ['Edited', 'file', 'files', true],
    fs_glob: ['Searched', 'pattern', 'patterns'],
    run_command: ['Ran', 'command', 'commands'],
    execute_code: ['Ran', 'script', 'scripts'],
    get_url_content: ['Fetched', 'page', 'pages'],
    web_search: ['Searched the web', 'time', 'times'],
    spawn_agent: ['Delegated', 'task', 'tasks'],
    computer: ['Used the computer', 'time', 'times'],
    browser: ['Used the browser', 'time', 'times'],
  };

  // One browser action: what it does, and to what.
  function browserWords(a) {
    switch (a.action) {
      case 'navigate': return ['Open', a.url || ''];
      case 'back': return ['Go back', ''];
      case 'reload': return ['Reload the page', ''];
      case 'read_page': return ['Read the page', a.ref || ''];
      case 'find': return ['Find on the page', a.query || ''];
      case 'click': return ['Click', a.ref || (a.x != null ? `${a.x}, ${a.y}` : '')];
      case 'type': return ['Type', `${a.text || ''}${a.ref ? ` into ${a.ref}` : ''}`];
      case 'press': return ['Press', a.keys || ''];
      case 'scroll': return ['Scroll', a.ref || a.direction || 'down'];
      case 'screenshot': return ['Look at the page', a.ref || ''];
      case 'console': return ['Read the console', a.errors_only ? 'errors' : ''];
      case 'viewport': return ['Resize the page', a.preset || ''];
      default: return ['Use the browser', a.action || ''];
    }
  }

  // One computer action: what it does, and to what.
  function computerWords(a) {
    const at = a.element != null ? `element ${a.element}` : a.x != null && a.y != null ? `${a.x}, ${a.y}` : '';
    switch (a.action) {
      case 'click': return ['Click', at];
      case 'double_click': return ['Double-click', at];
      case 'right_click': return ['Right-click', at];
      case 'move': return ['Point at', at];
      case 'drag': return ['Drag', `${at} to ${a.to_element != null ? `element ${a.to_element}` : `${a.to_x}, ${a.to_y}`}`];
      case 'scroll': return ['Scroll', `${a.direction || 'down'}${at ? ` at ${at}` : ''}`];
      case 'type': return ['Type', a.text || ''];
      case 'key': return ['Press', a.keys || a.text || ''];
      case 'wait': return ['Wait', `${a.seconds || 1} s`];
      case 'elements': return ['Read the screen', a.window ? `window: ${a.window}` : 'the window in front'];
      case 'windows': return ['List open windows', ''];
      case 'focus_window': return ['Switch to', a.window || ''];
      default: return ['Use the computer', a.action || ''];
    }
  }

  // "Allow all ... this session" covers the REASON a call was held, not the one
  // tool that asked: someone who allows file changes means fs_write, fs_edit and
  // a script that writes a file alike. The main process keeps it with the
  // session, so it still holds on the next run and after a restart.
  const ALLOW_LABELS = {
    'runs a command': 'Allow all commands this session',
    'changes files': 'Allow all file changes this session',
    'reads outside the project folder': 'Allow reads outside the folder this session',
    'takes a picture of your screen': 'Allow screenshots this session',
    'reads secrets': 'Allow reading secrets this session',
    'uses a local MCP tool': 'Allow local MCP tools this session',
    'controls your computer': 'Allow computer use this session',
  };

  const REASONS = {
    'retry interrupted tool': 'closed while this tool was running. Its effects are uncertain. Check them before choosing Retry',
    'runs a command': 'wants to run a command',
    'changes files': 'wants to change a file',
    'reads outside the project folder': 'wants to read outside the project folder',
    'takes a picture of your screen': 'wants to take a picture of your screen',
    'reads secrets': 'wants to read a secrets file or your environment variables',
    'may delete or overwrite data': 'wants to run a command that can delete or overwrite data',
    'runs a script from the internet': 'wants to download a script and run it',
    'uses a local MCP tool': 'wants to use a tool from a local MCP server',
    'controls your computer': 'wants to use your mouse, keyboard and screen',
  };

  // Reasons the app asks about every time (src/core/guard.js ALWAYS_ASK), and
  // the browser typing into a site ("types into example.com", guard.alwaysAsk).
  // So is a coding CLI set to "Ask each time": "starts Codex on this computer".
  const ALWAYS_ASKED = new Set(['may delete or overwrite data', 'runs a script from the internet']);
  const STARTS_CLI = /^starts (.+) on this computer$/;
  const alwaysAsked = (reason) => ALWAYS_ASKED.has(reason) || /^types into /.test(String(reason || ''))
    || STARTS_CLI.test(String(reason || ''));

  // The browser's reasons name the site: "uses example.com in the browser",
  // asked once per site and session; "types into example.com", every time.
  const SITE_REASON = /^uses (.+) in the browser$/;
  // A site is allowed for the rest of the session, or not at all: no "once".
  const sessionOnly = (reason) => SITE_REASON.test(String(reason || ''));

  function reasonText(reason) {
    if (REASONS[reason]) return REASONS[reason];
    const r = String(reason || '');
    let m = SITE_REASON.exec(r);
    if (m) return `wants to use ${m[1]} in its browser`;
    m = /^types into (.+)$/.exec(r);
    if (m) return `wants to type into ${m[1]} in its browser`;
    m = STARTS_CLI.exec(r);
    if (m) return `wants to start ${m[1]} on this computer`;
    return 'wants to use a tool';
  }

  // The site a browser reason names, for "Always allow <site>": its host, no port.
  function siteOfReason(reason) {
    const m = SITE_REASON.exec(String(reason || ''));
    return m ? m[1].replace(/:\d+$/, '') : null;
  }

  function allowLabel(reason) {
    if (ALLOW_LABELS[reason]) return ALLOW_LABELS[reason];
    const m = SITE_REASON.exec(String(reason || ''));
    return m ? `Allow ${m[1]} this session` : 'Allow all calls this session';
  }

  function toolSummary(tool) {
    const args = tool.arguments || {};
    if (VERBS[tool.name]) return VERBS[tool.name](args);
    const firstString = Object.values(args).find((v) => typeof v === 'string');
    if (tool.name.startsWith('local_')) return [`Local MCP: ${tool.name.slice(6).replace(/_/g, ' ')}`, firstString || ''];
    return [tool.name.replace(/_/g, ' '), firstString || ''];
  }

  function groupSummary(tools) {
    const buckets = new Map();
    for (const tool of tools) {
      const words = GROUP_WORDS[tool.name] || ['Used', 'tool', 'tools'];
      const key = words[0] + words[1];
      if (!buckets.has(key)) buckets.set(key, { words, count: 0, paths: new Set() });
      const bucket = buckets.get(key);
      const target = tool.arguments && tool.arguments.path;
      if (words[3] && target) {
        if (bucket.paths.has(target)) continue;
        bucket.paths.add(target);
      }
      bucket.count++;
    }
    return [...buckets.values()].map(({ words, count }, index) => {
      const verb = index === 0 ? words[0] : words[0].toLowerCase();
      if (words[1] === 'time') return count === 1 ? verb : `${verb} ${count} times`;
      return `${verb} ${count} ${count === 1 ? words[1] : words[2]}`;
    }).join(', ');
  }

  const api = {
    VERBS, GROUP_WORDS, ALLOW_LABELS, REASONS, ALWAYS_ASKED, alwaysAsked, sessionOnly, siteOfReason, reasonText, allowLabel,
    toolSummary, groupSummary,
  };
  root.CF_TOOL_WORDS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
