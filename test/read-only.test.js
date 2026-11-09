'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readOnlyCommand, commandsOf, namesSecret } = require('../src/core/read-only');

const cwd = path.join(os.tmpdir(), 'cf-read-only', 'project');

test('commands that only read inside the folder run without asking', () => {
  for (const command of [
    'ls', 'ls -la src/', 'pwd', 'cat package.json', 'head -n 40 src/app.js', 'tail -n +5 README.md',
    'wc -l src/*.js', 'grep -rn "TODO" src', "grep -rn '/api/v1' src", 'grep -e /api -rn .', 'rg -n useState',
    'rg --files -g "*.ts"', "find . -name '*.test.js' -not -path './node_modules/*'", 'git status',
    'git --no-pager log --oneline -20', 'git diff HEAD~1 -- src', 'git diff main..feature --stat',
    'git show HEAD:src/a.js', 'git log --since="2 weeks ago" --format=%h', 'git blame -L 10,20 src/a.js',
    'git ls-files', 'git rev-parse --abbrev-ref HEAD', 'git branch -a', 'git branch --show-current',
    'git remote -v', 'node --version', 'npm -v', 'python3 --version', 'git --version', 'which node',
    'echo ---', 'cd src && ls', 'git status && git diff', 'ls; cat a.txt', 'grep -c x a || echo none',
    'git log --oneline | head -5', 'grep -rho "import [a-z]*" src | sort | uniq -c | sort -rn',
    'find . -name "*.log" 2>/dev/null', 'ls missing 2>&1', 'cat a.txt >/dev/null', 'ls\n', 'ls\n\n# list\ncat a',
    'cat src/../package.json',
    // Listing names opens nothing, whatever the wildcard.
    'ls .env*', 'find . -name ".env*"', 'wc -l *',
  ]) {
    assert.equal(readOnlyCommand(command, cwd), true, command);
  }
});

test('commands that write, run something else or leave the folder still ask', () => {
  for (const command of [
    // Not on the list, or not as the command.
    'npm test', 'rm a.txt', 'mv a b', 'touch a', 'python a.py', 'node -e "1"', './ls', 'sudo ls',
    'FOO=1 ls', 'xargs cat', 'ls | xargs rm', 'git checkout main', 'git commit -m x', 'git stash',
    'git branch new-feature', 'git remote add origin x', 'git -C ../other status', 'git -c core.pager=x log',
    'git', 'yarn --version', 'npm version patch', '',
    // Writing through a listed command.
    'ls > files.txt', 'cat a >> b', 'sort -o out.txt a', 'sort -ro out.txt a', 'sort --output=out a',
    'uniq a b', 'find . -delete', 'find . -name x -exec rm {} ;', 'find . -fprint out', 'git diff --output=d.patch',
    'git log --ext-diff', 'rg --pre ./run.sh x', 'rg --pre=./run.sh x',
    // Shell features that run or expand into something else.
    'echo $(rm a)', 'echo `rm a`', 'cat "$HOME/a"', 'cat $FILE', 'ls &', '(ls)', 'cat < a', 'diff <(ls) b',
    'cat {..,.}/a', 'ls |& cat', "echo 'unterminated", 'echo "unterminated',
    // Leaving the folder.
    'ls ..', 'cat ../secret.txt', 'cat /etc/passwd', 'ls ~', 'cat ~/.bashrc', 'grep -r x /', 'cd .. && ls',
    'cd', 'cd -', 'grep -f /etc/passwd x', 'grep --file=/etc/passwd x', 'grep -f/etc/passwd x',
    'find / -name x', 'git diff --no-index /etc/hosts a', 'cat src/../../x', 'head --file=~/x',
    // A secret, named as the shell puts it together, or reached by a wildcard.
    'cat .env', 'cat .en""v', "cat .en''v", 'cat .\\env', 'git show HEAD:.env', 'grep --file=.env x',
    'cat .env*', 'cat .en?', 'cat .en[v]', 'head -n 50 .e*', 'cat *.pem', 'tail -f *.key', 'cat id_*',
    'grep KEY .env*', 'grep -r x --include=*.env .', 'cat *', 'sort .npm*', 'cat config/credentials.*',
  ]) {
    assert.equal(readOnlyCommand(command, cwd), false, command);
  }
});

test('a command line is read as bash reads its words', () => {
  assert.deepEqual(commandsOf('grep -rn "a b" src | head -5'), [['grep', '-rn', 'a b', 'src'], ['head', '-5']]);
  assert.deepEqual(commandsOf("echo 'it''s' \"\\$x\" a\\ b"), [['echo', 'its', '$x', 'a b']]);
  assert.deepEqual(commandsOf('ls 2>/dev/null && pwd'), [['ls'], ['pwd']]);
  assert.deepEqual(commandsOf('ls # a comment; rm -rf /'), [['ls']]);
  assert.equal(commandsOf('ls ; ; pwd'), null);
});

