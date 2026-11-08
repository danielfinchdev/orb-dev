// Publishing a Windows release, on the owner's PC only (review D9 A1/M1): the updater key never goes to GitHub Actions,
// which only builds and tests (.github/workflows/release.yml).
//   npm run release:firmar -- [<version>] [--setup <Orb_x.y.z_x64-setup.exe>] [--run <id>] [--draft] [--dry-run]
// 1. The installer: the one release.yml built for that version (its artifact orb-windows-<version>, from the newest
//    successful run, or --run), or a local one (--setup).
// 2. Signed with the updater key (TAURI_SIGNING_PRIVATE_KEY_PATH, default C:\orb-project\claves\orb-updater.key; its
//    password from TAURI_SIGNING_PRIVATE_KEY_PASSWORD or asked here), for that version (the updater requires it), and
//    checked to be the key whose public half is in src-tauri/tauri.conf.json (never the retired or the test one).
// 3. latest.json (Orb on Tauri), latest.yml (Orb 3.8.0's updater: the bridge) and Orb-<version>-instalador.exe
//    (scripts/release-manifests.mjs).
// 4. Release v<version> created with gh (notes: docs/CHANGELOG.md), as the latest one (--draft: as a draft). --dry-run
//    stops before it and says where the files are.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeManifests, releaseBase, REPO } from './release-manifests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a)) ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
let out = null; // the folder with what is published (kept only when it all went well)
const fail = (text) => { console.error(`✖ ${text}`); if (out) fs.rmSync(out, { recursive: true, force: true }); process.exit(1); };

// The key id of a minisign public key or signature (base64 of its text; the second line: algorithm (2) + key id (8) + …).
export function keyId(base64Text) {
  const line = Buffer.from(base64Text.trim(), 'base64').toString('utf8').split('\n')[1] ?? '';
  return Buffer.from(line.trim(), 'base64').subarray(2, 10).toString('hex');
}

async function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close(); process.stdout.write('\n');
  return answer;
}

async function main() {
  out = fs.mkdtempSync(path.join(os.tmpdir(), `orb-release-${version}-`));
  // 1. The installer
  let setup = arg('setup'); let target = null;
  if (!setup) {
    let run = arg('run');
    if (!run) {
      const runs = JSON.parse(gh(['run', 'list', '--repo', REPO, '--workflow', 'release.yml', '--status', 'success', '--limit', '20', '--json', 'databaseId,headSha,createdAt']));
      for (const r of runs) {
        const artifacts = JSON.parse(gh(['api', `repos/${REPO}/actions/runs/${r.databaseId}/artifacts`, '--jq', '[.artifacts[].name]']));
        if (artifacts.includes(`orb-windows-${version}`)) { run = String(r.databaseId); target = r.headSha; break; }
      }
      if (!run) fail(`ninguna ejecución correcta de release.yml tiene el instalador de la ${version}`);
    }
    gh(['run', 'download', run, '--repo', REPO, '--name', `orb-windows-${version}`, '--dir', out]);
    setup = path.join(out, `Orb_${version}_x64-setup.exe`);
    console.log(`instalador de la ejecución ${run}${target ? ` (commit ${target.slice(0, 7)})` : ''}`);
  } else {
    fs.copyFileSync(setup, path.join(out, path.basename(setup)));
    setup = path.join(out, path.basename(setup));
  }
  if (!fs.existsSync(setup)) fail(`no existe ${setup}`);
  if (path.basename(setup) !== `Orb_${version}_x64-setup.exe`) fail(`${path.basename(setup)} no es el instalador de la ${version}`);

  // 2. Signed, with the key tauri.conf.json trusts
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || 'C:\\orb-project\\claves\\orb-updater.key';
  if (!fs.existsSync(key)) fail(`no existe la clave ${key}`);
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? await askHidden('Contraseña de la clave del actualizador: ');
  const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PATH: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'signer', 'sign', '--app-version', version, setup], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  const pubkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater.pubkey;
  const signature = fs.readFileSync(`${setup}.sig`, 'utf8');
  if (keyId(signature) !== keyId(pubkey)) fail(`firmado con la clave ${keyId(signature)}, pero Orb confía en ${keyId(pubkey)} (tauri.conf.json): ¿clave retirada o de pruebas?`);

  // 3. The manifests
  makeManifests({ setup, out, version, base: releaseBase(version) });
  const files = [`Orb_${version}_x64-setup.exe`, `Orb_${version}_x64-setup.exe.sig`, `Orb-${version}-instalador.exe`, 'latest.json', 'latest.yml'].map((f) => path.join(out, f));
  for (const f of files) if (!fs.existsSync(f)) fail(`falta ${f}`);
  console.log(`firmado y listo en ${out}`);
  if (flag('dry-run')) return;

  // 4. The release
  const notes = path.join(ROOT, 'docs', 'CHANGELOG.md');
  gh(['release', 'create', `v${version}`, '--repo', REPO, '--title', `Orb ${version}`, '--notes-file', notes, ...(target ? ['--target', target] : []), ...(flag('draft') ? ['--draft'] : ['--latest']), ...files], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`✔ release v${version} ${flag('draft') ? 'creada como borrador' : 'publicada'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => fail(e.stack ?? e.message));
