'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const memory = require('../src/core/project-memory');
const { MemoryJobs, runJob, prepareProject, existing } = require('../src/core/memory-jobs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-memory-jobs-')));
const APP = { enabled: true, location: 'app', customDir: '', left: [] };

// Projects with notes in the app's own folder: [{ cwd, dir }].
function projects(appDir, count, entries = 2) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const cwd = path.join(tmp(), `project-${i}`);
    fs.mkdirSync(cwd);
    const dir = memory.memoryDir(cwd, { appDir });
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0; n < entries; n += 1) fs.writeFileSync(path.join(dir, `note-${n}.md`), `Note ${n} of project ${i}\n`);
    memory.syncIndex(dir);
    out.push({ cwd, dir });
  }
  return out;
}

test('the folders that are gone, and a folder named twice, are left out', () => {
  const here = tmp();
  const other = process.platform === 'win32' ? here.toUpperCase() : here;
  assert.deepEqual(existing([here, other, path.join(here, 'gone'), '', null, 7]), [here]);
});

test('a change of place moves the notes of every project, and says what Preferences shows', () => {
  const appDir = tmp();
  const custom = tmp();
  const all = projects(appDir, 3);
  const next = { enabled: true, location: 'custom', customDir: custom, left: [{ location: 'app', customDir: '' }] };
  const done = runJob({
    type: 'set', cwds: [...all.map((p) => p.cwd), path.join(appDir, 'gone')], before: APP, next, appDir,
    move: true, current: all[1].cwd,
  });
  assert.equal(done.moved, 6);
  assert.equal(done.failed, 0);
  assert.deepEqual(done.errors, []);
  assert.equal(done.projects.length, 3);
  for (const [i, project] of done.projects.entries()) {
    assert.equal(project.cwd, all[i].cwd);
    assert.equal(project.dir, path.join(custom, memory.folderKey(all[i].cwd)));
    assert.equal(project.entries, 2);
    assert.deepEqual(fs.readdirSync(project.dir).sort(), ['MEMORY.md', 'note-0.md', 'note-1.md']);
    assert.ok(!fs.existsSync(all[i].dir), 'nothing stays at the old place');
  }
  assert.deepEqual(done.current.entries.map((entry) => [entry.name, entry.description]),
    [['note-0', 'Note 0 of project 1'], ['note-1', 'Note 1 of project 1']]);
});

test('with memory off nothing is made, moved or listed', () => {
  const appDir = tmp();
  const [project] = projects(appDir, 1);
  const off = { ...APP, enabled: false };
  const done = runJob({ type: 'set', cwds: [project.cwd], before: APP, next: off, appDir, move: false, current: project.cwd });
  assert.deepEqual({ moved: done.moved, current: done.current, projects: done.projects }, { moved: 0, current: null, projects: [] });
  assert.ok(fs.existsSync(path.join(project.dir, 'note-0.md')));
});

test('a project gets its folder and index, and the notes it left at an earlier place', () => {
  const appDir = tmp();
  const custom = tmp();
  const [project] = projects(appDir, 1);
  const settings = { enabled: true, location: 'custom', customDir: custom, left: [{ location: 'app', customDir: '' }] };
  const prepared = prepareProject(project.cwd, settings, appDir);
  assert.equal(prepared.dir, path.join(custom, memory.folderKey(project.cwd)));
  assert.match(prepared.index, /- \[note-0\]\(note-0\.md\): Note 0 of project 0/);
  assert.ok(!fs.existsSync(project.dir));
  // A project with no notes: the job makes an empty index for it.
  const empty = path.join(tmp(), 'empty');
  fs.mkdirSync(empty);
  assert.deepEqual(runJob({ type: 'prepare', cwds: [empty], settings, appDir }), { errors: [] });
  assert.ok(fs.existsSync(path.join(custom, memory.folderKey(empty), 'MEMORY.md')));
});

test('the thread gives the same answers, in the order the jobs were given', async () => {
  const appDir = tmp();
  const custom = tmp();
  const all = projects(appDir, 4);
  const cwds = all.map((p) => p.cwd);
  const there = { enabled: true, location: 'custom', customDir: custom, left: [{ location: 'app', customDir: '' }] };
  const back = { ...APP, left: [{ location: 'custom', customDir: custom }] };
  const jobs = new MemoryJobs();
  try {
    // Sent together: the second must find what the first moved.
    const [first, second, view] = await Promise.all([
      jobs.run({ type: 'set', cwds, before: APP, next: there, appDir, move: true }),
      jobs.run({ type: 'set', cwds, before: there, next: back, appDir, move: true }),
      jobs.run({ type: 'view', cwds, settings: back, appDir, current: cwds[0] }),
    ]);
    assert.ok(jobs.threaded, 'the thread ran them');
    assert.equal(first.moved, 8);
    assert.equal(second.moved, 8);
    assert.equal(view.projects.reduce((sum, project) => sum + project.entries, 0), 8);
    assert.equal(view.current.dir, all[0].dir);
    assert.ok(fs.existsSync(path.join(all[3].dir, 'note-1.md')));
    await assert.rejects(jobs.run({ type: 'no such job' }), /Unknown project memory job/);
    // The thread goes on after a job that failed.
    assert.equal((await jobs.run({ type: 'view', cwds, settings: back, appDir })).projects.length, 4);
  } finally {
    jobs.close();
  }
});

test('a thread that cannot start: the jobs run here, and none is lost', async () => {
  const appDir = tmp();
  const [project] = projects(appDir, 1);
  const warnings = [];
  const jobs = new MemoryJobs({ warn: (message) => warnings.push(message), workerFile: path.join(appDir, 'no-such-worker.js') });
  const job = { type: 'view', cwds: [project.cwd], settings: APP, appDir };
  const answers = await Promise.all([jobs.run(job), jobs.run(job)]);
  assert.deepEqual(answers.map((answer) => answer.projects[0].entries), [2, 2]);
  assert.equal(jobs.threaded, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /the work runs in the app itself/);
  assert.equal((await jobs.run(job)).projects.length, 1);
});

test('a note of the same name on another drive is copied when it cannot be renamed', () => {
  // A rename that fails (as it does across drives) falls back to a copy.
  const from = path.join(tmp(), 'memory');
  const to = path.join(tmp(), 'memory');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'build.md'), 'How it is built\n');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }); };
  try {
    assert.equal(memory.moveMemory(from, to), 1);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(fs.readFileSync(path.join(to, 'build.md'), 'utf8'), 'How it is built\n');
  assert.ok(!fs.existsSync(from));
});
