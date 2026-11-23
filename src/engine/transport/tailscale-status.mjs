// Tailscale as Orb's «account»: what the PC reads from the local Tailscale client (installed, signed in, the devices of
// the same account) and how the sign-in is started. Tailscale only says WHERE a device is and that it belongs to the
// same account: it never links anything. Linking still needs the pairing code and the master password.
import { execFile } from 'node:child_process';
import { tailscaleExe } from './remote-net.mjs';

const CGNAT = (ip) => { const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(String(ip)); return Boolean(m && Number(m[1]) >= 64 && Number(m[1]) <= 127); };
const clean = (s, n = 80) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const dnsOf = (s) => (s ? String(s).replace(/\.$/, '').toLowerCase().slice(0, 255) : null);
// the OS as a short word the list can translate; Tailscale writes «windows», «android», «iOS», «macOS», «linux»…
const osOf = (s) => { const o = String(s ?? '').toLowerCase(); return ['windows', 'android', 'ios', 'macos', 'linux'].find((x) => o === x) ?? (o ? 'other' : null); };

function deviceOf(raw, self = false) {
  const ips = (raw?.TailscaleIPs ?? []).filter((ip) => typeof ip === 'string');
  const ip = ips.find((x) => CGNAT(x)) ?? null;
  return { name: clean(raw?.HostName || String(raw?.DNSName ?? '').split('.')[0], 63), dns: dnsOf(raw?.DNSName), ip, os: osOf(raw?.OS), online: self ? raw?.Online !== false : raw?.Online === true,
    lastSeen: !self && raw?.LastSeen && !String(raw.LastSeen).startsWith('0001') ? clean(raw.LastSeen, 40) : null, self };
}

// `tailscale status --json` → what the window shows. Pure: no command, no log. state: 'running' | 'needsLogin' |
// 'stopped' | 'starting'. Peers shared in from another tailnet or tagged servers are listed like the rest.
export function parseTailscaleStatus(json) {
  let st; try { st = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { installed: true, state: 'unknown', devices: [], self: null, account: null, tailnet: null }; }
  if (!st || typeof st !== 'object') return { installed: true, state: 'unknown', devices: [], self: null, account: null, tailnet: null };
  const backend = String(st.BackendState ?? '');
  const state = backend === 'Running' ? 'running' : backend === 'NeedsLogin' || backend === 'NeedsMachineAuth' ? 'needsLogin' : backend === 'Stopped' ? 'stopped' : backend === 'Starting' ? 'starting' : 'unknown';
  const self = st.Self ? deviceOf(st.Self, true) : null;
  const user = st.User?.[st.Self?.UserID];
  const peers = Object.values(st.Peer ?? {}).map((p) => deviceOf(p)).filter((d) => d.name);
  return {
    installed: true, state, self,
    account: clean(user?.LoginName, 120) || null, // shown on this PC's screen only, never logged
    tailnet: clean(st.CurrentTailnet?.Name, 120) || null,
    suffix: dnsOf(st.CurrentTailnet?.MagicDNSSuffix),
    devices: peers.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  };
}

const run = (args, { timeoutMs = 8000 } = {}) => new Promise((resolve) => {
  execFile(tailscaleExe(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, missing: error?.code === 'ENOENT', out: String(stdout ?? ''), err: String(stderr ?? '') }));
});

// The state of Tailscale on this PC. `exec` stands in for the command in tests.
export async function tailscaleInfo({ exec = run } = {}) {
  const r = await exec(['status', '--json']);
  if (r.missing) return { installed: false, state: 'missing', devices: [], self: null, account: null, tailnet: null };
  // `status` exits non-zero while signed out but still prints the JSON
  if (!r.out.trim()) return { installed: !r.missing, state: 'stopped', devices: [], self: null, account: null, tailnet: null };
  return parseTailscaleStatus(r.out);
}

// Starts the sign-in: `tailscale up` prints the page to sign in at (Google, GitHub, Microsoft…) and waits for it, so the
// command is left to finish by itself and only the first address is returned for the window to open. Nothing else about
// Tailscale's settings is changed.
export async function tailscaleLogin({ exec = (args, o) => new Promise((resolve) => {
  const child = execFile(tailscaleExe(), args, { windowsHide: true, timeout: 600_000 }, () => {}); // the person may take minutes to sign in
  let buf = ''; let done = false;
  const finish = (v) => { if (!done) { done = true; resolve(v); } };
  const take = (d) => { buf += String(d); const m = /https:\/\/login\.tailscale\.com\/[^\s"']+/.exec(buf); if (m) finish({ ok: true, url: m[0] }); };
  child.stdout?.on('data', take); child.stderr?.on('data', take);
  child.on('error', (e) => finish({ ok: false, missing: e.code === 'ENOENT' }));
  child.on('exit', () => finish({ ok: false }));
  setTimeout(() => finish({ ok: false }), o.timeoutMs).unref?.();
}) } = {}) {
  const r = await exec(['up'], { timeoutMs: 20_000 });
  if (r.missing) return { started: false, missing: true, url: null };
  return { started: Boolean(r.ok && r.url), url: r.ok && /^https:\/\/login\.tailscale\.com\//.test(r.url ?? '') ? r.url : null };
}

// Which of Tailscale's devices are phones linked to this Orb: the address that linked device last connected from is the
// device's Tailscale address (or, failing that, the same name). → the devices with `orbDevice` (the linked device's name) or null.
export function markLinked(devices, linked = []) {
  const byIp = new Map((linked ?? []).filter((d) => d?.ip).map((d) => [String(d.ip).replace(/^::ffff:/, ''), d]));
  // over `tailscale serve` a phone arrives through loopback, so its address was not kept: its name is the fallback
  const byName = new Map((linked ?? []).filter((d) => d?.name).map((d) => [String(d.name).toLowerCase(), d]));
  return (devices ?? []).map((d) => ({ ...d, orbDevice: (d.ip && byIp.get(d.ip)?.name) || byName.get(String(d.name).toLowerCase())?.name || null }));
}
