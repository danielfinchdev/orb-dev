// Audit fixes for the command guard: stray brackets, quoted git option values and a bare `cd` (home folder).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide } from '../src/domain/security/guard.mjs';

let base; let proj; let internal;
before(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-aud384-')));
  proj = path.join(base, 'proyectos', 'web'); internal = path.join(base, 'Orb', 'core');
  fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(path.join(internal, 'datos'), { recursive: true });
});
after(() => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ } });
const ask = (permission, command) => decide({ permission, internalDir: internal, cwd: proj, projectDir: proj, tool: 'Bash', command });

test('stray brackets never throw the guard', () => {
  for (const c of ['if [ -f package.json ]; then echo ok; fi', '[[ -d x ]] && echo y', 'echo $arr[$i-1]', 'ls [', 'cat [[ ../x', 'ls [abc', 'cat ]x[ ']) {
    for (const permission of ['editar', 'auto', 'total']) assert.doesNotThrow(() => ask(permission, c), c);
  }
  // A word that is not a valid glob is compared literally: a real class still reaches a closed name.
  assert.notEqual(ask('editar', 'cat [').decision, 'deny');
});

test('git with quoted option values still asks for push, reset --hard and clean', () => {
  for (const c of [
    'git -C "D:\\mi web" push origin main', "git -C 'D:\\mi web' push origin main",
    'git -c "user.name=a b" push', 'git --git-dir="x y" push', 'git -C "a b" reset --hard', 'git -C "a b" clean -fd'
  ]) {
    assert.notEqual(ask('editar', c).decision, 'allow', c);
  }
});

test('a bare cd goes home, so relative closed paths resolve there', () => {
  for (const c of ['cd && cat .ssh/known_hosts', 'cd; cat .ssh/known_hosts', 'cd ~ && cat .ssh/known_hosts', 'pushd && cat .ssh/known_hosts', 'cd\ncat .ssh/known_hosts']) {
    for (const permission of ['editar', 'auto']) assert.equal(ask(permission, c).decision, 'deny', `${c} (${permission})`);
  }
});

test('an escaped quote cannot hide a push or reset --hard behind a quoted option value', () => {
  for (const c of [
    'git -c a.b="x y" -c c.d=\\" push origin main #"',
    'git -c a.b="x y" -c c.d=`" push origin main #"',
    'git -c a.b="x y" -c c.d=\\" reset --hard #"',
    'git -c a.b="x y" -c c.d=`" reset --hard #"'
  ]) {
    // Plain `git reset --hard` is allowed in auto and any git push in total by design: only compare against modes that ask.
    for (const permission of /push/.test(c) ? ['editar', 'auto'] : ['editar']) assert.notEqual(ask(permission, c).decision, 'allow', `${c} (${permission})`);
  }
});

test('bash bracket expressions JS reads differently still reach closed folders', () => {
  for (const c of ['cat ../../Orb/c[]o]re/datos/x', 'cat ../../Orb/c[[:alpha:]]re/datos/x', 'cat ../../Orb/c[!]x]re/datos/x', 'cat ../../Orb/c[]o]re/da[^]x]os/x']) {
    for (const permission of ['editar', 'auto']) assert.notEqual(ask(permission, c).decision, 'allow', `${c} (${permission})`);
  }
  assert.notEqual(ask('editar', 'cat ~/.ss[]h]/known_hosts').decision, 'allow');
});

test('quoted git options are checked in linear time', () => {
  // Overlapping quote branches once made this exponential: 22 pairs of quotes took seconds and froze the engine.
  for (const c of ['git -x' + '""'.repeat(2000) + ' x', 'git -x' + '"'.repeat(3001) + ' x', "git -x" + "'\"".repeat(1500) + " x"]) {
    const t = Date.now(); ask('editar', c);
    assert.ok(Date.now() - t < 1000, `${c.length} chars took ${Date.now() - t} ms`);
  }
});
