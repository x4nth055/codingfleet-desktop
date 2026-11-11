'use strict';
// Commands and paths that once ran without a question although they leave the
// folder, write, or read a secret; and the ordinary ones beside them, which
// must go on running at once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const guard = require('../src/core/guard');
const tools = require('../src/core/tools');
const log = require('../src/core/log');
const computer = require('../src/core/computer');
const page = require('../src/core/browser-page');
const { McpServer } = require('../src/core/mcp');
const { readOnlyCommand } = require('../src/core/read-only');

const cwd = path.join(os.tmpdir(), 'cf-approval-gaps', 'project');
const ps = (command, folder = 'C:\\work\\app') => readOnlyCommand(command, folder, 'powershell');

test('a search whose pattern sits on its option still has its paths checked', () => {
  for (const command of ['grep -e. /etc/passwd', 'grep -re. ../other', 'grep -efoo ../x.txt', 'grep --reg=foo /etc/passwd',
    'grep --regex foo /etc/passwd', 'rg -e. /etc/hosts']) {
    assert.equal(readOnlyCommand(command, cwd), false, command);
  }
  for (const command of ['grep -e foo src', 'grep -rn foo src', 'grep -rne foo src', 'grep -e. src', 'grep --regexp=foo src',
    'grep -Ei "a|b" src', 'rg -e foo src', 'rg --files src']) {
    assert.equal(readOnlyCommand(command, cwd), true, command);
  }
});

test('sort writes through a shortened --output, so that asks', () => {
  for (const command of ['sort --o=package.json README.md', 'sort --outp package.json README.md', 'sort --comp=./x README.md']) {
    assert.equal(readOnlyCommand(command, cwd), false, command);
  }
  for (const command of ['sort README.md', 'sort -r README.md', 'sort --reverse README.md']) {
    assert.equal(readOnlyCommand(command, cwd), true, command);
  }
});

test('git prints a file too: a wildcard that could match a secret asks', () => {
  for (const command of ['git diff --no-index package.json .en?', 'git blame .en?', 'git show HEAD:.env', 'git log -p -- *.pem']) {
    assert.equal(readOnlyCommand(command, cwd), false, command);
  }
  for (const command of ['git diff', 'git diff src/*.js', 'git log --oneline -5', 'git show HEAD:README.md', 'git blame src/a.js']) {
    assert.equal(readOnlyCommand(command, cwd), true, command);
  }
});

test('Git Bash: /c is the whole drive, not the folder', { skip: process.platform !== 'win32' && 'Windows paths' }, () => {
  const win = 'C:\\work\\app';
  for (const command of ['ls /c', 'ls /C', 'find /c -maxdepth 2', 'grep -rI token /c', 'cd /c && ls', 'ls c:']) {
    assert.equal(readOnlyCommand(command, win), false, command);
  }
  assert.equal(readOnlyCommand('ls /c/work/app/src', win), true);
  // A delete after `cd /c` is not a delete inside the folder.
  assert.equal(guard.commandRisk('cd /c && rm -f Users/x/file.txt', { cwd: win, shell: 'bash' }), guard.DESTRUCTIVE);
});

test('PowerShell: a path sent down the pipe to a lister or reader is checked', () => {
  for (const command of ['Write-Output C:\\Windows\\win.ini | Get-Item | Get-Content', 'echo C:\\Users | Get-ChildItem',
    'echo .en? | gi | gc', 'write ..\\other | Get-ChildItem']) {
    assert.equal(ps(command), false, command);
  }
  for (const command of ['Write-Output hello', 'echo hi | Out-Null', 'echo src | Get-ChildItem', 'echo hello | Select-String h',
    'Write-Output done; Get-ChildItem src', 'Get-ChildItem | Sort-Object Name']) {
    assert.equal(ps(command), true, command);
  }
});

test('fs_glob cannot leave the folder through braces', () => {
  for (const pat of ['{..,.}/*', '{../..,x}/**', '{a,..}/*.js']) {
    assert.equal(tools.approvalReason('fs_glob', { pat }, cwd), 'reads outside the project folder', pat);
  }
  for (const pat of ['src/**/*.{js,css}', '**/*.js', '{a,b}/*.js', 'a..b/*.js']) {
    assert.equal(tools.approvalReason('fs_glob', { pat }, cwd), null, pat);
  }
});

test('a stream name after a colon does not hide a secret', () => {
  for (const p of ['.env::$DATA', 'config/id_rsa::$DATA', '.env:stream', 'C:\\proj\\.env::$DATA', 'c:.env']) {
    assert.equal(guard.isSecretPath(p), true, p);
  }
  for (const p of ['README.md::$DATA', 'C:\\proj\\README.md', 'c:notes.txt', '.env.example::$DATA']) {
    assert.equal(guard.isSecretPath(p), false, p);
  }
  assert.equal(tools.approvalReason('fs_read', { path: '.env::$DATA' }, cwd), guard.SECRETS);
});

