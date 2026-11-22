// Network identity of the PC for the phone link: private-source checks, device names, Tailscale and LAN addresses, and the attention-only server.
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ctx, tr } from '../../platform/context.mjs';
import { oneLine } from '../../shared/text.mjs';
import { quickRun } from '../../agents/index.mjs';
import { IS_WIN } from '../../platform/proc.mjs';
import { ownPorts } from '../host/host.mjs';
import { PAIR_KINDS } from './remote-common.mjs';
import { TYPES, HEADERS } from './remote-web.mjs';

// only the home network, Tailscale and this PC itself may talk to Orb: 127.0.0.0/8, 10/8, 172.16/12, 192.168/16,
// 100.64/10 (Tailscale) and, in IPv6, ::1 and Tailscale's fd7a:115c:a1e0::/48.
export function privateSource(address) {
  let ip = String(address ?? '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return true;
  if (/^fd7a:115c:a1e0:/.test(ip)) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
// The name another device sees for this Orb: the one set in Ajustes, or the computer's name.
export const orbNameOf = (config) => oneLine(String(config?.mobile?.name || os.hostname() || config?.assistantName || 'Orb'), 60);
const ipOf = (req) => String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
const kindOf = (proof) => (PAIR_KINDS.includes(proof?.kind) ? proof.kind : /iphone|ipad|android/i.test(String(proof?.name ?? '')) ? 'phone' : 'browser');
// the kind of a new device: the one the QR was made for. A QR made without saying takes what a phone or a browser
// says it is (they have the same rights). Another Orb or an Orb Terminal is never linked (null).
export function kindForPairing(issued, claimed) {
  if (claimed === 'orb' || claimed === 'terminal') return null;
  if (PAIR_KINDS.includes(issued)) return issued;
  return PAIR_KINDS.includes(claimed) ? claimed : 'phone';
}
// «<computer>.local» when the computer's name is a valid host name (letters, digits and dashes).
export const localName = (host = os.hostname()) => { const h = String(host ?? '').toLowerCase().replace(/\.local$/, ''); return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(h) ? `${h}.local` : null; };
const isLoopback = (ip) => /^(127\.|::1$)/.test(String(ip ?? '').replace(/^::ffff:/, ''));
// whether a pairing comes from a browser's page over plain http on the home network: not a program (no Origin: another
// Orb), not the Android app, not this PC (or Tailscale's https, which arrives through loopback), not the
// Tailscale address. Never otherwise: the master password is typed in that page.
export function plainHttpBrowser({ origin, app = false, localAddress, routes = [] }) {
  if (!origin || app) return false;
  const local = String(localAddress ?? '').replace(/^::ffff:/, '');
  if (isLoopback(local)) return false;
  const r = (routes ?? []).find((x) => x.address === local);
  return !(r && r.kind === 'tailscale');
}
const parseMeta = (d) => { try { return d?.meta ? JSON.parse(d.meta) : {}; } catch { return {}; } };
const metaVOf = (d) => Number(parseMeta(d).v ?? 2);
// the Android app's page is not served by this PC but by the app itself: it may call the API, where everything is
// still sealed with the phone's own key, and its WebView has to be told so (CORS). Tauri: http://tauri.localhost
// only. The Capacitor app's origins (localhost, capacitor://) are not accepted: a page on this PC's localhost, such
// as an agent's, would pass for the app.
const APP_ORIGINS = new Set(['http://tauri.localhost', 'https://tauri.localhost']);
const APP_CORS = { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Orb-Device, X-Orb-Auth', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
const appOrigin = (req) => { const o = String(req.headers.origin ?? '').toLowerCase(); return APP_ORIGINS.has(o) ? o : null; };

const inCgnat = (ip) => { const [x, y] = String(ip).split('.').map(Number); return x === 100 && y >= 64 && y <= 127; };
const isPrivate = (ip) => { const [a, b] = String(ip).split('.').map(Number); return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); };
const tailscaleExe = () => (IS_WIN ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale');

// This PC's Tailscale IPv4 and MagicDNS name, as Tailscale itself reports them, and whether the tailnet hands out HTTPS
// certificates. The 100.64.0.0/10 range is also used by operators' shared NAT and other VPNs, so an address there is
// only trusted when Tailscale confirms it or the network adapter is Tailscale's.
// `tailscale status --json` is long (quickRun keeps only the first 2000 characters): read in full, without the peers.
const tailscaleStatus = () => new Promise((resolve) => {
  execFile(tailscaleExe(), ['status', '--json', '--peers=false'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve({ ok: !error, out: String(stdout ?? '') }));
});

export async function tailscaleAddress() {
  const r = await tailscaleStatus();
  if (r.ok) {
    try {
      const st = JSON.parse(r.out); const self = st?.Self;
      const address = (self?.TailscaleIPs ?? []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && inCgnat(ip));
      const dns = self?.DNSName ? String(self.DNSName).replace(/\.$/, '').toLowerCase() : null;
      if (address) return { address, dns, https: Boolean(dns && (st.CertDomains ?? []).map((d) => String(d).toLowerCase()).includes(dns)) };
    } catch { /* fall back to the adapter */ }
  }
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!/tailscale/i.test(name)) continue;
    const a = (list ?? []).find((x) => x.family === 'IPv4' && !x.internal && inCgnat(x.address));
    if (a) return { address: a.address, dns: null, https: false };
  }
  return null;
}

// Whether a Tailscale network adapter with its address is up: an in-process look, with no command run, so the watcher can
// ask it every few seconds.
export function tailscaleAdapterUp() {
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/tailscale/i.test(name) && (list ?? []).some((x) => x.family === 'IPv4' && !x.internal && inCgnat(x.address))) return true;
  }
  return false;
}

