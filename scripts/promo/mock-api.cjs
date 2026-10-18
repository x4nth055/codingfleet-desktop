'use strict';
// A stand-in for the CodingFleet Agent API, for recording the promo video.
// The app is the real one: its window, its tools, its approvals and its undo.
// Only the model is scripted: each run plays the turn in turns.cjs whose
// `match` fits the prompt, and waits for the app's real tool results.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const LOGOS = path.join(__dirname, 'logos');
const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createMock({ turns, sessions: seeded = [], speed = 1 }) {
  const sessions = new Map();
  const runs = new Map();
  const files = new Map();
  const log = [];
  let base = '';

  for (const s of seeded) {
    sessions.set(s.id, {
      pinned: false, executor: 'client', model: 'auto', capabilities: {}, created_at: iso(s.ago + 30),
      last_used_at: iso(s.ago), last_message_at: iso(s.ago), messages: s.messages || [], ...s,
    });
  }

  const serialize = (s) => ({
    id: s.id, title: s.title, pinned: s.pinned, executor: s.executor, model: s.model,
    snapshot_sandbox: false, created_at: s.created_at, last_used_at: s.last_used_at,
    last_message_at: s.last_message_at, capabilities: s.capabilities, git_repository: null,
    restore_from: null, sandbox_spec: null, sandbox: s.sandbox || null,
    context: s.context || null, cost: s.cost ?? null,
  });

  const provider = (name, logo) => ({ name, logo_url: logo ? `${base}/logos/${logo}` : null });
  const MODELS = [
    // Unlimited (the last flag but one): the plan's standard models, as on
    // codingfleet.com/pricing. The demos run on these.
    ['auto', 'Auto', null, 0.5, false, 0],
    ['claude-opus-5-5', 'Claude Opus 5.5', provider('Anthropic', 'anthropic.png'), 6, false, 80],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5', provider('Anthropic', 'anthropic.png'), 3, false, 76],
    ['claude-haiku-5-5', 'Claude Haiku 5.5', provider('Anthropic', 'anthropic.png'), 1, true, 64],
    ['gpt-6-1-sol', 'GPT-6.1 Sol', provider('OpenAI', 'openai.png'), 5, false, 81],
    ['gpt-6-luna', 'GPT-6 Luna', provider('OpenAI', 'openai.png'), 1, true, 66],
    ['gemini-4-argon', 'Gemini 4 Argon', provider('Google', 'google-g-logo.webp'), 4, false, 79],
    ['gemini-3-1-pro', 'Gemini 3.1 Pro', provider('Google', 'google-g-logo.webp'), 2, false, 72],
    ['deepseek-v4-1-flash', 'DeepSeek V4.1 Flash', provider('DeepSeek', 'deepseek.png'), 0.25, true, 63],
    ['qwen-3-8-max', 'Qwen 3.8 Max', provider('Qwen', 'qwen.png'), 1.5, false, 71],
    ['qwen-3-8-flash', 'Qwen 3.8 Flash', provider('Qwen', 'qwen.png'), 0.3, true, 58],
    ['kimi-k3', 'Kimi K3', provider('Moonshot', null), 1, false, 70],
    ['glm-5-3', 'GLM 5.3', provider('Z.ai', null), 1, false, 69],
    ['glm-5-3-flash', 'GLM 5.3 Flash', provider('Z.ai', null), 0.3, true, 60],
    ['grok-4-7', 'Grok 4.7', provider('xAI', 'xai.png'), 3, false, 74],
    ['mistral-medium-3-5', 'Mistral Medium 3.5', provider('Mistral', 'mistral.png'), 0.5, false, 57],
  ];
  const models = () => MODELS.map(([mid, name, prov, cost, unlimited, iq]) => ({
    id: mid, name, legacy: false, credits_per_20k_tokens: cost, context_window: mid === 'auto' ? null : 400000,
    supports_vision: true, unlimited, intelligence_index: iq || null, output_tokens_per_second: iq ? 60 + iq : null,
    provider: prov, family: null, effort: { label: null, rank: 0 },
  }));

  const credits = () => ({
    plan: {
      key: 'pro', name: 'Pro', unlimited_models: true, byok_in_sandbox: true,
      urls: { plans: 'https://codingfleet.com/pricing/', credits: 'https://codingfleet.com/pricing/#one-time-purchase', billing: 'https://codingfleet.com/billing/' },
    },
    credits: 1840, weekly_remaining: 3260, weekly_total: 5000, quota_remaining: 5100,
    concurrency: { limit: 5, active: [...runs.values()].filter((r) => !r.done).length },
    account: { username: 'ada', email: 'ada@example.com' },
    key: { name: 'CodingFleet Desktop', hint: 'cf_sk_…demo', client: 'desktop', created_at: iso(9000), expires_at: null },
  });

  const settings = () => ({
    privacy: { privacy_models: false, zero_data_retention: false, data_region: '', data_region_available: false, private_sessions: false },
    preferences: { default_model: process.env.PROMO_DEFAULT_MODEL || 'deepseek-v4-1-flash', show_legacy_models: false, credit_cap_per_message: 0, economy_mode: false },
  });

  // ── Runs ────────────────────────────────────────────────────────────────
  function pickTurn(message) {
    const text = String(message || '');
    return turns.find((t) => (t.match instanceof RegExp ? t.match.test(text) : text.includes(t.match)))
      || turns.find((t) => t.fallback);
  }

  async function play(run, res, session, body) {
    const send = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      run.events.push({ event, data });
    };
    const turn = pickTurn(body.message);
    const model = body.model && body.model !== 'auto' ? body.model : (turn?.model || 'claude-sonnet-5-5');
    send('run.started', { run_id: run.id, session_id: session.id, model });
    send('run.meta', { model });
    const record = { role: 'assistant', text: '', tools: [], created_at: new Date().toISOString() };
    session.messages.push({ role: 'user', text: body.message, created_at: new Date().toISOString(), files: [] });

    const say = async (text, cps = 140) => {
      const pace = cps * speed;
      let i = 0;
      while (i < text.length) {
        if (run.cancelled) return;
        const n = 2 + Math.floor(Math.random() * 5);
        const chunk = text.slice(i, i + n);
        i += n;
        record.text += chunk;
        send('text.delta', { text: chunk });
        await sleep((n / pace) * 1000);
      }
    };

    const callTool = async (step, agentId) => {
      const callId = step.id || id('call');
      const client = step.client !== false;
      const call = { id: callId, name: step.tool, arguments: step.args || {} };
      if (client) call.executor = 'client';
      if (agentId) call.agent_id = agentId;
      if (!agentId) record.tools.push({ name: step.tool, arguments: step.args || {}, ok: true, text_offset: record.text.length });
      send('tool.call', call);
      let result;
      if (client) {
        result = await new Promise((resolve) => run.waiting.set(callId, resolve));
      } else {
        await sleep((step.ms || 1200) / speed);
        result = { output: step.output ?? '', is_error: false };
      }
      // An image goes to the model, not into the transcript: the card says what it was.
      const shown = result.output && typeof result.output === 'object' && result.output.data && result.output.width
        ? `Viewed ${step.args?.source || 'the image'} (${result.output.width}×${result.output.height}).` : result.output;
      const out = { id: callId, name: step.tool, ok: !result.is_error, output: shown };
      if (agentId) out.agent_id = agentId;
      send('tool.result', out);
      // Later steps can quote what a command really printed.
      if (step.label) run.results[step.label] = result.output;
      return result;
    };

    const steps = typeof turn?.steps === 'function' ? turn.steps({ body, session }) : (turn?.steps || [
      { say: 'This promo server has no scripted turn for that prompt.' },
    ]);

    const runStep = async (step) => {
      if (run.cancelled) return;
      if (step.wait) await sleep(step.wait / speed);
      else if (step.think) {
        send('status', { kind: 'thinking', state: 'started' });
        await sleep(step.think / speed);
        send('status', { kind: 'thinking', state: 'ended' });
      } else if (step.say) await say(typeof step.say === 'function' ? step.say(run.results) : step.say, step.cps);
      else if (step.tool) await callTool(step);
      else if (step.parallel) await Promise.all(step.parallel.map((s) => callTool(s)));
      else if (step.title) {
        session.title = step.title;
        send('session.title', { title: step.title });
      } else if (step.untilSteered) {
        const started = Date.now();
        while (!run.steers.length && Date.now() - started < step.untilSteered) await sleep(100);
        // The window draws the message it sent before the answer to it starts.
        if (run.steers.length) await sleep(1200);
      } else if (step.agents) {
        await Promise.all(step.agents.map(async (agent) => {
          const agentId = id('agent');
          const callId = id('call');
          record.tools.push({ name: 'spawn_agent', arguments: { task: agent.task, role: agent.role }, ok: true, text_offset: record.text.length });
          send('tool.call', { id: callId, name: 'spawn_agent', arguments: { task: agent.task, role: agent.role } });
          send('subagent.started', { agent_id: agentId, call_id: callId, role: agent.role, task: agent.task, model: agent.model });
          await sleep((agent.delay || 0) / speed);
          for (const s of agent.steps) {
            if (s.wait) await sleep(s.wait / speed);
            else if (s.say) {
              for (const word of s.say.match(/\S+\s*/g)) {
                send('subagent.text', { text: word, agent_id: agentId });
                await sleep(45 / speed);
              }
            } else await callTool(s, agentId);
          }
          send('subagent.done', { agent_id: agentId, call_id: callId, credits: agent.credits ?? 0.4, summary: agent.summary, ok: true, cancelled: false, model: agent.model });
          send('tool.result', { id: callId, name: 'spawn_agent', ok: true, output: agent.summary, subagent: { id: agentId, credits: agent.credits ?? 0.4, summary: agent.summary, model: agent.model, role: agent.role } });
        }));
      } else if (step.do) await step.do({ send, run, session });
    };

    try {
      for (const step of steps) await runStep(step);
      const usage = turn?.usage || {};
      send('usage', {
        credits: usage.credits ?? 1.6, credits_charged: 0, credits_remaining: 1840, quota_remaining: 5100,
        model, prompt_tokens: 38211, cache_read_input_tokens: 30144, cache_creation_input_tokens: 0,
        completion_tokens: 1450, reasoning_tokens: 310, time_taken: usage.time ?? 41,
        context_tokens: usage.context ?? 21480, billing: 'plan',
      });
      send('run.ended', { reason: run.cancelled ? 'cancelled' : 'completed' });
    } catch (err) {
      send('run.ended', { reason: 'error', error: err.message });
    }
    run.done = true;
    session.busy = false;
    session.active_run_id = null;
    session.last_message_at = new Date().toISOString();
    session.last_used_at = session.last_message_at;
    session.cost = (session.cost || 0) + (turn?.usage?.credits ?? 1.6);
    session.context = { tokens: turn?.usage?.context ?? 21480, window: 400000 };
    session.messages.push(record);
    res.end();
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/^\/v1/, '');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const parts = p.split('/').filter(Boolean);
    log.push(`${req.method} ${p}`);
    try {
      if (parts[0] === 'logos') {
        const file = path.join(LOGOS, path.basename(parts[1] || ''));
        if (!fs.existsSync(file)) return json(404, {});
        res.writeHead(200, { 'Content-Type': file.endsWith('.webp') ? 'image/webp' : 'image/png' });
        return res.end(fs.readFileSync(file));
      }
      if (p === '/files' && req.method === 'POST') {
        // Multipart: keep the file's own bytes, between its headers and the boundary.
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(req.headers['content-type'])[1]}`);
        let file = null;
        let name = 'file';
        let type = 'application/octet-stream';
        for (let at = raw.indexOf(boundary); at !== -1;) {
          const next = raw.indexOf(boundary, at + boundary.length);
          if (next === -1) break;
          const part = raw.subarray(at + boundary.length + 2, next - 2);
          const split = part.indexOf('\r\n\r\n');
          const head = part.subarray(0, split).toString();
          if (/name="file"/.test(head)) {
            file = part.subarray(split + 4);
            name = /filename="([^"]*)"/.exec(head)?.[1] || name;
            type = /Content-Type: (.+)/i.exec(head)?.[1].trim() || type;
          }
          at = next;
        }
        const fileId = id('file');
        files.set(fileId, { data: file, type, name });
        return json(201, { id: fileId, filename: name, bytes: file ? file.length : 0, content_type: type, purpose: 'attachment' });
      }
      if (parts[0] === 'files' && parts[1]) {
        const f = files.get(parts[1]);
        if (!f) return json(404, { error: { message: 'File not found.' } });
        if (req.method === 'DELETE') { files.delete(parts[1]); return json(200, { deleted: true }); }
        if (parts[2] === 'content') {
          res.writeHead(200, { 'Content-Type': f.type });
          return res.end(f.data);
        }
        return json(200, { id: parts[1], filename: f.name, bytes: f.data.length, content_type: f.type });
      }
      if (p === '/credits') return json(200, credits());
      if (p === '/models') return json(200, { models: models() });
      if (p === '/settings' && req.method === 'GET') return json(200, settings());
      if (p === '/settings' && req.method === 'PATCH') return json(200, settings());
      if (p === '/settings/keys') return json(200, { keys: [] });
      if (p === '/billing') return json(200, { plan: credits().plan, subscriptions: [], payments: [] });
      if (p === '/sandbox_specs') return json(200, { specs: [] });
      if (p === '/sandbox_config') return json(200, {});
      if (p === '/sandboxes') return json(200, { sandboxes: [] });
      if (p === '/snapshots') return json(200, { snapshots: [] });
      if (p === '/sessions' && req.method === 'GET') {
        const list = [...sessions.values()].sort((a, b) => b.last_used_at.localeCompare(a.last_used_at));
        return json(200, { sessions: list.map(serialize) });
      }
      if (p === '/sessions' && req.method === 'POST') {
        const body = await readBody(req);
        const s = {
          id: id('sess'), title: null, pinned: false, executor: body.executor || 'client', model: body.model || 'auto',
          capabilities: body.capabilities || {}, created_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(), last_message_at: null, messages: [],
        };
        sessions.set(s.id, s);
        return json(201, serialize(s));
      }
      if (parts[0] === 'sessions' && parts[1]) {
        const s = sessions.get(parts[1]);
        if (!s) return json(404, { error: { message: 'Session not found.', code: 'session_not_found' } });
        if (parts.length === 2 && req.method === 'GET') {
          return json(200, { ...serialize(s), busy: Boolean(s.busy), active_run_id: s.active_run_id || null });
        }
        if (parts.length === 2 && req.method === 'PATCH') {
          const body = await readBody(req);
          if (body.title !== undefined) s.title = body.title;
          if (body.pinned !== undefined) s.pinned = body.pinned;
          return json(200, serialize(s));
        }
        if (parts.length === 2 && req.method === 'DELETE') {
          sessions.delete(s.id);
          return json(200, { deleted: true });
        }
        if (parts[2] === 'messages') return json(200, { session_id: s.id, messages: s.messages, compactions: [] });
        if (parts[2] === 'background') return json(200, { jobs: [] });
        if (parts[2] === 'runs' && req.method === 'POST') {
          const body = await readBody(req);
          const run = { id: id('run'), sessionId: s.id, waiting: new Map(), steers: [], events: [], results: {}, done: false };
          runs.set(run.id, run);
          s.busy = true;
          s.active_run_id = run.id;
          s.last_used_at = new Date().toISOString();
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          return play(run, res, s, body);
        }
      }
      if (parts[0] === 'runs' && parts[1]) {
        const run = runs.get(parts[1]);
        if (!run) return json(404, { error: { message: 'Run not found.', code: 'run_not_found' } });
        if (parts[2] === 'heartbeat') return json(200, { ok: true });
        if (parts[2] === 'tool_results') {
          const body = await readBody(req);
          const waiting = run.waiting.get(body.call_id);
          if (!waiting) return json(409, { error: { message: 'Not pending.', code: 'call_not_pending' } });
          run.waiting.delete(body.call_id);
          waiting({ output: body.output, is_error: body.is_error });
          return json(200, { ok: true });
        }
        if (parts[2] === 'steer') {
          const body = await readBody(req);
          run.steers.push(body.message);
          return json(200, { ok: true });
        }
        if (parts[2] === 'cancel') {
          run.cancelled = true;
          for (const resolve of run.waiting.values()) resolve({ output: 'cancelled', is_error: true });
          return json(200, { ok: true });
        }
        if (!parts[2]) return json(200, { id: run.id, status: run.done ? 'completed' : 'running', created_at: iso(0) });
      }
      return json(404, { error: { message: `Not in the promo mock: ${req.method} ${p}`, code: 'not_found' } });
    } catch (err) {
      return json(500, { error: { message: err.message } });
    }
  });

  return {
    log,
    sessions,
    runs,
    listen: (port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}/v1`;
      resolve(base);
    })),
    close: () => server.close(),
  };
}

module.exports = { createMock };
