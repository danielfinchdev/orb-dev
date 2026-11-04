// 3.7 (WS1): Orb Server's releases are signed (ed25519) with a key that lives outside the repository; the server updates
// itself only within 3.7.x, only with a valid signature and matching sums, after a backup, and goes back to the previous
// version when the new one is not healthy within its health check. A throwaway key in a temp folder; never a real one.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './helpers.mjs';
import { keygen, sign, checkKeyPath, embedKey, buildManifest, fingerprint, defaultKeyPath } from '../scripts/release.mjs';
import { readManifest, verifySignature, updateFor, createUpdater, rollback, readPending, appDirOf } from '../src/server/update.mjs';
import { RELEASE_PUBLIC_KEY } from '../src/server/release-key.mjs';
import { writeTarGz } from '../src/server/tar.mjs';
import { pointTo } from '../src/server/engines.mjs';
import { renderInstall } from '../scripts/dist-servidor.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orb-release-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('la clave de firma vive fuera del repositorio y nunca se sobrescribe', () => {
  const dir = tmp();
  try {
    assert.throws(() => checkKeyPath(path.join(ROOT, 'release.key')), /dentro del repositorio/);
    assert.throws(() => checkKeyPath(path.join(ROOT, 'docs', 'x', 'release.key')), /dentro del repositorio/);
    assert.equal(defaultKeyPath({ USERPROFILE: 'C:\\Users\\ana' }), path.resolve('C:\\Users\\ana', '.orb-release', 'release.key'));
    const file = path.join(dir, '.orb-release', 'release.key');
    const r = keygen({ file, embed: false });
    assert.ok(fs.existsSync(file) && fs.existsSync(`${file}.pub`));
    assert.match(fs.readFileSync(file, 'utf8'), /BEGIN PRIVATE KEY/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.throws(() => keygen({ file, embed: false }), /no se sobrescribe/);
    assert.equal(r.fingerprint, fingerprint(r.publicKey));
    // only the public key is written into the code
    const src = embedKey("// x\nexport const RELEASE_PUBLIC_KEY = '';\n", r.publicKey);
    assert.match(src, /BEGIN PUBLIC KEY/); assert.doesNotMatch(src, /PRIVATE/);
    // the repository never carries a private key, and ignores the key folder
    assert.doesNotMatch(String(RELEASE_PUBLIC_KEY), /PRIVATE/);
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    for (const line of ['*.key', '.orb-release/', 'release.key']) assert.ok(ignore.split(/\r?\n/).includes(line), line);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('release:sign firma manifest.json e install.sh; el servidor rechaza firmas malas y manifiestos tocados', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'key', 'release.key');
    const { publicKey } = keygen({ file, embed: false });
    const dist = path.join(dir, 'dist'); fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'orb-server-3.7.1-linux-x64.tar.gz'), 'paquete x64');
    fs.writeFileSync(path.join(dist, 'orb-server-3.7.1-linux-arm64.tar.gz'), 'paquete arm64');
    fs.writeFileSync(path.join(dist, 'orb-server-3.7.0-linux-x64.tar.gz'), 'otra versión');
    fs.writeFileSync(path.join(dist, 'install.sh'), '#!/bin/sh\n');
    const r = await sign({ dir: dist, version: '3.7.1', file, publicKey });
    assert.deepEqual(r.signed, ['manifest.json', 'install.sh']);
    const data = fs.readFileSync(path.join(dist, 'manifest.json')); const sig = fs.readFileSync(path.join(dist, 'manifest.json.sig'), 'utf8');
    const m = readManifest(data, sig, { publicKey });
    assert.deepEqual(Object.keys(m.assets).sort(), ['install.sh', 'orb-server-3.7.1-linux-arm64.tar.gz', 'orb-server-3.7.1-linux-x64.tar.gz']);
    assert.equal(m.assets['orb-server-3.7.1-linux-x64.tar.gz'].sha256, sha('paquete x64'));
    assert.ok(verifySignature(fs.readFileSync(path.join(dist, 'install.sh')), fs.readFileSync(path.join(dist, 'install.sh.sig'), 'utf8'), publicKey));
    // touched, signed by another key, or no key in this build: refused
    const touched = Buffer.from(data.toString().replace(sha('paquete x64'), sha('otra cosa')));
    assert.throws(() => readManifest(touched, sig, { publicKey }), /firma/);
    const other = crypto.generateKeyPairSync('ed25519');
    assert.throws(() => readManifest(data, crypto.sign(null, data, other.privateKey).toString('base64'), { publicKey }), /firma/);
    assert.throws(() => readManifest(data, sig, { publicKey: '' }), /clave pública/);
    assert.throws(() => readManifest(data, 'basura', { publicKey }), /firma/);
    // signing with a key that is not the embedded one's pair: refused
    await assert.rejects(sign({ dir: dist, version: '3.7.1', file, publicKey: other.publicKey.export({ type: 'spki', format: 'pem' }) }), /no es la de la clave pública/);
    assert.throws(() => buildManifest(dist, '3.9.9'), /no hay paquetes/);
    // within 3.7.x only, and only newer
    assert.equal(updateFor(m, '3.7.0', 'x64').name, 'orb-server-3.7.1-linux-x64.tar.gz');
    assert.equal(updateFor(m, '3.7.0', 'arm64').name, 'orb-server-3.7.1-linux-arm64.tar.gz');
    assert.equal(updateFor(m, '3.7.1'), null); assert.equal(updateFor(m, '3.7.2'), null); assert.equal(updateFor(m, '3.6.9'), null); assert.equal(updateFor({ ...m, version: '3.8.0' }, '3.7.0'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A release server for createUpdater: manifest.json(.sig) and the package, signed with a throwaway key.
async function release(dir, { version = '3.7.1', badSum = false } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pkg = path.join(dir, 'pkg.tgz');
  const top = `orb-server-${version}`;
  await writeTarGz(pkg, [{ name: top, dir: true }, { name: `${top}/node/bin/node`, data: Buffer.from('node'), mode: 0o755 }, { name: `${top}/src/server/orb-server.mjs`, data: Buffer.from('//') }, { name: `${top}/VERSION`, data: Buffer.from(version) }]);
  const bytes = fs.readFileSync(pkg);
  const name = `orb-server-${version}-linux-x64.tar.gz`;
  const manifest = Buffer.from(JSON.stringify({ product: 'orb-server', version, assets: { [name]: { sha256: badSum ? sha('otro') : sha(bytes), size: bytes.length } } }));
  const sig = crypto.sign(null, manifest, privateKey).toString('base64');
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    if (url.endsWith('/latest/download/manifest.json')) return new Response(manifest);
    if (url.endsWith('/latest/download/manifest.json.sig')) return new Response(sig);
    if (url.endsWith(`/download/v${version}/${name}`)) return new Response(bytes);
    return new Response('no', { status: 404 });
  };
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), fetchImpl, asked };
}
function appFolder(dir, version = '3.7.0') {
  const app = path.join(dir, 'app'); fs.mkdirSync(path.join(app, version, 'src', 'server'), { recursive: true });
  fs.writeFileSync(path.join(app, version, 'VERSION'), version);
  pointTo(path.join(app, 'current'), path.join(app, version));
  return app;
}
const currentVersion = (app) => fs.readFileSync(path.join(app, 'current', 'VERSION'), 'utf8').trim();

