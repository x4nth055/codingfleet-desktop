// Live end-to-end test of the pull-request buttons: a real model gets the very
// prompt a button writes and works through it on this computer with the
// GitHub CLI. Nothing reaches GitHub but reads: every command is checked
// before it runs, and pushing, posting a review or opening a PR is declined
// (and recorded, so the test can see the agent tried the right thing).
//   CODINGFLEET_API_KEY=cf_sk_... npm run e2e:github
//   E2E_MODEL=... to pick the model. Needs `gh`, signed in.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../src/core/api.js');
const { Run } = require('../src/core/runner.js');
const tools = require('../src/core/tools.js');
const { reviewPrompt, createPrompt } = require('../src/renderer/lib/pr-prompts.js');

assert.ok(process.env.CODINGFLEET_API_KEY, 'Set CODINGFLEET_API_KEY.');
const MODEL = process.env.E2E_MODEL || 'deepseek-v4-flash-instant';
const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ── What may run ───────────────────────────────────────────────────────────
// Reads only. Anything that would change GitHub is declined and recorded.
const PUBLISH = /\bgit\s+push\b|\bgh\s+(pr\s+(review|comment|merge|close|edit|create|ready|reopen)|issue\s|release\s|repo\s+(create|edit|delete|fork))|\bgh\s+api\b[^|;&]*(-X|--method|\s-f\s|\s-F\s|--field|--raw-field|--input)/i;
const READ_COMMAND = /^\s*(cd\s+\S+\s*&&\s*)?(gh\s+(pr\s+(view|diff|checks|list|status)|repo\s+view|api\s)|git\s+(log|show|diff|status|rev-parse|ls-files|blame|branch(\s+--show-current|\s*$)|remote)|ls|cat|head|tail|grep|rg|find|wc|sed\s+-n|echo|pwd|type|Get-Content|Select-String)\b/i;

function policy({ allowLocalGit = false } = {}) {
  const seen = { commands: [], blocked: [], writes: [] };
  const approve = (call) => {
    const args = call.arguments || {};
    if (call.name === 'run_command' || call.name === 'execute_code') {
      const command = String(args.command || args.code || '');
      seen.commands.push(command);
      if (PUBLISH.test(command)) { seen.blocked.push(command); return 'deny'; }
      if (READ_COMMAND.test(command)) return 'allow';
      if (allowLocalGit && /^\s*(cd\s+\S+\s*&&\s*)?git\s+(checkout\s+-b|switch\s+-c|add|commit|branch\s+\S+|status|diff|log)\b/i.test(command)) return 'allow';
      seen.blocked.push(command);
      return 'deny';
    }
    if (/^fs_(write|edit|delete|move)/.test(call.name)) {
      seen.writes.push(`${call.name} ${args.path || ''}`);
      return 'deny';
    }
    return 'allow';
  };
  return { seen, approve };
}

async function runTurn(sessionId, cwd, message, approve) {
  const events = [];
  let text = '';
  const run = new Run({
    sessionId,
    cwd,
    approve,
    onEvent: (event, data) => {
      events.push({ event, data });
      if (event === 'text.delta') text += data.text;
    },
  });
  await run.start({ message, model: MODEL });
  return { events, text, of: (name) => events.filter((e) => e.event === name).map((e) => e.data) };
}

const newSession = (cwd) => api.createSession({
  executor: 'client',
  model: MODEL,
  system_message: `You are a coding agent working on the user's computer. Working directory: ${cwd}. `
    + `Shell: ${tools.SHELL.name}. The GitHub CLI (gh) is installed and signed in. Use relative paths.`,
  capabilities: { code_execution: true },
});

console.log(`api: ${api.API_BASE}\nshell: ${tools.SHELL.name}\nmodel: ${MODEL}\n`);

