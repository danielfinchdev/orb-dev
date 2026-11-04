// 3.5, `npm run servidor:instalar -- <servidor-ssh> [--dry-run] [--tar <archivo>]`: installs or updates Orb Server on
// the Linux server over SSH, without questions (BatchMode: the SSH key must already work, e.g. a Host in ~/.ssh/config).
//   1. copies dist/orb-server-<version>-linux-x64.tar.gz to ~/orb-nucleo/paquetes
//   2. stops the service and keeps a copy of ~/orb/.orb/datos in ~/orb-nucleo/copias (before any update)
//   3. unpacks it in ~/orb-nucleo/<version> and points ~/orb-nucleo/current to it
//   4. installs ~/.config/systemd/user/orb-nucleo.service, daemon-reload and enable --now
//   5. loginctl enable-linger (only with `sudo -n`: if it needs a password, it says what to run once by hand)
// --dry-run prints every step and runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15'];

// The script the server runs (POSIX sh). Its last lines say how linger and Tailscale's operator are (LINGER=…, TS=…).
export function remoteScript(version) {
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) throw new Error(`versión no válida: ${version}`);
  return `set -eu
V='${version}'
B="$HOME/orb-nucleo"
TAR="$B/paquetes/orb-server-$V-linux-x64.tar.gz"
UNIT="$HOME/.config/systemd/user/orb-nucleo.service"
[ -f "$TAR" ] || { echo "falta $TAR" >&2; exit 2; }
# The engine stops before its data is copied (the database must not change while it is copied).
systemctl --user stop orb-nucleo 2>/dev/null || true
if [ -d "$HOME/orb/.orb/datos" ]; then
  mkdir -p "$B/copias"
  STAMP=$(date +%Y%m%d-%H%M%S)
  tar -czf "$B/copias/datos-antes-$V-$STAMP.tar.gz" -C "$HOME/orb/.orb" datos
  echo "COPIA=$B/copias/datos-antes-$V-$STAMP.tar.gz"
fi
rm -rf "$B/.nuevo"; mkdir -p "$B/.nuevo"
tar -xzf "$TAR" -C "$B/.nuevo"
rm -rf "$B/$V"
mv "$B/.nuevo/orb-server-$V" "$B/$V"
rmdir "$B/.nuevo"
"$B/$V/node/bin/node" --version >/dev/null
ln -sfn "$V" "$B/current.nuevo"
mv -Tf "$B/current.nuevo" "$B/current"
mkdir -p "$HOME/.config/systemd/user"
cp "$B/current/orb-nucleo.service" "$UNIT"
systemctl --user daemon-reload
systemctl --user enable --now orb-nucleo
sleep 3
echo "SERVICIO=$(systemctl --user is-active orb-nucleo || true)"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" = yes ]; then echo LINGER=si
elif sudo -n loginctl enable-linger "$USER" >/dev/null 2>&1; then echo LINGER=si
else echo LINGER=falta; fi
if command -v tailscale >/dev/null 2>&1; then
  if tailscale serve status >/dev/null 2>&1 || sudo -n tailscale set --operator="$USER" >/dev/null 2>&1; then echo TS=si; else echo TS=falta; fi
else echo TS=no; fi
`;
}

// The steps: [{ what, cmd, args, input? }]. Nothing runs here.
export function plan({ host, version, tarball }) {
  if (!/^[\w.@-]{1,100}$/.test(String(host ?? ''))) throw new Error('falta el servidor SSH (por ejemplo: npm run servidor:instalar -- mi-servidor)');
  const name = `orb-server-${version}-linux-x64.tar.gz`;
  return [
    { what: 'preparar la carpeta del servidor', cmd: 'ssh', args: [...SSH_OPTS, host, 'mkdir -p orb-nucleo/paquetes'] },
    // From its own folder: a Windows path (D:\…) could be taken for a host by scp.
    { what: `copiar ${name}`, cmd: 'scp', args: [...SSH_OPTS, '-q', path.basename(tarball), `${host}:orb-nucleo/paquetes/${name}`], cwd: path.dirname(tarball) },
    { what: 'copia de los datos, descomprimir, servicio y linger', cmd: 'ssh', args: [...SSH_OPTS, host, 'sh -s'], input: remoteScript(version) }
  ];
}

// What the server answered, in plain words for the user.
export function explain(output, host) {
  const lines = [];
  const val = (k) => String(output).match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? null;
  if (val('COPIA')) lines.push(`Copia de tus datos: ${val('COPIA')}`);
  lines.push(val('SERVICIO') === 'active' ? 'Orb Server está en marcha.' : `El servicio no ha arrancado (${val('SERVICIO') ?? '?'}). Míralo con: ssh ${host} journalctl --user -u orb-nucleo -n 50`);
  if (val('LINGER') !== 'si') lines.push(`Falta un paso con sudo, una sola vez, para que siga encendido sin tu sesión abierta. En el servidor escribe:\n  sudo loginctl enable-linger $USER`);
  if (val('TS') === 'falta') lines.push('Para que el móvil entre por Tailscale con https, escribe una vez en el servidor:\n  sudo tailscale set --operator=$USER');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const ti = args.indexOf('--tar');
  const host = args.find((a, i) => !a.startsWith('--') && (ti < 0 || i !== ti + 1));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const tarball = path.resolve(ti >= 0 ? args[ti + 1] : path.join(ROOT, 'dist', `orb-server-${version}-linux-x64.tar.gz`));
  const steps = plan({ host, version, tarball });
  if (!dry && !fs.existsSync(tarball)) throw new Error(`no está ${tarball}: primero npm run dist:servidor`);
  console.log(`${dry ? '[simulación] ' : ''}Orb Server ${version} → ${host}`);
  let output = '';
  for (const [i, s] of steps.entries()) {
    console.log(`${i + 1}/${steps.length} ${s.what}`);
    if (dry) { console.log(`  $ ${s.cwd ? `(en ${s.cwd}) ` : ''}${s.cmd} ${s.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`); if (s.input) console.log(s.input.replace(/^/gm, '  | ')); continue; }
    const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, input: s.input, encoding: 'utf8', windowsHide: true, timeout: 15 * 60_000, stdio: [s.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) throw new Error(`${s.what}: ${(r.stderr || r.stdout || r.error?.message || '').trim() || `código ${r.status}`}`);
    output += r.stdout ?? '';
  }
  if (!dry) console.log(explain(output, host));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`✖ ${error.message}`); process.exit(1); }
}