test('rm -r is seen wherever a command can start, and wherever its option is', () => {
  const where = { cwd, shell: 'bash' };
  for (const command of ['echo hi\nrm -rf ~/projects', ' rm -rf build', '\trm -rf build', 'cd build\nrm -rf *',
    'if [ -d x ]; then rm -rf x; fi', 'for d in a b; do rm -rf "$d"; done', 'rm -v -rf build', 'rm build -rf',
    'find . -name x | xargs -0 rm -rf', 'sudo -E rm -rf /var/x', 'set -e\nrm -rf "$HOME/work"\n']) {
    assert.equal(guard.commandRisk(command, where), guard.DESTRUCTIVE, command);
  }
  // A script is judged line by line too.
  assert.equal(guard.guardReason('execute_code', { command: 'bash clean.sh', code: 'set -e\nrm -rf "$HOME/work"\n' }, where),
    guard.DESTRUCTIVE);
  for (const command of ['rm -f tmp/a.py', 'echo hi\nrm -f tmp/a.py', 'rm tmp/a.py', 'npm run build && rm -f dist/x.map',
    'git rm -r --cached node_modules', 'npm rm -f lodash', 'echo "rm -rf is dangerous"', 'grep -rn "rm -rf" src']) {
    assert.equal(guard.commandRisk(command, where), null, command);
  }
});

test('PowerShell: Remove-Item under its other names, and its parameters cut short', () => {
  const where = { cwd, shell: 'powershell' };
  for (const command of ['del -Recurse -Force C:\\Users\\x\\Documents', 'rd -Recurse -Force .\\src', 'rmdir -Recurse .\\src',
    'Remove-Item .\\src -Rec -Fo', 'ri x -rec', 'erase -r x']) {
    assert.equal(guard.commandRisk(command, where), guard.DESTRUCTIVE, command);
  }
  for (const command of ['Remove-Item -Force a.log', 'Remove-Item a.log -Fo', 'del -Force a.log', 'del a.log', 'Remove-Item a.log',
    'Get-ChildItem -Recurse', 'Format-Table -Force']) {
    assert.equal(guard.commandRisk(command, where), null, command);
  }
});

test('the environment is asked about on any line, and one variable when its name is a secret\'s', () => {
  for (const command of ['echo x\nprintenv', 'echo x\nenv', 'cd src\n  set', 'printenv GITHUB_TOKEN', 'printenv DB_PASSWORD']) {
    assert.equal(guard.commandRisk(command), guard.SECRETS, command);
  }
  for (const command of ['printenv PATH', 'printenv PWD', 'printenv HOME', 'env FOO=1 node a.js', 'set -e\nnpm test', 'echo $PWD']) {
    assert.equal(guard.commandRisk(command), null, command);
  }
});

test('fs_edit keeps CRLF when only the new text has a line break', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-gaps-'));
  fs.writeFileSync(path.join(dir, 'w.js'), 'a();\r\nb();\r\nc();\r\n');
  const result = await tools.executeTool('fs_edit', { path: 'w.js', old: 'b();', new: 'b();\nb2();' }, { cwd: dir });
  assert.equal(result.output, 'File edited.');
  assert.equal(fs.readFileSync(path.join(dir, 'w.js'), 'utf8'), 'a();\r\nb();\r\nb2();\r\nc();\r\n');
  // A file with \n keeps \n.
  fs.writeFileSync(path.join(dir, 'u.js'), 'a();\nb();\n');
  await tools.executeTool('fs_edit', { path: 'u.js', old: 'b();', new: 'b();\nb2();' }, { cwd: dir });
  assert.equal(fs.readFileSync(path.join(dir, 'u.js'), 'utf8'), 'a();\nb();\nb2();\n');
});

test('the log hides the token after Bearer, not the word', () => {
  assert.equal(log.redact('Authorization: Bearer abcdef0123456789abcdef'), 'Authorization: Bearer [redacted]');
  assert.equal(log.redact('authorization=Basic dXNlcjpwYXNz'), 'authorization=Basic [redacted]');
  assert.equal(log.redact('{"authorization":"abc123456789"}'), '{"authorization":"[redacted]"}');
  assert.equal(log.redact('Bearer abcdef0123456789abcdef'), 'Bearer [redacted]');
});

test('cmd+alt+esc is the Stop key where cmd is sent as Ctrl', () => {
  assert.match(computer.parseKeys('cmd+alt+esc', 'win32').error, /stop you/);
  assert.match(computer.parseKeys('command+option+escape', 'linux').error, /stop you/);
  assert.match(computer.parseKeys('cmd+alt+del', 'win32').error, /cannot be sent/);
  // On macOS it is another key (Force Quit), and Control+Option+Esc is the Stop key.
  assert.deepEqual(computer.parseKeys('cmd+alt+esc', 'darwin').combos, [['cmd', 'alt', 'escape']]);
  assert.match(computer.parseKeys('ctrl+alt+esc', 'darwin').error, /stop you/);
});

test('an IPv6 site on the user\'s list is matched', () => {
  assert.equal(page.onSiteList('http://[2001:db8::1]:8080/x', ['2001:db8::1']), true);
  assert.equal(page.onSiteList('http://[2001:db8::2]/x', ['2001:db8::1']), false);
});

test('a local MCP server may print JSON that is not a message', () => {
  const server = new McpServer({ id: 'x', name: 'x', command: 'node', args: [] });
  assert.doesNotThrow(() => server.onData('null\n42\n"text"\n[]\n'));
});