// ── Review: a real open pull request on a public repository ────────────────
{
  const slug = 'cli/cli';
  const open = JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '50',
    '--json', 'number,title,url,isDraft,additions,deletions']));
  // A small one, so the review is quick and the diff fits in one read.
  const pr = open.filter((p) => !p.isDraft && p.additions + p.deletions > 0)
    .sort((a, b) => (a.additions + a.deletions) - (b.additions + b.deletions))[0];
  check('found an open PR to review', pr, pr && `#${pr.number} ${pr.title} (+${pr.additions} −${pr.deletions})`);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-e2e-review-'));
  sh('git', ['init', '-q'], cwd);
  sh('git', ['remote', 'add', 'origin', `https://github.com/${slug}.git`], cwd);
  const session = await newSession(cwd);
  const { seen, approve } = policy();
  const turn = await runTurn(session.id, cwd, reviewPrompt({ slug, remote: 'origin' }, pr), approve);

  const ran = seen.commands.join('\n');
  check('the agent read the diff with gh pr diff', new RegExp(`gh\\s+pr\\s+diff\\s+${pr.number}`).test(ran), seen.commands.slice(0, 6).join(' | '));
  check('the agent read the description with gh pr view', new RegExp(`gh\\s+pr\\s+view\\s+${pr.number}`).test(ran));
  check('the agent tried to post nothing', !seen.blocked.some((c) => PUBLISH.test(c)), seen.blocked.join(' | '));
  check('the agent changed no files', seen.writes.length === 0, seen.writes.join(' | '));
  check('the agent reported findings', turn.text.trim().length > 200, `${turn.text.trim().length} characters`);
  check('the agent asks before posting a review', /post|submit|gh pr review/i.test(turn.text.slice(-800)), turn.text.trim().slice(-200).replace(/\s+/g, ' '));
  check('the run completed', turn.of('run.ended')[0]?.reason === 'completed', JSON.stringify(turn.of('run.ended')[0]));
  console.log(`\nreview session: ${session.id}\n`);
}

// ── Create: a local repository, pushed and opened nowhere ──────────────────
{
  // A repository name that does not exist: even a push that slipped through
  // could not land anywhere.
  const slug = 'x4nth055/cf-e2e-no-such-repo';
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-e2e-create-'));
  sh('git', ['init', '-q', '-b', 'main'], cwd);
  sh('git', ['config', 'user.email', 'e2e@example.com'], cwd);
  sh('git', ['config', 'user.name', 'E2E'], cwd);
  fs.writeFileSync(path.join(cwd, 'app.js'), 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
  sh('git', ['add', '.'], cwd);
  sh('git', ['commit', '-q', '-m', 'Initial commit'], cwd);
  sh('git', ['remote', 'add', 'origin', `https://github.com/${slug}.git`], cwd);
  // The work: a real change, plus a secret that must stay out of the commit.
  fs.writeFileSync(path.join(cwd, 'app.js'), 'function add(a, b) {\n  return a + b;\n}\n\nfunction subtract(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add, subtract };\n');
  fs.writeFileSync(path.join(cwd, '.env'), 'API_TOKEN=do-not-commit-me\n');

  const session = await newSession(cwd);
  const { seen, approve } = policy({ allowLocalGit: true });
  const turn = await runTurn(session.id, cwd, createPrompt({ slug, remote: 'origin' }, { base: 'main', onBase: true }), approve);

  const branch = sh('git', ['branch', '--show-current'], cwd);
  check('the agent made a new branch', branch && branch !== 'main', branch);
  const log = sh('git', ['log', '--format=%s', 'main..HEAD'], cwd);
  check('the agent committed the change', log.length > 0, log.split('\n')[0]);
  const committed = log ? sh('git', ['show', '--name-only', '--format=', 'main..HEAD'], cwd) : '';
  check('the change is in the commit', /app\.js/.test(committed), committed.replace(/\n/g, ' '));
  check('the secret stayed out of the commit', !/\.env/.test(committed));
  check('the agent pushed the branch (declined here)', seen.blocked.some((c) => /git\s+push\b[^|;&]*\borigin\b/.test(c)), seen.blocked.join(' | '));
  const create = seen.blocked.find((c) => /gh\s+pr\s+create/.test(c)) || '';
  check('the agent ran gh pr create for this repo and base (declined here)',
    create.includes(`--repo ${slug}`) && /--base\s+main/.test(create) && /--title/.test(create) && /--body/.test(create), create.slice(0, 200));
  check('the agent said what it left out', /\.env|secret/i.test(turn.text), turn.text.trim().slice(0, 160).replace(/\s+/g, ' '));
  check('the run completed', turn.of('run.ended')[0]?.reason === 'completed', JSON.stringify(turn.of('run.ended')[0]));
  console.log(`\ncreate session: ${session.id}`);
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
