// 3.8.10: the preview of «Deshacer» and the plan it takes its decisions from read their files with asynchronous git in batches,
// so the engine keeps answering while a big undo is worked out, and they give the very same plan as the synchronous run.
import { tempHome } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit, undoCheckpoint, undoCheckpointAsync, undoPreviewFiles, newKnown } from '../src/domain/tasks/checkpoints.mjs';

const FILES = 50;

test('50 changed files: the plan and the preview never hold the event loop and equal the synchronous plan', async () => {
  const t = tempHome();
  try {
    const repo = path.join(t.home, 'web', 'big');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    for (let i = 0; i < FILES; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), `one ${i}\ntwo\nthree\n`);
    git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
    const cp = takeCheckpoint(repo, `t-big-${Date.now()}`, path.join(t.home, 'fotos'));
    for (let i = 0; i < FILES; i++) {
      if (i % 10 === 0) fs.rmSync(path.join(repo, `f${i}.txt`));
      else fs.writeFileSync(path.join(repo, `f${i}.txt`), `one ${i}\nchanged\nthree\n`);
    }
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(repo, `new${i}.txt`), 'new\n');
    const end = snapshotCommit(repo, { always: true, message: 'after' });
    const after = { kind: 'git', repo, commit: end.commit, at: Date.now() };

    const sync = undoCheckpoint(cp, after, { dry: true });
    let last = performance.now(); let worst = 0;
    const timer = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 10);
    let plan; let files;
    try {
      const known = newKnown();
      plan = await undoCheckpointAsync(cp, after, { dry: true, known });
      files = await undoPreviewFiles(cp, plan.plan);
      // a second run over the same commits asks git for none of what the commits hold
      assert.ok(known.blobs.size > 0);
      assert.deepEqual((await undoCheckpointAsync(cp, after, { dry: true, known })).plan, plan.plan);
    } finally { clearInterval(timer); }
    assert.deepEqual(plan.plan, sync.plan);
    assert.equal(plan.plan.length, FILES + 5);
    assert.equal(files.filter((f) => f.patch).length, FILES + 5);
    assert.ok(files.find((f) => f.path === 'f1.txt').patch.includes('changed'));
    assert.ok(worst < 100, `the event loop was held ${Math.round(worst)} ms`);
  } finally { t.cleanup(); }
});

test('a file changed after the batch was read and before it is written over is a conflict, not lost', async () => {
  const t = tempHome();
  try {
    const repo = path.join(t.home, 'web', 'race');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(repo, f), `${f} one\n`);
    git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
    const cp = takeCheckpoint(repo, `t-race-${Date.now()}`, path.join(t.home, 'fotos'));
    for (const f of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(repo, f), `${f} agent\n`);
    fs.writeFileSync(path.join(repo, 'new.txt'), 'agent\n');
    fs.rmSync(path.join(repo, 'c.txt'));
    const end = snapshotCommit(repo, { always: true, message: 'after' });
    const after = { kind: 'git', repo, commit: end.commit, at: Date.now() };
    // the person edits a.txt, new.txt and recreates c.txt in the instant between the batch and the write
    const hook = (file) => {
      const name = path.basename(file);
      if (name === 'a.txt' || name === 'new.txt') fs.writeFileSync(file, 'mine\n');
    };
    const out = await undoCheckpointAsync(cp, after, { onBeforeWrite: hook });
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'mine\n');
    assert.equal(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8'), 'mine\n');
    assert.ok(out.skipped.includes('a.txt') && out.skipped.includes('new.txt'));
    assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'b.txt one\n', 'the untouched ones still come back');
    assert.equal(fs.readFileSync(path.join(repo, 'c.txt'), 'utf8'), 'c.txt one\n');
    assert.ok(out.restored.includes('b.txt'));
  } finally { t.cleanup(); }
});
