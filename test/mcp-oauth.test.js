'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const api = require('../src/core/api');
const { authorizeUrlFor, waitForSignIn, signInStates, canonical } = require('../src/core/mcp-oauth');

test('the sign-in page must be on the API\'s own site', () => {
  const base = 'https://codingfleet.com/v1';
  assert.equal(authorizeUrlFor({ authorize_url: 'https://codingfleet.com/mcp/oauth/begin/abc/' }, base),
    'https://codingfleet.com/mcp/oauth/begin/abc/');
  assert.equal(authorizeUrlFor({ authorize_url: 'http://localhost:8010/mcp/oauth/begin/abc/' }, 'http://localhost:8010/v1'),
    'http://localhost:8010/mcp/oauth/begin/abc/');
  for (const bad of ['https://evil.example/mcp/oauth/begin/abc/', 'https://codingfleet.com.evil.example/x',
    'file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', '', null, undefined]) {
    assert.throws(() => authorizeUrlFor({ authorize_url: bad }, base), /sign-in page/, String(bad));
  }
  assert.throws(() => authorizeUrlFor({}, base), /sign-in page/);
  // Another port is another origin.
  assert.throws(() => authorizeUrlFor({ authorize_url: 'http://localhost:9999/x' }, 'http://localhost:8010/v1'));
});

