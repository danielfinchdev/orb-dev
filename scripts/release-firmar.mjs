// Publishing a Windows release, on the owner's PC only (review D9 A1/M1): the updater key never goes to GitHub Actions,
// which only builds and tests (.github/workflows/release.yml).
//   npm run release:firmar -- [<version>] [--setup <Orb_x.y.z_x64-setup.exe>] [--run <id>] [--draft] [--dry-run]
// 0. The version must be newer than every published release (and than 3.8.0).
// 1. The installer: the one release.yml built for that version (its artifact orb-windows-<version>) from a run of the
//    tip of main: the newest successful push run, or --run (a push or a manual run, also of main). Checked (review D10
//    M2): the run's commit is main's tip now and package.json there says <version>; a local one (--setup) only from a
//    clean checkout whose HEAD is main's tip. Its Orb.exe (extracted with 7-Zip) must trust the updater key of
//    tauri.conf.json and hold nothing of a test build (scripts/tauri-check-release.mjs).
// 2. Signed with the updater key (TAURI_SIGNING_PRIVATE_KEY_PATH, default C:\orb-project\claves\orb-updater.key; its
//    password from TAURI_SIGNING_PRIVATE_KEY_PASSWORD or asked here), for that version (the updater requires it), and
//    checked to be the key whose public half is in src-tauri/tauri.conf.json (never the retired or the test one).
// 3. latest.json (Orb on Tauri), latest.yml (Orb 3.8.0's updater: the bridge) and Orb-<version>-instalador.exe
//    (scripts/release-manifests.mjs).
// 4. An annotated tag v<version> on that commit (pushed), and release v<version> created with gh on it (notes: the
//    download section and «What's new in <version>» of docs/CHANGELOG.md), as the latest one (--draft: as a draft).
//    --dry-run stops before it and says where the files are.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeManifests, releaseBase, REPO } from './release-manifests.mjs';
import { releaseProblems } from './tauri-check-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a)) ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
let out = null; // the folder with what is published (kept only when it all went well)
const fail = (text) => { console.error(`✖ ${text}`); if (out) fs.rmSync(out, { recursive: true, force: true }); process.exit(1); };

// The key id of a minisign public key or signature (base64 of its text; the second line: algorithm (2) + key id (8) + …).
export function keyId(base64Text) {
  const line = Buffer.from(base64Text.trim(), 'base64').toString('utf8').split('\n')[1] ?? '';
  return Buffer.from(line.trim(), 'base64').subarray(2, 10).toString('hex');
}

// a > b for x.y.z versions.
export function newer(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

// The release notes: the download section and «## What's new in <version>» of the changelog (not all of it).
export function releaseNotes(changelog, version) {
  const parts = changelog.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  const download = parts.find((p) => p.startsWith('## Download\n'));
  const news = parts.find((p) => p.startsWith(`## What's new in ${version}\n`));
  if (!download || !news) return null;
  return `${download.trim()}\n\n${news.trim()}\n`;
}

const SEVEN_ZIP = () => [process.env.ORB_7Z, path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe'), path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', '7-Zip', '7z.exe')].find((f) => f && fs.existsSync(f));

async function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close(); process.stdout.write('\n');
  return answer;
}

