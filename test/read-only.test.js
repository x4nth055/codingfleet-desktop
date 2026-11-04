'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readOnlyCommand, commandsOf } = require('../src/core/read-only');

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
