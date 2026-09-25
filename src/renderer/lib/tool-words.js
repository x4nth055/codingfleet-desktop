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
  };

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
  };

  // Reasons the app asks about every time (src/core/guard.js ALWAYS_ASK).
  const ALWAYS_ASKED = new Set(['may delete or overwrite data', 'runs a script from the internet']);

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

  const api = { VERBS, GROUP_WORDS, ALLOW_LABELS, REASONS, ALWAYS_ASKED, toolSummary, groupSummary };
  root.CF_TOOL_WORDS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
