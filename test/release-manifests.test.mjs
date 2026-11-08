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
