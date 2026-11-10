// 3.8.3: «Deshacer» gives every file back byte for byte, whatever its line endings: with core.autocrlf=true (Git for
// Windows' default) a file the user or an agent wrote with LF came back with CRLF, and one checked out with CRLF must stay so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit, undoCheckpoint } from '../src/domain/tasks/checkpoints.mjs';

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
