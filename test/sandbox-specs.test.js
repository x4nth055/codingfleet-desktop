'use strict';
// Cloud sandboxes: the spec editor's checks, the bodies it sends, and how
// builds and running sandboxes are described.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sbx = require('../src/renderer/lib/sandbox-specs');

const SPEC = {
  id: 'q8Zr2mXc1VbN4tLp', name: 'Go 1.23', description: '', image_source: 'dockerhub', snapshot: null,
  registry_image: 'golang:1.23', dockerfile: null, install_essentials: true, env_var_names: ['GOFLAGS', 'TOKEN'],
  summary: 'Docker Hub · golang:1.23', pinned: false, sessions: 0,
  build: { status: null, error: null, steps: [], started_at: null, updated_at: null },
};

test('a new spec sends only what its image source reads', () => {
  const form = { ...sbx.emptyForm(), name: ' Go ', image_source: 'dockerhub', registry_image: ' golang:1.23 ',
    dockerfile: 'FROM x', snapshot: 'im-1', env: [{ ...sbx.envRow('A'), value: '1' }, sbx.envRow()] };
  assert.equal(sbx.checkForm(form), '');
  assert.deepEqual(sbx.specBody(form), {
    image_source: 'dockerhub', name: 'Go', registry_image: 'golang:1.23', install_essentials: true, env_vars: { A: '1' },
  });
  assert.deepEqual(sbx.specBody({ ...sbx.emptyForm(), dockerfile: 'FROM x' }), { image_source: 'standard' });
  const snap = sbx.specBody({ ...sbx.emptyForm(), image_source: 'snapshot', snapshot: 'im-1', install_essentials: false });
  assert.deepEqual(snap, { image_source: 'snapshot', snapshot: 'im-1' });
});

test('an edit sends what changed, and nothing when nothing did', () => {
  const form = sbx.formFromSpec(SPEC);
  assert.deepEqual(form.env.map((r) => [r.name, r.existing, r.value]), [['GOFLAGS', true, ''], ['TOKEN', true, '']]);
  assert.equal(sbx.checkForm(form), '');
  assert.deepEqual(sbx.specBody(form, SPEC), {});

  form.registry_image = 'golang:1.24';
  form.env[0].value = '-mod=mod';
  form.env[1].removed = true;
  form.env.push({ ...sbx.envRow('NEW'), value: 'x' });
  form.description = 'Go toolchain';
  assert.deepEqual(sbx.specBody(form, SPEC), {
    description: 'Go toolchain', registry_image: 'golang:1.24',
    env_vars: { GOFLAGS: '-mod=mod', TOKEN: null, NEW: 'x' },
  });

  const other = sbx.formFromSpec(SPEC);
  other.image_source = 'dockerfile';
  other.dockerfile = 'FROM gcc:13\n';
  assert.deepEqual(sbx.specBody(other, SPEC), { image_source: 'dockerfile', dockerfile: 'FROM gcc:13\n', install_essentials: true });
  const cleared = sbx.formFromSpec({ ...SPEC, description: 'old' });
  cleared.description = '';
  assert.deepEqual(sbx.specBody(cleared, { ...SPEC, description: 'old' }), { description: '' });
  const essentials = sbx.formFromSpec(SPEC);
  essentials.install_essentials = false;
  assert.deepEqual(sbx.specBody(essentials, SPEC), { install_essentials: false });
});

test('what the form refuses before anything is sent', () => {
  const base = sbx.emptyForm();
  const cases = [
    [{ name: 'x'.repeat(101) }, 'at most 100'],
    [{ image_source: 'dockerhub' }, 'Enter the image'],
    [{ image_source: 'dockerhub', registry_image: 'golang 1.23' }, 'not an image name'],
    [{ image_source: 'dockerfile', dockerfile: '  ' }, 'Write the Dockerfile'],
    [{ image_source: 'dockerfile', dockerfile: `FROM x\n${'#'.repeat(70000)}` }, 'larger than 64 KB'],
    [{ image_source: 'snapshot' }, 'Choose the snapshot'],
    [{ image_source: 'nope' }, 'Choose where'],
    [{ env: [{ ...sbx.envRow('1A'), value: 'x' }] }, 'not a valid variable name'],
    [{ env: [{ ...sbx.envRow('A'), value: 'x' }, { ...sbx.envRow('A'), value: 'y' }] }, 'twice'],
    [{ env: [sbx.envRow('A')] }, 'Give "A" a value'],
    [{ env: [{ ...sbx.envRow(''), value: 'x' }] }, 'Give every variable a name'],
    [{ env: Array.from({ length: 51 }, (_, i) => ({ ...sbx.envRow(`V${i}`), value: 'x' })) }, 'At most 50'],
  ];
  for (const [change, text] of cases) {
    assert.match(sbx.checkForm({ ...base, ...change }), new RegExp(text), JSON.stringify(change).slice(0, 80));
  }
  // A saved variable left empty keeps its value; an empty new row is ignored.
  assert.equal(sbx.checkForm({ ...base, env: [sbx.envRow('KEEP', { existing: true }), sbx.envRow()] }), '');
  assert.equal(sbx.checkForm({ ...base, env: [{ ...sbx.envRow('1BAD', { existing: true }), removed: true }] }), '');
});