async function main() {
  // 0. Newer than what is published
  const published = JSON.parse(gh(['release', 'list', '--repo', REPO, '--limit', '100', '--json', 'tagName,isDraft']))
    .filter((r) => !r.isDraft && /^v\d+\.\d+\.\d+$/.test(r.tagName)).map((r) => r.tagName.slice(1));
  const last = published.reduce((m, v) => (newer(v, m) ? v : m), '3.8.0');
  if (!newer(version, last)) fail(`la ${version} no es más nueva que la ${last} (última publicada)`);
  out = fs.mkdtempSync(path.join(os.tmpdir(), `orb-release-${version}-`));
  // 1. The installer, from main's tip
  const mainSha = gh(['api', `repos/${REPO}/commits/main`, '--jq', '.sha']).trim();
  const versionAt = (sha) => JSON.parse(Buffer.from(JSON.parse(gh(['api', `repos/${REPO}/contents/package.json?ref=${sha}`])).content, 'base64').toString('utf8')).version;
  let setup = arg('setup'); let target = null;
  if (!setup) {
    let run = arg('run');
    if (run) {
      const r = JSON.parse(gh(['run', 'view', run, '--repo', REPO, '--json', 'headSha,headBranch,event,conclusion,workflowName,status']));
      if (r.workflowName !== 'Release build' || r.status !== 'completed' || r.conclusion !== 'success') fail(`la ejecución ${run} no es una de release.yml terminada bien (${r.workflowName}, ${r.conclusion})`);
      if (r.headBranch !== 'main' || !['push', 'workflow_dispatch'].includes(r.event)) fail(`la ejecución ${run} es de ${r.headBranch} (${r.event}), no de main`);
      target = r.headSha;
    } else {
      const runs = JSON.parse(gh(['run', 'list', '--repo', REPO, '--workflow', 'release.yml', '--branch', 'main', '--event', 'push', '--status', 'success', '--limit', '20', '--json', 'databaseId,headSha,headBranch,event']));
      for (const r of runs) {
        if (r.headBranch !== 'main' || r.event !== 'push') continue;
        const artifacts = JSON.parse(gh(['api', `repos/${REPO}/actions/runs/${r.databaseId}/artifacts`, '--jq', '[.artifacts[].name]']));
        if (artifacts.includes(`orb-windows-${version}`)) { run = String(r.databaseId); target = r.headSha; break; }
      }
      if (!run) fail(`ninguna ejecución correcta de release.yml en main (push) tiene el instalador de la ${version}`);
    }
    if (target !== mainSha) fail(`la ejecución ${run} compiló ${target.slice(0, 7)}, pero main está en ${mainSha.slice(0, 7)}: vuelve a compilar o publica desde la punta de main`);
    gh(['run', 'download', run, '--repo', REPO, '--name', `orb-windows-${version}`, '--dir', out]);
    setup = path.join(out, `Orb_${version}_x64-setup.exe`);
    console.log(`instalador de la ejecución ${run} (commit ${target.slice(0, 7)})`);
  } else {
    // A local installer: only from a clean checkout of main's tip (so the tag points at what was built).
    target = git(['rev-parse', 'HEAD']);
    if (git(['status', '--porcelain', '--untracked-files=no'])) fail('hay cambios sin commitear: el instalador local no sería el de ningún commit');
    if (target !== mainSha) fail(`HEAD (${target.slice(0, 7)}) no es la punta de main en GitHub (${mainSha.slice(0, 7)})`);
    fs.copyFileSync(setup, path.join(out, path.basename(setup)));
    setup = path.join(out, path.basename(setup));
  }
  if (!fs.existsSync(setup)) fail(`no existe ${setup}`);
  if (path.basename(setup) !== `Orb_${version}_x64-setup.exe`) fail(`${path.basename(setup)} no es el instalador de la ${version}`);
  if (versionAt(target) !== version) fail(`package.json en ${target.slice(0, 7)} no dice ${version}`);
  // Its Orb.exe: a normal build that trusts the updater key of tauri.conf.json (not an old one, not the test one).
  const sevenZip = SEVEN_ZIP();
  if (!sevenZip) fail('falta 7-Zip (o ORB_7Z) para mirar el Orb.exe del instalador');
  const inside = path.join(out, 'dentro');
  execFileSync(sevenZip, ['e', '-y', `-o${inside}`, setup, 'Orb.exe'], { stdio: 'ignore' });
  const exe = path.join(inside, 'Orb.exe');
  if (!fs.existsSync(exe)) fail('el instalador no tiene Orb.exe');
  const problems = releaseProblems(fs.readFileSync(exe));
  fs.rmSync(inside, { recursive: true, force: true });
  if (problems.length) fail(`el Orb.exe del instalador no se publica: ${problems.join(', ')}`);
  const notesText = releaseNotes(fs.readFileSync(path.join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8'), version);
  if (!notesText) fail(`docs/CHANGELOG.md no tiene «## Download» y «## What's new in ${version}»`);

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

  // 4. The annotated tag on the commit that was built, then the release on it
  const notes = path.join(os.tmpdir(), `orb-notas-${version}-${process.pid}.md`);
  fs.writeFileSync(notes, notesText);
  git(['fetch', 'origin', 'main', '--tags']);
  const tagged = (() => { try { return git(['rev-parse', '--verify', '--quiet', `v${version}^{commit}`]); } catch { return null; } })();
  if (tagged && tagged !== target) fail(`la etiqueta v${version} ya existe en otro commit (${tagged.slice(0, 7)})`);
  if (!tagged) { git(['tag', '-a', `v${version}`, target, '-m', `Orb ${version}`]); git(['push', 'origin', `refs/tags/v${version}`]); }
  try {
    gh(['release', 'create', `v${version}`, '--repo', REPO, '--verify-tag', '--title', `Orb ${version}`, '--notes-file', notes, '--target', target, ...(flag('draft') ? ['--draft'] : ['--latest']), ...files], { stdio: ['ignore', 'inherit', 'inherit'] });
  } finally { fs.rmSync(notes, { force: true }); }
  console.log(`✔ release v${version} ${flag('draft') ? 'creada como borrador' : 'publicada'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => fail(e.stack ?? e.message));
