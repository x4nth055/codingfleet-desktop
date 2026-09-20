'use strict';
// Local MCP servers: programs on this computer that speak the Model Context
// Protocol over stdio. The app starts the ones the user turned on, lists their
// tools, declares them for each run as client tools, and runs a call when the
// model makes one. Shared by the desktop app and the CLI: no Electron here.
const { spawn } = require('child_process');
const crypto = require('crypto');

const PROTOCOL_VERSION = '2025-06-18';
const START_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_TOOLS = 64;
const MAX_NAME = 64;
const MAX_OUTPUT_CHARS = 200_000;
const STDERR_KEEP = 2000;

// A Windows command such as npx is a .cmd file, which only a shell can start.
const needsShell = (command) => process.platform === 'win32' && !/\.(exe|com)$/i.test(command);
const quoteForCmd = (arg) => (/^[\w./:=@+-]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '""')}"`);

class McpServer {
  constructor({ id, name, command, args, env, cwd }) {
    this.id = id;
    this.name = name;
    this.command = command;
    this.args = args || [];
    this.env = env || {};
    this.cwd = cwd || undefined;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.tools = [];
    this.error = null;
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = this.boot().catch((err) => {
      this.error = err.message;
      this.stop();
      throw err;
    });
    return this.ready;
  }

  async boot() {
    const shell = needsShell(this.command);
    const args = shell ? this.args.map(quoteForCmd) : this.args;
    const command = shell ? quoteForCmd(this.command) : this.command;
    this.child = spawn(command, args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_KEEP);
    });
    const exited = new Promise((_, reject) => {
      this.child.once('error', (err) => reject(new Error(`${this.name} could not start: ${err.message}`)));
      this.child.once('exit', (code) => {
        const detail = this.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        const err = new Error(`${this.name} stopped (exit code ${code})${detail ? `: ${detail}` : ''}`);
        this.failAll(err);
        this.child = null;
        this.ready = null;
        reject(err);
      });
    });
    exited.catch(() => {});
    const handshake = (async () => {
      await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'CodingFleet Desktop', version: '0.1.0' },
      }, START_TIMEOUT_MS);
      this.notify('notifications/initialized', {});
      const tools = [];
      let cursor;
      do {
        const page = await this.request('tools/list', cursor ? { cursor } : {}, START_TIMEOUT_MS);
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor && tools.length < MAX_TOOLS);
      this.tools = tools.slice(0, MAX_TOOLS);
      this.error = null;
      return this.tools;
    })();
    return Promise.race([handshake, exited]);
  }

  onData(chunk) {
    this.buffer += chunk;
    let cut;
    while ((cut = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      this.onMessage(message);
    }
  }

  onMessage(message) {
    if (message.id !== undefined && message.method) {
      // A request from the server. Answer the few that matter; refuse the rest.
      if (message.method === 'ping') this.write({ jsonrpc: '2.0', id: message.id, result: {} });
      else if (message.method === 'roots/list') this.write({ jsonrpc: '2.0', id: message.id, result: { roots: [] } });
      else this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not supported' } });
      return;
    }
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error.message || 'The MCP server returned an error.'));
    else waiting.resolve(message.result || {});
  }

  write(message) {
    if (!this.child) throw new Error(`${this.name} is not running.`);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  request(method, params, timeout, signal) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} did not answer ${method} in ${Math.round(timeout / 1000)} seconds.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      if (signal) {
        signal.addEventListener('abort', () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          clearTimeout(timer);
          try { this.notify('notifications/cancelled', { requestId: id }); } catch { /* gone */ }
          reject(new Error('Cancelled.'));
        }, { once: true });
      }
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  failAll(err) {
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(err);
    }
    this.pending.clear();
  }

  async call(tool, args, signal) {
    await this.start();
    const result = await this.request('tools/call', { name: tool, arguments: args || {} }, CALL_TIMEOUT_MS, signal);
    return toOutput(result);
  }

  stop() {
    this.failAll(new Error(`${this.name} was stopped.`));
    if (this.child) {
      try { this.child.kill(); } catch { /* already gone */ }
    }
    this.child = null;
    this.ready = null;
  }
}

// What the model gets back: the text parts, joined. Other parts are named.
function toOutput(result) {
  const parts = [];
  for (const item of result.content || []) {
    if (item.type === 'text') parts.push(item.text);
    else if (item.type === 'resource' && item.resource && typeof item.resource.text === 'string') {
      parts.push(item.resource.text);
    } else parts.push(`[${item.type} content omitted]`);
  }
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  let output = parts.join('\n');
  if (output.length > MAX_OUTPUT_CHARS) output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n[output cut]`;
  return { output, is_error: Boolean(result.isError) };
}

const slug = (text) => String(text || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

// local_<server>_<tool>, within the API's 64 characters, and unique.
function toolName(serverName, toolNameRaw, taken) {
  let name = `local_${slug(serverName)}_${slug(toolNameRaw)}`;
  if (name.length > MAX_NAME || taken.has(name)) {
    const hash = crypto.createHash('sha1').update(`${serverName}/${toolNameRaw}`).digest('hex').slice(0, 6);
    name = `${name.slice(0, MAX_NAME - 7)}_${hash}`;
  }
  taken.add(name);
  return name;
}

/**
 * The user's local servers, started on demand and kept running.
 * configs: [{ id, name, command, args, env, enabled }]
 */
class LocalMcp {
  constructor() {
    this.servers = new Map(); // id -> { server, key }
  }

  configure(configs) {
    const wanted = new Map();
    for (const config of configs || []) {
      if (!config.enabled || !config.command) continue;
      wanted.set(config.id, { config, key: JSON.stringify([config.name, config.command, config.args, config.env]) });
    }
    for (const [id, entry] of this.servers) {
      const next = wanted.get(id);
      if (!next || next.key !== entry.key) {
        entry.server.stop();
        this.servers.delete(id);
      }
    }
    for (const [id, { config, key }] of wanted) {
      if (!this.servers.has(id)) this.servers.set(id, { server: new McpServer(config), key });
    }
  }

  /** Start every enabled server; returns [{ id, name, tools, error }]. */
  async status() {
    const out = [];
    await Promise.all([...this.servers.values()].map(async ({ server }) => {
      try {
        await server.start();
      } catch { /* kept in server.error */ }
      out.push({ id: server.id, name: server.name, tools: server.tools.map((t) => t.name), error: server.error });
    }));
    return out;
  }

  /** The tools to declare for a run, and how to find each one again. */
  async toolsForRun() {
    await this.status();
    const declared = [];
    const routes = new Map();
    const taken = new Set();
    for (const { server } of this.servers.values()) {
      if (server.error) continue;
      for (const tool of server.tools) {
        if (declared.length >= MAX_TOOLS) break;
        const name = toolName(server.name, tool.name, taken);
        const schema = tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema : { type: 'object', properties: {} };
        declared.push({
          name,
          description: `${tool.description || tool.name} (local MCP server "${server.name}")`.slice(0, 2000),
          input_schema: schema,
        });
        routes.set(name, { server, tool: tool.name, label: `${server.name} · ${tool.name}` });
      }
    }
    return { declared, routes };
  }

  stopAll() {
    for (const { server } of this.servers.values()) server.stop();
    this.servers.clear();
  }
}

module.exports = { LocalMcp, McpServer, toolName, toOutput };
