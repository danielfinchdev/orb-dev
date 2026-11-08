// The update manifests of a Windows release (D9), next to the installer `tauri build` made:
//   - latest.json: what Orb on Tauri (3.8.1 and later) reads (tauri-plugin-updater): the version, the installer's
//     address and its minisign signature (the .sig made with Orb's updater key: TAURI_SIGNING_PRIVATE_KEY).
//   - latest.yml: what Orb 3.8.0 (Electron, electron-updater) reads, pointing at the same installer with its sha512 and
//     size and no blockmap (electron-updater then downloads it whole). That installer removes Orb on Electron and opens
//     the new one (src-tauri/nsis/hooks.nsh): the bridge from 3.8.0 without uninstalling by hand.
//   - Orb-<version>-instalador.exe: a copy under the name the website has always linked.
//   node scripts/release-manifests.mjs --setup <Orb_x.y.z_x64-setup.exe> [--sig <file.sig>] [--out <folder>]
//                                      [--version x.y.z] [--base <download address>] [--notes <text>]
// --base: where the files will be (default: the GitHub release of that version); a local feed for tests passes
// http://127.0.0.1:<port>/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'danielfinchdev/orb-dev';

export const releaseBase = (version) => `https://github.com/${REPO}/releases/download/v${version}/`;

// electron-updater compares the sha512 of the file it downloaded with this one, in base64.
export function fileFacts(file) {
  const bytes = fs.readFileSync(file);
  return { name: path.basename(file), size: bytes.length, sha512: crypto.createHash('sha512').update(bytes).digest('base64') };
}

const yamlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function latestYml({ version, file, date }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file.name}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`,
    `path: ${file.name}`,
    `sha512: ${file.sha512}`,
    `releaseDate: ${yamlString(date)}`,
    ''
  ].join('\n');
}

export function latestJson({ version, notes, date, url, signature }) {
  const entry = { signature, url };
  // The plugin looks for "<target>-<installer>" first, then "<target>".
  return { version, notes: notes ?? '', pub_date: date, platforms: { 'windows-x86_64-nsis': entry, 'windows-x86_64': entry } };
}

export function makeManifests({ setup, sig, out, version, base, notes, date = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`versión no válida: ${version}`);
  const file = fileFacts(setup);
  if (!file.name.includes(version)) throw new Error(`${file.name} no es el instalador de la ${version}`);
  const signature = fs.readFileSync(sig ?? `${setup}.sig`, 'utf8').trim();
  // A minisign signature (base64 of its four lines): its trusted comment (covered by the signature) must name this
  // installer and this version (Orb's updater requires it: plugins.updater.requireSignedVersion).
  const trusted = /^trusted comment: (.*)$/m.exec(Buffer.from(signature, 'base64').toString('utf8'))?.[1] ?? '';
  const fields = Object.fromEntries(trusted.split('	').map((f) => [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)]));
  if (fields.file !== file.name) throw new Error(`${sig ?? `${setup}.sig`} no es la firma de ${file.name}`);
  if (fields.version !== version) throw new Error(`la firma no lleva la versión ${version} (firma con: tauri signer sign --app-version ${version})`);
  const where = base ?? releaseBase(version);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'latest.json'), `${JSON.stringify(latestJson({ version, notes, date, url: new URL(file.name, where).href, signature }), null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'latest.yml'), latestYml({ version, file, date }));
  fs.copyFileSync(setup, path.join(out, `Orb-${version}-instalador.exe`));
  // The installer and its signature next to the manifests (one folder to publish).
  if (path.resolve(out) !== path.resolve(path.dirname(setup))) {
    fs.copyFileSync(setup, path.join(out, file.name));
    fs.writeFileSync(path.join(out, `${file.name}.sig`), signature);
  }
  return { file, signature };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const setup = arg('setup');
  if (!setup) { console.error('uso: node scripts/release-manifests.mjs --setup <Orb_x.y.z_x64-setup.exe> [--sig f] [--out dir] [--version v] [--base url] [--notes texto]'); process.exit(2); }
  const version = arg('version') ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const out = arg('out') ?? path.dirname(setup);
  const { file } = makeManifests({ setup, sig: arg('sig'), out, version, base: arg('base'), notes: arg('notes') });
  console.log(`${out}: latest.json, latest.yml y Orb-${version}-instalador.exe (${file.name}, ${file.size} bytes)`);
}
