// 3.5: the bots' server tools. Reading is free (srv_status, srv_logs); changes are a closed list the user approves on a
// card (srv_propose → the engine runs runServerAction). Nothing runs through a shell or with sudo: when an action needs
// root, the answer says so and gives the command for the user. Never anything the user protected (config.protected:
// «Cosas que nadie toca»).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { tr } from './context.mjs';
import { redactSecrets, oneLine } from './safety.mjs';
import { protectedHit } from './guard.mjs';

const IS_LINUX = process.platform === 'linux';
const NAME = /^[A-Za-z0-9][\w.@-]{0,99}$/;
export const SERVER_ACTIONS = ['docker_restart', 'docker_update', 'systemd_restart', 'clean_journal', 'clean_apt'];

// A program and its arguments (never a shell), with a time limit. → { ok, out, code, missing }
export function run(cmd, args, { cwd, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
        resolve({ ok: !error, code: error?.code ?? 0, missing: error?.code === 'ENOENT', out: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim() });
      });
    } catch (error) { resolve({ ok: false, missing: true, out: error.message }); }
  });
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
function disk(dir) {
  try { const s = fs.statfsSync(dir); const total = s.blocks * s.bsize; const free = s.bavail * s.bsize; return { path: dir, total: gb(total), free: gb(free), usedPct: Math.round((1 - free / total) * 100) }; } catch { return null; }
}

// How the machine is now: CPU, memory, disks and how long it has been on; on Linux also the containers and the failed
// services (when docker / systemctl are there). Windows: the reduced version (no containers or services).
export async function serverStatus() {
  const load = os.loadavg();
  const out = {
    host: os.hostname(), system: `${os.type()} ${os.release()}`, uptimeHours: Math.round(os.uptime() / 360) / 10,
    cpu: { cores: os.cpus().length, load1: load[0], load5: load[1], load15: load[2] },
    memory: { total: gb(os.totalmem()), free: gb(os.freemem()), usedPct: Math.round((1 - os.freemem() / os.totalmem()) * 100) },
    disks: (process.platform === 'win32' ? ['C:\\'] : ['/', '/home']).map(disk).filter(Boolean)
  };
  if (!IS_LINUX) return { ...out, note: tr('sys.srv.reduced') };
  const ps = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}']);
  out.containers = ps.missing ? null : ps.ok ? ps.out.split('\n').filter(Boolean).map((l) => { const [name, status, image] = l.split('\t'); return { name, status, image }; }) : { error: oneLine(ps.out, 300) };
  const failed = [];
  for (const scope of [[], ['--user']]) {
    const r = await run('systemctl', [...scope, '--failed', '--no-legend', '--plain', '--no-pager']);
    if (r.missing) { out.services = null; break; }
    if (r.ok) for (const l of r.out.split('\n').filter(Boolean)) failed.push({ unit: l.split(/\s+/)[0], user: scope.length > 0 });
  }
  if (out.services !== null) out.failedServices = failed;
  return out;
}

// The last lines of a container's or a service's log, with anything that looks like a key hidden.
export async function serverLogs({ kind = 'docker', name, lines = 80, user = false } = {}) {
  if (!NAME.test(String(name ?? ''))) throw new Error(tr('sys.srv.badName'));
  { const hit = protectedHit(name); if (hit) throw new Error(tr('sys.srv.protected', { name: hit })); }
  const n = Math.min(Math.max(Number(lines) || 80, 5), 400);
  if (!IS_LINUX) throw new Error(tr('sys.srv.linuxOnly'));
  const r = kind === 'journal'
    ? await run('journalctl', [...(user ? ['--user'] : []), '-u', name, '-n', String(n), '--no-pager', '-o', 'short-iso'])
    : await run('docker', ['logs', '--tail', String(n), name]);
  if (r.missing) throw new Error(tr('sys.srv.noProgram', { program: kind === 'journal' ? 'journalctl' : 'docker' }));
  return redactSecrets(r.out).slice(-20_000);
}