function fakeApi(answers) {
  const calls = [];
  return {
    calls,
    async mcpOAuthFlow(flowId) {
      calls.push(flowId);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const noSleep = async () => {};

test('waiting ends when the sign-in is done', async () => {
  const fake = fakeApi([{ status: 'pending' }, { status: 'pending' }, { status: 'connected' }]);
  const result = await waitForSignIn(fake, { flow_id: 'F', interval: 2, expires_in: 900 }, { sleep: noSleep });
  assert.deepEqual(result, { status: 'connected', error: null });
  assert.deepEqual(fake.calls, ['F', 'F', 'F']);
});

test('a failed sign-in gives the reason', async () => {
  const fake = fakeApi([{ status: 'failed', error: 'Access to mcp.example was not allowed.' }]);
  const result = await waitForSignIn(fake, { flow_id: 'F' }, { sleep: noSleep });
  assert.deepEqual(result, { status: 'failed', error: 'Access to mcp.example was not allowed.' });
});

test('a lost connection is tried again, a refusal is not', async () => {
  const offline = Object.assign(new Error('Cannot reach the server'), { transient: true });
  const fake = fakeApi([offline, offline, { status: 'connected' }]);
  assert.equal((await waitForSignIn(fake, { flow_id: 'F' }, { sleep: noSleep })).status, 'connected');
  assert.equal(fake.calls.length, 3);

  const gone = Object.assign(new Error('No such sign-in.'), { transient: false, status: 404 });
  const refused = await waitForSignIn(fakeApi([gone]), { flow_id: 'F' }, { sleep: noSleep });
  assert.deepEqual(refused, { status: 'failed', error: 'No such sign-in.' });
});

test('waiting stops when the time is up', async () => {
  let clock = 0;
  const fake = fakeApi(Array.from({ length: 50 }, () => ({ status: 'pending' })));
  const result = await waitForSignIn(fake, { flow_id: 'F', interval: 2, expires_in: 10 },
    { sleep: async (ms) => { clock += ms; }, now: () => clock });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /too long/);
  assert.equal(fake.calls.length, 5);
});

test('waiting can be cancelled, and then asks nothing more', async () => {
  const controller = new AbortController();
  const fake = fakeApi([{ status: 'pending' }, { status: 'connected' }]);
  let sleeps = 0;
  const result = await waitForSignIn(fake, { flow_id: 'F' }, {
    signal: controller.signal,
    sleep: async () => { sleeps += 1; if (sleeps === 2) controller.abort(); },
  });
  assert.deepEqual(result, { status: 'cancelled', error: null });
  assert.equal(fake.calls.length, 1);
});

test('the real delay stops at once on cancel', async () => {
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 30);
  const result = await waitForSignIn(fakeApi([]), { flow_id: 'F', interval: 60 }, { signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.ok(Date.now() - started < 2000);
});

test('a server address is compared as the server keeps it', () => {
  assert.equal(canonical(' HTTPS://MCP.Linear.App/mcp#x '), 'https://mcp.linear.app/mcp');
  assert.equal(canonical('https://mcp.example.com'), 'https://mcp.example.com');
  assert.equal(canonical('https://mcp.example.com/Path?Q=1'), 'https://mcp.example.com/Path?Q=1');
  assert.equal(canonical('not a url'), 'not a url');
});

test('sign-in states by saved server', () => {
  const servers = [
    { id: 'a', url: 'https://MCP.linear.app/mcp', oauth: true },
    { id: 'b', url: 'https://mcp.notion.com/mcp', oauth: true },
    { id: 'c', url: 'https://mcp.sentry.dev/mcp', oauth: true },
    { id: 'd', url: 'https://mcp.linear.app/mcp', oauth: false },
  ];
  const connections = [
    { url: 'https://mcp.linear.app/mcp', connected: true, needs_reauth: false },
    { url: 'https://mcp.notion.com/mcp', connected: false, needs_reauth: true },
  ];
  assert.deepEqual(Object.fromEntries(signInStates(servers, connections)),
    { a: 'connected', b: 'reauth', c: 'none' });
  assert.deepEqual(Object.fromEntries(signInStates(servers, undefined)), { a: 'none', b: 'none', c: 'none' });
});

test('the API calls of a sign-in', { timeout: 10000 }, async () => {
  const saved = api.snapshot();
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push([req.method, req.url, body ? JSON.parse(body) : null, req.headers.authorization]);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/mcp_servers/oauth/start' && JSON.parse(body).url.includes('noreg')) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: {
          message: 'Create an OAuth app there.', code: 'client_id_required',
          redirect_uri: 'https://codingfleet.com/mcp/oauth/callback/',
        } }));
      }
      if (req.url === '/v1/mcp_servers/oauth/start') {
        res.statusCode = 201;
        return res.end(JSON.stringify({ flow_id: 'F1', authorize_url: 'x', expires_in: 900, interval: 2 }));
      }
      if (req.url === '/v1/mcp_servers/oauth/flows/F%2F1') return res.end(JSON.stringify({ status: 'pending' }));
      if (req.url === '/v1/mcp_servers/oauth') return res.end(JSON.stringify({ connections: [] }));
      if (req.url === '/v1/mcp_servers/oauth/disconnect') return res.end(JSON.stringify({ disconnected: true }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    api.configure({ apiBase: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'cf_sk_test' });
    assert.equal((await api.mcpOAuthStart({ url: 'https://mcp.example/mcp' })).flow_id, 'F1');
    // The flow id goes into the path encoded.
    assert.deepEqual(await api.mcpOAuthFlow('F/1'), { status: 'pending' });
    assert.deepEqual(await api.mcpOAuthConnections(), { connections: [] });
    assert.deepEqual(await api.mcpOAuthDisconnect('https://mcp.example/mcp'), { disconnected: true });
    await assert.rejects(api.mcpOAuthStart({ url: 'https://noreg.example/mcp' }), (err) => {
      assert.equal(err.code, 'client_id_required');
      assert.equal(err.details.redirect_uri, 'https://codingfleet.com/mcp/oauth/callback/');
      return true;
    });
    assert.deepEqual(seen.map(([method, url]) => `${method} ${url}`), [
      'POST /v1/mcp_servers/oauth/start', 'GET /v1/mcp_servers/oauth/flows/F%2F1', 'GET /v1/mcp_servers/oauth',
      'POST /v1/mcp_servers/oauth/disconnect', 'POST /v1/mcp_servers/oauth/start',
    ]);
    assert.deepEqual(seen[3][2], { url: 'https://mcp.example/mcp' });
    assert.ok(seen.every((call) => call[3] === 'Bearer cf_sk_test'));
  } finally {
    api.configure(saved);
    server.close();
  }
});