test('se actualiza sola dentro de 3.7.x: firma, suma, copia antes, current a la nueva', async () => {
  const dir = tmp();
  try {
    const app = appFolder(dir);
    const rel = await release(dir);
    let backups = 0; let restarts = 0;
    const up = createUpdater({ home: dir, version: '3.7.0', fetchImpl: rel.fetchImpl, base: 'https://releases.test', publicKey: rel.publicKey, appDir: app, arch: 'x64', backup: async () => { backups++; }, restart: () => { restarts++; }, auto: true });
    const c = await up.check();
    assert.equal(c.available.version, '3.7.1');
    const r = await up.apply();
    assert.deepEqual(r, { updated: true, version: '3.7.1' });
    assert.equal(backups, 1, 'una copia de los datos antes de cambiar'); assert.equal(restarts, 1);
    assert.equal(currentVersion(app), '3.7.1');
    assert.deepEqual({ from: readPending(app).from, to: readPending(app).to }, { from: '3.7.0', to: '3.7.1' });
    assert.equal(fs.readFileSync(path.join(app, 'update-from'), 'utf8').trim(), '3.7.0', 'el lanzador sabe a cuál volver');
    assert.ok(fs.existsSync(path.join(app, '3.7.0')), 'la anterior se queda');
    // the new version is unhealthy for its health check: back to 3.7.0, markers gone
    let back = 0;
    const next = createUpdater({ home: dir, version: '3.7.1', appDir: app, publicKey: rel.publicKey, restart: () => { back++; }, healthMs: 50, auto: false });
    assert.equal(await next.afterStart({ healthy: async () => false }), 'rolledBack');
    assert.equal(currentVersion(app), '3.7.0'); assert.equal(back, 1);
    assert.equal(readPending(app), null); assert.ok(!fs.existsSync(path.join(app, 'update-from')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('una versión sana se queda; una suma mala o una firma mala no tocan nada', async () => {
  const dir = tmp();
  try {
    const app = appFolder(dir);
    const rel = await release(dir);
    const up = createUpdater({ home: dir, version: '3.7.0', fetchImpl: rel.fetchImpl, base: 'https://releases.test', publicKey: rel.publicKey, appDir: app, arch: 'x64', backup: async () => {}, restart: () => {} });
    await up.apply();
    const ok = createUpdater({ home: dir, version: '3.7.1', appDir: app, publicKey: rel.publicKey, healthMs: 20, auto: false });
    assert.equal(await ok.afterStart({ healthy: async () => true }), 'kept');
    assert.equal(currentVersion(app), '3.7.1'); assert.equal(readPending(app), null);
    assert.equal(rollback(app), null, 'nada que deshacer');

    const dir2 = tmp();
    try {
      const app2 = appFolder(dir2);
      const bad = await release(dir2, { badSum: true });
      let backups = 0;
      const u2 = createUpdater({ home: dir2, version: '3.7.0', fetchImpl: bad.fetchImpl, base: 'https://releases.test', publicKey: bad.publicKey, appDir: app2, arch: 'x64', backup: async () => { backups++; }, restart: () => {} });
      await assert.rejects(u2.apply(), /sha256/);
      assert.equal(currentVersion(app2), '3.7.0'); assert.equal(backups, 0); assert.ok(!fs.existsSync(path.join(app2, '3.7.1')));
      const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
      bad.asked.length = 0;
      const u3 = createUpdater({ home: dir2, version: '3.7.0', fetchImpl: bad.fetchImpl, base: 'https://releases.test', publicKey: other, appDir: app2, arch: 'x64', backup: async () => { backups++; }, restart: () => {} });
      await assert.rejects(u3.apply(), /firma/);
      assert.equal(currentVersion(app2), '3.7.0'); assert.ok(!bad.asked.some((u) => u.endsWith('.tar.gz')), 'con una firma mala ni se descarga el paquete');
      // no app/ folder (a development copy): never
      assert.equal(appDirOf(ROOT), null);
      await assert.rejects(createUpdater({ home: dir2, version: '3.7.0', appDir: null }).apply(), /app\//);
    } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install.sh lleva las sumas de los paquetes y de Node, y las comprueba antes de instalar', () => {
  const tmpl = fs.readFileSync(path.join(ROOT, 'scripts', 'install.sh.tmpl'), 'utf8');
  const sums = { x64: { sha256: 'a'.repeat(64), node: 'b'.repeat(64) }, arm64: { sha256: 'c'.repeat(64), node: 'd'.repeat(64) } };
  const out = renderInstall(tmpl, { version: '3.7.1', packages: sums });
  assert.doesNotMatch(out, /@@/);
  assert.doesNotMatch(out, /\r/);
  for (const s of ['a', 'b', 'c', 'd']) assert.ok(out.includes(s.repeat(64)));
  assert.match(out, /sha256sum -c/);
  assert.ok(out.indexOf('sha256sum -c') < out.indexOf('tar -xzf'), 'la suma antes de descomprimir');
  assert.ok(out.indexOf('NODE_SUM') < out.indexOf('migrar'), 'Node comprobado antes de tocar nada');
  for (const s of ['--pair', '--no-sudo', 'orb-server" migrar', 'enable --now orb-server.service', 'disable orb-nucleo.service', 'admin-setup.sh', 'emparejar']) assert.ok(out.includes(s), s);
  // one sudo, for admin-setup.sh only
  assert.equal(out.split('\n').filter((l) => /\bsudo sh\b/.test(l) && !/say /.test(l)).length, 1);
  assert.throws(() => renderInstall(tmpl, { version: '3.7.1; rm -rf ~', packages: sums }), /versión/);
  assert.throws(() => renderInstall('@@OTRA@@', { version: '3.7.1', packages: sums }), /falta OTRA/);
  assert.throws(() => renderInstall(tmpl, { version: '3.7.1', packages: { x64: { sha256: "a'; rm", node: '' } } }), /no válido/);
});
