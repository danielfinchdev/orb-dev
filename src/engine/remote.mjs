// Phone access: the same interface as a web app, off by default. Two ways to reach the PC, each can be on or off:
// - the home Wi-Fi: plain http on this PC's local address (nothing to install on the phone);
// - Tailscale: https through `tailscale serve` when the tailnet has HTTPS (installable app and notifications), or plain
//   http on the Tailscale address otherwise.
// A phone is paired by scanning a one-time QR on the PC. The phone makes its own key and from then on every message is
// encrypted end to end (src/core/mobile-crypto.mjs): whoever sees the traffic (the Wi-Fi, a proxy) reads nothing, and a
// copied link or QR is useless. The PC can revoke any phone. What a phone may do is a subset of the PC's actions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ctx, tr } from '../core/context.mjs';
import { oneLine } from '../core/safety.mjs';
import { quickRun } from '../agents/index.mjs';
import { IS_WIN } from '../agents/common.mjs';
import { b64, newKeyPair, publicKeyOf, pairingKey, sessionKey, fingerprint, seal, open, sealText, openText, openBytes, AAD, CLOCK_SKEW_MS } from '../core/mobile-crypto.mjs';
import { newVapidKeys, checkSubscription, sendPush } from './webpush.mjs';

const RENDERER = path.resolve(process.env.ORB_RENDERER || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer'));
const SESSION_DAYS = 30; // a phone unused for this long has to be paired again
const PAIR_MINUTES = 5;
const UPLOAD_MAX = 10 * 1024 * 1024;
const UPLOADS_TOTAL = 300 * 1024 * 1024; // phone pictures kept at most (oldest go first), and never older than 7 days
const UPLOADS_DAYS = 7;
const STREAM_BACKLOG = 1024 * 1024; // a live-event stream that stops reading is dropped instead of filling the memory
const STREAMS_PER_DEVICE = 3;
const NETWORK_CHECK_MS = 60_000; // the Wi-Fi address can change (another network, DHCP): checked every minute
const now = () => new Date().toISOString();

// The settings a phone gets: what the interface shows, without connector commands and secrets, login folders or paths
// of the agents' programs.
export function phoneConfig(c) {
  if (!c || typeof c !== 'object') return c;
  return {
    ...c,
    mcpServers: (c.mcpServers ?? []).map((m) => ({ name: m.name, enabled: m.enabled, agents: m.agents })),
    accounts: (c.accounts ?? []).map(({ home: _home, ...a }) => a),
    agents: Object.fromEntries(Object.entries(c.agents ?? {}).map(([k, a]) => { const { path: _path, ...rest } = a ?? {}; return [k, rest]; })),
    projectRoots: [], mobile: { enabled: c.mobile?.enabled }
  };
}

// What a phone may call. Everything that changes settings, accounts, connectors, installs software or publishes stays on the PC.
const ALLOWED = new Set(['app.state', 'chat.list', 'chat.send', 'chat.reset', 'chat.stop', 'chat.accept', 'chat.settings',
  'tasks.list', 'tasks.live', 'tasks.get', 'tasks.create', 'tasks.approve', 'tasks.retry', 'tasks.cancel', 'tasks.reassign', 'tasks.followup', 'tasks.undo', 'tasks.launchAnyway', 'tasks.accept',
  'sessions.list', 'sessions.create', 'sessions.items', 'sessions.send', 'sessions.stop', 'sessions.update',
  'projects.list', 'projects.info', 'projects.setActive', 'projects.create', 'logs.list', 'logs.read', 'activity.list', 'usage.get', 'usage.now', 'agents.status', 'models.catalog',
  'control.pause', 'control.resume', 'sidebar.complete',
  // 2.3: answer permission requests, the queue, continue, fork, settle, Task Review, scheduled tasks and @ (all of it
  // is work the PC already allowed; nothing here changes settings or gives total access).
  'sessions.queue', 'sessions.editQueued', 'sessions.approve', 'sessions.resume', 'sessions.fork', 'sessions.settle', 'approvals.list', 'chat.approve',
  'tasks.review', 'projects.review', 'schedules.list', 'schedules.create', 'schedules.update', 'schedules.remove', 'schedules.run', 'mentions.options']);
const EVENTS = new Set(['board:changed', 'chat:state', 'chat:new', 'session:item', 'session:update', 'session:removed', 'config:changed', 'session:delta', 'session:queue', 'approval:changed']);

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

// This PC's addresses on the local network (home Wi-Fi or cable): private IPv4 only, without virtual adapters (WSL,
// Hyper-V, VirtualBox, Docker…) or VPNs. The Wi-Fi or Ethernet one first: it is the one the QR shows.
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|bluetooth|vpn|tap|tun/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address)) out.push({ name, address: a.address });
  }
  const rank = (n) => (/wi-?fi|wlan|wireless|inal[aá]mbrica/i.test(n) ? 0 : /ethernet|^eth|^en/i.test(n) ? 1 : 2);
  return out.sort((x, y) => rank(x.name) - rank(y.name)).map((a) => a.address);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// The installed app's service worker: shows the notifications the PC sends and opens the app when one is tapped.
