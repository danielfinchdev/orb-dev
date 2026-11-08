// 3.8.1 (D9): the update manifests of a release (scripts/release-manifests.mjs) and the updater's configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeManifests, releaseBase } from '../scripts/release-manifests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A signature shaped as `tauri signer sign` writes it (base64 of minisign's four lines); its bytes are not checked here.
const fakeSig = (trusted) => Buffer.from(`untrusted comment: signature from tauri secret key\nRUQx\ntrusted comment: ${trusted}\nAAAA\n`).toString('base64');

test('latest.json for Orb on Tauri and latest.yml for Orb 3.8.0 point at the same installer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-manifiestos-'));
  try {
    const setup = path.join(dir, 'Orb_3.8.1_x64-setup.exe');
    const bytes = crypto.randomBytes(4096);
    fs.writeFileSync(setup, bytes);
    fs.writeFileSync(`${setup}.sig`, fakeSig('timestamp:1\tfile:Orb_3.8.1_x64-setup.exe\tversion:3.8.1'));
    const out = path.join(dir, 'salida');
    makeManifests({ setup, out, version: '3.8.1', date: '2026-11-08T10:00:00.000Z', notes: 'Orb on Tauri' });
    const json = JSON.parse(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'));
    assert.equal(json.version, '3.8.1');
    assert.equal(json.pub_date, '2026-11-08T10:00:00.000Z');
    for (const key of ['windows-x86_64', 'windows-x86_64-nsis']) {
      assert.equal(json.platforms[key].url, `${releaseBase('3.8.1')}Orb_3.8.1_x64-setup.exe`);
      assert.equal(json.platforms[key].signature, fs.readFileSync(`${setup}.sig`, 'utf8'));
    }
    assert.equal(releaseBase('3.8.1'), 'https://github.com/danielfinchdev/orb-dev/releases/download/v3.8.1/');
    const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
    assert.equal(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'), [
      'version: 3.8.1', 'files:', '  - url: Orb_3.8.1_x64-setup.exe', `    sha512: ${sha512}`, '    size: 4096',
      'path: Orb_3.8.1_x64-setup.exe', `sha512: ${sha512}`, "releaseDate: '2026-11-08T10:00:00.000Z'", ''
    ].join('\n'));
    assert.deepEqual(fs.readFileSync(path.join(out, 'Orb-3.8.1-instalador.exe')), bytes);
    // A local feed for tests.
    makeManifests({ setup, out, version: '3.8.1', base: 'http://127.0.0.1:8123/' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'latest.json'), 'utf8')).platforms['windows-x86_64'].url, 'http://127.0.0.1:8123/Orb_3.8.1_x64-setup.exe');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the signature must be of that installer and bound to that version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-manifiestos-'));
  try {
    const setup = path.join(dir, 'Orb_3.8.1_x64-setup.exe');
    fs.writeFileSync(setup, 'x');
    const out = path.join(dir, 'salida');
    const tryWith = (trusted, version = '3.8.1') => { fs.writeFileSync(`${setup}.sig`, fakeSig(trusted)); return () => makeManifests({ setup, out, version }); };
    assert.throws(tryWith('timestamp:1\tfile:Orb_3.8.0_x64-setup.exe\tversion:3.8.1'), /no es la firma/);
    assert.throws(tryWith('timestamp:1\tfile:Orb_3.8.1_x64-setup.exe'), /no lleva la versión 3\.8\.1/);
    assert.throws(tryWith('timestamp:1\tfile:Orb_3.8.1_x64-setup.exe\tversion:3.8.2'), /no lleva la versión/);
    assert.throws(tryWith('timestamp:1\tfile:Orb_3.8.1_x64-setup.exe\tversion:3.8.1', '3.8.2'), /no es el instalador de la 3\.8\.2/);
    assert.throws(tryWith('x', 'latest'), /versión no válida/);
    assert.ok(!fs.existsSync(out), 'nothing written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the updater: GitHub release feed, Orb\'s public key, signed versions, passive installer and the bridge hooks', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const u = conf.plugins.updater;
  assert.deepEqual(u.endpoints, ['https://github.com/danielfinchdev/orb-dev/releases/latest/download/latest.json']);
  assert.match(Buffer.from(u.pubkey, 'base64').toString('utf8'), /^untrusted comment: minisign public key: [0-9A-F]{16}\nRW[A-Za-z0-9+/]{54}\n?$/);
  assert.equal(u.requireSignedVersion, true);
  assert.equal(u.dangerousInsecureTransportProtocol, undefined, 'plain http only in the e2e build');
  assert.equal(u.windows.installMode, 'passive');
  assert.equal(conf.bundle.createUpdaterArtifacts, true);
  assert.equal(conf.bundle.windows.nsis.installerHooks, 'nsis/hooks.nsh');
  const hooks = fs.readFileSync(path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh'), 'utf8');
  // electron-builder's uninstall entry for appId dev.orb.app, run silently in place and waited for, never deleting data.
  assert.match(hooks, /Uninstall\\c791290b-4a7b-5a24-9cba-134994a22734"/);
  assert.match(hooks, /ExecWait '"\$OrbElectronDir\\Uninstall Orb\.exe" \/S \/currentuser _\?=\$OrbElectronDir'/);
  assert.doesNotMatch(hooks.replace(/^\s*;.*$/gm, ''), /delete-app-data|RMDir \/r/i);
  assert.match(hooks, /\$\{GetOptions\} \$0 "--updated" \$1/);
  // The private key never in the repository.
  for (const f of ['src-tauri/tauri.conf.json', 'scripts/release-manifests.mjs']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /secret key|PRIVATE KEY/i);
});

// 3.8.1 (review D9 M2): the tests' updater key is not Orb's: release:firmar refuses a signature whose key id is not the
// one in tauri.conf.json, and the test build trusts only the test key.
test('the test updater key is not the one Orb trusts, and a signature says which key made it', async () => {
  const { keyId } = await import('../scripts/release-firmar.mjs');
  const { execFileSync } = await import('node:child_process');
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater.pubkey;
  const testPub = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'actualizador-prueba.key.pub'), 'utf8');
  assert.notEqual(keyId(testPub), keyId(conf));
  assert.match(keyId(conf), /^[0-9a-f]{16}$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-firma-'));
  try {
    const file = path.join(dir, 'x.bin'); fs.writeFileSync(file, 'x');
    const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PATH: path.join(ROOT, 'test', 'fixtures', 'actualizador-prueba.key'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'prueba' };
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'signer', 'sign', file], { env, stdio: 'ignore' });
    assert.equal(keyId(fs.readFileSync(`${file}.sig`, 'utf8')), keyId(testPub));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 3.8.1 (review D9 A1/M1/M7): GitHub Actions build and test only: a read-only token that is not kept in .git, no
// signing key, nothing published from there, every action pinned by commit, and the packaged Orb opened before its
// installer is kept. Linux is not built for 3.8.1 (planned later).
test('the workflows: read-only, no keys, pinned actions, smoke test of the packaged Orb, Windows only', () => {
  for (const name of ['release.yml', 'pruebas.yml']) {
    const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
    assert.match(y, /^permissions:\n {2}contents: read$/m, `${name}: token de solo lectura`);
    assert.doesNotMatch(y, /contents: write|secrets\.|TAURI_SIGNING|action-gh-release|gh release create/, `${name}: sin claves ni publicación`);
    const uses = [...y.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${name}: ${u} fijada por commit`);
    const checkouts = (y.match(/actions\/checkout@/g) ?? []).length;
    assert.equal((y.match(/persist-credentials: false/g) ?? []).length, checkouts, `${name}: el token no se queda en .git`);
    assert.doesNotMatch(y.replace(/^\s*#.*$/gm, ''), /electron|linux|AppImage|\.deb\b/i, `${name}: sin Electron ni Linux en la 3.8.1`);
  }
  const release = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /createUpdaterArtifacts":false/, 'se compila sin firmar');
  assert.match(release, /node test\/smoke\.e2e\.mjs --exe src-tauri\/target\/release\/Orb\.exe/, 'humo de la app empaquetada');
  assert.match(release, /orb-windows-\$\{\{ needs\.version\.outputs\.version \}\}/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['release:firmar'], 'node scripts/release-firmar.mjs');
});

// 3.8.1 (review D10 M2/B2): release:firmar publishes only a newer version, with its own notes, and an Orb.exe that trusts
// the updater key of tauri.conf.json and carries nothing of the test build.
test('release:firmar: newer versions only, the version\'s notes, and the Orb.exe it would publish is checked', async () => {
  const { newer, releaseNotes } = await import('../scripts/release-firmar.mjs');
  const { releaseProblems } = await import('../scripts/tauri-check-release.mjs');
  assert.ok(newer('3.8.1', '3.8.0') && newer('3.10.0', '3.9.9') && !newer('3.8.0', '3.8.0') && !newer('3.7.9', '3.8.0'));
  const notes = releaseNotes(fs.readFileSync(path.join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8'), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  assert.ok(notes, 'CHANGELOG has «## Download» and «## What\'s new in» the package\'s version');
  assert.match(notes, /^## Download\n/); assert.doesNotMatch(notes, /What's new in 3\.8\.0/);
  assert.equal(releaseNotes('## Download\nx\n## What\'s new in 3.8.0\ny\n', '3.8.1'), null);
  const pub = 'cHVibGljLWtleQ==';
  const testPub = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'actualizador-prueba.key.pub'), 'utf8').trim();
  assert.deepEqual(releaseProblems(Buffer.from(`...${pub}...`), pub), []);
  assert.match(releaseProblems(Buffer.from('...'), pub).join(), /sin la clave pública/);
  assert.match(releaseProblems(Buffer.from(`${pub} ${testPub}`), pub).join(), /PRUEBA/);
  assert.match(releaseProblems(Buffer.from(`${pub} ORB_E2E_CDP_PORT`), pub).join(), /ORB_E2E_CDP_PORT/);
});
