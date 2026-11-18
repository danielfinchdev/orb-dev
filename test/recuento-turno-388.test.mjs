// 3.8.8 paso 5G: el recuento ligero de un turno (statBetween / sessions.turnDiff {stat:true}) da los mismos números que el
// parche de diffBetween, sin sacar el parche, y no escribe nada en el repositorio.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit, diffBetween, statBetween, statBetweenAsync, undoCheckpoint } from '../src/domain/tasks/checkpoints.mjs';
import { turnDiff } from '../src/domain/conversations/turns.mjs';
import { METHODS } from '../src/domain/security/permissions.mjs';

let t; let repo;
before(() => {
  t = tempHome();
  repo = path.join(t.home, 'web', 'recuento'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'gone.txt'), 'bye\nbye\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
});
after(() => t.cleanup());

// every ref, HEAD, the index file itself and the object count: what a read must leave alone (no git status: it may refresh the index)
const gitDir = () => path.join(repo, '.git');
const state = () => [git(repo, 'rev-parse', 'HEAD').stdout, git(repo, 'for-each-ref').stdout, git(repo, 'count-objects', '-v').stdout, fs.readFileSync(path.join(gitDir(), 'HEAD'), 'utf8'), fs.readFileSync(path.join(gitDir(), 'index')).toString('hex'), String(fs.existsSync(path.join(gitDir(), 'index.lock')))].join('\n--\n');
const plusMinus = (patch) => { let a = 0; let r = 0; for (const l of patch.split('\n')) { if (l.startsWith('+++') || l.startsWith('---')) continue; if (l.startsWith('+')) a += 1; else if (l.startsWith('-')) r += 1; } return [a, r]; };

test('statBetween: mismos números que el parche de diffBetween (añadido, cambiado, borrado, binario) y no escribe', async () => {
  const cp = takeCheckpoint(repo, `t-stat-${Date.now()}`, path.join(t.home, 'fotos'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n2\nthree\nfour\n');
  fs.writeFileSync(path.join(repo, 'new file.txt'), 'hello\nworld\nagain\n');
  fs.writeFileSync(path.join(repo, 'pic.bin'), Buffer.from([0, 1, 2, 0, 255]));
  fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=secret\n');
  fs.rmSync(path.join(repo, 'gone.txt'));
  const end = snapshotCommit(repo, { always: true, message: 'after' });
  const was = state();
  const full = diffBetween(repo, cp.commit, end.commit);
  const sync = statBetween(repo, cp.commit, end.commit);
  const lazy = await statBetweenAsync(repo, cp.commit, end.commit);
  assert.equal(state(), was, 'nothing written');
  assert.deepEqual(lazy, sync);
  assert.deepEqual(sync.files.map((f) => f.path).sort(), ['a.txt', 'gone.txt', 'new file.txt', 'pic.bin']);
  assert.equal(sync.more, 0);
  for (const f of full.files) {
    const s = sync.files.find((x) => x.path === f.path);
    assert.ok(s, f.path); assert.equal(s.status, f.status, f.path); assert.equal(Boolean(s.binary), Boolean(f.binary), f.path);
    assert.equal(s.added, f.added, f.path); assert.equal(s.removed, f.removed, f.path);
    if (!f.binary) assert.deepEqual([s.added, s.removed], plusMinus(f.patch), `${f.path} against the patch lines`);
    assert.ok(!('patch' in s));
  }
  const by = Object.fromEntries(sync.files.map((f) => [f.path, f]));
  assert.deepEqual([by['new file.txt'].status, by['new file.txt'].added, by['new file.txt'].removed], ['A', 3, 0]);
  assert.deepEqual([by['gone.txt'].status, by['gone.txt'].added, by['gone.txt'].removed], ['D', 0, 2]);
  assert.equal(by['pic.bin'].binary, true);
  assert.equal(statBetween(repo, cp.commit, end.commit, { maxFiles: 2 }).more, 2);
  undoCheckpoint(cp, end);
});

test('un .env que sí está en los commits no sale en el recuento (ni su nombre), y leer no toca índice ni refs', async () => {
  const dir = path.join(t.home, 'web', 'secretos'); fs.mkdirSync(dir, { recursive: true });
  const run = (...a) => git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a);
  git(dir, 'init', '-q'); fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); run('add', '-A'); run('commit', '-q', '-m', 'one');
  const first = git(dir, 'rev-parse', 'HEAD').stdout.trim();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=secret\n');
  fs.mkdirSync(path.join(dir, 'sub')); fs.writeFileSync(path.join(dir, 'sub', 'id_rsa'), 'KEY\n');
  run('add', '-A', '-f'); run('commit', '-q', '-m', 'two');
  const second = git(dir, 'rev-parse', 'HEAD').stdout.trim();
  // the commits really hold the secret: git itself lists it, so only the filter can be what hides it
  assert.match(git(dir, 'diff', '--numstat', first, second).stdout, /.env/);
  const was = [git(dir, 'for-each-ref').stdout, fs.readFileSync(path.join(dir, '.git', 'index')).toString('hex'), fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8')];
  const sync = statBetween(dir, first, second);
  const lazy = await statBetweenAsync(dir, first, second);
  assert.deepEqual(lazy, sync);
  assert.deepEqual(sync.files.map((f) => f.path), ['a.txt']);
  assert.equal(sync.more, 0);
  assert.doesNotMatch(JSON.stringify([sync, lazy]), /.env|id_rsa/);
  assert.doesNotMatch(JSON.stringify(diffBetween(dir, first, second)), /.env|id_rsa/);
  assert.deepEqual([git(dir, 'for-each-ref').stdout, fs.readFileSync(path.join(dir, '.git', 'index')).toString('hex'), fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8')], was);
  assert.equal(fs.existsSync(path.join(dir, '.git', 'index.lock')), false);
});

test('turnDiff {stat} da los mismos números que sin ella y sin parche; `more` cuenta lo que pasa del tope', async () => {
  const dir = path.join(t.home, 'web', 'turnos'); fs.mkdirSync(dir, { recursive: true });
  const run = (...a) => git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a);
  git(dir, 'init', '-q'); fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); run('add', '-A'); run('commit', '-q', '-m', 'one');
  git(dir, 'update-ref', 'refs/orb/turnos/chat1/0', 'HEAD');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  for (let i = 0; i < 302; i += 1) fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x\n');
  run('add', '-A'); run('commit', '-q', '-m', 'two');
  git(dir, 'update-ref', 'refs/orb/turnos/chat1/1', 'HEAD');
  const light = await turnDiff(dir, 'chat1', { scope: 'turn', n: 1, stat: true });
  const full = await turnDiff(dir, 'chat1', { scope: 'turn', n: 1 });
  assert.equal(light.available, true);
  assert.equal(light.files.length, 300); assert.equal(light.more, 3);
  assert.equal(full.files.length, 300); assert.equal(full.more, 3);
  for (const f of light.files) { assert.ok(!('patch' in f)); const g = full.files.find((x) => x.path === f.path); assert.deepEqual([f.status, f.added, f.removed], [g.status, g.added, g.removed]); }
  assert.equal(METHODS['sessions.turnDiff'], 'remote');
});