test('Git Bash paths name the drive', { skip: process.platform !== 'win32' && 'Windows paths' }, () => {
  const win = 'C:\\work\\app';
  assert.equal(readOnlyCommand('cat /c/work/app/src/a.js', win), true);
  assert.equal(readOnlyCommand('cat /c/Users/me/notes.txt', win), false);
  assert.equal(readOnlyCommand('cat C:/Users/me/notes.txt', win), false);
});

// ── Windows PowerShell ────────────────────────────────────────────────────
// Its paths are Windows paths on every system the tests run on.
const ps = (command, folder = 'C:\\work\\app') => readOnlyCommand(command, folder, 'powershell');

test('PowerShell: commands that only read inside the folder run without asking', () => {
  for (const command of [
    'ls', 'dir', 'Get-ChildItem', 'GET-CHILDITEM SRC', 'Get-ChildItem -Recurse -Filter *.js', 'gci src -File',
    'Get-ChildItem -Path src\\components -Include *.tsx -Recurse', 'Get-ChildItem -ErrorAction SilentlyContinue src',
    'Get-ChildItem node_modules/@types', 'Get-ChildItem *', 'Get-ChildItem -Force -Filter .env*',
    'Get-Content package.json', 'gc src\\app.js -TotalCount 40', 'cat README.md -Tail 20', 'type .\\src\\a.js',
    'Get-Content -Path:src\\a.js', 'Get-Content a.txt, b.txt', "Get-Content 'a b.txt'", 'Get-Content src\\..\\package.json',
    'Get-Content C:\\work\\app\\src\\a.js', 'Get-Content C:/work/app/src/a.js',
    "Select-String -Pattern 'TODO' -Path src\\*.js", 'Select-String TODO src\\*.js', "sls '/api/v1' src\\*.ts",
    'Select-String -Path a.txt -Pattern "/etc/x"', 'Select-String -Pattern:/etc/x a.txt',
    'Get-ChildItem -Recurse -Filter *.js | Select-String -Pattern useState',
    'Get-Content a.txt | Select-String foo | Measure-Object',
    'Get-ChildItem src | Sort-Object Length -Descending | Select-Object -First 5 Name, Length',
    'Get-ChildItem | Where-Object Length -gt 1000 | Format-Table Name, Length -AutoSize',
    'Get-ChildItem -Recurse | Measure-Object -Property Length -Sum', 'Get-Content a.txt | Out-String',
    'Test-Path package.json', 'Resolve-Path src', 'Get-Item src\\a.js', 'Get-Location', 'pwd', 'cd src; ls', 'Set-Location src',
    'git status', 'git --no-pager log --oneline -20', 'git diff HEAD~1 -- src', 'git show HEAD:src/a.js',
    "git log --since='2 weeks ago' --format=%h", 'git branch -a', 'git remote -v', 'Git status',
    'node --version', 'npm -v', 'git --version', 'rg -n useState', 'Write-Output ---', 'echo done', "Write-Output 'it''s'",
    'Get-ChildItem missing 2>$null', 'Get-ChildItem missing 2> $null', 'Get-Content a.txt *>$null', 'git status 2>&1',
    'Get-ChildItem | Out-Null', 'ls; Get-Content a.txt', 'ls\n# list\ncat a.txt', 'ls\r\n',
  ]) {
    assert.equal(ps(command), true, command);
  }
});