// This PC's addresses on the local network (home Wi-Fi or cable): private IPv4 only, without virtual adapters (WSL,
// Hyper-V, VirtualBox, Docker…) or VPNs. The Wi-Fi or Ethernet one first: it is the one the QR shows.
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    // also Linux's container and VM bridges (br-…, veth…, virbr…, lxc…): a server with Docker has several.
    if (/vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|bluetooth|vpn|tap|tun|^br-|^veth|^virbr|^lxc|^lxd|^cni|^flannel|^podman/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address)) out.push({ name, address: a.address });
  }
  const rank = (n) => (/wi-?fi|wlan|wireless|inal[aá]mbrica/i.test(n) ? 0 : /ethernet|^eth|^en/i.test(n) ? 1 : 2);
  return out.sort((x, y) => rank(x.name) - rank(y.name)).map((a) => a.address);
}

// while the data of Orb 3.7 could not be updated (engine.mjs › blocked), the phone access cannot
// start (its devices, keys and conversations are in those data), and a linked phone only saw «sin conexión». Instead, the
// same addresses and port answer with one fixed state and nothing else: every /api/ request gets 503 { attention:
// 'migration', error } (the app's origin with its CORS, so it can read it), any page a short notice. No data, no device
// check, no keys: what it says is only that this Orb needs attention on the PC. The Tailscale https name is served too
// when the tailnet has it (and turned off again on stop). → { stop(), routes } or null (phone access off, nothing bound).
export async function startAttention({ log = () => {}, code = 'migration' } = {}) {
  const m = ctx.config?.mobile ?? {};
  if (!m.enabled) return null;
  const port = m.port ?? 3131;
  const { default: http } = await import('node:http');
  const servers = []; const hosts = new Set(); let served = null;
  const message = () => tr('msg.remote.attention');
  const page = () => `<!doctype html><html lang="${ctx.config?.language === 'en' ? 'en' : 'es'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orb</title><body style="font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box;text-align:center"><p style="max-width:28em">${message().replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)}</p></body></html>`;
  const handle = (req, res) => {
    req.resume();
    const reply = (status, body, type, extra = {}) => { res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', 'Retry-After': '30', ...extra }); res.end(body); };
    if (!privateSource(req.socket?.remoteAddress) || req.headers['tailscale-funnel-request']) return reply(403, JSON.stringify({ error: 'red no permitida' }), 'application/json; charset=utf-8');
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) return reply(421, JSON.stringify({ error: 'host no permitido' }), 'application/json; charset=utf-8');
    const p = new URL(req.url, 'http://x').pathname;
    const app = p.startsWith('/api/') ? appOrigin(req) : null;
    const cors = app ? { 'Access-Control-Allow-Origin': app, ...APP_CORS } : {};
    if (req.method === 'OPTIONS') return reply(app ? 204 : 403, '', 'text/plain', cors);
    if (p.startsWith('/api/')) return reply(503, JSON.stringify({ attention: code, error: message() }), 'application/json; charset=utf-8', cors);
    return reply(503, page(), TYPES['.html']);
  };
  const bind = (address) => new Promise((resolve) => {
    const srv = http.createServer(handle);
    srv.headersTimeout = 15_000; srv.requestTimeout = 30_000;
    srv.once('error', (error) => { log(`móvil (atención): ${address}:${port}: ${error.message}`); resolve(false); });
    srv.listen(port, address, () => { ownPorts.add(srv.address().port); servers.push(srv); resolve(true); });
  });
  const routes = [];
  if (process.env.ORB_REMOTE_BIND === '127.0.0.1') {
    if (await bind('127.0.0.1')) { hosts.add(`127.0.0.1:${port}`); routes.push(`http://127.0.0.1:${port}/`); }
  } else {
    if (m.wifi !== false) {
      for (const address of lanAddresses()) if (await bind(address)) { hosts.add(`${address}:${port}`); routes.push(`http://${address}:${port}/`); }
      const local = localName(); if (local && servers.length) hosts.add(`${local}:${port}`);
    }
    if (m.tailscale !== false) {
      const ts = await tailscaleAddress().catch(() => null);
      if (ts?.https && ts.dns && await bind('127.0.0.1')) {
        const r = await quickRun(tailscaleExe(), ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`], { timeoutMs: 30_000 }).catch(() => ({ ok: false }));
        if (r.ok) { served = port; hosts.add(`${ts.dns}:${port}`); routes.push(`https://${ts.dns}:${port}/`); }
      }
      if (ts && served === null && await bind(ts.address)) { hosts.add(`${ts.address}:${port}`); if (ts.dns) hosts.add(`${ts.dns}:${port}`); routes.push(`http://${ts.address}:${port}/`); }
    }
  }
  if (!servers.length) return null;
  for (const r of routes) log(`acceso móvil en modo atención (${code}) en ${r}`);
  return {
    routes,
    async stop() {
      await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => { try { s.close(() => resolve()); s.closeAllConnections?.(); } catch { resolve(); } setTimeout(resolve, 2000).unref?.(); })));
      if (served !== null) { const at = served; served = null; await quickRun(tailscaleExe(), ['serve', `--https=${at}`, 'off'], { timeoutMs: 15_000 }).catch(() => {}); }
    }
  };
}

export { APP_CORS, appOrigin, ipOf, kindOf, metaVOf, parseMeta, tailscaleExe };