test('the client checks match the server limits', () => {
  // The server's own lists (codingfleet assistant/api/sandboxes.py), copied
  // here: a value the window accepts must not be one the server refuses.
  for (const ok of ['golang:1.23', 'ghcr.io/org/app:1.2', 'localhost:5000/x@sha256:abc', 'gcc']) {
    assert.ok(sbx.REGISTRY_RE.test(ok), ok);
  }
  for (const bad of ['golang 1.23', ':tag', '-x', '']) assert.ok(!sbx.REGISTRY_RE.test(bad), bad);
  assert.ok(sbx.ENV_NAME_RE.test('_A1') && !sbx.ENV_NAME_RE.test('A-B'));
  assert.equal(sbx.LIMITS.envVars, 50);
  assert.equal(sbx.LIMITS.dockerfileBytes, 64 * 1024);
});

test('a snapshot becomes a new spec form', () => {
  const form = sbx.formFromSnapshot({ id: 'im-9', name: 'Go deps · 2026-10-10 08:30 UTC' });
  assert.equal(form.image_source, 'snapshot');
  assert.deepEqual(sbx.specBody(form), { image_source: 'snapshot', name: 'Go deps · 2026-10-10 08:30 UTC', snapshot: 'im-9' });
});

test('a build is described by its state', () => {
  assert.equal(sbx.buildState(SPEC).kind, 'none');
  const building = sbx.buildState({ build: { status: 'building', steps: [
    { step: 'registry', label: 'Pulling golang:1.23', status: 'done', seconds: 20 },
    { step: 'essentials', label: "Installing CodingFleet's tooling", status: 'running', seconds: null },
  ] } });
  assert.deepEqual([building.kind, building.detail], ['building', "Installing CodingFleet's tooling"]);
  assert.equal(sbx.buildState({ build: { status: 'building', steps: [] } }).detail, 'Starting the build');
  const built = sbx.buildState({ build: { status: 'built', steps: [{ seconds: 25.6 }, { seconds: 16 }] } });
  assert.deepEqual([built.kind, built.detail], ['built', 'Built in 42 s']);
  const failed = sbx.buildState({ build: { status: 'failed', error: 'exit 3' } });
  assert.deepEqual([failed.kind, failed.label, failed.detail], ['failed', 'Build failed', 'exit 3']);
  assert.equal(sbx.anyBuilding([SPEC, { build: { status: 'building' } }]), true);
  assert.equal(sbx.anyBuilding(null), false);
});

test('running sandboxes and the limit read plainly', () => {
  const now = Date.parse('2026-10-10T08:00:00Z');
  assert.equal(sbx.inMinutes('2026-10-10T08:12:20Z', now), 'in 12 min');
  assert.equal(sbx.inMinutes('2026-10-10T09:05:00Z', now), 'in 1 h 5 min');
  assert.equal(sbx.inMinutes('2026-10-10T07:00:00Z', now), 'now');
  assert.equal(sbx.inMinutes('nope', now), '');
  const resources = { cpu: { reserved: 0.125, limit: 4 }, memory_mb: { reserved: 256, limit: 8192 } };
  assert.equal(sbx.sandboxLine({ idle_stop_at: '2026-10-10T08:20:00Z', resources }, now),
    'Stops if idle in 20 min · up to 4 CPU, 8 GB');
  assert.equal(sbx.sandboxLine({ busy: true, idle_stop_at: '2026-10-10T08:20:00Z' }, now), 'A run is using it');
  assert.match(sbx.limitLine({ api_sandboxes: 2, api_active: 1 }), /^1 of 2 session sandboxes running/);
  assert.match(sbx.limitLine({ api_sandboxes: null, api_active: 3 }), /no limit/);
  assert.match(sbx.limitLine({ api_sandboxes: 0, api_active: 0 }), /no cloud sandboxes/);
  assert.equal(sbx.limitLine(null), '');
});