const SERVICE_WORKER = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{}
e.waitUntil(self.registration.showNotification(d.title||'Orb',{body:d.body||'',tag:d.tag||'orb',renotify:true,icon:'/icon.png',badge:'/icon.png',data:{url:d.url||'/'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/';
e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c)return c.focus()}return self.clients.openWindow(u)}))});`;

export function createRemote({ board, api, log }) {
  let servers = []; // http servers (one per address)
  let state = { running: false, routes: [], error: null };
  let generation = 0; // moved by stop(): a start() still waiting for Tailscale gives up
  let starting = null;
  let watcher = null;
  let served = null; // the https port `tailscale serve` is forwarding for us (turned off on stop)
  let pairing = null; // { code, expires, route }
  const failures = new Map(); // address -> timestamps of wrong pairing attempts (one noisy device cannot lock out the others)
  const clients = new Set(); // live-event streams: { res, device, key }
  const seen = new Map(); // device id -> Map(nonce -> expiry): requests already answered (replays are refused)
  const keys = new Map(); // device id -> session key
  const uploads = () => path.join(ctx.paths.internal, 'adjuntos-movil');

  // This PC's own keys: X25519 for the phones, VAPID for notifications. Made once, kept in the database.
  const own = (() => {
    let k = board.settingJson('remote_keys');
    if (!k?.priv || !k?.vapid?.publicKey) {
      k = { priv: b64.enc(newKeyPair().priv), vapid: newVapidKeys() };
      board.settingJson('remote_keys', k);
    }
    const priv = b64.dec(k.priv);
    return { priv, pub: publicKeyOf(priv), vapid: k.vapid };
  })();
  const pcFingerprint = fingerprint(own.pub);
  // Phones paired by 2.3.2 and older (a reusable token, no key of their own) cannot use the encrypted channel: they go.
  board.run('DELETE FROM devices WHERE public_key IS NULL');

  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const keyOf = (d) => { if (!keys.has(d.id)) keys.set(d.id, sessionKey(own.priv, b64.dec(d.public_key))); return keys.get(d.id); };
  const deviceOf = (req) => {
    const id = String(req.headers['x-orb-device'] ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const d = board.one('SELECT * FROM devices WHERE id = ?', id);
    if (!d?.public_key) return null;
    if (Date.now() - Date.parse(d.last_seen ?? d.created_at) > SESSION_DAYS * 86_400_000) return null;
    return d;
  };
  const touch = (d) => { if (!d.last_seen || Date.now() - Date.parse(d.last_seen) > 60_000) board.run('UPDATE devices SET last_seen = ? WHERE id = ?', now(), d.id); };

  // A request is accepted once: recent and with a nonce not seen before. 'ok', 'replay', or 'clock' when its time is too
  // far from the PC's (the phone's clock is off: it gets the PC's time and stamps its requests with it).
  function freshness(deviceId, nonce, t) {
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > CLOCK_SKEW_MS) return 'clock';
    let m = seen.get(deviceId); if (!m) seen.set(deviceId, (m = new Map()));
    const at = Date.now();
    for (const [n, exp] of m) if (exp < at) m.delete(n);
    if (m.has(nonce) || m.size > 5000) return 'replay';
    m.set(nonce, at + 2 * CLOCK_SKEW_MS);
    return 'ok';
  }
  // Opens a request sealed by this device: { body, nonce }, { clock: true } or null.
  function openRequest(device, box, expected) {
    let msg; try { msg = open(keyOf(device), box, AAD.request(device.id)); } catch { return null; }
    if (!msg || msg.m !== expected) return null;
    const f = freshness(device.id, box.n, Number(msg.t));
    return f === 'ok' ? { body: msg.b ?? null, nonce: box.n } : f === 'clock' ? { clock: true } : null;
  }
  // The same for the requests whose envelope travels in a header (live events, pictures).
  function openHeader(req, device, expected) {
    const text = String(req.headers['x-orb-auth'] ?? '');
    let msg; try { msg = openText(keyOf(device), text, AAD.request(device.id)); } catch { return null; }
    const nonce = text.split('.')[0];
    if (!msg || msg.m !== expected) return null;
    const f = freshness(device.id, nonce, Number(msg.t));
    return f === 'ok' ? { nonce } : f === 'clock' ? { clock: true } : null;
  }
  // Only sent after the request opened with the device's own key (or the QR's), so only a paired phone learns it.
  const clockOff = (res) => send(res, 409, { error: tr('msg.remote.clock'), now: Date.now() });
  const reply = (res, device, nonce, value) => send(res, 200, seal(keyOf(device), { r: nonce, ...value }, AAD.response(device.id)));

  // Only requests addressed to this server by one of its own names pass (stops DNS rebinding), and only from our own page.
  const hostOk = (req) => state.hosts?.includes(String(req.headers.host ?? '').toLowerCase());
  const originOk = (req) => !req.headers.origin || state.origins?.includes(String(req.headers.origin).toLowerCase());

  const readBody = (req, max) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error(tr('sys.remote.tooLarge')), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const readJson = async (req, max = 400_000) => { try { return JSON.parse((await readBody(req, max)).toString('utf8') || '{}'); } catch (error) { if (error.status) throw error; throw new Error(tr('msg.remote.badJson')); } };

  function serveStatic(req, res, pathname) {
    if (pathname === '/manifest.webmanifest') {
      const name = ctx.config.assistantName;
      return send(res, 200, JSON.stringify({ name, short_name: name, id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait', background_color: '#1d2257', theme_color: '#5b6ee8',
        icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }), TYPES['.webmanifest']);
    }
    if (pathname === '/sw.js') return send(res, 200, SERVICE_WORKER, TYPES['.js'], { 'Service-Worker-Allowed': '/' });
    let rel; try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return send(res, 404, 'no encontrado', 'text/plain'); }
    // Only what the phone's page needs (not the desktop-only pages such as the agent's browser window).
    if (!(rel === 'index.html' || rel === 'icon.png' || /^assets\/[\w.-]+$/.test(rel) || /^robot\/[\w-]+\.png$/.test(rel))) return send(res, 404, 'no encontrado', 'text/plain');
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return send(res, 404, 'no encontrado', 'text/plain');
    fs.readFile(file, (error, data) => {
      if (error) return send(res, 404, 'no encontrado', 'text/plain');
      let body = data;
      // The installed web app needs the manifest and the home-screen tags: added to the page served to phones only.
      if (rel === 'index.html') body = Buffer.from(String(data).replace('</head>', `<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon.png"><meta name="theme-color" content="#5b6ee8"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="${ctx.config.assistantName.replace(/[<>"&]/g, '')}"></head>`));
      res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': rel === 'index.html' ? 'no-store' : 'public, max-age=86400' });
      res.end(body);
    });
  }

  async function handle(req, res) {
    if (!hostOk(req)) return send(res, 421, { error: 'host no permitido' });
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(req, res, p);
    if (!originOk(req)) return send(res, 403, { error: 'origen no permitido' });

    if (req.method === 'POST' && p === '/api/pair') return pair(req, res);

    const device = deviceOf(req);
    if (!device) { req.resume(); return send(res, 401, { error: tr('msg.remote.notLinked') }); }

    if (req.method === 'GET' && p === '/api/events') {
      const auth = openHeader(req, device, 'events');
      if (!auth) return send(res, 401, { error: tr('msg.remote.notLinked') });
      if (auth.clock) return clockOff(res);
      touch(device);
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': hola\n\n');
      const client = { res, device: device.id, key: keyOf(device) };
      const mine = [...clients].filter((c) => c.device === device.id);
      if (mine.length >= STREAMS_PER_DEVICE) { try { mine[0].res.end(); } catch { /* closed */ } clients.delete(mine[0]); }
      clients.add(client);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
      req.on('close', () => { clearInterval(ping); clients.delete(client); });
      return undefined;
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'no encontrado' });
    if (p === '/api/upload') return upload(req, res, device);

    const what = { '/api/call': 'call', '/api/me': 'me', '/api/push': 'push' }[p];
    if (!what) { req.resume(); return send(res, 404, { error: 'no encontrado' }); }
    let box; try { box = await readJson(req); } catch (error) { return send(res, error.status ?? 400, { error: error.message }); }
    const msg = openRequest(device, box, what);
    if (!msg) return send(res, 401, { error: tr('msg.remote.notLinked') });
    if (msg.clock) return clockOff(res);
    touch(device);

    if (what === 'me') return reply(res, device, msg.nonce, { ok: true, result: { device: device.name, name: ctx.config.assistantName, pc: pcFingerprint, push: Boolean(device.push), vapid: own.vapid.publicKey } });
    if (what === 'push') {
      // Turn notifications on (a subscription made by this phone's browser) or off (null).
      try {
        const sub = msg.body?.subscription ? checkSubscription(msg.body.subscription) : null;
        board.run('UPDATE devices SET push = ? WHERE id = ?', sub ? JSON.stringify(sub) : null, device.id);
        return reply(res, device, msg.nonce, { ok: true, result: { push: Boolean(sub) } });
      } catch (error) { return reply(res, device, msg.nonce, { ok: false, error: error.message }); }
    }
    // what === 'call'
    const method = String(msg.body?.method ?? '');
    const params = msg.body?.params && typeof msg.body.params === 'object' ? msg.body.params : {};
    const deny = (error) => reply(res, device, msg.nonce, { ok: false, status: 403, error });
    if (!ALLOWED.has(method)) return deny(tr('msg.remote.pcOnly'));
    if (params.permission === 'total') return deny(tr('msg.remote.totalPcOnly'));
    // A conversation the PC gave total access to is driven from the PC only.
    if (method.startsWith('sessions.') && method !== 'sessions.stop' && params.id !== undefined && board.one('SELECT permission FROM sessions WHERE id = ?', String(params.id))?.permission === 'total') return deny(tr('msg.remote.totalConvPcOnly'));
    // Pictures from a phone are only the ones it uploaded itself (never other files of the PC).
    if (params.images !== undefined) {
      const dir = uploads() + path.sep;
      if (!Array.isArray(params.images) || params.images.some((f) => typeof f !== 'string' || !path.resolve(f).startsWith(dir))) return deny(tr('msg.remote.ownImages'));
    }
    try { const result = (await api.call(method, params)) ?? null; return reply(res, device, msg.nonce, { ok: true, result: method === 'app.state' ? { ...result, config: phoneConfig(result.config) } : result }); }
    catch (error) { return reply(res, device, msg.nonce, { ok: false, error: oneLine(error?.message ?? String(error), 1000) }); }
  }

  // Pairing: the phone sends its public key and a proof sealed with the key of this QR (the one-time code never travels).
  async function pair(req, res) {
    const who = req.socket.remoteAddress ?? '?';
    const recent = (failures.get(who) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
    failures.set(who, recent);
    if (recent.length >= 10) { req.resume(); return send(res, 429, { error: tr('msg.remote.tooMany') }); }
    const fail = () => { recent.push(Date.now()); return send(res, 401, { error: tr('msg.remote.badQr') }); };
    let body; try { body = await readJson(req, 10_000); } catch { return fail(); }
    if (!pairing || Date.now() > pairing.expires || !body || typeof body.pub !== 'string') return fail();
    let devPub; try { devPub = b64.dec(body.pub); } catch { return fail(); }
    if (devPub.length !== 32) return fail();
    let proof; try { proof = open(pairingKey(own.priv, devPub, pairing.code), body.proof, AAD.pair); } catch { return fail(); }
    if (!proof || proof.pub !== body.pub) return fail();
    // The QR was right but the phone's clock is off: it tries again with the PC's time (the QR is not used up).
    if (!(Math.abs(Date.now() - Number(proof.t)) <= CLOCK_SKEW_MS)) return clockOff(res);
    const route = pairing.route;
    pairing = null; // one use
    const id = crypto.randomUUID();
    const name = oneLine(typeof proof.name === 'string' && proof.name ? proof.name : tr('msg.remote.defaultName'), 60);
    board.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, `clave:${id}`, now(), now(), body.pub, route);
    board.event(null, 'usuario', 'device.paired', name);
    board.addChat('system', tr('msg.remote.deviceLinked', { name }));
    // The answer is sealed with the new session key: the phone checks it really is the PC of the QR.
    const key = sessionKey(own.priv, devPub); keys.set(id, key);
    return send(res, 200, { id, box: seal(key, { id, name: ctx.config.assistantName, pc: pcFingerprint }, AAD.paired(id)) });
  }

  // A picture from the phone (encrypted): checked by its first bytes (not its name), stored in the app's folder, path returned.
  let uploading = 0;
  async function upload(req, res, device) {
    const auth = openHeader(req, device, 'upload');
    if (!auth) { req.resume(); return send(res, 401, { error: tr('msg.remote.notLinked') }); }
    if (auth.clock) { req.resume(); return clockOff(res); }
    if (uploading >= 3) { req.resume(); return reply(res, device, auth.nonce, { ok: false, status: 429, error: tr('msg.remote.waitUploads') }); }
    uploading++;
    try {
      let raw; try { raw = await readBody(req, UPLOAD_MAX + 64); } catch { return reply(res, device, auth.nonce, { ok: false, status: 413, error: tr('msg.remote.imageTooBig') }); }
      let b; try { b = Buffer.from(openBytes(keyOf(device), new Uint8Array(raw), AAD.upload(device.id))); } catch { return send(res, 401, { error: tr('msg.remote.notLinked') }); }
      const ext = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
        : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : b.subarray(0, 3).toString() === 'GIF' ? 'gif' : null;
      if (!ext) return reply(res, device, auth.nonce, { ok: false, status: 415, error: tr('msg.remote.imageTypes') });
      await fs.promises.mkdir(uploads(), { recursive: true });
      await pruneUploads(b.length);
      const file = path.join(uploads(), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
      await fs.promises.writeFile(file, b);
      return reply(res, device, auth.nonce, { ok: true, result: { path: file } });
    } catch (error) { log(`móvil: subida: ${error.message}`); return reply(res, device, auth.nonce, { ok: false, error: tr('msg.remote.cannotSaveImage') }); }
    finally { uploading--; }
  }
  // Old pictures go (7 days), and the oldest ones too while the folder would pass its quota.
  async function pruneUploads(incoming = 0) {
    let files; try { files = await fs.promises.readdir(uploads()); } catch { return; }
    const list = [];
    for (const f of files) { try { const st = await fs.promises.stat(path.join(uploads(), f)); list.push({ f, at: st.mtimeMs, size: st.size }); } catch { /* gone */ } }
    list.sort((a, b) => a.at - b.at);
    let total = list.reduce((n, x) => n + x.size, 0) + incoming;
    for (const x of list) {
      if (Date.now() - x.at < UPLOADS_DAYS * 86_400_000 && total <= UPLOADS_TOTAL) break;
      await fs.promises.rm(path.join(uploads(), x.f), { force: true }).catch(() => {});
      total -= x.size;
    }
  }

  // Notifications: a new message in the assistant's chat (an answer, a task that needs approval, finished or failed work)
  // goes to the phones that turned them on and do not have the app open right now.
  function notify(payload) {
    if (!payload || payload.role === 'usuario') return;
    const openNow = new Set([...clients].map((c) => c.device));
    const name = ctx.config.assistantName;
    for (const d of board.all('SELECT id, push FROM devices WHERE push IS NOT NULL')) {
      if (openNow.has(d.id)) continue;
      let sub; try { sub = JSON.parse(d.push); } catch { continue; }
      sendPush(sub, { title: payload.role === 'orb' ? name : tr('msg.remote.pushNotice', { name }), body: String(payload.body ?? '').slice(0, 200), tag: 'orb-chat', url: '/' }, own.vapid)
        .then((r) => { if (r === 'gone') board.run('UPDATE devices SET push = NULL WHERE id = ?', d.id); })
        .catch(() => {});
    }
  }

  // ---- listening: one http server per address; the Tailscale https name goes through `tailscale serve` to loopback.
  const listen = (address, port) => new Promise((resolve) => {
    const srv = http.createServer((req, res) => { handle(req, res).catch((error) => { log(`móvil: ${error.stack}`); try { send(res, 500, { error: tr('msg.remote.internalError') }); } catch { /* sent */ } }); });
    srv.headersTimeout = 15_000; srv.requestTimeout = 60_000;
    srv.once('error', (error) => resolve({ error }));
    srv.listen(port, address, () => resolve({ srv }));
  });
  async function serveHttps(port) {
    const r = await quickRun(tailscaleExe(), ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`], { timeoutMs: 30_000 });
    if (r.ok) { served = port; return true; }
    log(`móvil: tailscale serve no pudo dar https: ${oneLine(r.out, 300)}`);
    return false;
  }
  async function unserve() {
    if (served === null) return;
    const port = served; served = null;
    await quickRun(tailscaleExe(), ['serve', `--https=${port}`, 'off'], { timeoutMs: 15_000 }).catch(() => {});
  }

  async function startNow() {
    const mine = generation;
    const m = ctx.config.mobile ?? {};
    const port = m.port ?? 3131;
    const routes = []; const hosts = []; const origins = []; const errors = [];
    const bind = async (address) => {
      const r = await listen(address, port);
      if (r.error) { errors.push(tr('msg.remote.portBusy', { address, port, error: r.error.message })); return false; }
      servers.push(r.srv); return true;
    };
    const unbind = () => { try { servers.pop()?.close(); } catch { /* closed */ } };
    const gaveUp = () => { closeAll(); return state; }; // stop() ran while we waited: what we bound goes too
    if (process.env.ORB_REMOTE_BIND === '127.0.0.1') {
      // Tests: only loopback.
      if (await bind('127.0.0.1')) { hosts.push(`127.0.0.1:${port}`); origins.push(`http://127.0.0.1:${port}`); routes.push({ kind: 'wifi', url: `http://127.0.0.1:${port}/`, secure: false, address: '127.0.0.1' }); }
    } else {
      if (m.wifi !== false) {
        const lan = lanAddresses();
        if (!lan.length) errors.push(tr('msg.remote.noWifi'));
        for (const address of lan) {
          if (mine !== generation) return gaveUp();
          if (await bind(address)) { hosts.push(`${address}:${port}`); origins.push(`http://${address}:${port}`); if (!routes.some((r) => r.kind === 'wifi')) routes.push({ kind: 'wifi', url: `http://${address}:${port}/`, secure: false, address }); }
        }
      }
      if (m.tailscale !== false) {
        const ts = await tailscaleAddress();
        if (mine !== generation) return gaveUp();
        // The loopback server is only of use while `tailscale serve` forwards https to it: otherwise plain http.
        let https = false;
        if (ts?.https && ts.dns && await bind('127.0.0.1')) { https = await serveHttps(port); if (!https) unbind(); }
        if (mine !== generation) return gaveUp();
        if (!ts) errors.push(tr('msg.remote.noTailscale'));
        else if (https) {
          hosts.push(`${ts.dns}:${port}`); origins.push(`https://${ts.dns}:${port}`);
          routes.push({ kind: 'tailscale', url: `https://${ts.dns}:${port}/`, secure: true, address: ts.address });
        } else if (await bind(ts.address)) {
          hosts.push(`${ts.address}:${port}`, ...(ts.dns ? [`${ts.dns}:${port}`] : [])); origins.push(`http://${ts.address}:${port}`, ...(ts.dns ? [`http://${ts.dns}:${port}`] : []));
          routes.push({ kind: 'tailscale', url: `http://${ts.dns ?? ts.address}:${port}/`, secure: false, address: ts.address });
        }
      }
    }
    if (mine !== generation) return gaveUp();
    state = { running: routes.length > 0, routes, hosts, origins, lan: lanAddresses().join(','), error: routes.length ? (errors[0] ?? null) : (errors.join(' ') || tr('msg.remote.noNetwork')) };
    for (const r of routes) log(`acceso móvil (${r.kind}) en ${r.url}`);
    pruneUploads().catch(() => {});
    return state;
  }
  function closeAll() { for (const s of servers) { try { s.close(); } catch { /* closed */ } } servers = []; }

  const remote = {
    // Engine events go to the paired phones too (only the ones the interface needs), each sealed for its phone.
    broadcast(event, payload) {
      if (event === 'chat:new') notify(payload);
      if (!clients.size || !EVENTS.has(event)) return;
      // The settings themselves never travel to a phone (the page just reloads what it is allowed to see).
      const value = { e: event, p: event === 'config:changed' ? null : payload };
      for (const c of clients) {
        if (c.res.writableLength > STREAM_BACKLOG) { try { c.res.destroy(); } catch { /* gone */ } clients.delete(c); continue; }
        try { c.res.write(`data: ${sealText(c.key, value, AAD.event(c.device))}\n\n`); } catch { clients.delete(c); }
      }
    },
    start() {
      if (servers.length) return Promise.resolve(state);
      starting ??= startNow().finally(() => { starting = null; });
      // The Wi-Fi address changes with the network (or comes back after it was gone): the servers follow it.
      watcher ??= setInterval(() => {
        if (starting || ctx.config.mobile?.wifi === false || process.env.ORB_REMOTE_BIND) return;
        if (lanAddresses().join(',') !== (state.lan ?? '')) { log('móvil: ha cambiado la red; vuelvo a abrir el acceso'); remote.restart().catch(() => {}); }
      }, NETWORK_CHECK_MS);
      watcher.unref?.();
      return starting;
    },
    async restart() { await remote.stop(); return remote.start(); },
    async stop() {
      generation++;
      clearInterval(watcher); watcher = null;
      await starting?.catch(() => {}); // a start() still waiting for the network gives up and closes what it bound
      for (const c of clients) { try { c.res.end(); } catch { /* closed */ } }
      clients.clear(); closeAll(); pairing = null; state = { running: false, routes: [], error: null };
      await unserve();
    },
    status() {
      return { enabled: Boolean(ctx.config.mobile?.enabled), running: Boolean(state.running), routes: state.routes ?? [], error: state.error ?? null, pc: pcFingerprint,
        wifi: ctx.config.mobile?.wifi !== false, tailscale: ctx.config.mobile?.tailscale !== false,
        devices: board.all('SELECT id, name, created_at, last_seen, route, push IS NOT NULL AS push FROM devices ORDER BY created_at DESC').map((d) => ({ ...d, push: Boolean(d.push) })) };
    },
    // A one-time QR for 5 minutes, for one of the ways in (Wi-Fi or Tailscale). The code and this PC's key travel in the
    // URL fragment (#), which the browser never sends to any server.
    pair(kind) {
      if (!state.running) throw new Error(tr('msg.remote.enableFirst'));
      const route = state.routes.find((r) => r.kind === kind) ?? state.routes[0];
      const code = crypto.randomBytes(18).toString('base64url');
      pairing = { code, expires: Date.now() + PAIR_MINUTES * 60_000, route: route.kind };
      return { url: `${route.url}#vincular=${code}&pc=${b64.enc(own.pub)}`, expiresAt: pairing.expires, kind: route.kind, secure: route.secure, pc: pcFingerprint };
    },
    revoke(id) {
      const d = board.one('SELECT * FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      board.run('DELETE FROM devices WHERE id = ?', d.id);
      keys.delete(d.id); seen.delete(d.id);
      for (const c of clients) if (c.device === d.id) { try { c.res.end(); } catch { /* closed */ } clients.delete(c); }
      board.event(null, 'usuario', 'device.revoked', d.name);
      return true;
    }
  };
  return remote;
}
