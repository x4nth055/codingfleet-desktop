'use strict';
// Cloud sandboxes: the spec editor's form, the request bodies it sends, and
// how a spec's build and a running sandbox are described. The server is
// codingfleet.com's /v1/sandbox_specs, /v1/sandbox_config, /v1/sandboxes and
// /v1/snapshots. No DOM and no state, so the tests can require it.
(function (root) {
  const SOURCES = [
    { id: 'standard', name: 'Standard image', short: 'Standard',
      desc: "Debian with CodingFleet's tooling: git, curl, Python 3, build tools, ripgrep." },
    { id: 'dockerhub', name: 'Docker Hub image', short: 'Docker Hub',
      desc: 'A public image, such as golang:1.23, gcc:13 or ghcr.io/org/app:1.2.' },
    { id: 'dockerfile', name: 'Dockerfile', short: 'Dockerfile',
      desc: 'An image built from your Dockerfile. There is no build context: fetch files inside the image.' },
    { id: 'snapshot', name: 'Snapshot', short: 'Snapshot',
      desc: 'A snapshot you saved of a sandbox, with everything installed in it.' },
  ];
  // The field each source reads. The server refuses the others.
  const SOURCE_FIELD = { standard: null, dockerhub: 'registry_image', dockerfile: 'dockerfile', snapshot: 'snapshot' };
  // CodingFleet's tooling is layered only on an image someone else made.
  const ESSENTIALS_SOURCES = ['dockerhub', 'dockerfile'];

  const LIMITS = { name: 100, description: 2000, registry: 300, dockerfileBytes: 64 * 1024, envVars: 50, envValue: 32 * 1024 };
  const REGISTRY_RE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;
  const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

  const sourceOf = (id) => SOURCES.find((s) => s.id === id) || SOURCES[0];
  const byteLength = (text) => new TextEncoder().encode(String(text || '')).length;

  // A row of the env var editor. `existing`: the server has a value for it,
  // which it never sends back; an empty value then keeps it.
  const envRow = (name = '', { existing = false } = {}) => ({ name, value: '', existing, removed: false });

  function emptyForm() {
    return {
      name: '', description: '', image_source: 'standard', registry_image: '', dockerfile: '',
      snapshot: '', install_essentials: true, env: [],
    };
  }

  function formFromSpec(spec) {
    return {
      name: spec.name || '',
      description: spec.description || '',
      image_source: spec.image_source || 'standard',
      registry_image: spec.registry_image || '',
      dockerfile: spec.dockerfile || '',
      snapshot: spec.snapshot || '',
      install_essentials: spec.install_essentials !== false,
      env: (spec.env_var_names || []).map((name) => envRow(name, { existing: true })),
    };
  }

  // A new spec made from a snapshot ("New spec from it").
  function formFromSnapshot(snapshot) {
    return { ...emptyForm(), name: String(snapshot.name || '').slice(0, LIMITS.name),
      image_source: 'snapshot', snapshot: snapshot.id };
  }

  // What is wrong with the env rows, or ''. `keepEmpty`: an existing row with
  // no value keeps the stored one.
  function checkEnv(rows) {
    const seen = new Set();
    let count = 0;
    for (const row of rows || []) {
      if (row.removed) continue;
      const name = String(row.name || '').trim();
      if (!name && !row.value) continue;
      if (!name) return 'Give every variable a name.';
      if (!ENV_NAME_RE.test(name)) return `"${name}" is not a valid variable name: use letters, digits and _, and do not start with a digit.`;
      if (seen.has(name)) return `"${name}" is there twice.`;
      seen.add(name);
      if (!row.existing && !row.value) return `Give "${name}" a value.`;
      if (String(row.value || '').length > LIMITS.envValue) return `The value of "${name}" is too long.`;
      count++;
    }
    if (count > LIMITS.envVars) return `At most ${LIMITS.envVars} variables.`;
    return '';
  }

  // What is wrong with the form, or '' when it can be sent.
  function checkForm(form) {
    if (String(form.name || '').trim().length > LIMITS.name) return `The name can have at most ${LIMITS.name} characters.`;
    if (String(form.description || '').length > LIMITS.description) return `The description can have at most ${LIMITS.description} characters.`;
    const source = form.image_source;
    if (!(source in SOURCE_FIELD)) return 'Choose where the image comes from.';
    if (source === 'dockerhub') {
      const image = String(form.registry_image || '').trim();
      if (!image) return 'Enter the image, such as golang:1.23.';
      if (image.length > LIMITS.registry || !REGISTRY_RE.test(image)) return `"${image}" is not an image name, such as golang:1.23.`;
    }
    if (source === 'dockerfile') {
      if (!String(form.dockerfile || '').trim()) return 'Write the Dockerfile.';
      if (byteLength(form.dockerfile) > LIMITS.dockerfileBytes) return 'The Dockerfile is larger than 64 KB.';
    }
    if (source === 'snapshot' && !form.snapshot) return 'Choose the snapshot.';
    return checkEnv(form.env);
  }

  // The env vars to send: {NAME: value} to set, {NAME: null} to remove. Only
  // what changes: an existing variable left empty keeps its value.
  function envChanges(rows) {
    const out = {};
    for (const row of rows || []) {
      const name = String(row.name || '').trim();
      if (!name) continue;
      if (row.removed) {
        if (row.existing) out[name] = null;
      } else if (row.value) {
        out[name] = String(row.value);
      }
    }
    return out;
  }

  const sourceValue = (form) => {
    const field = SOURCE_FIELD[form.image_source];
    if (!field) return null;
    const value = form[field];
    return field === 'registry_image' ? String(value || '').trim() : value;
  };

  // The body of POST /v1/sandbox_specs (no `original`) or of its PATCH: for a
  // change, only what changed. {} when nothing did.
  function specBody(form, original) {
    const source = form.image_source;
    const field = SOURCE_FIELD[source];
    const essentials = ESSENTIALS_SOURCES.includes(source);
    const name = String(form.name || '').trim();
    const description = String(form.description || '').trim();
    const env = envChanges(form.env);
    if (!original) {
      const body = { image_source: source };
      if (name) body.name = name;
      if (description) body.description = description;
      if (field) body[field] = sourceValue(form);
      if (essentials) body.install_essentials = Boolean(form.install_essentials);
      if (Object.keys(env).length) body.env_vars = env;
      return body;
    }
    const body = {};
    if (name && name !== (original.name || '')) body.name = name;
    if (description !== (original.description || '')) body.description = description;
    const sourceChanged = source !== original.image_source;
    if (sourceChanged) body.image_source = source;
    if (field && (sourceChanged || sourceValue(form) !== (original[field] || ''))) body[field] = sourceValue(form);
    if (essentials && (sourceChanged || Boolean(form.install_essentials) !== (original.install_essentials !== false))) {
      body.install_essentials = Boolean(form.install_essentials);
    }
    if (Object.keys(env).length) body.env_vars = env;
    return body;
  }

  // A spec's last build, for a pill and a line under it.
  function buildState(spec) {
    const build = (spec && spec.build) || {};
    const steps = build.steps || [];
    if (build.status === 'building') {
      const step = [...steps].reverse().find((s) => s.status === 'running');
      return { kind: 'building', label: 'Building', detail: step ? step.label : 'Starting the build' };
    }
    if (build.status === 'built') {
      const seconds = steps.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
      return { kind: 'built', label: 'Built', detail: seconds ? `Built in ${Math.round(seconds)} s` : 'Built' };
    }
    if (build.status === 'failed') return { kind: 'failed', label: 'Build failed', detail: build.error || 'The build failed.' };
    return { kind: 'none', label: 'Not built', detail: 'Built when a session first needs it, or now with Build.' };
  }

  const anyBuilding = (specs) => (specs || []).some((spec) => buildState(spec).kind === 'building');

  // "in 12 min", "in 1 h 5 min", "now".
  function inMinutes(iso, now = Date.now()) {
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return '';
    const minutes = Math.round((at - now) / 60000);
    if (minutes <= 0) return 'now';
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `in ${hours} h${rest ? ` ${rest} min` : ''}`;
  }

  // One line for a running sandbox: who uses it and when it stops.
  function sandboxLine(sandbox, now = Date.now()) {
    const parts = [];
    if (sandbox.busy) parts.push('A run is using it');
    else if (sandbox.idle_stop_at) parts.push(`Stops if idle ${inMinutes(sandbox.idle_stop_at, now)}`);
    const resources = sandbox.resources || {};
    if (resources.cpu && resources.memory_mb) {
      const gb = Math.round((resources.memory_mb.limit / 1024) * 10) / 10;
      parts.push(`up to ${resources.cpu.limit} CPU, ${gb} GB`);
    }
    return parts.join(' · ');
  }

  // "1 of 2 session sandboxes running", or '' with no limit.
  function limitLine(limits) {
    if (!limits) return '';
    const active = Number(limits.api_active) || 0;
    if (limits.api_sandboxes === null || limits.api_sandboxes === undefined) {
      return `${active} session ${active === 1 ? 'sandbox' : 'sandboxes'} running. Your plan has no limit.`;
    }
    if (limits.api_sandboxes === 0) return 'Your plan has no cloud sandboxes for sessions.';
    return `${active} of ${limits.api_sandboxes} session sandboxes running. At the limit, the one idle the `
      + 'longest is stopped (and snapshotted) to make room.';
  }

  // What the composer's folder button says for a cloud session.
  function cloudLabel(specId, specs) {
    if (!specId) return 'Cloud sandbox';
    const spec = (specs || []).find((s) => s.id === specId);
    return `Cloud · ${spec ? spec.name : 'custom image'}`;
  }

  const api = {
    SOURCES, SOURCE_FIELD, ESSENTIALS_SOURCES, LIMITS, REGISTRY_RE, ENV_NAME_RE,
    sourceOf, envRow, emptyForm, formFromSpec, formFromSnapshot, checkForm, checkEnv, envChanges, specBody,
    buildState, anyBuilding, inMinutes, sandboxLine, limitLine, cloudLabel,
  };
  root.CF_SANDBOX = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
