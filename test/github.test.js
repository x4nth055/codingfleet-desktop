'use strict';
// Which remotes count as a GitHub repository for the pull-request pill.
const test = require('node:test');
const assert = require('node:assert');

const { parseRemote, deviceCode } = require('../src/main/github');

test('deviceCode finds the sign-in code in what every gh version prints', () => {
  // gh 2.100 and later
  assert.strictEqual(deviceCode('\n! One-time code (B718-6900) copied to clipboard\n'
    + 'Open this URL to continue in your web browser: https://github.com/login/device\n'), 'B718-6900');
  // gh before 2.100
  assert.strictEqual(deviceCode('! First copy your one-time code: 3F2A-9C1D\n'
    + 'Open this URL to continue in your web browser: https://github.com/login/device\n'), '3F2A-9C1D');
  assert.strictEqual(deviceCode('Open this URL to continue in your web browser: https://github.com/login/device\n'), null);
  assert.strictEqual(deviceCode(''), null);
});

test('parseRemote reads the owner and name from every URL shape git uses', () => {
  const want = { owner: 'x4nth055', name: 'codingfleet-desktop' };
  for (const url of [
    'https://github.com/x4nth055/codingfleet-desktop.git',
    'https://github.com/x4nth055/codingfleet-desktop',
    'https://github.com/x4nth055/codingfleet-desktop/',
    'https://token@github.com/x4nth055/codingfleet-desktop.git',
    'git@github.com:x4nth055/codingfleet-desktop.git',
    'ssh://git@github.com/x4nth055/codingfleet-desktop.git',
    'HTTPS://GitHub.com/x4nth055/codingfleet-desktop.git',
  ]) {
    assert.deepStrictEqual(parseRemote(url), want, url);
  }
});

test('parseRemote keeps dots in a repository name', () => {
  assert.deepStrictEqual(parseRemote('https://github.com/owner/my.site.git'), { owner: 'owner', name: 'my.site' });
});

test('parseRemote says no to other hosts and to nonsense', () => {
  for (const url of [
    'https://gitlab.com/owner/repo.git',
    'git@bitbucket.org:owner/repo.git',
    'https://github.com.evil.example/owner/repo.git',
    'https://github.com/owner',
    '/home/me/repos/thing.git',
    '',
    null,
  ]) {
    assert.strictEqual(parseRemote(url), null, String(url));
  }
});

const { reviewPrompt, createPrompt } = require('../src/renderer/lib/pr-prompts');
const repo = { slug: 'acme/app', remote: 'origin' };
const pr = { number: 42, title: 'Fix the login', url: 'https://github.com/acme/app/pull/42' };

test('reviewPrompt reads the PR with gh, changes nothing, and posts nothing unasked', () => {
  const text = reviewPrompt(repo, pr);
  assert.match(text, /^Review pull request #42 \("Fix the login"\) in acme\/app: https:\/\/github\.com\/acme\/app\/pull\/42/);
  assert.match(text, /`gh pr view 42 --repo acme\/app --comments`/);
  assert.match(text, /`gh pr diff 42 --repo acme\/app`/);
  assert.match(text, /Do not check out the branch or change any files/);
  assert.match(text, /Do not post anything until I say so/);
});

test('reviewPrompt for your own PR offers fixes instead of posting', () => {
  const text = reviewPrompt(repo, pr, { own: true });
  assert.match(text, /^Look over my pull request #42/);
  assert.match(text, /offer to fix/);
  assert.doesNotMatch(text, /gh pr review/);
});

test('createPrompt: a branch first when on the base, then commit, push, gh pr create', () => {
  const text = createPrompt(repo, { base: 'main', onBase: true });
  assert.match(text, /into main\./);
  assert.match(text, /1\. I am on main: first create a new branch/);
  assert.match(text, /`git push -u origin HEAD`/);
  assert.match(text, /`gh pr create --repo acme\/app --base main --title/);
  assert.doesNotMatch(text, /--head/);
  assert.doesNotMatch(createPrompt(repo, { base: 'main' }), /create a new branch/);
});

test('createPrompt in a fork pushes to origin and opens the PR upstream', () => {
  const text = createPrompt({ slug: 'cli/cli', remote: 'upstream' }, { base: 'trunk' });
  assert.match(text, /Push the branch to my fork: `git push -u origin HEAD`/);
  assert.match(text, /gh pr create --repo cli\/cli --base trunk --head <my user>:<branch>/);
});