test('PowerShell: commands that write, run something else or leave the folder still ask', () => {
  for (const command of [
    // Not on the list, or not as the command.
    'npm test', 'Remove-Item a.txt', 'rm a.txt', 'del a.txt', 'Set-Content a.txt x', 'Out-File a.txt', 'New-Item x',
    'Copy-Item a b', 'mv a b', 'Start-Process notepad', 'Invoke-WebRequest https://x', 'iwr https://x', 'curl https://x',
    'Invoke-Expression ls', 'iex ls', 'Get-ChildItem | ForEach-Object Delete', 'ls | % Delete', 'Get-ChildItem | Remove-Item',
    'Get-Content a.txt | Set-Content b.txt', 'Get-Content a.txt | Tee-Object b.txt', 'Get-Content a.txt | Out-File b.txt',
    'git checkout main', 'git -C ..\\other status', 'git log --ext-diff', 'python a.py', '.\\script.ps1', '. .\\script.ps1',
    'Set-Alias ls Remove-Item', 'Get-Command ls', 'Set-Location -Path src', 'cd -', 'cd', 'Get-Location -PSProvider x', '',
    // Writing through a redirection.
    'ls > files.txt', 'Get-Content a >> b', 'ls 2> err.txt', 'ls *> all.txt', 'ls >$nullx', 'ls >> $null',
    // Shell features that run or expand into something else.
    'Get-Content $env:USERPROFILE\\x', 'Get-Content $HOME\\a', 'echo $(Remove-Item a)', 'Write-Output "$(Remove-Item a)"',
    'Write-Output "a`nb"', 'ls `\n; rm a', '& rm a', '& { rm a }', 'ls & rm a', 'ls && rm a', 'ls || rm a',
    'Get-ChildItem | Where-Object { $_.Length -gt 1 }', 'ls @args', '@(1) | ls', '(ls)', 'ls (rm a)',
    '[IO.File]::Delete("a")', 'Get-ChildItem [a-z]*', 'Get-Content a.txt < b', 'git log --% x', "'Remove-Item' a", '"ls"',
    "echo 'unterminated", 'echo "unterminated', 'ls ; ; pwd',
    // Characters PowerShell reads as quotes, dashes or spaces.
    'Get-Content \u201ca.txt\u201d', 'Get-ChildItem \u2013Recurse', 'ls\u00a0..', 'ls \u2018..\u2019',
    // Leaving the folder.
    'ls ..', 'Get-Content ..\\secret.txt', 'gc ../secret.txt', 'Get-Content C:\\Windows\\win.ini', 'Get-Content D:\\x',
    'Get-Content \\\\server\\share\\x', 'Get-Content //server/share/x', 'Get-ChildItem ~', 'Get-Content ~\\.gitconfig',
    'Get-Content -Path:..\\x', 'Get-Content -Path ..\\x', 'Get-Content a.txt, ..\\b.txt', 'cd ..; ls', 'Get-Content src\\..\\..\\x',
    'Select-String -Path ..\\x foo', 'Select-String foo -Path ..\\x', 'Select-String -Pattern foo ..\\x',
    'Select-String -SimpleMatch ..\\x a.txt', 'git diff ..\\other', 'git diff --no-index C:\\Windows\\win.ini a', 'rg x ..\\',
    'rg --pre run.ps1 x',
    // Other drives than the disk: the environment, the registry, certificates, other servers.
    'Get-ChildItem env:', 'Get-Content env:PATH', 'Get-Item HKLM:\\Software', 'Get-ChildItem Cert:\\', 'Get-Content variable:x',
    'Get-Content function:prompt', 'Get-Content Microsoft.PowerShell.Core\\FileSystem::\\\\server\\share\\x',
    'Get-Content FileSystem::C:\\x', 'Get-Content a.txt:hidden', 'cd env:', 'Get-Content -Path:env:PATH',
    // A secret, named as PowerShell puts it together, or reached by a wildcard or a pipe.
    'Get-Content .env', "gc .en''v", 'gc .en""v', 'Get-Content -Path:.env', 'git show HEAD:.env', 'Get-Content .env*',
    'Get-Content *.pem', 'cat *', 'Select-String KEY .env*', 'Select-String -Path .e* KEY',
    'Get-ChildItem -Force -Filter .env* | Get-Content', 'Get-ChildItem .env* | Select-String KEY',
    'Resolve-Path .en? | Get-Content', 'Get-ChildItem * | Get-Content',
  ]) {
    assert.equal(ps(command), false, command);
  }
});

test('PowerShell: a command line is read as PowerShell reads its words', () => {
  const words = (line) => commandsOf(line, 'powershell');
  assert.deepEqual(words("Select-String 'a b' src | Select-Object -First 5"),
    [['Select-String', 'a b', 'src'], ['Select-Object', '-First', '5']]);
  // '' and "" are one quote; a comma separates words; a backslash is only a backslash.
  assert.deepEqual(words('Write-Output \'it\'\'s\' "say ""hi""" a,b C:\\x\\y .\\env'),
    [['Write-Output', "it's", 'say "hi"', 'a', 'b', 'C:\\x\\y', '.\\env']]);
  assert.deepEqual(words('ls 2>$null; pwd'), [['ls'], ['pwd']]);
  assert.deepEqual(words('ls # a comment; rm -rf /'), [['ls']]);
  assert.equal(words('ls ; ; pwd'), null);
  // The bash reader still reads bash.
  assert.deepEqual(commandsOf('cat .\\env'), [['cat', '.env']]);
});

test('a secret the shell puts together is still a secret', () => {
  for (const [command, shell] of [
    ['cat .en""v', 'bash'], ["cat .en''v", 'bash'], ['cat .\\env', 'bash'], ['git show HEAD:.env', 'bash'],
    ['grep --file=.env x', 'bash'], ["gc .en''v", 'powershell'], ['gc .en""v', 'powershell'],
    ['Get-Content -Path:.env', 'powershell'], ['git show HEAD:.env', 'powershell'],
  ]) {
    assert.equal(namesSecret(command, shell), true, `${shell}: ${command}`);
  }
  for (const [command, shell] of [
    ['cat .env.example', 'bash'], ['cat src/env.js', 'bash'], ['ls', 'bash'],
    // In PowerShell .\env is the file named env.
    ['gc .\\env', 'powershell'], ['Get-ChildItem', 'powershell'],
    // A line neither reader can read is left to the guard, which splits it on its own.
    ['echo $(cat .env)', 'bash'],
  ]) {
    assert.equal(namesSecret(command, shell), false, `${shell}: ${command}`);
  }
});
