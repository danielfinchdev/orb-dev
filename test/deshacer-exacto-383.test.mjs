// 3.8.3: «Deshacer» gives every file back byte for byte, whatever its line endings: with core.autocrlf=true (Git for
// Windows' default) a file the user or an agent wrote with LF came back with CRLF, and one checked out with CRLF must stay so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit, undoCheckpoint, RAW_GIT, RAW_INDEX } from '../src/domain/tasks/checkpoints.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-undo-eol-'));
after(() => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* temp */ } });

test('Deshacer devuelve cada archivo con sus finales de línea (LF, CRLF o mezclados), con core.autocrlf=true', () => {
  const repo = path.join(base, 'web'); fs.mkdirSync(repo);
  const g = (...a) => { const r = git(repo, ...a); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
  g('init', '-q'); g('config', 'core.autocrlf', 'true'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t');
  const files = {
    'crlf.txt': 'uno\r\ndos\r\n',
    'lf.txt': 'uno\ndos\n',
    'mixed.txt': 'uno\ndos\r\ntres\n',
    'gone.txt': 'se borra\nlf\n'
  };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(repo, f), c);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  // What a checkout with autocrlf=true leaves (CRLF), and the others as the user wrote them after the commit.
  fs.rmSync(path.join(repo, 'crlf.txt')); g('checkout', '--', 'crlf.txt');
  for (const f of ['lf.txt', 'mixed.txt', 'gone.txt']) fs.writeFileSync(path.join(repo, f), files[f]);
  fs.writeFileSync(path.join(repo, 'new-lf.txt'), 'nuevo\nsin commit\n');
  g('status', '--porcelain'); // refreshes the index' stat cache, as any git status would
  const disk = Object.fromEntries(['crlf.txt', 'lf.txt', 'mixed.txt', 'gone.txt', 'new-lf.txt'].map((f) => [f, fs.readFileSync(path.join(repo, f))]));

  const before = takeCheckpoint(repo, 'eol', path.join(base, 'copias'));
  // The task changes everything and deletes one file.
  for (const f of ['crlf.txt', 'lf.txt', 'mixed.txt', 'new-lf.txt']) fs.writeFileSync(path.join(repo, f), 'cambiado por la tarea\n');
  fs.rmSync(path.join(repo, 'gone.txt'));
  const snap = snapshotCommit(repo, { always: true, message: 'despues', raw: before.raw });
  const out = undoCheckpoint(before, { commit: snap.commit });
  assert.deepEqual(out.skipped, []);
  for (const [f, bytes] of Object.entries(disk)) assert.ok(fs.readFileSync(path.join(repo, f)).equals(bytes), `${f}: ${JSON.stringify(fs.readFileSync(path.join(repo, f), 'latin1'))}`);
  assert.equal(g('status', '--porcelain', '--', 'crlf.txt'), '', 'el índice del usuario no cambia');
});

// 3.8.3 (repaso): the raw snapshots keep their own index, so a second checkpoint reads only what changed and still
// returns every byte. A raw index that is not an index any more is dropped and rebuilt, never a failed checkpoint.
test('las fotos en bruto guardan su propio índice y siguen siendo exactas (y se rehacen si está roto)', () => {
  const repo = path.join(base, 'rapido'); fs.mkdirSync(repo);
  const g = (...a) => { const r = git(repo, ...a); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
  g('init', '-q'); g('config', 'core.autocrlf', 'true'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t');
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), `uno\r\ndos\r\n${i}\n`);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  const rawIndex = path.resolve(repo, g('rev-parse', '--git-path', RAW_INDEX).trim());
  assert.ok(!fs.existsSync(rawIndex));
  const first = takeCheckpoint(repo, 'r1', path.join(base, 'copias'));
  assert.ok(fs.existsSync(rawIndex), 'la primera foto deja su índice');
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'index.lock')) && g('status', '--porcelain') === '', 'el índice del usuario no cambia');
  // Second snapshot: one file changed (LF only), one new, one gone, the rest untouched.
  fs.writeFileSync(path.join(repo, 'f3.txt'), 'solo\nlf\n');
  fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'mezcla\r\nde\nfinales\r\n');
  fs.rmSync(path.join(repo, 'f7.txt'));
  const second = takeCheckpoint(repo, 'r2', path.join(base, 'copias'));
  const show = (ref, f) => git(repo, ...RAW_GIT, 'cat-file', '--filters', `${ref}:${f}`);
  assert.equal(show(second.commit, 'f3.txt').stdout, 'solo\nlf\n');
  assert.equal(show(second.commit, 'nuevo.txt').stdout, 'mezcla\r\nde\nfinales\r\n');
  assert.equal(show(second.commit, 'f5.txt').stdout, 'uno\r\ndos\r\n5\n', 'un archivo sin tocar sigue en bruto');
  assert.notEqual(show(second.commit, 'f7.txt').status, 0, 'el borrado no está en la foto');
  // Undo between the two gives the first state back, byte for byte.
  const out = undoCheckpoint(first, { commit: second.commit });
  assert.deepEqual(out.skipped, []);
  assert.equal(fs.readFileSync(path.join(repo, 'f3.txt'), 'latin1'), 'uno\r\ndos\r\n3\n');
  assert.equal(fs.readFileSync(path.join(repo, 'f7.txt'), 'latin1'), 'uno\r\ndos\r\n7\n');
  assert.ok(!fs.existsSync(path.join(repo, 'nuevo.txt')));
  // A broken raw index: the snapshot is still taken, from the user's index, and the raw index is rebuilt.
  fs.writeFileSync(rawIndex, 'esto no es un índice');
  const third = takeCheckpoint(repo, 'r3', path.join(base, 'copias'));
  assert.equal(show(third.commit, 'f3.txt').stdout, 'uno\r\ndos\r\n3\n');
  assert.ok(fs.readFileSync(rawIndex).length > 100, 'índice en bruto rehecho');
});
