'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLog, redact } = require('../src/core/log');

test('keys and tokens never reach the log', () => {
  const cases = [
    ['request failed with Authorization: Bearer cf_sk_abcdefghijklmnop', /cf_sk_abcdef/],
    ['key cf_sk_1234567890abcdef refused', /cf_sk_1234567890/],
    ['openai sk-proj-abcdefghijklmnopqrstuvwxyz', /abcdefghijklmnopqrstu/],
    ['github ghp_abcdefghijklmnopqrstuvwxyz0123', /ghp_abcdefghijklmnop/],
    ['{"api_key": "secret-value-123"}', /secret-value-123/],
    ['password=hunter2 user=me', /hunter2/],
    ['AWS AKIAABCDEFGHIJKLMNOP', /AKIAABCDEFGHIJKLMNOP/],
  ];
  for (const [line, leaked] of cases) {
    assert.doesNotMatch(redact(line), leaked, line);
  }
  assert.equal(redact('run R1 ended: completed in 12s'), 'run R1 ended: completed in 12s');
});

test('the log rotates and the tail reads across files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-log-'));
  const log = createLog(dir);
  log.info('first line');
  log.error(new Error('boom'));
  const text = fs.readFileSync(log.file, 'utf8');
  assert.match(text, /INFO  first line/);
  assert.match(text, /ERROR Error: boom/);
  // A stack trace stays one entry: continuation lines are indented.
  assert.match(text, /\n {4,}at /);

  fs.writeFileSync(log.file, 'x'.repeat(2 * 1024 * 1024 + 10) + '\n');
  log.info('after rotation');
  assert.ok(fs.existsSync(`${log.file}.1`));
  assert.match(fs.readFileSync(log.file, 'utf8'), /after rotation/);
  assert.match(log.tail(5), /after rotation$/);
});

test('a log that cannot be written does not throw', () => {
  const log = createLog(path.join(os.tmpdir(), 'cf-log-\0bad'));
  assert.doesNotThrow(() => log.info('x'));
  assert.equal(log.tail(), '');
});
