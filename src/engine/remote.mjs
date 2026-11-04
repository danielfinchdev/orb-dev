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
import { ctx, tr, isHeadless, role as myRole, keepsBots, programs } from '../core/context.mjs';
import { ROLES, hostsBots, doesDev } from '../core/home.mjs';
import { oneLine } from '../core/safety.mjs';
import { quickRun } from '../agents/index.mjs';
import { IS_WIN } from '../agents/common.mjs';
import { b64, newKeyPair, publicKeyOf, pairingKey, sessionKey, fingerprint, seal, open, sealText, openText, openBytes, AAD, CLOCK_SKEW_MS, shortSecret } from '../core/mobile-crypto.mjs';
import { newVapidKeys, checkSubscription, sendPush } from './webpush.mjs';
import { wake, normalMac } from '../core/wol.mjs';
import { PROTOCOL, CODE_ALPHABET, RELAY_EVENTS, shortCodeLabel } from '../core/link.mjs';

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
    projectRoots: [], mobile: { enabled: c.mobile?.enabled, preview: pushPreview(c) }
  };
}

// What a phone may call. Everything that changes settings, accounts, connectors, installs software or publishes stays on the PC.
const ALLOWED = new Set(['app.state', 'chat.list', 'chat.send', 'conversations.list', 'conversations.update', 'conversations.search', 'projects.securityReview', 'chat.stop', 'chat.accept', 'chat.answer', 'chat.settings', 'whiteboard.load', 'whiteboard.save', 'whiteboard.note',
  'tasks.list', 'tasks.live', 'tasks.get', 'tasks.create', 'tasks.approve', 'tasks.retry', 'tasks.cancel', 'tasks.reassign', 'tasks.followup', 'tasks.undo', 'tasks.launchAnyway', 'tasks.accept',
  'sessions.list', 'sessions.create', 'sessions.items', 'sessions.send', 'sessions.stop', 'sessions.update',
  'projects.list', 'projects.icons', 'projects.branch', 'projects.info', 'projects.setActive', 'projects.create', 'logs.list', 'logs.read', 'activity.list', 'usage.get', 'usage.now', 'agents.status', 'models.catalog', 'models.guide',
  'control.pause', 'control.resume', 'sidebar.complete',
  // 2.3: answer permission requests, the queue, continue, fork, settle, Task Review, scheduled tasks and @ (all of it
  // is work the PC already allowed; nothing here changes settings or gives total access).
  'sessions.queue', 'sessions.editQueued', 'sessions.approve', 'sessions.resume', 'sessions.fork', 'sessions.settle', 'approvals.list',
  'tasks.review', 'projects.review', 'schedules.list', 'schedules.create', 'schedules.update', 'schedules.remove', 'schedules.run', 'mentions.options',
  // 3.5: talking to the bots, answering their cards and questions, pausing one and its reminders. Creating, changing or
  // deleting bots, their memories, the golden rules, what nobody touches and Home Assistant's token are set on the PC.
  'bots.list', 'bots.get', 'bots.chat', 'bots.send', 'bots.stop', 'bots.decide', 'bots.answer', 'bots.pause', 'bots.groups.list', 'bots.groups.chat', 'bots.groups.send',
  'bots.memory.get', 'bots.rules.get', 'bots.protected.get', 'bots.reminders.list', 'bots.reminders.create', 'bots.reminders.cancel', 'bots.ha.states', 'bots.srv.status']);
// 3.5: a device the user marked «Puede administrar» (Ajustes › Magic Link › Dispositivos enlazados) manages this Orb's
// bots and links from afar (a server without a window needs one; `orb-nucleo enlazar` gives it to the first device it
// links). Never by the kind a device says it is, and still nothing with total access.
// The bots of a centre are the user's: their own Orb linked to it (a device of kind «orb») manages them too.
export const BOTS_OWNER = ['bots.create', 'bots.update', 'bots.delete', 'bots.groups.create', 'bots.groups.update', 'bots.groups.delete', 'bots.memory.set', 'bots.rules.set', 'bots.protected.set', 'bots.ha.get', 'bots.ha.set'];
export const ORB_ALLOWED = new Set([...ALLOWED, ...BOTS_OWNER]);
// What a workshop passes on to its centre (centro.<method>): the bots, nothing else.
export const CENTRO_FORWARD = new Set([...ORB_ALLOWED].filter((m) => m.startsWith('bots.')));
export const CONSOLE_ALLOWED = new Set([...ORB_ALLOWED, 'link.qr', 'link.devices', 'link.rename', 'link.revoke', 'link.setAdmin', 'link.setApprove', 'link.confirm', 'link.peers', 'link.connect', 'link.disconnect']);
// What a centre sends to the Orbs linked with it (their Bots mode shows the centre's bots, live).
const BOT_EVENTS = new Set(['bot.updated', 'bot.message', 'bot.state']);
// What the access of a device allows on this Orb (role: this Orb's): everything of the console for a device marked
// «Puede administrar», the bots for another Orb of the user when this one keeps bots («centro» or «todo»), else a phone's.
// 3.5.1: «orb» counts only when this Orb's owner chose it when making the QR (confirmed); what a device says it is never
// gives it more.
export const allowedFor = (role, kind, admin = false, confirmed = true) => (admin ? CONSOLE_ALLOWED : kind === 'orb' && confirmed && hostsBots(role) ? ORB_ALLOWED : ALLOWED);
// 3.5.1: what the owner may choose when making a QR (the kind of device it is for); the device's rights are decided there.
export const PAIR_KINDS = ['phone', 'browser', 'orb', 'terminal'];
// The rights of a device to answer a bot's card: «approve» for any card (a lock, a purchase, a tool that sends…);
// changing bots and the server also need the rights of the bots' owner (the PC, «Puede administrar» or a confirmed Orb).
export const approverOf = (device, allowed) => ({ device: device.id, name: device.name, approve: Number(device.approve ?? 1) === 1, owner: allowed.has('bots.update') });
// 3.5: what a phone or a terminal does in the Orb mode: it goes to the Orb that programs (Ajustes › Magic Link › «Orb
// para programar») when it is not this one. The bots, the links and this Orb's own state stay here.
export const devForwards = (method) => ALLOWED.has(method) && !/^(bots\.|app\.state$)/.test(method);
const EVENTS = new Set(['board:changed', 'chat:state', 'chat:new', 'notice', 'session:item', 'session:update', 'session:removed', 'config:changed', 'session:delta', 'session:queue', 'approval:changed',
  // 3.5 (Magic Link): which linked Orbs are on, and the calls left waiting for the workshop.
  'link:status', 'link:queue',
  // 3.5 (bots)
  'bot.updated', 'bot.message', 'bot.state']);
