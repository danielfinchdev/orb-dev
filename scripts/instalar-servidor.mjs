// 3.5/3.7, `npm run servidor:instalar -- <servidor-ssh> [--dry-run] [--arch x64|arm64]`: installs or updates Orb Server on
// the Linux server over SSH, without questions (BatchMode: the SSH key must already work, e.g. a Host in ~/.ssh/config).
// It runs the same installer as the one-command install (dist/install.sh, made by `npm run dist:server`):
//   1. asks the server its processor (uname -m) and makes ~/.orb-server-paquetes
//   2. copies dist/install.sh and dist/orb-server-<version>-linux-<arch>.tar.gz there
//   3. runs install.sh --tarball …: checks the sums, unpacks into ~/orb-server/app/<version>, migrates an install from
//      before 3.7 (after a backup), installs and starts orb-server.service; sudo only if it needs no password (sudo -n):
//      otherwise it says the one command to run by hand
// --dry-run prints every step and runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15'];
export const PACKAGES = '.orb-server-paquetes';

const checkVersion = (version) => { if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) throw new Error(`versión no válida: ${version}`); };
export const archOf = (uname) => (/^(aarch64|arm64)$/.test(String(uname).trim()) ? 'arm64' : /^(x86_64|amd64)$/.test(String(uname).trim()) ? 'x64' : null);

// The script the server runs (POSIX sh): the installer, with the package already there.
export function remoteScript(version, arch = 'x64') {
  checkVersion(version);
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`procesador no válido: ${arch}`);
  return `set -eu
P="$HOME/${PACKAGES}"
TAR="$P/orb-server-${version}-linux-${arch}.tar.gz"
[ -f "$TAR" ] && [ -f "$P/install.sh" ] || { echo "falta el paquete en $P" >&2; exit 2; }
bash "$P/install.sh" --tarball "$TAR"
`;
}

// The steps: [{ what, cmd, args, input? }]. Nothing runs here.
export function plan({ host, version, arch = 'x64', dist = path.join(ROOT, 'dist') }) {
  if (!/^[\w.@-]{1,100}$/.test(String(host ?? ''))) throw new Error('falta el servidor SSH (por ejemplo: npm run servidor:instalar -- mi-servidor)');
  checkVersion(version);
  const name = `orb-server-${version}-linux-${arch}.tar.gz`;
  return [
    { what: 'preparar la carpeta del servidor', cmd: 'ssh', args: [...SSH_OPTS, host, `mkdir -p ${PACKAGES} && uname -m`] },
    // From its own folder: a Windows path (D:\…) could be taken for a host by scp.
    { what: `copiar install.sh y ${name}`, cmd: 'scp', args: [...SSH_OPTS, '-q', 'install.sh', name, `${host}:${PACKAGES}/`], cwd: dist },
    { what: 'instalar (sumas, copia de los datos, servicio)', cmd: 'ssh', args: [...SSH_OPTS, host, 'sh -s'], input: remoteScript(version, arch) }
  ];
}

// What the server answered, in plain words for the user.
export function explain(output, host) {
  const lines = [];
  const val = (k) => String(output).match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? null;
  lines.push(val('SERVICIO') === 'active' ? 'Orb Server está en marcha y arranca solo con el servidor.' : `El servicio no ha arrancado (${val('SERVICIO') ?? '?'}). Míralo con: ssh ${host} journalctl --user -u orb-server -n 50`);
  const by = String(output).match(/sudo sh (\S+admin-setup\.sh) (\S+) (\S+)/);
  if (val('ADMIN') !== 'si') lines.push(by ? `Falta un paso con sudo, una sola vez (encendido sin tu sesión y las acciones de administración). En el servidor escribe:\n  sudo sh ${by[1]} ${by[2]} ${by[3]}` : 'Sin acciones de administración (instalado sin sudo).');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const ai = args.indexOf('--arch');
  const host = args.find((a, i) => !a.startsWith('--') && (ai < 0 || i !== ai + 1));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  let arch = ai >= 0 ? args[ai + 1] : 'x64';
  const first = plan({ host, version, arch })[0];
  console.log(`${dry ? '[simulación] ' : ''}Orb Server ${version} → ${host}`);
  let output = '';
  const exec = (s) => spawnSync(s.cmd, s.args, { cwd: s.cwd, input: s.input, encoding: 'utf8', windowsHide: true, timeout: 15 * 60_000, stdio: [s.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  // 1: the processor decides the package (unless --arch says it)
  console.log(`1/3 ${first.what}`);
  if (dry) console.log(`  $ ${first.cmd} ${first.args.join(' ')}`);
  else {
    const r = exec(first);
    if (r.status !== 0) throw new Error(`${first.what}: ${(r.stderr || r.stdout || '').trim() || `código ${r.status}`}`);
    if (ai < 0) { arch = archOf(r.stdout.trim().split('\n').pop()); if (!arch) throw new Error(`procesador no compatible: ${r.stdout.trim()}`); }
  }
  const steps = plan({ host, version, arch });
  for (const f of ['install.sh', `orb-server-${version}-linux-${arch}.tar.gz`]) if (!dry && !fs.existsSync(path.join(ROOT, 'dist', f))) throw new Error(`no está dist/${f}: primero npm run dist:server`);
  for (const [i, s] of steps.slice(1).entries()) {
    console.log(`${i + 2}/3 ${s.what}`);
    if (dry) { console.log(`  $ ${s.cwd ? `(en ${s.cwd}) ` : ''}${s.cmd} ${s.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`); if (s.input) console.log(s.input.replace(/^/gm, '  | ')); continue; }
    const r = exec(s);
    if (r.status !== 0) throw new Error(`${s.what}: ${(r.stderr || r.stdout || r.error?.message || '').trim() || `código ${r.status}`}`);
    output += r.stdout ?? '';
  }
  if (!dry) console.log(explain(output, host));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`✖ ${error.message}`); process.exit(1); }
}
