'use strict';
// Writes src/renderer/mcp-catalog.js from the web app's list of built-in MCP
// servers, so the two apps offer the same servers:
//   node scripts/make-mcp-catalog.cjs ../codingfleet/assistant/static/js/mcp-catalog.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = process.argv[2];
if (!source) {
  console.error('Give the path of the web app\'s mcp-catalog.js.');
  process.exit(1);
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(source, 'utf8'), sandbox, { filename: source });
const web = sandbox.window.MCP_CATALOG;
if (!web || !web.connectors) throw new Error(`${source} does not set window.MCP_CATALOG.`);

const DEFAULT_COLOR = '#7b8cff';
const connectors = {};
for (const [key, entry] of Object.entries(web.connectors)) {
  // The web shows an icon; here a badge takes the icon's colour.
  const color = /color:\s*(#[0-9a-fA-F]{3,8})/.exec(entry.iconHtml || '');
  connectors[key] = {
    name: entry.name,
    category: entry.category,
    description: entry.description,
    authMode: entry.authMode,
    authHeaderName: entry.authHeaderName || null,
    url: entry.defaultUrl,
    servers: (entry.servers || []).map((s) => ({ name: s.name, url: s.url })),
    tools: entry.defaultTools || [],
    tokenHelp: entry.tokenHelp,
    tokenPlaceholder: entry.tokenPlaceholder,
    color: color ? color[1] : DEFAULT_COLOR,
  };
}
const catalog = {
  categories: web.categories.map((c) => ({ id: c.id, name: c.name })),
  connectors,
};

const target = path.join(__dirname, '..', 'src', 'renderer', 'mcp-catalog.js');
fs.writeFileSync(target, '\'use strict\';\n'
  + '// Built-in remote MCP servers, generated from the web app\'s assistant/static/js/mcp-catalog.js.\n'
  + `window.MCP_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`);
console.log(`${Object.keys(connectors).length} servers in ${catalog.categories.length} categories -> ${target}`);
