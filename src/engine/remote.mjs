// Phone access: the same interface as a web app, off by default. Two ways to reach the PC, each can be on or off:
// - the home Wi-Fi: plain http on this PC's local address (nothing to install on the phone);
// - Tailscale: https through `tailscale serve` when the tailnet has HTTPS (installable app and notifications), or plain
//   http on the Tailscale address otherwise.
// A phone is paired by scanning a one-time QR on the PC. The phone makes its own key and from then on every message is
// encrypted end to end (src/core/mobile-crypto.mjs): whoever sees the traffic (the Wi-Fi, a proxy) reads nothing, and a
// copied link or QR is useless. The PC can revoke any phone. What a phone may do is a subset of the PC's actions.
import { isMuted, itemOfConversation } from '../core/inbox.mjs';
import { buildNote, actionRoute } from '../core/notes.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ctx, tr } from '../core/context.mjs';
import { oneLine } from '../core/safety.mjs';
import { quickRun } from '../agents/index.mjs';
import { IS_WIN } from '../agents/common.mjs';
import { b64, newKeyPair, publicKeyOf, pairingKey, sessionKey, fingerprint, seal, open, sealText, openText, openBytes, AAD, CLOCK_SKEW_MS, shortSecret, sharedSecret, pakeTranscript, pakeKey, pakeMac, MAC_PHONE, macPc, sameBytes, pairKdfOk } from '../core/mobile-crypto.mjs';
import { PAIR_ID } from '../core/master.mjs';
import { newVapidKeys, checkSubscription, sendPush } from './webpush.mjs';
import { PROTOCOL, MIN_PROTOCOL, PAIR_PROTOCOL, versionOfProtocol, CODE_ALPHABET, shortCodeLabel } from '../core/link-payload.mjs';
import { REMOTE_METHODS, principalOf } from '../core/permissions.mjs';
import { isLegacy } from '../core/migrate-38.mjs';

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

// What a phone or a browser may call: the methods src/core/permissions.mjs marks 'remote'. Never by the kind a device
// says it is, and nothing with total access.
// 3.5.1: what the owner may choose when making a QR (the kind of device it is for).
export const PAIR_KINDS = ['phone', 'browser'];
const EVENTS = new Set(['board:changed', 'chat:state', 'chat:new', 'notice', 'session:item', 'session:update', 'session:removed', 'config:changed', 'session:delta', 'session:queue', 'approval:changed',
  // 3.6 (messaging lists): a chat list changed
  'inbox:changed']);
const PAIR_FAILS_MAX = 20; // wrong attempts (all addresses together) that cancel the code on screen
// 3.8: wrong master passwords one code allows (they do not use it up); then a new code is needed.
export const PAIR_PASSWORD_TRIES = 5;

// The checks of a call coming from a phone or a browser: null when it may run, or why not. `uploadsDir`: the pictures
// that may go with it.
export function guardCall(board, method, params, { allowed = REMOTE_METHODS, uploadsDir = null } = {}) {
  if (!allowed.has(method)) return tr('msg.remote.pcOnly');
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
// 3.5.1: what a notification shows on a locked phone: 'all', 'chat' (the default) or 'none' (only «Tienes un mensaje
// nuevo»). 3.8: 'all' and 'chat' show the same (the bots' messages, hidden with 'chat', are gone).
export const PREVIEWS = ['all', 'chat', 'none'];
export const pushPreview = (config) => (PREVIEWS.includes(config?.mobile?.preview) ? config.mobile.preview : 'chat');
// 3.8: no folder of this PC reaches a phone or browser. A value that is one whole absolute path (a project's folder, a
// task's copy, a conversation's cwd…) goes as its place inside the assistant folder («proyectos/web/tienda»), or just
// its last part when it is outside; in any other text (a chat message, an activity line, an error, a key), only the assistant folder's own
// path is cut, written in any case and with either separator. F2.6c: free text is never replaced whole (a message that
// starts with C:\ keeps its words). (Other paths an agent wrote in its text go as they are.)
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|mnt|media|var|tmp|opt|private|Volumes|srv|data)\/)/;
const UPLOAD_NAME = /^\d+-[0-9a-f]{8}\.(png|jpg|webp|gif)$/;
// Fields of free text (what people and agents write): never replaced whole, only the assistant folder is cut.
const TEXT_FIELD = /^(body|text|title|description|message|note|notes|result|summary|content|prompt|question|answer|label|reason|error|detail|final|output|input|brief|elements)$/i;
// A whole value that is one path (a single line, no sentence in it), in any other field.
const isPath = (v) => ABSOLUTE.test(v) && v.length <= 400 && !/[\r\n]|[.,;:!?]\s/.test(v);
function placeOf(file) {
  const rel = ctx.home ? path.relative(ctx.home, file) : '';
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(/[\\/]+/).join('/') : path.basename(file.replace(/[\\/]+$/, '')) || '…';
}
// The assistant folder inside a text: «<home>\x» → «x», the folder alone → «…» (in JSON its \ are doubled: matched too).
const homePattern = () => {
  if (!ctx.home) return null;
  const parts = path.resolve(ctx.home).split(/[\\/]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const SEP = '[\\\\/]+';
  return new RegExp(`${/^[\\/]/.test(path.resolve(ctx.home)) ? SEP : ''}${parts.join(SEP)}(?:(${SEP})|(?![\\w-]|\\.\\w))`, 'gi');
};
const cutHome = (text, re) => (re ? text.replace(re, (m, sep) => (sep ? '' : '…')) : text);
export function withoutPaths(value, depth = 0, key = '', re = homePattern()) {
  if (typeof value === 'string') return !TEXT_FIELD.test(key) && isPath(value) ? placeOf(value) : cutHome(value, re);
  if (!value || typeof value !== 'object') return value;
  if (depth > 12) { try { return JSON.parse(cutHome(JSON.stringify(value), re)); } catch { return null; } }
  if (Array.isArray(value)) return value.map((v) => withoutPaths(v, depth + 1, key, re));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [cutHome(k, re), withoutPaths(v, depth + 1, k, re)]));
}

