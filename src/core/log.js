'use strict';
// The app's own log: what happened, for the user and for a crash report.
//
// One line per event in <logs>/main.log, the newest file kept under 2 MB and
// three older ones beside it. It records what the app did — runs starting and
// ending, tool names and outcomes, connection trouble, crashes — never what a
// message said, what a file held or what a command printed. Keys and tokens
// are cut out of every line before it is written, since a line can quote an
// error message that quoted a header. No Electron: the CLI can use it too.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;
const MAX_LINE = 4000;

const REDACTIONS = [
  [/cf_sk_[A-Za-z0-9_-]{6,}/g, 'cf_sk_[redacted]'],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '$1-[redacted]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, 'gh_[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[redacted]'],
  [/(authorization|bearer)(["'\s:=]+)[^\s"',;}]+/gi, '$1$2[redacted]'],
  [/((?:api[_-]?key|access[_-]?token|secret|password|passwd|token)["'\s]*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[redacted]'],
];

function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function describe(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function createLog(dir, { echo = false } = {}) {
  const file = path.join(dir, 'main.log');
  let ready = false;

  function rotate() {
    try {
      if (fs.statSync(file).size < MAX_BYTES) return;
    } catch { return; }
    for (let i = KEEP - 1; i >= 1; i--) {
      try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch { /* not there yet */ }
    }
    try { fs.renameSync(file, `${file}.1`); } catch { /* another process has it */ }
  }

  function write(level, parts) {
    const line = redact(`${new Date().toISOString()} ${level.padEnd(5)} ${parts.map(describe).join(' ')}`)
      .replace(/\r?\n/g, '\n    ')
      .slice(0, MAX_LINE);
    if (echo) (level === 'ERROR' ? console.error : console.log)(line);
    try {
      if (!ready) {
        fs.mkdirSync(dir, { recursive: true });
        ready = true;
      }
      rotate();
      fs.appendFileSync(file, `${line}\n`);
    } catch { /* a full or read-only disk must not stop the app */ }
  }

  /** The last `lines` lines of the log, oldest first, for a crash report. */
  function tail(lines = 300) {
    let text = '';
    for (const name of [`${file}.1`, file]) {
      try { text += fs.readFileSync(name, 'utf8'); } catch { /* none */ }
    }
    return text.split('\n').filter(Boolean).slice(-lines).join('\n');
  }

  return {
    dir,
    file,
    info: (...parts) => write('INFO', parts),
    warn: (...parts) => write('WARN', parts),
    error: (...parts) => write('ERROR', parts),
    tail,
  };
}

module.exports = { createLog, redact };
