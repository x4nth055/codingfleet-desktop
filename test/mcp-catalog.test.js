'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'mcp-catalog.js'), 'utf8'), sandbox);
const catalog = sandbox.window.MCP_CATALOG;
const entries = Object.entries(catalog.connectors);

test('every built-in server can be shown and saved', () => {
  const categories = new Set(catalog.categories.map((c) => c.id));
  for (const [key, info] of entries) {
    assert.match(key, /^[a-z0-9_-]{1,40}$/, key);
    assert.ok(!key.startsWith('local'), `${key}: "local" is the prefix of local tools`);
    assert.ok(info.name && info.description, key);
    assert.ok(categories.has(info.category), `${key}: unknown category ${info.category}`);
    assert.ok(['none', 'optional', 'required', 'oauth'].includes(info.authMode), `${key}: ${info.authMode}`);
    assert.match(info.url, /^https:\/\/\S+$/, key);
    assert.ok(Array.isArray(info.tools), key);
  }
  // No category is empty, and no server is listed twice.
  for (const id of categories) assert.ok(entries.some(([, info]) => info.category === id), id);
  assert.equal(new Set(entries.map(([, info]) => info.url)).size, entries.length);
});

test('a server the user signs in to takes no key', () => {
  const signIn = entries.filter(([, info]) => info.authMode === 'oauth');
  assert.deepEqual(signIn.map(([key]) => key).sort(),
    ['atlassian', 'cloudflare', 'linear', 'netlify', 'notion', 'railway']);
  for (const [key, info] of signIn) assert.equal(info.authHeaderName, null, key);
});

test('the services that deploy apps are together', () => {
  const deploy = entries.filter(([, info]) => info.category === 'deploy').map(([key]) => key).sort();
  assert.deepEqual(deploy, ['cloudflare', 'heroku', 'netlify', 'railway', 'render']);
});
