'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RecoveryStore } = require('../src/core/recovery-store');

test('a restart retains uncertain tool state and completed undo copies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-recovery-'));
  try {
    const file = path.join(dir, 'run-recovery.json');
    const first = new RecoveryStore(file);
    first.start('session', dir);
    first.setRunId('session', 'run');
    first.setCall('session', 'call', { state: 'executing' });
    first.setChange('session', path.join(dir, 'edited.txt'), {
      before: { exists: true, text: 'before' }, after: { exists: true, text: 'after' },
    });
    const reopened = new RecoveryStore(file);
    assert.equal(reopened.active('session').runId, 'run');
    assert.equal(reopened.call('session', 'call').state, 'executing');
    reopened.finish('session', 'run', Object.entries(reopened.active('session').changes)
      .map(([name, change]) => ({ path: name, ...change })));
    const later = new RecoveryStore(file);
    assert.equal(later.active('session'), null);
    assert.equal(later.data.undo.run.files[0].before.text, 'before');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