test('the composer names the spec a cloud session uses', () => {
  assert.equal(sbx.cloudLabel(null, [SPEC]), 'Cloud sandbox');
  assert.equal(sbx.cloudLabel(SPEC.id, [SPEC]), 'Cloud · Go 1.23');
  assert.equal(sbx.cloudLabel(SPEC.id, null), 'Cloud · custom image');
});

test('every sandbox call the window makes is bridged and handled', () => {
  const root = path.join(__dirname, '..', 'src');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const windowCode = read('renderer/app/12-sandboxes.js') + read('renderer/app/08-composer.js');
  const used = new Set([...windowCode.matchAll(/cf\.([A-Za-z]+)/g)].map((m) => m[1]));
  const preload = read('main/preload.js');
  const main = read('main/main.js');
  const api = require('../src/core/api');
  for (const name of [...used].filter((n) => /andbox|napshot/.test(n))) {
    const bridged = preload.match(new RegExp(`\\b${name}: call\\('([^']+)'\\)`));
    assert.ok(bridged, `cf.${name} is not in preload.js`);
    assert.ok(main.includes(`handle('${bridged[1]}'`), `${bridged[1]} has no handler in main.js`);
  }
  for (const fn of ['sandboxSpecs', 'createSandboxSpec', 'updateSandboxSpec', 'deleteSandboxSpec', 'validateSandboxSpec',
    'buildSandboxSpec', 'sandboxConfig', 'updateSandboxConfig', 'sandboxes', 'stopSandboxById', 'snapshotSandbox',
    'snapshots', 'updateSnapshot', 'deleteSnapshot']) {
    assert.equal(typeof api[fn], 'function', fn);
  }
});

test('the API client sends each sandbox call to the right place', { timeout: 10000 }, async () => {
  const http = require('node:http');
  const api = require('../src/core/api');
  const saved = api.snapshot();
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push([req.method, req.url, raw ? JSON.parse(raw) : null]);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/sandbox_specs/gone') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: { message: 'No sandbox spec with that id on your account.', code: 'spec_not_found' } }));
      return;
    }
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api.configure({ apiBase: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'cf_sk_test' });
  try {
    await api.sandboxSpecs();
    await api.createSandboxSpec({ image_source: 'standard' });
    await api.updateSandboxSpec('abc', { name: 'x' });
    await api.deleteSandboxSpec('abc');
    await api.validateSandboxSpec({ image_source: 'dockerfile', dockerfile: 'FROM x' });
    await api.buildSandboxSpec('abc');
    await api.sandboxConfig();
    await api.updateSandboxConfig({ always_fresh: true });
    await api.sandboxes(true);
    await api.sandboxes(false);
    await api.stopSandboxById('sb-1');
    await api.snapshotSandbox('sb-1');
    await api.snapshotSandbox('sb-1', { name: 'n' });
    await api.snapshots();
    await api.updateSnapshot('im-1', { name: 'n' });
    await api.deleteSnapshot('im-1');
    await assert.rejects(api.sandboxSpec('gone'), (err) => err.status === 404 && err.code === 'spec_not_found');
  } finally {
    server.close();
    api.configure(saved);
  }
  assert.deepEqual(seen, [
    ['GET', '/v1/sandbox_specs', null],
    ['POST', '/v1/sandbox_specs', { image_source: 'standard' }],
    ['PATCH', '/v1/sandbox_specs/abc', { name: 'x' }],
    ['DELETE', '/v1/sandbox_specs/abc', null],
    ['POST', '/v1/sandbox_specs/validate', { image_source: 'dockerfile', dockerfile: 'FROM x' }],
    ['POST', '/v1/sandbox_specs/abc/build', null],
    ['GET', '/v1/sandbox_config', null],
    ['PATCH', '/v1/sandbox_config', { always_fresh: true }],
    ['GET', '/v1/sandboxes?refresh=1', null],
    ['GET', '/v1/sandboxes', null],
    ['DELETE', '/v1/sandboxes/sb-1', null],
    ['POST', '/v1/sandboxes/sb-1/snapshot', {}],
    ['POST', '/v1/sandboxes/sb-1/snapshot', { name: 'n' }],
    ['GET', '/v1/snapshots?limit=200', null],
    ['PATCH', '/v1/snapshots/im-1', { name: 'n' }],
    ['DELETE', '/v1/snapshots/im-1', null],
    ['GET', '/v1/sandbox_specs/gone', null],
  ]);
});
