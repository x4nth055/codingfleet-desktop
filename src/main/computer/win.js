'use strict';
// The Windows backend of the computer tool: one long-lived PowerShell process
// that hosts win-helper.cs. It starts on the first action, is compiled once to
// a DLL kept in the app's data folder (keyed by the source's hash, so an update
// compiles again), and after that answers each request in milliseconds.
//
// No native module: PowerShell 5.1 and the .NET Framework's UI Automation ship
// with every Windows 10 and 11, and the DLL is loaded into PowerShell, which
// Microsoft signs, rather than run as an executable of its own.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const SOURCE = path.join(__dirname, 'win-helper.cs');
// The first start compiles the helper, which takes a few seconds.
const START_TIMEOUT_MS = 45_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const BOOTSTRAP = `
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
if (-not (Test-Path -LiteralPath $env:CF_HELPER_DLL)) {
  $tmp = "$($env:CF_HELPER_DLL).$PID.tmp"
  Add-Type -TypeDefinition ([IO.File]::ReadAllText($env:CF_HELPER_CS)) -OutputAssembly $tmp -OutputType Library \`
    -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions
  try { Move-Item -LiteralPath $tmp -Destination $env:CF_HELPER_DLL -ErrorAction Stop } catch { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions
Add-Type -LiteralPath $env:CF_HELPER_DLL
[CodingFleet.Computer]::Start()
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  [Console]::Out.WriteLine([CodingFleet.Computer]::Handle($line))
}
`;

class WindowsComputer {
  /** @param {{ cacheDir: string, log?: object }} options */
  constructor({ cacheDir, log } = {}) {
    this.cacheDir = cacheDir;
    this.log = log || null;
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  // The helper's source travels inside the app (asar), which PowerShell cannot
  // read: it is copied next to the DLL it compiles into.
  prepare() {
    const source = fs.readFileSync(SOURCE, 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const cs = path.join(this.cacheDir, `win-helper-${hash}.cs`);
    const ps1 = path.join(this.cacheDir, `win-helper-${hash}.ps1`);
    if (!fs.existsSync(cs)) fs.writeFileSync(cs, source, 'utf8');
    if (!fs.existsSync(ps1) || fs.readFileSync(ps1, 'utf8') !== BOOTSTRAP) fs.writeFileSync(ps1, BOOTSTRAP, 'utf8');
    return { cs, ps1, dll: path.join(this.cacheDir, `win-helper-${hash}.dll`) };
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let files;
      try {
        files = this.prepare();
      } catch (err) {
        reject(new Error(`Could not prepare computer control: ${err.message}`));
        return;
      }
      const child = spawn('powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', files.ps1], {
          windowsHide: true,
          env: { ...process.env, CF_HELPER_CS: files.cs, CF_HELPER_DLL: files.dll },
        });
      this.child = child;
      let stderr = '';
      const timer = setTimeout(() => {
        this.stop();
        reject(new Error('Computer control did not start in time.'));
      }, START_TIMEOUT_MS);
      child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d.toString('utf8'); });
      child.on('error', (err) => {
        clearTimeout(timer);
        this.fail(new Error(`Could not start PowerShell: ${err.message}`));
        reject(new Error(`Could not start PowerShell: ${err.message}`));
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        const message = stderr.trim().split(/\r?\n/).slice(0, 6).join(' ') || `exit code ${code}`;
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
        this.fail(new Error(`Computer control stopped: ${message}`));
        reject(new Error(`Computer control could not start: ${message}`));
      });
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.ready) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.ok) waiting.resolve(message.result);
        else waiting.reject(new Error(message.error || 'The action failed.'));
      });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  fail(err) {
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(err);
      this.pending.delete(id);
    }
  }

  async request(op, args = {}, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
    await this.start();
    const child = this.child;
    if (!child) throw new Error('Computer control is not running.');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // A request that never answers (UI Automation stuck on a hung app)
      // takes the helper down with it; the next action starts a fresh one.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${op} took longer than ${Math.round(timeout / 1000)} seconds, so it was stopped.`));
        this.stop();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...args, id, op })}\n`);
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child) {
      try { child.stdin.end(); } catch { /* gone */ }
      try { child.kill(); } catch { /* gone */ }
    }
    this.fail(new Error('Computer control was stopped.'));
  }

  // ── The backend contract (see computer/index.js) ───────────────────────────
  move(x, y) { return this.request('move', { x, y }); }
  click(x, y, button, count) { return this.request('click', { x, y, button, count }); }
  drag(path) { return this.request('drag', { path }); }
  scroll(x, y, dx, dy) { return this.request('scroll', { x, y, dx, dy }); }
  type(text) { return this.request('type', { text }, { timeout: 15_000 + text.length * 20 }); }
  keys(combos) { return this.request('keys', { combos }); }
  cursor() { return this.request('cursor'); }
  foreground() { return this.request('foreground'); }
  windows() { return this.request('windows'); }
  focus(hwnd) { return this.request('focus', { hwnd }); }
  elements(hwnd) { return this.request('elements', { hwnd: hwnd || null }, { timeout: 20_000 }); }
}

module.exports = { WindowsComputer };