// What a call from outside gets back: the settings without secrets, and no folder of this PC (its home, the assistant's
// paths; any other path as its place in the assistant folder).
export function shapeResult(method, result) {
  // F2.6c: the whiteboard comes back to the PC as it went (whiteboard.save): only its attachments are cut.
  if (method === 'whiteboard.load' && result) return { ...result, attachments: withoutPaths(result.attachments) };
  if (method !== 'app.state' || !result) return withoutPaths(result);
  const { home: _home, paths: _paths, ...rest } = result;
  const activeProject = rest.activeProject ? (({ path: _path, ...p }) => p)(rest.activeProject) : rest.activeProject;
  return withoutPaths({ ...rest, activeProject, config: phoneConfig(rest.config) });
}

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
const kindOf = (proof) => (PAIR_KINDS.includes(proof?.kind) ? proof.kind : /iphone|ipad|android/i.test(String(proof?.name ?? '')) ? 'phone' : 'browser');
// 3.5.1: the kind of a new device: the one the QR was made for. A QR made without saying takes what a phone or a browser
// says it is (they have the same rights). 3.8: another Orb or an Orb Terminal is never linked (null).
export function kindForPairing(issued, claimed) {
  if (claimed === 'orb' || claimed === 'terminal') return null;
  if (PAIR_KINDS.includes(issued)) return issued;
  return PAIR_KINDS.includes(claimed) ? claimed : 'phone';
}
// 3.6 (A11): «<computer>.local» when the computer's name is a valid host name (letters, digits and dashes).
export const localName = (host = os.hostname()) => { const h = String(host ?? '').toLowerCase().replace(/\.local$/, ''); return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(h) ? `${h}.local` : null; };
const isLoopback = (ip) => /^(127\.|::1$)/.test(String(ip ?? '').replace(/^::ffff:/, ''));
// 3.5.1: whether a pairing comes from a browser's page over plain http on the home network: not a program (no Origin: another
// Orb), not the Android app, not this PC (or Tailscale's https, which arrives through loopback), not the
// Tailscale address. 3.8: never (the setting that allowed it is gone: the master password is typed in that page).
export function plainHttpBrowser({ origin, app = false, localAddress, routes = [] }) {
  if (!origin || app) return false;
  const local = String(localAddress ?? '').replace(/^::ffff:/, '');
  if (isLoopback(local)) return false;
  const r = (routes ?? []).find((x) => x.address === local);
  return !(r && r.kind === 'tailscale');
}
const parseMeta = (d) => { try { return d?.meta ? JSON.parse(d.meta) : {}; } catch { return {}; } };
const metaVOf = (d) => Number(parseMeta(d).v ?? 2);
// 3.5: the Android app's page is not served by this PC but by the app itself: it may call the API, where everything is
// still sealed with the phone's own key, and its WebView has to be told so (CORS). 3.8.1 (Tauri): http://tauri.localhost
// only (review D8 B1: the Capacitor app of 3.8.0 is uninstalled first, owner's decision 18; a page on this PC's
// localhost, an agent's for one, is not the app).
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
// 3.6 (messaging, M4): one notification per chat (tag): new lines join it (the last five, and how many in the title);
// the sender's picture (icon); «Responder» opens the chat; «Aprobar» / «Rechazar» answer the card right there with a
// one-time token of this device (POST /api/note-action); a card whose text is hidden opens the chat. Tapping opens the
// exact chat (an open window is told: postMessage { orbOpen }; else /#abrir=…).
export const SERVICE_WORKER = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{}
e.waitUntil((async()=>{const tag=d.tag||'orb';let lines=[],count=0;
try{for(const n of await self.registration.getNotifications({tag})){const x=n.data||{};lines=x.lines||[];count=x.count||0;n.close()}}catch{}
lines=lines.concat([d.body||'']).slice(-5);count+=1;
const body=d.hidden?(d.body||''):lines.join('\\n');const title=(d.title||'Orb')+(count>1?' ('+count+')':'');
return self.registration.showNotification(title,{body,tag,renotify:true,icon:d.icon||'/icon.png',badge:'/icon.png',
actions:(d.actions||[]).slice(0,2).map(a=>({action:a.id,title:a.title})),
data:{url:d.url||'/',route:d.route||null,lines,count,acts:d.acts||{},card:d.card||null,actions:d.actions||[]}})})())});
const openApp=(route,approve)=>{const o={route:route||null,approve:approve||null};
return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c){c.postMessage({orbOpen:o});return c.focus()}}
return self.clients.openWindow(route?'/#abrir='+encodeURIComponent(JSON.stringify(o)):'/')})};
self.addEventListener('notificationclick',e=>{e.notification.close();const d=e.notification.data||{};const a=e.action||'';
const def=(d.actions||[]).find(x=>x.id===a);
if((a==='allow'||a==='deny')&&d.acts&&d.acts[a]&&!(def&&def.open)){
e.waitUntil(fetch('/api/note-action',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:d.acts[a]})})
.then(r=>r.ok?r.json():null).then(x=>{if(!x||!x.ok)return openApp(d.route)}).catch(()=>openApp(d.route)));return}
e.waitUntil(openApp(d.route,a==='allow'&&def&&def.open?d.card:null))});`;

export function createRemote({ board, api, log, emit = () => {}, version = null }) {
  let servers = []; // http servers (one per address)
  let state = { running: false, routes: [], error: null };
  let generation = 0; // moved by stop(): a start() still waiting for Tailscale gives up
  let starting = null;
  let watcher = null;
  let served = null; // the https port `tailscale serve` is forwarding for us (turned off on stop)
  let pairing = null; // { code, short, expires, route, fails }
  const orbName = () => orbNameOf(ctx.config);
  const failures = new Map(); // address -> timestamps of wrong pairing attempts (one noisy device cannot lock out the others)
  const clients = new Set(); // live-event streams: { res, device, key }
  const seen = new Map(); // device id -> Map(nonce -> expiry): requests already answered (replays are refused)
  const keys = new Map(); // device id -> session key
  // The phones' pictures (a phone may only attach the ones uploaded from a linked device). 3.6-3.7 kept them in a
  // subfolder per person: those are still inside, and pruneUploads clears them with the rest.
  const uploads = () => path.join(ctx.paths.internal, 'adjuntos-movil');
  // What this Orb says of itself on every hello and /api/me (3.6, protocol 3).
  const versions = () => ({ v: PROTOCOL, min: MIN_PROTOCOL, version });
  const metaV = (d) => Number(parseMeta(d).v ?? 2);
  // 3.6: a client too old for this Orb is told to update (in its own words: «Actualiza …»).
  const tooOld = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < MIN_PROTOCOL;

  // This PC's own keys: X25519 for the phones, VAPID for notifications. Made once. 3.8: kept in the master password's
  // vault (src/core/master.mjs; the database of 3.7 had them in clear: moved by api-master.mjs › migrateSecrets), read
  // when first needed. Without the vault open (another PC: the password was not typed yet) the access does not start.
  let ownKeys = null;
  const own = () => {
    if (ownKeys) return ownKeys;
    const m = ctx.master;
    if (m && !m.unlocked()) throw Object.assign(new Error(tr('msg.master.locked')), { userFacing: true });
    let k = m ? m.get('remote_keys') : board.settingJson('remote_keys');
    if (!k?.priv || !k?.vapid?.publicKey) {
      k = { priv: b64.enc(newKeyPair().priv), vapid: newVapidKeys() };
      if (m) m.set('remote_keys', k); else board.settingJson('remote_keys', k);
    }
    const priv = b64.dec(k.priv);
    ownKeys = { priv, pub: publicKeyOf(priv), vapid: k.vapid, fp: fingerprint(publicKeyOf(priv)) };
    return ownKeys;
  };
  const pcFingerprint = () => own().fp;
  // Phones paired by 2.3.2 and older (a reusable token, no key of their own) cannot use the encrypted channel: they go.
  board.run('DELETE FROM devices WHERE public_key IS NULL');
  // 3.8: a phone or browser linked before 3.8 never proved the master password: at the first start of 3.8 they all go,
  // and the owner is told to link them again (once).
  if (!board.setting('relink_38')) {
    const old = board.all('SELECT id, meta FROM devices').filter((d) => metaVOf(d) < PAIR_PROTOCOL);
    for (const d of old) board.run('DELETE FROM devices WHERE id = ?', d.id);
    if (old.length) { board.event(null, 'usuario', 'device.revokedAll', String(old.length)); board.notice(tr('msg.link.relink38', { n: old.length }), 'warning'); log(`3.8: ${old.length} dispositivo(s) enlazados antes de 3.8 desenlazados`); }
    board.setting('relink_38', new Date().toISOString());
  }

  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  // A device served: a phone or a browser, used in the last 30 days, without a person. 3.8: a linked Orb or an Orb
  // Terminal of before, or any device paired in 3.6–3.7 that still has a person (the 3.8 migration clears the owner's and
  // removes the rest), is never served.
  const validDevice = (d) => Boolean(d?.public_key && (!d.kind || PAIR_KINDS.includes(d.kind))
    && Date.now() - Date.parse(d.last_seen ?? d.created_at) <= SESSION_DAYS * 86_400_000
    && d.person_id == null);
  const keyOf = (d) => { if (!keys.has(d.id)) keys.set(d.id, sessionKey(own().priv, b64.dec(d.public_key))); return keys.get(d.id); };
  const deviceOf = (req) => {
    const id = String(req.headers['x-orb-device'] ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const d = board.one('SELECT * FROM devices WHERE id = ?', id);
    return validDevice(d) ? d : null;
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
        icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }), TYPES['.webmanifest']);
    }
    if (pathname === '/sw.js') return send(res, 200, SERVICE_WORKER, TYPES['.js'], { 'Service-Worker-Allowed': '/' });
    let rel; try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return send(res, 404, 'no encontrado', 'text/plain'); }
    // Only what the phone's page needs (not the desktop-only pages such as the agent's browser window).
    if (!(rel === 'index.html' || rel === 'icon.png' || rel === 'icon-o.png' || rel === 'icon-maskable.png' || /^assets\/[\w.-]+$/.test(rel) || /^(robot|apps)\/[\w-]+\.png$/.test(rel) || /^juegos\/ajedrez\/rhosgfx\/[wb][KQRBNP]\.svg$/.test(rel) || /^excalidraw\/fonts\/[A-Za-z]+\/[\w.-]+\.woff2$/.test(rel))) return send(res, 404, 'no encontrado', 'text/plain');
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
    // 3.6 (M4): «Aprobar» / «Rechazar» from a notification of the phone's browser (its service worker has no keys).
    if (req.method === 'POST' && p === '/api/note-action') return noteAction(req, res);

    const device = deviceOf(req);
    if (!device) { req.resume(); return send(res, 401, { error: tr('msg.remote.notLinked') }); }

    if (req.method === 'GET' && p === '/api/events') {
      const auth = openHeader(req, device, 'events');
      if (!auth) return send(res, 401, { error: tr('msg.remote.notLinked') });
      if (auth.clock) return clockOff(res);
      touch(device, req);
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': hola\n\n');
      const client = { res, device: device.id, key: keyOf(device), at: Date.now() };
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
    touch(device, req);

    if (what === 'me') {
      // 3.6: this device's name here, and the versions of both sides (the client says its own).
      const cv = Number(msg.body?.v);
      if (Number.isFinite(cv) && cv > 0 && cv !== metaV(device)) board.run('UPDATE devices SET meta = ? WHERE id = ?', JSON.stringify({ ...parseMeta(device), v: cv }), device.id);
      if (tooOld(cv)) return reply(res, device, msg.nonce, { ok: false, status: 426, update: 'me', error: tr('msg.link.updateClient', { has: versionOfProtocol(cv), need: versionOfProtocol(MIN_PROTOCOL) }) });
      return reply(res, device, msg.nonce, { ok: true, result: { device: device.name, name: ctx.config.assistantName, orb: orbName(), ...versions(), pc: pcFingerprint(), push: Boolean(device.push), vapid: own().vapid.publicKey } });
    }
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
    const principal = principalOf({ device });
    // 2.6: which account the assistant spends is chosen on the PC (the brain's agent and model, also from the phone).
    if (method === 'chat.settings' && params.account !== undefined) delete params.account;
    // F2.6c: a picture it uploaded comes back by the name /api/upload gave it (never a path of the PC).
    if (Array.isArray(params.images)) params.images = params.images.map((f) => (typeof f === 'string' && UPLOAD_NAME.test(f) ? path.join(uploads(), f) : f));
    const why = guardCall(board, method, params, { uploadsDir: uploads() });
    if (why) return deny(why);
    try {
      // What this device may call (src/core/permissions.mjs), and the settings without paths or secrets (phoneConfig).
      const result = shapeResult(method, (await api.call(method, params, principal)) ?? null);
      return reply(res, device, msg.nonce, { ok: true, result });
    }
    catch (error) { return reply(res, device, msg.nonce, { ok: false, error: withoutPaths(oneLine(error?.message ?? String(error), 1000)), ...(error?.reason ? { reason: error.reason, status: error.status ?? 403 } : error?.status === 403 ? { status: 403 } : {}) }); }
  }

  // 3.5: what a device that has only the short code needs to know (only while a code is on screen). urls: the other
  // addresses of this same PC (Wi-Fi, Tailscale, name.local).
  function helloInfo(res) {
    if (!pairing || Date.now() > pairing.expires) return send(res, 404, { error: tr('msg.link.noCode') });
    // short: 3 (3.5.1): the short code is tied to this key (src/ui/lib/web-bridge.js refuses an Orb without it).
    return send(res, 200, { v: PROTOCOL, short: 3, pc: b64.enc(own().pub), fp: pcFingerprint(), name: orbName(), urls: (state.routes ?? []).map((r) => r.url) });
  }

  // Linking (3.8, two steps; src/core/mobile-crypto.mjs › linkDevice has the phone's side). Phones and browsers alike.
  //   start   the phone sends its public key and a proof sealed with the key of this QR (the one-time code never travels),
  //           or of the short code typed by hand (via: 'code3'); the PC answers, sealed with that same key, a session id
  //           and the salt and cost of the master password's verifier.
  //   finish  the phone's MAC over the exchange, keyed with the code, ECDH(phone, PC) and ECDH(password key, PC): right
  //           only when it knew the password, which never travels. The PC answers with its own MAC (only the real PC can).
  // A wrong password does not use the code up: five per code, then a new code; and the waits of src/core/master.mjs (the
  // 'pair' channel) for all of them together.
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
    // 3.5.1: a page served over the home Wi-Fi in plain http could have been changed on the way (and, 3.8, the master
    // password is typed in it): a browser links only over https (Tailscale), the Tailscale address or this PC itself. The
    // Android app brings its own code and checks the key, so it may.
    if (plainBrowser(req)) return send(res, 403, { error: tr('msg.link.httpBrowser') });
    let devPub; try { devPub = b64.dec(body.pub); } catch { return fail(); }
    if (devPub.length !== 32) return fail();
    if (body.step === 'finish') return finishPair(res, body, devPub, fail, who);
    // The short code: code3 (3.5.1, stretched and tied to this key).
    const secretOf = body.via === 'code3' ? pairing.short3 : pairing.code;
    const codeKey = pairingKey(own().priv, devPub, secretOf);
    let proof; try { proof = open(codeKey, body.proof, AAD.pair); } catch { return fail(); }
    if (!proof || proof.pub !== body.pub) return fail();
    // The QR was right but the phone's clock is off: it tries again with the PC's time (the QR is not used up).
    if (!(Math.abs(Date.now() - Number(proof.t)) <= CLOCK_SKEW_MS)) return clockOff(res);
    // 3.6: a device too old for this Orb is told to update first (the QR is not used up). 3.8: linking needs protocol 4
    // and its two steps (the master password); an app of 3.7 is told to update.
    if (!(Number(proof.v) >= PAIR_PROTOCOL) || body.step !== 'start') return send(res, 426, { error: tr('msg.link.updatePair', { need: versionOfProtocol(PAIR_PROTOCOL) }), update: 'pair' });
    // 3.5.1: what the device is was chosen when the QR was made: that kind wins over what the device says (kindForPairing;
    // one made for no kind takes the device's word). Another Orb or an Orb Terminal is refused (the QR stays).
    // 3.8: another Orb is never linked.
    const kind = kindForPairing(pairing.device, typeof proof.kind === 'string' ? proof.kind : kindOf({ name: proof.name }));
    if (!kind) return send(res, 403, { error: tr('msg.link.notForOrb') });
    const m = ctx.master;
    if (!m?.hasPassword()) return send(res, 403, { error: tr('msg.link.noMaster'), reason: 'noMaster' });
    const until = m.waitOf('pair');
    if (until) return send(res, 429, { error: tr('msg.link.passWait', { s: Math.max(1, Math.ceil((until - Date.now()) / 1000)) }), reason: 'wait' });
    let verifier = null; try { verifier = m.get(PAIR_ID); } catch { verifier = null; }
    if (!verifier?.pub || !pairKdfOk(verifier.kdf)) return send(res, 403, { error: tr('msg.link.noVerifier'), reason: 'noVerifier' });
    // One exchange per device key, a few at a time, while the code lives.
    const sid = crypto.randomBytes(16).toString('base64url');
    const kdf = { N: verifier.kdf.N, r: verifier.kdf.r, p: verifier.kdf.p, salt: verifier.kdf.salt };
    for (const [k, x] of pairing.pending) if (x.pub === body.pub) pairing.pending.delete(k);
    if (pairing.pending.size >= 8) pairing.pending.delete(pairing.pending.keys().next().value);
    pairing.pending.set(sid, { pub: body.pub, via: body.via === 'code3' ? 'code3' : 'qr', secret: secretOf, kdf, verifier: verifier.pub, kind, name: proof.name, v: proof.v });
    return send(res, 200, { sid, box: seal(codeKey, { sid, kdf }, AAD.pairChallenge) });
  }

  async function finishPair(res, body, devPub, fail, who) {
    const issued = pairing;
    const x = typeof body.sid === 'string' ? issued.pending.get(body.sid) : null;
    if (!x || x.pub !== body.pub) return fail();
    issued.pending.delete(body.sid); // one try per exchange
    let mac; try { mac = b64.dec(body.mac); } catch { mac = null; }
    let K = null;
    try {
      const transcript = pakeTranscript({ via: x.via, devPub, pcPub: own().pub, sid: body.sid, kdf: x.kdf });
      K = pakeKey({ secret: x.secret, dhDevice: sharedSecret(own().priv, devPub), dhPassword: sharedSecret(own().priv, b64.dec(x.verifier)), transcript });
    } catch { return fail(); }
    const r = await ctx.master.attempt('pair', () => sameBytes(mac, pakeMac(K, MAC_PHONE)));
    if (!r.ok) {
      if (r.reason === 'wait') return send(res, 429, { error: tr('msg.link.passWait', { s: Math.max(1, Math.ceil((Date.parse(r.until) - Date.now()) / 1000)) }), reason: 'wait' });
      if (r.reason === 'tries') return send(res, 503, { error: tr('msg.master.tries'), reason: 'tries' });
      if (pairing === issued && ++issued.passFails >= PAIR_PASSWORD_TRIES) { pairing = null; log('enlace: demasiadas contraseñas incorrectas; código anulado'); return send(res, 403, { error: tr('msg.link.passTooMany'), reason: 'newCode' }); }
      const left = Math.max(1, PAIR_PASSWORD_TRIES - issued.passFails);
      return send(res, 403, { error: tr('msg.link.passWrong', { n: left }), reason: 'password', left });
    }
    if (pairing !== issued || Date.now() > issued.expires) return fail(); // used or gone while the password was checked
    const { route } = pairing;
    pairing = null; // one use
    const id = crypto.randomUUID();
    const name = oneLine(typeof x.name === 'string' && x.name ? x.name : tr('msg.remote.defaultName'), 60);
    board.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, ip, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, name, `clave:${id}`, now(), now(), body.pub, route, x.kind, who, JSON.stringify({ v: Number(x.v) || PAIR_PROTOCOL }));
    board.event(null, 'usuario', 'device.paired', name);
    board.notice(tr('msg.remote.deviceLinked', { name }), 'success');
    // The PC's MAC proves it is the PC of the code and of the verifier; the answer is sealed with the new session key.
    const key = sessionKey(own().priv, devPub); keys.set(id, key);
    linkChanged();
    return send(res, 200, { id, mac: b64.enc(pakeMac(K, macPc(id))), box: seal(key, { id, name: ctx.config.assistantName, orb: orbName(), ...versions(), pc: pcFingerprint() }, AAD.paired(id)) });
  }

  // 3.5.1: a request from a browser's page that came over plain http on the home network (not this PC, not Tailscale's
  // https through loopback, not the Tailscale address).
  const plainBrowser = (req) => plainHttpBrowser({ origin: req.headers.origin, app: Boolean(appOrigin(req)), localAddress: req.socket?.localAddress, routes: state.routes });


  // A picture from the phone (encrypted): checked by its first bytes (not its name), stored in the app's folder, path returned.
  let uploading = 0;
  async function upload(req, res, device) {
    const mine = uploads();
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
      await fs.promises.mkdir(mine, { recursive: true });
      await pruneUploads(b.length);
      const file = path.join(mine, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
      await fs.promises.writeFile(file, b);
      return reply(res, device, auth.nonce, { ok: true, result: { path: path.basename(file) } }); // its name: the PC knows where
    } catch (error) { log(`móvil: subida: ${error.message}`); return reply(res, device, auth.nonce, { ok: false, error: tr('msg.remote.cannotSaveImage') }); }
    finally { uploading--; }
  }
  // Old pictures go (7 days), and the oldest ones too while the folder would pass its quota.
  // The oldest first (3.6-3.7's per-person subfolders too).
  async function pruneUploads(incoming = 0) {
    const list = [];
    const walk = async (dir, depth) => {
      let files; try { files = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const f of files) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) { if (depth === 0) await walk(full, 1); continue; }
        try { const st = await fs.promises.stat(full); list.push({ f: full, at: st.mtimeMs, size: st.size }); } catch { /* gone */ }
      }
    };
    await walk(uploads(), 0);
    list.sort((a, b) => a.at - b.at);
    let total = list.reduce((n, x) => n + x.size, 0) + incoming;
    for (const x of list) {
      if (Date.now() - x.at < UPLOADS_DAYS * 86_400_000 && total <= UPLOADS_TOTAL) break;
      await fs.promises.rm(x.f, { force: true }).catch(() => {});
      total -= x.size;
    }
  }

  // Notifications: a new message in the assistant's chat (an answer, a task that needs approval, finished or failed work)
  // goes to the phones that turned them on and do not have the app open right now.
  // 3.6 (M4): as a messaging app's (deliverNote): the chat's name and picture, one per chat, its actions; muted: none.
  function notify(payload) {
    if (!payload || payload.role === 'usuario') return;
    deliverNote({ conversation: payload.conversation ?? null, line: { id: payload.id ?? null, role: payload.role, body: payload.body, meta: payload.meta ?? null } });
  }

  // ---- 3.6 (messaging, M4): notifications as a messaging app's (src/core/notes.mjs builds them).
  const NOTE_TOKEN_MS = 24 * 3_600_000;
  const noteTokens = new Map(); // one-time token → { device, call: [method, params], group, until }
  const noteWords = () => ({ hidden: tr('msg.remote.pushHidden'), reply: tr('msg.notes.reply'), allow: tr('msg.notes.allow'), deny: tr('msg.notes.deny'), open: tr('msg.notes.open') });
  // Which chat a conversation is: one with the assistant (none: the assistant's main chat).
  function chatOf(conversation) {
    const name = ctx.config.assistantName ?? 'Orb';
    if (conversation == null) return { kind: 'orb', id: null, name };
    const it = itemOfConversation(board, conversation);
    if (it?.kind !== 'conversation') return null;
    const c = board.one('SELECT id, title FROM conversations WHERE id = ?', Number(it.id));
    return c ? { kind: 'conversation', id: c.id, name: c.title || name } : null;
  }
  // The picture: Orb's own for the Android app (av_orb, copied from the app's icon by scripts/android-web.mjs).
  const dress = (note) => ({ ...note, largeIcon: 'av_orb' });
  // The answers a notification of the phone's browser may give right there: one token per action, only for this device,
  // used once (either answer spends both).
  function mintActs(device, note) {
    const out = {}; const group = crypto.randomBytes(8).toString('hex');
    for (const [k, t] of noteTokens) if (t.until <= Date.now()) noteTokens.delete(k);
    if (noteTokens.size > 2000) noteTokens.clear();
    for (const a of note.actions ?? []) {
      if (a.open || (a.id !== 'allow' && a.id !== 'deny')) continue;
      const r = actionRoute(note, a.id);
      if (!r.call) continue;
      const token = crypto.randomBytes(24).toString('base64url');
      noteTokens.set(token, { device: String(device), call: r.call, group, until: Date.now() + NOTE_TOKEN_MS });
      out[a.id] = token;
    }
    return out;
  }
  // One line of a chat, to every linked device (the preview and the mute of Ajustes); the apps open now get it as a
  // sealed «note» event (the Android app shows it while in the background), the others a Web Push.
  function deliverNote({ conversation = null, line }) {
    let chat; try { chat = chatOf(conversation); } catch { chat = null; }
    if (!chat) return false;
    let muted = false; try { muted = conversation != null && isMuted(board, conversation); } catch { /* no marks yet */ }
    const built = buildNote({ chat, line, preview: pushPreview(ctx.config), muted, assistantName: ctx.config.assistantName ?? 'Orb', words: noteWords() });
    const n = built ? dress(built) : null;
    if (!n) return false;
    const openNow = new Set();
    for (const c of clients) {
      openNow.add(c.device);
      try { c.res.write(`data: ${sealText(c.key, { e: 'note', p: n }, AAD.event(c.device))}\n\n`); } catch { /* gone */ }
    }
    for (const d of board.all('SELECT * FROM devices WHERE push IS NOT NULL')) {
      if (openNow.has(d.id) || !validDevice(d)) continue;
      let sub; try { sub = JSON.parse(d.push); } catch { continue; }
      const data = { title: n.title, body: n.body, hidden: n.hidden, tag: `orb-${n.key}`, icon: n.icon, url: '/', route: n.route, kind: n.kind,
        actions: n.actions.map(({ id, title, open: o }) => ({ id, title, ...(o ? { open: true } : {}) })), card: n.card ?? null, acts: mintActs(d.id, n) };
      sendPush(sub, data, own().vapid)
        .then((r) => { if (r === 'gone') board.run('UPDATE devices SET push = NULL WHERE id = ?', d.id); })
        .catch(() => {});
    }
    return true;
  }
  // POST /api/note-action { token }: the answer chosen on a notification, run as that device (the same checks as a call
  // from it).
  async function noteAction(req, res) {
    let body; try { body = await readJson(req, 4_000); } catch (error) { return send(res, error.status ?? 400, { ok: false, error: error.message }); }
    const t = typeof body?.token === 'string' ? noteTokens.get(body.token) : null;
    if (!t || t.until <= Date.now()) return send(res, 401, { ok: false, error: tr('msg.notes.expired') });
    for (const [k, x] of noteTokens) if (x.group === t.group) noteTokens.delete(k);
    const device = board.one('SELECT * FROM devices WHERE id = ?', t.device);
    if (!validDevice(device) || !device.push) return send(res, 401, { ok: false, error: tr('msg.notes.expired') });
    const [method, given] = t.call; const params = { ...given };
    const why = guardCall(board, method, params, { uploadsDir: uploads() });
    if (why) return send(res, 403, { ok: false, error: why });
    const principal = principalOf({ device });
    try {
      await api.call(method, params, principal);
      touch(device, req);
      return send(res, 200, { ok: true });
    } catch (error) {
      return send(res, error.status === 403 ? 403 : 400, { ok: false, error: withoutPaths(oneLine(error?.message ?? String(error), 300)), ...(error.reason ? { reason: error.reason } : {}) });
    }
  }

  // ---- listening: one http server per address; the Tailscale https name goes through `tailscale serve` to loopback.
  // 3.8.1: node:http is loaded when the access starts (~18 ms the engine's start no longer waits for).
  const listen = async (address, port) => { const { default: http } = await import('node:http'); return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { handle(req, res).catch((error) => { log(`móvil: ${error.stack}`); try { send(res, 500, { error: tr('msg.remote.internalError') }); } catch { /* sent */ } }); });
    srv.headersTimeout = 15_000; srv.requestTimeout = 60_000;    srv.once('error', (error) => resolve({ error }));
    srv.listen(port, address, () => resolve({ srv }));
  }); };
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
    const routes = []; const hosts = []; const origins = []; const errors = []; let localUrl = null;
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
        // 3.6 (A11): this computer's name on the home network (<name>.local, answered by the system's mDNS), so a phone
        // still finds it when the Wi-Fi address changes.
        const local = localName();
        if (local && routes.some((r) => r.kind === 'wifi')) { hosts.push(`${local}:${port}`); origins.push(`http://${local}:${port}`); localUrl = `http://${local}:${port}/`; }
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
    state = { running: routes.length > 0, routes, hosts, origins, local: localUrl, lan: lanAddresses().join(','), error: routes.length ? (errors[0] ?? null) : (errors.join(' ') || tr('msg.remote.noNetwork')) };
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

  // ---- 3.5 Magic Link: the linked phones and browsers.
  const onlineIds = () => new Set([...clients].map((c) => c.device));
  function deviceView(d, on = onlineIds()) {
    return { id: d.id, name: d.name, kind: d.kind ?? kindOf({ name: d.name }), createdAt: d.created_at, lastSeen: d.last_seen ?? null, ip: d.ip ?? null, v: metaV(d),
      route: d.route ?? null, push: Boolean(d.push), online: on.has(d.id) };
  }
  const devices = () => { const on = onlineIds(); return board.all('SELECT * FROM devices WHERE public_key IS NOT NULL ORDER BY created_at DESC').map((d) => deviceView(d, on)); };
  let changeTimer = null;
  function linkChanged() {
    changeTimer ??= setTimeout(() => {
      changeTimer = null;
      try { emit('link:devices', devices()); } catch (error) { log(`enlace: ${error.message}`); }
    }, 80);
    changeTimer.unref?.();
  }

  const remote = {
    // Engine events go to the paired phones too (only the ones the interface needs), each sealed for its phone.
    broadcast(event, payload) {
      if (event === 'chat:new') notify(payload);
      if (!clients.size || !EVENTS.has(event)) return;
      // The settings themselves never travel to a phone (the page just reloads what it is allowed to see).
      const value = { e: event, p: event === 'config:changed' ? null : withoutPaths(payload) };
      for (const c of clients) {
        if (c.res.writableLength > STREAM_BACKLOG) { try { c.res.destroy(); } catch { /* gone */ } clients.delete(c); continue; }
        try { c.res.write(`data: ${sealText(c.key, value, AAD.event(c.device))}\n\n`); } catch { clients.delete(c); }
      }
    },
    start() {
      if (servers.length) return Promise.resolve(state);
      // 3.8: never on a database of 3.5–3.7 the 3.8 migration could not finish yet (its devices may be other users').
      if (isLegacy(board.db)) { const e = new Error(tr('msg.remote.notMigrated')); e.userFacing = true; return Promise.reject(e); }
      // 3.8: and never while the vault with this PC's keys is locked (it opens with the master password).
      try { own(); } catch (error) { return Promise.reject(error); }
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
      clients.clear(); await closeAll(); pairing = null; state = { running: false, routes: [], error: null };
      await unserve();
    },
    status() {
      let pc = null; try { pc = pcFingerprint(); } catch { /* the vault is locked */ }
      return { enabled: Boolean(ctx.config.mobile?.enabled), running: Boolean(state.running), routes: state.routes ?? [], error: state.error ?? null, pc,
        wifi: ctx.config.mobile?.wifi !== false, tailscale: ctx.config.mobile?.tailscale !== false, name: orbName(),
        preview: pushPreview(ctx.config),
        devices: board.all('SELECT id, name, created_at, last_seen, route, kind, ip, push IS NOT NULL AS push FROM devices ORDER BY created_at DESC').map((d) => ({ ...d, push: Boolean(d.push) })) };
    },
    // A one-time QR for 5 minutes, for one of the ways in (Wi-Fi or Tailscale). The code and this PC's key travel in the
    // URL fragment (#), which the browser never sends to any server.
    // 3.5 (protocol v2): the fragment also names this Orb and its other addresses (Wi-Fi, Tailscale, name.local); and a
    // short code (8 letters and digits) can be typed by hand instead, together with the address.
    // 3.5.1: device: what it is for (phone or browser), chosen here by the owner, never by the device.
    pair(kind, { device = null } = {}) {
      if (!state.running) throw new Error(tr('msg.remote.enableFirst'));
      const route = state.routes.find((r) => r.kind === kind) ?? state.routes[0];
      const code = crypto.randomBytes(18).toString('base64url');
      const short = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
      const forKind = PAIR_KINDS.includes(device) ? device : null;
      pairing = { code, short, short3: shortSecret(short, b64.enc(own().pub)), expires: Date.now() + PAIR_MINUTES * 60_000, route: route.kind, fails: 0, passFails: 0, pending: new Map(),
        device: forKind };
      const others = state.routes.filter((r) => r !== route).map((r) => r.url);
      // 3.6 (A11): the name of this computer on the home network (name.local) too, for when the Wi-Fi address changes.
      if (state.local && !others.includes(state.local) && route.url !== state.local) others.push(state.local);
      const frag = new URLSearchParams({ vincular: code, pc: b64.enc(own().pub), v: String(PROTOCOL), n: orbName() });
      if (others.length) frag.set('a', others.join(','));
      return { url: `${route.url}#${frag}`, payload: { v: PROTOCOL, urls: [route.url, ...others], pc: b64.enc(own().pub), code, name: orbName(), expiresAt: pairing.expires },
        code: shortCodeLabel(short), address: route.url, expiresAt: pairing.expires, kind: route.kind, secure: route.secure, pc: pcFingerprint(), name: orbName(),
        device: forKind,
        browserOk: Boolean(route.secure) || route.address === '127.0.0.1' || route.kind === 'tailscale' };
    },
    revoke(id) {
      const d = board.one('SELECT * FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      board.run('DELETE FROM devices WHERE id = ?', d.id);
      keys.delete(d.id); seen.delete(d.id);
      for (const c of clients) if (c.device === d.id) { try { c.res.end(); } catch { /* closed */ } clients.delete(c); }
      board.event(null, 'usuario', 'device.revoked', d.name);
      linkChanged();
      return true;
    },
    devices,
    fingerprint: () => pcFingerprint(),
    // 3.8: «He olvidado la contraseña»: every linked phone and browser goes (they link again with the new password), and
    // the keys are read again (a new vault makes new ones). → how many went.
    revokeAll() {
      const list = board.all('SELECT id, name FROM devices');
      board.run('DELETE FROM devices');
      keys.clear(); seen.clear(); pairing = null; ownKeys = null;
      for (const c of clients) { try { c.res.end(); } catch { /* closed */ } }
      clients.clear();
      if (list.length) board.event(null, 'usuario', 'device.revokedAll', String(list.length));
      linkChanged();
      return list.length;
    },
    rename(id, name) {
      const d = board.one('SELECT id FROM devices WHERE id = ?', String(id)); if (!d) throw new Error(tr('msg.remote.noDevice'));
      const clean = oneLine(String(name ?? ''), 60).trim(); if (!clean) throw new Error(tr('msg.link.needName'));
      board.run('UPDATE devices SET name = ? WHERE id = ?', clean, d.id);
      linkChanged();
      return deviceView(board.one('SELECT * FROM devices WHERE id = ?', d.id));
    }
  };
  return remote;
}