// A proposal as the bot wrote it, checked: one of the actions and its target. Throws for the bot.
export function checkServerAction(a) {
  if (!SERVER_ACTIONS.includes(a?.action)) throw new Error(tr('sys.srv.badAction', { list: SERVER_ACTIONS.join(', ') }));
  const reason = oneLine(String(a.reason ?? ''), 300).trim();
  if (!reason) throw new Error(tr('sys.pc.needsReason'));
  const p = { action: a.action, reason };
  if (a.action === 'docker_restart' || a.action === 'systemd_restart') {
    const target = String(a.target ?? '').trim();
    if (!NAME.test(target)) throw new Error(tr('sys.srv.badName'));
    p.target = target;
  }
  if (a.action === 'docker_update') {
    const dir = String(a.target ?? '').trim();
    if (!path.isAbsolute(dir)) throw new Error(tr('sys.srv.composeDir'));
    p.target = path.resolve(dir);
  }
  { const hit = protectedHit(JSON.stringify(p)); if (hit) throw new Error(tr('sys.srv.protected', { name: hit })); }
  return p;
}

// Runs an approved action (engine only). → { ok, summary, sudo? }
export async function runServerAction(a) {
  const p = checkServerAction(a);
  if (!IS_LINUX) return { ok: false, summary: tr('sys.srv.linuxOnly') };
  const done = (r, what) => ({ ok: r.ok, summary: r.ok ? tr('sys.srv.done', { what }) : `${tr('sys.srv.failed', { what })} ${oneLine(redactSecrets(r.out), 600)}` });
  if (p.action === 'docker_restart') return done(await run('docker', ['restart', p.target], { timeoutMs: 120_000 }), `docker restart ${p.target}`);
  if (p.action === 'systemd_restart') return done(await run('systemctl', ['--user', 'restart', p.target], { timeoutMs: 120_000 }), `systemctl --user restart ${p.target}`);
  if (p.action === 'docker_update') {
    if (!['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].some((f) => fs.existsSync(path.join(p.target, f)))) return { ok: false, summary: tr('sys.srv.noCompose', { dir: p.target }) };
    const pull = await run('docker', ['compose', 'pull'], { cwd: p.target, timeoutMs: 15 * 60_000 });
    if (!pull.ok) return done(pull, 'docker compose pull');
    return done(await run('docker', ['compose', 'up', '-d'], { cwd: p.target, timeoutMs: 10 * 60_000 }), `docker compose pull + up -d (${p.target})`);
  }
  if (p.action === 'clean_journal') return done(await run('journalctl', ['--user', '--vacuum-time=14d'], { timeoutMs: 120_000 }), 'journalctl --user --vacuum-time=14d');
  if (p.action === 'clean_apt') {
    // The package cache belongs to root: without sudo Orb only says how to do it.
    try { fs.accessSync('/var/cache/apt/archives', fs.constants.W_OK); } catch { return { ok: false, sudo: true, summary: tr('sys.srv.needsSudo', { command: 'sudo apt-get clean' }) }; }
    return done(await run('apt-get', ['clean'], { timeoutMs: 120_000 }), 'apt-get clean');
  }
  return { ok: false, summary: tr('sys.srv.badAction', { list: SERVER_ACTIONS.join(', ') }) };
}

// ---- Home Assistant (REST API with a long-lived token)
export async function haFetch({ url, token }, method, apiPath, body) {
  if (!url || !token) throw new Error(tr('sys.ha.notSet'));
  const res = await fetch(`${url}/api/${apiPath.replace(/^\/+/, '')}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(tr('sys.ha.failed', { status: res.status, text: oneLine(text, 200) }));
  try { return JSON.parse(text); } catch { return text; }
}
export const HA_ID = /^[a-z_]+(\.[a-z0-9_]+)?$/;