// 3.5 «Solo Orb»: the server (Orb Núcleo, without a window) has no screen of its own, so a linked phone signs its agents in: it gets the
// link and the code, and pastes Claude's code back. On a PC the sign-in stays on the PC.
const CENTRO_PHONE = new Set(['agents.login', 'agents.loginCode', 'agents.loginCancel', 'agents.loginState']);
// 3.5: what a phone may also ask: the links' state and its workshop through the centre (taller.*).
const LINK_ALLOWED = new Set(['link.status']);
// What may be forwarded to each role (the workshop checks it again on its side): the same work a phone may do there.
export const ROLE_FORWARD = { taller: ALLOWED };
// 3.5: «terminal» is the orb command-line client (src/terminal): the same rights as a browser.
export const KINDS = ['phone', 'browser', 'orb', 'terminal'];
const FORWARD_MS = 60_000; // a forwarded call the workshop does not answer in a minute fails
const PAIR_FAILS_MAX = 20; // wrong attempts (all addresses together) that cancel the code on screen

// The checks of a call coming from outside (a phone, or the centre forwarding a phone's call): null when it may run, or
// why not. `uploadsDir`: the pictures that may go with it (none when forwarded).
export function guardCall(board, method, params, { allowed = ALLOWED, uploadsDir = null } = {}) {
  if (!allowed.has(method) && !(isHeadless() && CENTRO_PHONE.has(method))) return tr('msg.remote.pcOnly');
  if (method === 'agents.login' && params.console) return tr('msg.remote.pcOnly');
  if (params.permission === 'total') return tr('msg.remote.totalPcOnly');
  // A conversation the PC gave total access to is driven from the PC only.
  if (method.startsWith('sessions.') && method !== 'sessions.stop' && params.id !== undefined && board.one('SELECT permission FROM sessions WHERE id = ?', String(params.id))?.permission === 'total') return tr('msg.remote.totalConvPcOnly');
  // Pictures from a phone are only the ones it uploaded itself (never other files of the PC).
  if (params.images !== undefined) {
    if (!uploadsDir) return tr('msg.remote.ownImages');
    const dir = uploadsDir + path.sep;
    if (!Array.isArray(params.images) || params.images.some((f) => typeof f !== 'string' || !path.resolve(f).startsWith(dir))) return tr('msg.remote.ownImages');
  }
  return null;
}
// 3.5.1: what a notification shows on a locked phone: 'all', 'chat' (the default: the bots' messages and cards hidden) or
// 'none' (only «Tienes un mensaje nuevo»).
export const PREVIEWS = ['all', 'chat', 'none'];
export const pushPreview = (config) => (PREVIEWS.includes(config?.mobile?.preview) ? config.mobile.preview : 'chat');
// What a notification says: what ('chat': the assistant's chat, 'bots': a bot's message, card or reminder) with its own
// title and text, or only the assistant's name and «Tienes un mensaje nuevo».
export function pushContent(what, { title, body }, config) {
  const v = pushPreview(config); const name = config?.assistantName ?? 'Orb';
  const shown = v === 'all' || (v === 'chat' && what === 'chat');
  return shown ? { title: String(title ?? name).slice(0, 80), body: String(body ?? '').slice(0, 200) } : { title: name, body: tr('msg.remote.pushHidden') };
}
// What a call from outside gets back (the settings without secrets).
export const shapeResult = (method, result) => (method === 'app.state' && result ? { ...result, config: phoneConfig(result.config) } : result);

// 3.5: only the home network, Tailscale and this PC itself may talk to Orb: 127.0.0.0/8, 10/8, 172.16/12, 192.168/16,
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
const kindOf = (proof) => (KINDS.includes(proof?.kind) ? proof.kind : /iphone|ipad|android/i.test(String(proof?.name ?? '')) ? 'phone' : 'browser');
// 3.5.1: the kind of a new device: the one the QR was made for. A QR made without saying takes what a phone, a browser
// or a terminal says it is (they have the same rights), never «orb»; null: the device does not match the QR.
export function kindForPairing(issued, claimed) {
  if (issued === 'orb') return claimed === 'orb' ? 'orb' : null;
  if (claimed === 'orb') return null;
  if (PAIR_KINDS.includes(issued)) return issued;
  return ['phone', 'browser', 'terminal'].includes(claimed) ? claimed : 'phone';
}
const isLoopback = (ip) => /^(127\.|::1$)/.test(String(ip ?? '').replace(/^::ffff:/, ''));
// 3.5.1: whether a pairing comes from a browser's page over plain http on the home network: not a program (no Origin: the
// terminal, another Orb), not the Android app, not this PC (or Tailscale's https, which arrives through loopback), not the
// Tailscale address; and the user did not allow it (lanHttp).
export function plainHttpBrowser({ origin, app = false, localAddress, routes = [], lanHttp = false }) {
  if (lanHttp || !origin || app) return false;
  const local = String(localAddress ?? '').replace(/^::ffff:/, '');
  if (isLoopback(local)) return false;
  const r = (routes ?? []).find((x) => x.address === local);
  return !(r && r.kind === 'tailscale');
}
const parseMeta = (d) => { try { return d?.meta ? JSON.parse(d.meta) : {}; } catch { return {}; } };
const linkError = (message, extra = {}) => Object.assign(new Error(message), { userFacing: true, extra });
// 3.5: the Android app's page (Capacitor) is not served by this PC but by the app itself (http://localhost): it may call
// the API, where everything is still sealed with the phone's own key, and its WebView has to be told so (CORS).
const APP_ORIGINS = new Set(['http://localhost', 'https://localhost', 'capacitor://localhost']);
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

// This PC's addresses on the local network (home Wi-Fi or cable): private IPv4 only, without virtual adapters (WSL,
// Hyper-V, VirtualBox, Docker…) or VPNs. The Wi-Fi or Ethernet one first: it is the one the QR shows.
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    // 3.5: also Linux's container and VM bridges (br-…, veth…, virbr…, lxc…): a server with Docker has several.
    if (/vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|bluetooth|vpn|tap|tun|^br-|^veth|^virbr|^lxc|^lxd|^cni|^flannel|^podman/i.test(name)) continue;
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

