// 3.7 (WS1): Orb Server's agent engines come from the npm registry on demand, checked with the registry's sha512, within
// their line (Claude: the bundled SDK's 0.x; Codex: its major); a wrong sum installs nothing; they update within the
// line; and engine processes close when idle. A fake registry (fetchImpl) stands for registry.npmjs.org.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeTarGz, extractTarGz, safeName } from '../src/server/tar.mjs';
import { createEngines, createIdle, ENGINES, sameLine, newestInLine, checkIntegrity, runScript } from '../src/server/engines.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orb-engines-'));
const integrity = (buf) => `sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`;
async function tgz(dir, name, files) {
  const out = path.join(dir, name);
  await writeTarGz(out, [{ name: 'package', dir: true }, ...files.map((f) => ({ name: `package/${f.name}`, data: Buffer.from(f.data ?? 'x'), mode: f.mode ?? 0o644 }))]);
  return fs.readFileSync(out);
}
// A registry: { packument name → doc } and { tarball url → bytes }; it counts what was asked.
function fakeRegistry() {
  const docs = new Map(); const blobs = new Map(); const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const u = String(url);
    if (blobs.has(u)) { const b = blobs.get(u); return new Response(b, { status: 200 }); }
    const name = decodeURIComponent(u.replace(/^https:\/\/registry\.test\//, ''));
    if (docs.has(name)) return new Response(JSON.stringify(docs.get(name)), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('not found', { status: 404 });
  };
  return { docs, blobs, asked, fetchImpl };
}

test('versiones: la misma línea (0.x: el mismo minor; si no, el mismo major) y nunca más vieja', () => {
  assert.ok(sameLine('0.3.318', '0.3.289'));
  assert.ok(!sameLine('0.4.0', '0.3.289'));
  assert.ok(!sameLine('0.3.100', '0.3.289'));
  assert.ok(sameLine('3.9.0', '3.1.0') && !sameLine('4.0.0', '3.1.0'));
  assert.equal(newestInLine(['0.3.290', '0.3.300', '0.4.0', '0.3.301-beta.1'], '0.3.289'), '0.3.300');
  assert.ok(ENGINES.codex.inLine('0.170.1', '0.166.0') && !ENGINES.codex.inLine('1.0.0', '0.166.0') && !ENGINES.codex.inLine('0.165.0', '0.166.0'));
  assert.match(runScript({ bin: '/h/orb-server/engines/claude/current/claude', memoryMax: '1G' }), /systemd-run --user --scope .*MemoryMax=1G/);
  assert.match(runScript({ bin: '/x' }), /setpriv --no-new-privs/);
  assert.match(runScript({ bin: '/x' }), /oom_score_adj/);
});

test('el tar en streaming: deja el bit de ejecución y nunca escribe fuera de su carpeta', async () => {
  const dir = tmp();
  try {
    const out = path.join(dir, 'p.tgz');
    await writeTarGz(out, [{ name: 'package/bin/run', data: Buffer.from('#!/bin/sh\n'), mode: 0o755 }, { name: '../fuera.txt', data: Buffer.from('mal') }, { name: 'package/' + 'a/'.repeat(60) + 'largo.txt', data: Buffer.alloc(3000, 1) }]);
    const r = await extractTarGz(out, path.join(dir, 'x'), { strip: 1 });
    assert.equal(r.files, 2);
    assert.ok(fs.existsSync(path.join(dir, 'x', 'bin', 'run')));
    assert.equal(fs.statSync(path.join(dir, 'x', ...'a/'.repeat(60).split('/').filter(Boolean), 'largo.txt')).size, 3000);
    assert.ok(!fs.existsSync(path.join(dir, 'fuera.txt')) && !fs.existsSync(path.join(dir, 'x', '..', 'fuera.txt')));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'x', 'bin', 'run')).mode & 0o111, 0o111);
    assert.equal(safeName('/etc/passwd'), null); assert.equal(safeName('C:/x'), null); assert.equal(safeName('package/../../x', 1), null);
    await assert.rejects(extractTarGz(out, path.join(dir, 'y'), { strip: 1, maxBytes: 100 }), /demasiado grande/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Claude y Codex se descargan del registro con su sha512, solo si coincide, y se actualizan dentro de su línea', async () => {
  const dir = tmp();
  try {
    const reg = fakeRegistry();
    const claude300 = await tgz(dir, 'c300.tgz', [{ name: 'claude', data: 'v300', mode: 0o755 }, { name: 'package.json', data: '{}' }]);
    const claude400 = await tgz(dir, 'c400.tgz', [{ name: 'claude', data: 'v400', mode: 0o755 }]);
    const name = ENGINES.claude.name('x64');
    const base = ENGINES.claude.base();
    const [maj, min] = base.split('.').map(Number);
    const inLine = `${maj}.${min}.${Number(base.split('.')[2]) + 11}`; const nextMinor = `${maj}.${min + 1}.0`;
    reg.blobs.set('https://registry.test/c300.tgz', claude300); reg.blobs.set('https://registry.test/c400.tgz', claude400);
    reg.docs.set(name, { name, versions: { [inLine]: { dist: { tarball: 'https://registry.test/c300.tgz', integrity: integrity(claude300) } }, [nextMinor]: { dist: { tarball: 'https://registry.test/c400.tgz', integrity: integrity(claude400) } } } });
    const engines = createEngines({ dir: path.join(dir, 'engines'), registry: 'https://registry.test', fetchImpl: reg.fetchImpl, arch: 'x64' });
    assert.equal(engines.installed('claude'), false);
    const r = await engines.ensure('claude');
    assert.equal(r.version, inLine, 'la más nueva de su línea, no la del minor siguiente');
    assert.equal(fs.readFileSync(path.join(dir, 'engines', 'claude', 'current', 'claude'), 'utf8'), 'v300');
    assert.match(fs.readFileSync(engines.runPath('claude'), 'utf8'), /systemd-run --user --scope/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'engines', 'claude', 'engine.json'), 'utf8')).integrity, integrity(claude300));
    // A second ensure asks nothing (it is there).
    const n = reg.asked.length; await engines.ensure('claude'); assert.equal(reg.asked.length, n);
    assert.deepEqual(engines.list().find((e) => e.id === 'claude'), { id: 'claude', label: 'Claude', installed: true, version: inLine, checkedAt: engines.list()[0].checkedAt, installing: false });

    // Codex: the Linux build is <version>-linux-<arch> of @openai/codex; its program in vendor/<triple>/codex/codex.
    const codexBuild = await tgz(dir, 'x.tgz', [{ name: 'bin/codex.js', data: '//' }, { name: 'vendor/x86_64-unknown-linux-musl/codex/codex', data: 'codex', mode: 0o755 }]);
    reg.blobs.set('https://registry.test/x.tgz', codexBuild);
    reg.docs.set('@openai/codex', { name: '@openai/codex', 'dist-tags': { latest: '0.170.0' }, versions: { '0.170.0': { dist: {} }, '0.170.0-linux-x64': { dist: { tarball: 'https://registry.test/x.tgz', integrity: integrity(codexBuild) } }, '1.0.0': { dist: {} }, '1.0.0-linux-x64': { dist: { tarball: 'https://registry.test/x.tgz', integrity: integrity(codexBuild) } } } });
    const c = await engines.ensure('codex');
    assert.equal(c.version, '0.170.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'engines', 'codex', 'engine.json'), 'utf8')).bin, 'vendor/x86_64-unknown-linux-musl/codex/codex');

    // A newer version of the line: update() takes it, keeps the previous one (a process may still use it) and no more.
    const newer = `${maj}.${min}.${Number(base.split('.')[2]) + 12}`;
    const claude301 = await tgz(dir, 'c301.tgz', [{ name: 'claude', data: 'v301', mode: 0o755 }]);
    reg.blobs.set('https://registry.test/c301.tgz', claude301);
    reg.docs.get(name).versions[newer] = { dist: { tarball: 'https://registry.test/c301.tgz', integrity: integrity(claude301) } };
    const u = await engines.update('claude');
    assert.equal(u.version, newer); assert.equal(u.updated, true);
    assert.equal(fs.readFileSync(path.join(dir, 'engines', 'claude', 'current', 'claude'), 'utf8'), 'v301');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'engines', 'claude')).filter((f) => /^\d/.test(f)).sort(), [inLine, newer].sort());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('una suma que no coincide, o sin sha512, no instala nada', async () => {
  const dir = tmp();
  try {
    const reg = fakeRegistry();
    const good = await tgz(dir, 'g.tgz', [{ name: 'claude', data: 'ok', mode: 0o755 }]);
    const evil = await tgz(dir, 'e.tgz', [{ name: 'claude', data: 'malo', mode: 0o755 }]);
    const name = ENGINES.claude.name('arm64');
    const v = ENGINES.claude.base();
    reg.blobs.set('https://registry.test/e.tgz', evil);
    reg.docs.set(name, { name, versions: { [v]: { dist: { tarball: 'https://registry.test/e.tgz', integrity: integrity(good) } } } });
    const engines = createEngines({ dir: path.join(dir, 'engines'), registry: 'https://registry.test', fetchImpl: reg.fetchImpl, arch: 'arm64' });
    await assert.rejects(engines.ensure('claude'), /sha512.*no coincide/);
    assert.equal(engines.installed('claude'), false);
    assert.ok(!fs.existsSync(path.join(dir, 'engines', 'claude', v)), 'nada descomprimido');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'engines', 'claude')), [], 'ni la descarga');
    // only sha1 (old packages): refused
    reg.docs.get(name).versions[v].dist.integrity = 'sha1-abc=';
    await assert.rejects(engines.ensure('claude'), /sha512/);
    // http (not https) never
    reg.docs.get(name).versions[v].dist = { tarball: 'http://registry.test/e.tgz', integrity: integrity(evil) };
    await assert.rejects(engines.ensure('claude'), /https/);
    await assert.rejects(checkIntegrity(path.join(dir, 'g.tgz'), integrity(evil)), /no coincide/);
    assert.equal(await checkIntegrity(path.join(dir, 'g.tgz'), integrity(good)), true);
    // offline (the tests' engine): nothing is downloaded
    await assert.rejects(createEngines({ dir: path.join(dir, 'o'), offline: true }).ensure('claude'), /sin descargas/);
    await assert.rejects(engines.ensure('chromium'), /desconocido/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('un motor sin uso se cierra solo; el que se usa sigue', () => {
  let now = 0;
  const closed = [];
  const idle = createIdle({ now: () => now, tickMs: 1_000_000 });
  const child = (id) => Object.assign(new EventEmitter(), { id, kill: () => {} });
  const a = child('a'); const b = child('b');
  idle.track('chromium', a, { idleMs: 1000, close: (c) => closed.push(c.id) });
  idle.track('otro', b, { idleMs: 5000, close: (c) => closed.push(c.id) });
  now = 900; idle.touch('chromium'); now = 1500; idle.tick();
  assert.deepEqual(closed, [], 'usado hace 600 ms: sigue');
  now = 2001; idle.tick();
  assert.deepEqual(closed, ['a']);
  assert.deepEqual(idle.running(), ['otro']);
  b.emit('exit'); assert.deepEqual(idle.running(), [], 'un proceso que termina solo deja de contarse');
  const c = child('c'); idle.track('x', c, { close: (x) => closed.push(x.id) }); idle.closeAll();
  assert.deepEqual(closed, ['a', 'c']);
});