export function createRemote({ board, api, log, emit = () => {} }) {
  let servers = []; // http servers (one per address)
  let state = { running: false, routes: [], error: null };
  let generation = 0; // moved by stop(): a start() still waiting for Tailscale gives up
  let starting = null;
  let watcher = null;
  let served = null; // the https port `tailscale serve` is forwarding for us (turned off on stop)
  let pairing = null; // { code, short, expires, route, fails }
  const forwarded = new Map(); // 3.5: calls sent to the workshop waiting for its answer: id -> { resolve, reject, device, timer }
  let flushing = false; // the workshop's waiting calls are being sent
  const role = () => myRole();
  const orbName = () => orbNameOf(ctx.config);
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
  const touch = (d, req) => {
    const ip = req ? ipOf(req) : d.ip;
    if (!d.last_seen || Date.now() - Date.parse(d.last_seen) > 60_000 || ip !== d.ip) { board.run('UPDATE devices SET last_seen = ?, ip = ? WHERE id = ?', now(), ip ?? null, d.id); d.ip = ip; d.last_seen = now(); }
  };

  // A request is accepted once: recent and with a nonce not seen before. 'ok', 'replay', or 'clock' when its time is too
  // far from the PC's (the phone's clock is off: it gets the PC's time and stamps its requests with it).
  function freshness(deviceId, nonce, t) {
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > CLOCK_SKEW_MS) return 'clock';
    let m = seen.get(deviceId); if (!m) seen.set(deviceId, (m = new Map()));
    const at = Date.now();
    for (const [n, exp] of m) if (exp < at) m.delete(n);
    if (m.has(nonce)) return 'replay';
    // 3.0: a busy phone (thousands of requests in 10 min) is not mistaken for a replay and unpaired: the oldest nonces
    // make room (a Map keeps insertion order).
    while (m.size >= 5000) m.delete(m.keys().next().value);
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
  const originOk = (req) => !req.headers.origin || Boolean(appOrigin(req)) || state.origins?.includes(String(req.headers.origin).toLowerCase());

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
    if (!(rel === 'index.html' || rel === 'icon.png' || /^assets\/[\w.-]+$/.test(rel) || /^(robot|apps)\/[\w-]+\.png$/.test(rel) || /^juegos\/ajedrez\/rhosgfx\/[wb][KQRBNP]\.svg$/.test(rel) || /^excalidraw\/fonts\/[A-Za-z]+\/[\w.-]+\.woff2$/.test(rel))) return send(res, 404, 'no encontrado', 'text/plain');
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
    // 3.5: only the home network, Tailscale and this PC (never the internet: Tailscale Funnel requests are refused too).
    if (!privateSource(req.socket?.remoteAddress) || req.headers['tailscale-funnel-request']) { req.resume(); return send(res, 403, { error: 'red no permitida' }); }
    if (!hostOk(req)) return send(res, 421, { error: 'host no permitido' });
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const app = p.startsWith('/api/') ? appOrigin(req) : null;
    if (app) { res.setHeader('Access-Control-Allow-Origin', app); for (const [k, v] of Object.entries(APP_CORS)) res.setHeader(k, v); }
    if (req.method === 'OPTIONS') { req.resume(); return send(res, app ? 204 : 403, '', 'text/plain'); }
    if (req.method === 'GET' && p === '/api/hello') return helloInfo(res);
    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(req, res, p);
    if (!originOk(req)) return send(res, 403, { error: 'origen no permitido' });

    if (req.method === 'POST' && p === '/api/pair') return pair(req, res);

    const device = deviceOf(req);
    if (!device) { req.resume(); return send(res, 401, { error: tr('msg.remote.notLinked') }); }

    if (req.method === 'GET' && p === '/api/events') {
      const auth = openHeader(req, device, 'events');
      if (!auth) return send(res, 401, { error: tr('msg.remote.notLinked') });
      if (auth.clock) return clockOff(res);
      touch(device, req);
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': hola\n\n');
      const client = { res, device: device.id, key: keyOf(device), kind: device.kind ?? kindOf({ name: device.name }), role: device.role ?? null, at: Date.now() };
      const mine = [...clients].filter((c) => c.device === device.id);
      if (mine.length >= STREAMS_PER_DEVICE) { try { mine[0].res.end(); } catch { /* closed */ } clients.delete(mine[0]); }
      clients.add(client);
      if (client.kind === 'orb') linkChanged();
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
      req.on('close', () => {
        clearInterval(ping); clients.delete(client);
        if (client.kind === 'orb' && ![...clients].some((c) => c.device === client.device)) {
          board.run('UPDATE devices SET last_seen = ? WHERE id = ?', now(), client.device);
          for (const [id, f] of forwarded) if (f.device === client.device) { forwarded.delete(id); clearTimeout(f.timer); f.reject(offline(board.one('SELECT * FROM devices WHERE id = ?', client.device))); }
          linkChanged();
        }
      });
      return undefined;
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'no encontrado' });
    if (p === '/api/upload') return upload(req, res, device);

    const what = { '/api/call': 'call', '/api/me': 'me', '/api/push': 'push', '/api/link': 'link' }[p];
    if (!what) { req.resume(); return send(res, 404, { error: 'no encontrado' }); }
    let box; try { box = await readJson(req, what === 'link' ? 4_000_000 : 400_000); } catch (error) { return send(res, error.status ?? 400, { error: error.message }); }
    const msg = openRequest(device, box, what);
    if (!msg) return send(res, 401, { error: tr('msg.remote.notLinked') });
    if (msg.clock) return clockOff(res);
    touch(device, req);

    if (what === 'me') return reply(res, device, msg.nonce, { ok: true, result: { device: device.name, name: ctx.config.assistantName, orb: orbName(), role: role(), v: PROTOCOL, pc: pcFingerprint, push: Boolean(device.push), vapid: own.vapid.publicKey } });
    if (what === 'push') {
      // Turn notifications on (a subscription made by this phone's browser) or off (null).
      try {
        const sub = msg.body?.subscription ? checkSubscription(msg.body.subscription) : null;
        board.run('UPDATE devices SET push = ? WHERE id = ?', sub ? JSON.stringify(sub) : null, device.id);
        return reply(res, device, msg.nonce, { ok: true, result: { push: Boolean(sub) } });
      } catch (error) { return reply(res, device, msg.nonce, { ok: false, error: error.message }); }
    }
    if (what === 'link') return linkOp(res, device, msg);
    // what === 'call'
    let method = String(msg.body?.method ?? '');
    const params = msg.body?.params && typeof msg.body.params === 'object' ? msg.body.params : {};
    // 3.5: { method, target: 'taller' } is the same as taller.<method>: the centre passes it on to its workshop.
    if (msg.body?.target === 'taller' && !method.startsWith('taller.')) method = `taller.${method}`;
    const deny = (error) => reply(res, device, msg.nonce, { ok: false, status: 403, error });
    if (method.startsWith('taller.')) {
      try { return reply(res, device, msg.nonce, { ok: true, result: (await remote.taller(method.slice(7), params, { from: device.id })) ?? null }); }
      catch (error) { return reply(res, device, msg.nonce, { ok: false, status: error.extra?.status ?? 400, error: oneLine(error?.message ?? String(error), 1000), ...(error.extra ?? {}) }); }
    }
    if (LINK_ALLOWED.has(method)) return reply(res, device, msg.nonce, { ok: true, result: remote.linkStatus({ forPhone: true }) });
    // 3.5: the Orb mode of a phone or a terminal is the work of the Orb that programs: there it goes, when it is another one.
    if (device.kind !== 'orb' && devForwards(method) && devTargetDevice()) {
      try { return reply(res, device, msg.nonce, { ok: true, result: (await remote.taller(method, params, { from: device.id })) ?? null }); }
      catch (error) { return reply(res, device, msg.nonce, { ok: false, status: error.extra?.status ?? 400, error: oneLine(error?.message ?? String(error), 1000), ...(error.extra ?? {}) }); }
    }
    // 2.6: which account the assistant spends is chosen on the PC (the brain's agent and model, also from the phone).
    if (method === 'chat.settings' && params.account !== undefined) delete params.account;
    // 3.5: a bot learns that the user writes from a phone or a terminal (from the device's kind, never from what it sends).
    if (method === 'bots.send' || method === 'bots.groups.send') { delete params.via; if (device.kind === 'phone' || device.kind === 'terminal') params.via = device.kind; }
    const allowed = allowedFor(role(), device.kind, Boolean(device.admin), Number(device.kind_ok) === 1);
    // 3.5.1: who answers a bot's card (kept with the card) and with which rights: set here, never by what the device sends.
    if (method === 'bots.decide') { delete params.by; params.by = approverOf(device, allowed); }
    const why = guardCall(board, method, params, { uploadsDir: uploads(), allowed });
    if (why) return deny(why);
    try {
      let result = shapeResult(method, (await api.call(method, params)) ?? null);
      // What this device may do here (the interface shows or hides the buttons for it).
      if (method === 'app.state' && result) result = { ...result, access: { admin: Boolean(device.admin), bots: allowed.has('bots.create'), links: allowed.has('link.qr'), approve: Number(device.approve ?? 1) === 1 } };
      return reply(res, device, msg.nonce, { ok: true, result });
    }
    catch (error) { return reply(res, device, msg.nonce, { ok: false, error: oneLine(error?.message ?? String(error), 1000) }); }
  }

  // 3.5: what another Orb sends on its link: who it is (hello), answers to forwarded calls (reply), its live events
  // (events) and «forget me» (bye).
  async function linkOp(res, device, msg) {
    const op = String(msg.body?.op ?? '');
    const ok = (result = true) => reply(res, device, msg.nonce, { ok: true, result });
    const no = (error, status = 403) => reply(res, device, msg.nonce, { ok: false, status, error });
    if (op === 'bye') { remote.revoke(device.id, { quiet: true }); return ok(); }
    if (device.kind !== 'orb') return no(tr('msg.remote.pcOnly'));
    const b = msg.body ?? {};
    if (op === 'hello') {
      const meta = { ...parseMeta(device), host: oneLine(String(b.host ?? ''), 80) || null, macs: (Array.isArray(b.macs) ? b.macs : []).map(normalMac).filter(Boolean).slice(0, 8),
        version: b.version ? oneLine(String(b.version), 40) : null, platform: b.platform ? oneLine(String(b.platform), 20) : null };
      const r = ROLES.includes(b.role) ? b.role : device.role;
      board.run('UPDATE devices SET meta = ?, role = ? WHERE id = ?', JSON.stringify(meta), r ?? null, device.id);
      for (const c of clients) if (c.device === device.id) c.role = r;
      // 3.5.1: an Orb that says it programs is not the Orb mode of this one's phones until the owner confirms it here
      // (Ajustes › Magic Link); the owner is told when it starts saying so.
      if (doesDev(r ?? 'centro') && Number(device.dev_ok) !== 1 && device.role !== r) board.notice(tr('msg.link.confirmTaller', { name: device.name }), 'warning');
      // wantsEvents: whether this Orb wants its live events (only from the one its phones' Orb mode goes to).
      ok({ role: role(), name: orbName(), v: PROTOCOL, wantsEvents: devTargetDevice()?.id === device.id });
      linkChanged();
      if (devTargetDevice()?.id === device.id) flushQueue().catch((error) => log(`enlace: cola: ${error.message}`));
      return undefined;
    }
    if (op === 'reply') {
      const f = forwarded.get(String(b.id ?? ''));
      if (!f || f.device !== device.id) return no('respuesta sin petición', 404);
      forwarded.delete(String(b.id)); clearTimeout(f.timer);
      if (b.ok) f.resolve(b.result ?? null); else f.reject(linkError(oneLine(String(b.error ?? 'error'), 1000), { status: Number(b.status) || 400 }));
      return ok();
    }
    if (op === 'events') {
      // Only the Orb this one sends the Orb mode to (its phones see what it does); any other is thanked and ignored.
      if (!doesDev(device.role ?? 'centro') || Number(device.dev_ok) !== 1 || devTargetDevice()?.id !== device.id) return ok(false);
      for (const ev of (Array.isArray(b.list) ? b.list : []).slice(0, 200)) {
        if (typeof ev?.e === 'string' && RELAY_EVENTS.has(ev.e)) emit(`taller:${ev.e}`, ev.e === 'config:changed' ? null : ev.p ?? null);
      }
      return ok();
    }
    return no('operación desconocida', 404);
  }

  // 3.5: what a device that has only the short code needs to know (only while a code is on screen).
  function helloInfo(res) {
    if (!pairing || Date.now() > pairing.expires) return send(res, 404, { error: tr('msg.link.noCode') });
    // short: 3 (3.5.1): the short code is tied to this key (link.mjs › connect refuses an Orb without it).
    return send(res, 200, { v: PROTOCOL, short: 3, pc: b64.enc(own.pub), fp: pcFingerprint, name: orbName(), role: role(), urls: (state.routes ?? []).map((r) => r.url) });
  }

  // Pairing: the phone sends its public key and a proof sealed with the key of this QR (the one-time code never travels).
  // 3.5: or with the key of the short code typed by hand (via: 'code'). Phones, browsers and other Orbs alike.
  async function pair(req, res) {
    const who = ipOf(req) || '?';
    const recent = (failures.get(who) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
    failures.set(who, recent);
    if (recent.length >= 10) { req.resume(); return send(res, 429, { error: tr('msg.remote.tooMany') }); }
    const fail = () => {
      recent.push(Date.now());
      // Many wrong tries in all (from any address): the code on screen is no longer good.
      if (pairing && ++pairing.fails >= PAIR_FAILS_MAX) { pairing = null; log('enlace: demasiados intentos; código anulado'); }
      return send(res, 401, { error: tr('msg.remote.badQr') });
    };
    let body; try { body = await readJson(req, 10_000); } catch { return fail(); }
    if (!pairing || Date.now() > pairing.expires || !body || typeof body.pub !== 'string') return fail();
    // 3.5.1: a page served over the home Wi-Fi in plain http could have been changed on the way: a browser links only over
    // https (Tailscale), the Tailscale address or this PC itself, unless the user allowed it (Ajustes › Magic Link). The
    // Android app and the terminal bring their own code and check the key, so they may.
    if (plainBrowser(req)) return send(res, 403, { error: tr('msg.link.httpBrowser') });
    let devPub; try { devPub = b64.dec(body.pub); } catch { return fail(); }
    if (devPub.length !== 32) return fail();
    // The short code: code3 (3.5.1, stretched and tied to this key); code (3.5.0) still opens, for older apps.
    const secretOf = body.via === 'code3' ? pairing.short3 : body.via === 'code' ? `corto:${pairing.short}` : pairing.code;
    let proof; try { proof = open(pairingKey(own.priv, devPub, secretOf), body.proof, AAD.pair); } catch { return fail(); }
    if (!proof || proof.pub !== body.pub) return fail();
    // The QR was right but the phone's clock is off: it tries again with the PC's time (the QR is not used up).
    if (!(Math.abs(Date.now() - Number(proof.t)) <= CLOCK_SKEW_MS)) return clockOff(res);
    // 3.5.1: what the device is was chosen when the QR was made; a device that says otherwise is refused (the QR stays).
    const kind = kindForPairing(pairing.device, KINDS.includes(proof.kind) ? proof.kind : kindOf({ name: proof.name }));
    if (!kind) return send(res, 403, { error: tr(pairing.device === 'orb' ? 'msg.link.wantsOrb' : 'msg.link.notForOrb') });
    const { route, admin: askedAdmin, approve, dev } = pairing;
    pairing = null; // one use
    const id = crypto.randomUUID();
    const name = oneLine(typeof proof.name === 'string' && proof.name ? proof.name : tr(kind === 'orb' ? 'msg.link.defaultOrb' : 'msg.remote.defaultName'), 60);
    const peerRole = kind === 'orb' && ROLES.includes(proof.role) ? proof.role : null;
    // «Puede administrar»: asked by whoever made the QR (true: the PC, `orb-nucleo enlazar --admin` on the server itself or
    // a device that administers), or 'first': the first device of a server without a window gets it.
    const admin = askedAdmin === true || (askedAdmin === 'first' && !board.one('SELECT id FROM devices WHERE admin = 1 AND public_key IS NOT NULL'));
    const meta = kind === 'orb' ? { host: oneLine(String(proof.host ?? ''), 80) || null, macs: (Array.isArray(proof.macs) ? proof.macs : []).map(normalMac).filter(Boolean).slice(0, 8), version: proof.version ? oneLine(String(proof.version), 40) : null } : {};
    const devOk = kind === 'orb' && dev ? 1 : 0;
    board.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, role, ip, meta, admin, kind_ok, approve, dev_ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      id, name, `clave:${id}`, now(), now(), body.pub, route, kind, peerRole, who, JSON.stringify(meta), admin ? 1 : 0, approve === false ? 0 : 1, devOk);
    board.event(null, 'usuario', 'device.paired', name);
    const wantsDev = Boolean(peerRole && doesDev(peerRole) && !programs());
    board.notice(tr(wantsDev ? (devOk ? 'msg.link.tallerLinked' : 'msg.link.confirmTaller') : 'msg.remote.deviceLinked', { name }), wantsDev && !devOk ? 'warning' : 'success');
    // The answer is sealed with the new session key: the phone checks it really is the PC of the QR. 3.5.1: and with the
    // code's key too, so a device that got a key from someone in the middle finds out (nobody else has the code).
    const key = sessionKey(own.priv, devPub); keys.set(id, key);
    linkChanged();
    return send(res, 200, { id, box: seal(key, { id, name: ctx.config.assistantName, orb: orbName(), role: role(), v: PROTOCOL, pc: pcFingerprint }, AAD.paired(id)),
      confirm: seal(pairingKey(own.priv, devPub, secretOf), { id, pc: pcFingerprint }, AAD.confirm(id)) });
  }

  // 3.5.1: a request from a browser's page that came over plain http on the home network (not this PC, not Tailscale's
  // https through loopback, not the Tailscale address), while the user did not allow it.
  const plainBrowser = (req) => plainHttpBrowser({ origin: req.headers.origin, app: Boolean(appOrigin(req)), localAddress: req.socket?.localAddress, routes: state.routes, lanHttp: ctx.config.mobile?.lanHttp === true });

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
    const note = pushContent('chat', { title: payload.role === 'orb' ? name : tr('msg.remote.pushNotice', { name }), body: payload.body }, ctx.config);
    for (const d of board.all('SELECT id, push FROM devices WHERE push IS NOT NULL')) {
      if (openNow.has(d.id)) continue;
      let sub; try { sub = JSON.parse(d.push); } catch { continue; }
      sendPush(sub, { ...note, tag: 'orb-chat', url: '/' }, own.vapid)
        .then((r) => { if (r === 'gone') board.run('UPDATE devices SET push = NULL WHERE id = ?', d.id); })
        .catch(() => {});
    }
  }

  // ---- listening: one http server per address; the Tailscale https name goes through `tailscale serve` to loopback.
  const listen = (address, port) => new Promise((resolve) => {
    const srv = http.createServer((req, res) => { handle(req, res).catch((error) => { log(`móvil: ${error.stack}`); try { send(res, 500, { error: tr('msg.remote.internalError') }); } catch { /* sent */ } }); });
    srv.headersTimeout = 15_000; srv.requestTimeout = 60_000;    srv.once('error', (error) => resolve({ error }));
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
  // 2.7: closing waits until every server and its open connections are really gone (2 s at most), so a restart on the same
  // port never answers through a half-closed old one: a phone's request could hang on it for ~20 s and then fail (the
  // «reabrir el acceso» test failed now and then for that).
  function closeAll() {
    const closing = servers.map((s) => new Promise((resolve) => { try { s.close(() => resolve()); s.closeAllConnections?.(); } catch { resolve(); } setTimeout(resolve, 2000).unref?.(); }));
    servers = [];
    return Promise.all(closing);
  }

  // 3.5: a notification of the bots (a reminder, a bot's answer, a card waiting): to every phone with notifications on
  // that does not have the app open.
  function pushNote({ title, body } = {}) {
    const openNow = new Set([...clients].map((c) => c.device));
    const note = pushContent('bots', { title, body }, ctx.config);
    for (const d of board.all('SELECT id, push FROM devices WHERE push IS NOT NULL')) {
      if (openNow.has(d.id)) continue;
      let sub; try { sub = JSON.parse(d.push); } catch { continue; }
      sendPush(sub, { ...note, tag: 'orb-bot', url: '/' }, own.vapid)
        .then((r) => { if (r === 'gone') board.run('UPDATE devices SET push = NULL WHERE id = ?', d.id); }).catch(() => {});
    }
  }

  // ---- 3.5 Magic Link: linked devices, the workshop seen from the centre, forwarding, Wake-on-LAN and the waiting queue.
  const onlineIds = () => new Set([...clients].map((c) => c.device));
  function deviceView(d, on = onlineIds()) {
    const meta = parseMeta(d);
    const kind = d.kind ?? kindOf({ name: d.name });
    // 3.5.1: approve (may answer the bots' cards), confirmed (an Orb the owner chose when making its QR or confirmed
    // after), devOk (may be the Orb that programs for this one) and devPending (says it programs, not confirmed yet).
    return { id: d.id, name: d.name, kind, role: d.role ?? null, createdAt: d.created_at, lastSeen: d.last_seen ?? null, ip: d.ip ?? null,
      route: d.route ?? null, push: Boolean(d.push), online: on.has(d.id), host: meta.host ?? null, version: meta.version ?? null, canWake: Boolean(meta.macs?.length), admin: Boolean(d.admin),
      approve: Number(d.approve ?? 1) === 1, confirmed: kind !== 'orb' || Number(d.kind_ok) === 1, devOk: Number(d.dev_ok) === 1, devPending: kind === 'orb' && ['taller', 'todo'].includes(d.role) && Number(d.dev_ok) !== 1 };
  }
  const devices = () => { const on = onlineIds(); return board.all('SELECT * FROM devices WHERE public_key IS NOT NULL ORDER BY created_at DESC').map((d) => deviceView(d, on)); };
  // The linked Orbs that program («taller» or «todo»).
  // 3.5.1: only the ones the owner confirmed here (an Orb cannot make itself the workshop by saying so).
  const tallers = () => board.all("SELECT * FROM devices WHERE kind = 'orb' AND kind_ok = 1 AND dev_ok = 1 AND role IN ('taller', 'todo') AND public_key IS NOT NULL ORDER BY COALESCE(last_seen, created_at) DESC");
  // 3.5: where the Orb mode of this Orb's phones goes: the Orb chosen in «Orb para programar»; else this one if it programs
  // (null); else the linked one that does (the one on right now, or else the last one seen).
  const devTargetDevice = () => {
    const list = tallers(); const pick = String(ctx.config?.devTarget ?? '');
    if (pick && pick !== 'local') { const d = list.find((x) => x.id === pick); if (d) return d; }
    if (programs()) return null;
    const on = onlineIds(); return list.find((d) => on.has(d.id)) ?? list[0] ?? null;
  };
  const tallerDevice = devTargetDevice;
  const pendingCount = () => board.one("SELECT COUNT(*) AS n FROM link_queue WHERE status = 'pendiente'")?.n ?? 0;
  const tallerView = (d) => ({ ...deviceView(d), queued: pendingCount() });
  const offline = (d) => linkError(tr('msg.link.tallerOffline', { name: d?.name ?? tr('msg.link.defaultOrb') }), { status: 503, offline: true, lastSeen: d?.last_seen ?? null, canWake: Boolean(parseMeta(d).macs?.length) });
  let changeTimer = null;
  function linkChanged() {
    changeTimer ??= setTimeout(() => {
      changeTimer = null;
      try { emit('link:devices', devices()); emit('link:status', remote.linkStatus({ forPhone: true })); } catch (error) { log(`enlace: ${error.message}`); }
    }, 80);
    changeTimer.unref?.();
  }
  // What the centre may pass on to its workshop (checked again there, with its own database).
  function forwardCheck(method, params) {
    if (!ROLE_FORWARD.taller.has(method)) throw linkError(tr('msg.remote.pcOnly'), { status: 403 });
    if (params?.permission === 'total') throw linkError(tr('msg.remote.totalPcOnly'), { status: 403 });
    if (params?.images !== undefined) throw linkError(tr('msg.link.noImages'), { status: 403 });
  }
  // A call for the workshop goes down its own live stream (it may be behind a router or asleep: the centre never has to
  // reach it); its answer comes back as a 'reply' on /api/link.
  function forward(d, method, params) {
    const streams = [...clients].filter((c) => c.device === d.id).sort((a, b) => b.at - a.at);
    if (!streams.length) return Promise.reject(offline(d));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { forwarded.delete(id); reject(linkError(tr('msg.link.tallerTimeout', { name: d.name }), { status: 504 })); }, FORWARD_MS);
      timer.unref?.();
      forwarded.set(id, { resolve, reject, device: d.id, timer });
      try { streams[0].res.write(`data: ${sealText(streams[0].key, { e: 'link:request', p: { id, method, params } }, AAD.event(d.id))}\n\n`); }
      catch { forwarded.delete(id); clearTimeout(timer); reject(offline(d)); }
    });
  }
  // The calls left for the workshop while it was off, sent in order as soon as it says hello.
  async function flushQueue() {
    if (flushing) return;
    flushing = true;
    let done = 0; let d = null;
    try {
      for (;;) {
        d = tallerDevice(); if (!d || !onlineIds().has(d.id)) break;
        const row = board.one("SELECT * FROM link_queue WHERE status = 'pendiente' ORDER BY id LIMIT 1"); if (!row) break;
        let params = {}; try { params = JSON.parse(row.params); } catch { /* none */ }
        try {
          const result = await forward(d, row.method, params);
          board.run("UPDATE link_queue SET status = 'hecho', result = ?, done_at = ? WHERE id = ?", JSON.stringify(result ?? null).slice(0, 20_000), now(), row.id);
          emit('link:queue', { id: row.id, status: 'hecho', method: row.method }); done++;
        } catch (error) {
          if (error.extra?.offline) break; // it went away again: the rest waits
          board.run("UPDATE link_queue SET status = 'error', result = ?, done_at = ? WHERE id = ?", JSON.stringify({ error: oneLine(error.message, 500) }), now(), row.id);
          emit('link:queue', { id: row.id, status: 'error', method: row.method, error: oneLine(error.message, 300) });
        }
      }
    } finally { flushing = false; }
    if (done) board.notice(tr('msg.link.queueDone', { n: done, name: d?.name ?? '' }), 'success');
  }

  const remote = {
    push: pushNote,
    // Engine events go to the paired phones too (only the ones the interface needs), each sealed for its phone.
    // 3.5: a linked Orb gets only what is meant for it (the calls it is asked to run), never the interface's events; the
    // workshop's own events reach the phones as taller:<event>.
    broadcast(event, payload) {
      if (event === 'chat:new') notify(payload);
      if (!clients.size || !(EVENTS.has(event) || event.startsWith('taller:') || (event === 'agents:login' && isHeadless()))) return;
      // The settings themselves never travel to a phone (the page just reloads what it is allowed to see).
      const value = { e: event, p: event === 'config:changed' || event === 'taller:config:changed' ? null : payload };
      // 3.5: the events of the Orb that programs for this one's phones (only that one sends them, see linkOp 'events') also
      // reach them under their own name, for their Orb mode (which goes there).
      const plain = event.startsWith('taller:') ? { e: event.slice(7), p: value.p } : null;
      for (const c of clients) {
        if (c.kind === 'orb' && !(BOT_EVENTS.has(event) && keepsBots())) continue;
        if (c.res.writableLength > STREAM_BACKLOG) { try { c.res.destroy(); } catch { /* gone */ } clients.delete(c); continue; }
        try {
          c.res.write(`data: ${sealText(c.key, value, AAD.event(c.device))}\n\n`);
          if (plain && c.kind !== 'orb') c.res.write(`data: ${sealText(c.key, plain, AAD.event(c.device))}\n\n`);
        } catch { clients.delete(c); }
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
      for (const [id, f] of forwarded) { forwarded.delete(id); clearTimeout(f.timer); f.reject(linkError(tr('msg.link.stopped'), { status: 503 })); }
      clients.clear(); await closeAll(); pairing = null; state = { running: false, routes: [], error: null };
      await unserve();
    },
    status() {
      return { enabled: Boolean(ctx.config.mobile?.enabled), running: Boolean(state.running), routes: state.routes ?? [], error: state.error ?? null, pc: pcFingerprint,
        wifi: ctx.config.mobile?.wifi !== false, tailscale: ctx.config.mobile?.tailscale !== false, role: role(), name: orbName(),
        lanHttp: ctx.config.mobile?.lanHttp === true, preview: pushPreview(ctx.config),
        devices: board.all('SELECT id, name, created_at, last_seen, route, kind, role, ip, push IS NOT NULL AS push FROM devices ORDER BY created_at DESC').map((d) => ({ ...d, push: Boolean(d.push) })) };
    },
    // A one-time QR for 5 minutes, for one of the ways in (Wi-Fi or Tailscale). The code and this PC's key travel in the
    // URL fragment (#), which the browser never sends to any server.
    // 3.5 (protocol v2): the fragment also names this Orb, its role and its other addresses; and a short code (8 letters
    // and digits) can be typed by hand instead, together with the address.
    // admin: the device that uses it may administer this Orb (only for a server without a window, only its first one).
    // 3.5.1: device: what it is for (phone, browser, orb, terminal), chosen here by the owner, never by the device;
    // approve: whether it may answer the bots' cards (default yes); dev: for an Orb, whether it may be the one that
    // programs for this one; admin: true (whoever makes the QR is the owner: the PC, the server's own terminal or a device
    // that administers) or 'first' (only while no device administers, on a server without a window).
    pair(kind, { admin = false, device = null, approve = true, dev = false } = {}) {
      if (!state.running) throw new Error(tr('msg.remote.enableFirst'));
      const route = state.routes.find((r) => r.kind === kind) ?? state.routes[0];
      const code = crypto.randomBytes(18).toString('base64url');
      const short = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
      const forKind = PAIR_KINDS.includes(device) ? device : null;
      pairing = { code, short, short3: shortSecret(short, b64.enc(own.pub)), expires: Date.now() + PAIR_MINUTES * 60_000, route: route.kind, fails: 0,
        admin: admin === true && isHeadless() ? true : admin === 'first' && isHeadless() ? 'first' : false, device: forKind, approve: approve !== false, dev: forKind === 'orb' && dev === true };
      const others = state.routes.filter((r) => r !== route).map((r) => r.url);
      const frag = new URLSearchParams({ vincular: code, pc: b64.enc(own.pub), v: String(PROTOCOL), n: orbName(), r: role() });
      if (others.length) frag.set('a', others.join(','));
      return { url: `${route.url}#${frag}`, payload: { v: PROTOCOL, urls: [route.url, ...others], pc: b64.enc(own.pub), code, name: orbName(), role: role(), expiresAt: pairing.expires },
        code: shortCodeLabel(short), address: route.url, expiresAt: pairing.expires, kind: route.kind, secure: route.secure, pc: pcFingerprint, name: orbName(), role: role(),
        device: forKind, admin: pairing.admin === true, approve: pairing.approve, browserOk: Boolean(route.secure) || route.address === '127.0.0.1' || route.kind === 'tailscale' || ctx.config.mobile?.lanHttp === true };
    },
    revoke(id, { quiet = false } = {}) {
      const d = board.one('SELECT * FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      board.run('DELETE FROM devices WHERE id = ?', d.id);
      keys.delete(d.id); seen.delete(d.id);
      for (const c of clients) if (c.device === d.id) { try { c.res.end(); } catch { /* closed */ } clients.delete(c); }
      for (const [fid, f] of forwarded) if (f.device === d.id) { forwarded.delete(fid); clearTimeout(f.timer); f.reject(offline(d)); }
      board.event(null, 'usuario', quiet ? 'device.unlinked' : 'device.revoked', d.name);
      linkChanged();
      return true;
    },
    // ---- 3.5 Magic Link
    devices,
    rename(id, name) {
      const d = board.one('SELECT id FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      const clean = oneLine(String(name ?? ''), 60).trim(); if (!clean) throw new Error(tr('msg.link.needName'));
      board.run('UPDATE devices SET name = ? WHERE id = ?', clean, d.id);
      linkChanged();
      return deviceView(board.one('SELECT * FROM devices WHERE id = ?', d.id));
    },
    // 3.5: this Orb's role or its «Orb para programar» changed: the linked Orbs are asked to say hello again (and so learn
    // whether their live events are wanted here), and the phones get the new state.
    relinkOrbs() {
      for (const c of [...clients]) if (c.kind === 'orb') { try { c.res.write(`data: ${sealText(c.key, { e: 'link:rehello', p: null }, AAD.event(c.device))}\n\n`); } catch { clients.delete(c); } }
      linkChanged();
      if (devTargetDevice()) flushQueue().catch((error) => log(`enlace: cola: ${error.message}`));
    },
    // 3.5: «Puede administrar» on or off for a linked device (its next call already has it or not).
    setAdmin(id, admin) {
      const d = board.one('SELECT id, name FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      board.run('UPDATE devices SET admin = ? WHERE id = ?', admin ? 1 : 0, d.id);
      board.event(null, 'usuario', admin ? 'device.admin' : 'device.noAdmin', d.name);
      linkChanged();
      return deviceView(board.one('SELECT * FROM devices WHERE id = ?', d.id));
    },
    // 3.5.1: whether a linked device may answer the bots' cards.
    setApprove(id, on) {
      const d = board.one('SELECT id, name FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      board.run('UPDATE devices SET approve = ? WHERE id = ?', on ? 1 : 0, d.id);
      board.event(null, 'usuario', on ? 'device.approve' : 'device.noApprove', d.name);
      linkChanged();
      return deviceView(board.one('SELECT * FROM devices WHERE id = ?', d.id));
    },
    // 3.5.1: the owner confirms here that a linked device is one of their Orbs (what: 'orb'), or that it may be the Orb
    // that programs for this one (what: 'taller', which confirms it is an Orb too).
    confirm(id, what) {
      const d = board.one('SELECT * FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      if (d.kind !== 'orb') throw new Error(tr('msg.link.notAnOrb'));
      board.run(what === 'taller' ? 'UPDATE devices SET kind_ok = 1, dev_ok = 1 WHERE id = ?' : 'UPDATE devices SET kind_ok = 1 WHERE id = ?', d.id);
      board.event(null, 'usuario', what === 'taller' ? 'device.tallerOk' : 'device.orbOk', d.name);
      if (what === 'taller') remote.relinkOrbs(); else linkChanged();
      return deviceView(board.one('SELECT * FROM devices WHERE id = ?', d.id));
    },
    // Who is linked and who is on. For a phone, without the addresses.
    linkStatus({ forPhone = false } = {}) {
      const list = devices();
      const t = devTargetDevice();
      // dev: where the Orb mode of a phone goes: 'local' (this Orb programs), 'remote' (to «taller») or 'none'.
      return { role: role(), name: orbName(), v: PROTOCOL, running: Boolean(state.running), dev: t ? 'remote' : programs() ? 'local' : 'none',
        ...(forPhone ? {} : { devTarget: String(ctx.config?.devTarget ?? ''), tallers: tallers().map((d) => deviceView(d)) }),
        devices: forPhone ? list.map(({ id, name, kind, role: r, online, lastSeen }) => ({ id, name, kind, role: r, online, lastSeen })) : list,
        taller: t ? (forPhone ? (({ ip: _ip, ...rest }) => rest)(tallerView(t)) : tallerView(t)) : null };
    },
    // taller.<sub> on the centre: status, wake, queue and queued are answered here; anything else goes to the workshop.
    async taller(sub, params = {}, { from = null } = {}) {
      sub = String(sub ?? '');
      const d = devTargetDevice();
      if (sub === 'status') return d ? tallerView(d) : { linked: false, online: false, local: programs() };
      if (!d) throw programs() ? linkError(tr('msg.link.notCentro'), { status: 409 }) : linkError(tr('msg.link.noTaller'), { status: 404 });
      if (sub === 'wake') {
        const macs = parseMeta(d).macs ?? [];
        if (!macs.length) throw linkError(tr('msg.link.noMacs', { name: d.name }), { status: 409 });
        const r = await wake(macs);
        board.event(null, 'usuario', 'device.wake', d.name);
        log(`enlace: despertar ${d.name}: ${r.sent} paquete(s)`);
        return { ...r, name: d.name, online: onlineIds().has(d.id) };
      }
      if (sub === 'queue') {
        const method = String(params.method ?? ''); const inner = params.params && typeof params.params === 'object' ? params.params : {};
        forwardCheck(method, inner);
        const id = board.run('INSERT INTO link_queue (method, params, from_device, created_at) VALUES (?, ?, ?, ?)', method, JSON.stringify(inner).slice(0, 200_000), from, now()).lastInsertRowid;
        emit('link:queue', { id: Number(id), status: 'pendiente', method });
        if (onlineIds().has(d.id)) flushQueue().catch((error) => log(`enlace: cola: ${error.message}`));
        return { id: Number(id), queued: true, online: onlineIds().has(d.id) };
      }
      if (sub === 'queued') {
        return board.all('SELECT * FROM link_queue ORDER BY id DESC LIMIT 50').map((r) => { let result = null; try { result = r.result ? JSON.parse(r.result) : null; } catch { /* plain */ } return { id: r.id, method: r.method, status: r.status, createdAt: r.created_at, doneAt: r.done_at, result }; });
      }
      forwardCheck(sub, params);
      if (!onlineIds().has(d.id)) throw offline(d);
      return forward(d, sub, params);
    }
  };
  return remote;
}
