// Phone access: the same interface as a web app, off by default. Two ways to reach the PC, each can be on or off:
// - the home Wi-Fi: plain http on this PC's local address (nothing to install on the phone);
// - Tailscale: https through `tailscale serve` when the tailnet has HTTPS (installable app and notifications), or plain
//   http on the Tailscale address otherwise.
// A phone is paired by scanning a one-time QR on the PC. The phone makes its own key and from then on every message is
// encrypted end to end (src/shared/mobile-crypto.mjs): whoever sees the traffic (the Wi-Fi, a proxy) reads nothing, and a
// copied link or QR is useless. The PC can revoke any phone. What a phone may do is a subset of the PC's actions.
// Parts: remote-common.mjs (constants), remote-calls.mjs (call guard and result shaping), remote-net.mjs (addresses, Tailscale,
// attention server), remote-web.mjs (service worker, headers).
import { isMuted, itemOfConversation } from '../../domain/conversations/inbox.mjs';
import { buildNote, actionRoute } from '../../shared/notes.mjs';
import { noticeNote, targetOfNote } from './notes-center.mjs';
import { recordNote } from '../../domain/notes/recent.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../../platform/context.mjs';
import { oneLine } from '../../shared/text.mjs';
import { quickRun } from '../../agents/index.mjs';
import { b64, newKeyPair, publicKeyOf, pairingKey, sessionKey, fingerprint, seal, open, sealText, openText, openBytes, sealBytes, AAD, CLOCK_SKEW_MS, shortSecret, pairKdfOk } from '../../shared/mobile-crypto.mjs';
import { newVapidKeys, checkSubscription, sendPush } from './webpush.mjs';
import { streamFeed } from '../../shared/chat-stream.mjs';
import { PROTOCOL, MIN_PROTOCOL, PAIR_PROTOCOL, versionOfProtocol, CODE_ALPHABET, shortCodeLabel } from '../../shared/link-payload.mjs';
import { SHOT_NAME, SHOT_DIR, SHOT_TTL_MS, sweepShots } from '../host/screenshot.mjs';
import { principalOf, REMOTE_METHODS } from '../../domain/security/permissions.mjs';
import { isLegacy } from '../../domain/data/legacy/migrate-38.mjs';
import { ownPorts } from '../host/host.mjs';
import { RENDERER, SESSION_DAYS, PAIR_MINUTES, UPLOAD_MAX, UPLOADS_TOTAL, UPLOADS_DAYS, STREAM_BACKLOG, STREAMS_PER_DEVICE, NETWORK_CHECK_MS, PING_MS, CALL_MS, now, PAIR_KINDS, PAIR_FAILS_MAX, PAIR_PASSWORD_TRIES } from './remote-common.mjs';
import { guardCall, withDeadline, pushPreview, IMAGE_NAME, UPLOAD_TYPES, sniffUpload, sanitizeUploadName, withoutPaths, shapeResult } from './remote-calls.mjs';
import { privateSource, orbNameOf, ipOf, kindOf, kindForPairing, localName, plainHttpBrowser, parseMeta, metaVOf, APP_CORS, appOrigin, tailscaleExe, tailscaleAddress, tailscaleAdapterUp, lanAddresses } from './remote-net.mjs';
import { TYPES, HEADERS, SERVICE_WORKER } from './remote-web.mjs';
import { createJournal } from './remote-events.mjs';
import { createLinkWatcher, createRepairGate } from './remote-watch.mjs';

export { PAIR_KINDS, PAIR_PASSWORD_TRIES } from './remote-common.mjs';
export { PREVIEWS, guardCall, phoneConfig, pushPreview, shapeResult, withoutPaths } from './remote-calls.mjs';
export { SERVICE_WORKER } from './remote-web.mjs';
export { kindForPairing, lanAddresses, localName, orbNameOf, plainHttpBrowser, privateSource, startAttention, tailscaleAddress } from './remote-net.mjs';

const EVENTS = new Set(['board:changed', 'chat:state', 'chat:new', 'notice', 'session:item', 'session:update', 'session:removed', 'config:changed', 'session:delta', 'session:queue', 'session:reset', 'approval:changed',
  // a chat list changed
  'inbox:changed']);

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
  // device id -> Map(nonce -> { exp, done }): the sealed answer of each call (or the one still being worked out), so a phone
  // that resends a call it got no answer to (same nonce) gets that answer and the call never runs twice.
  const answers = new Map();
  const ANSWERS_PER_DEVICE = 200; const ANSWER_KEEP_MAX = 256 * 1024;
  const journal = createJournal(); // the last events sent, for a phone that reconnects
  // The phones' pictures (a phone may only attach the ones uploaded from a linked device). Older data kept them in a
  // subfolder per person: those may still be inside, and pruneUploads clears them with the rest.
  const uploads = () => path.join(ctx.paths.internal, 'adjuntos-movil');
  // Screenshots the phone may download: name -> { device, expires }. Only what pc.screenshot made for that device is ever
  // served, so a download can never reach any other file of the uploads folder.
  const downloads = new Map();
  const DOWNLOAD_MS = SHOT_TTL_MS; const DOWNLOADS_PER_DEVICE = 20;
  const shots = () => path.join(ctx.paths.internal, SHOT_DIR);
  const dropShot = (name) => fs.promises.rm(path.join(shots(), name), { force: true }).catch(() => {});
  function allowDownload(deviceId, name) {
    if (typeof deviceId !== 'string' || !SHOT_NAME.test(name)) return null;
    const t = Date.now();
    for (const [k, v] of downloads) if (v.expires <= t) { downloads.delete(k); dropShot(k); }
    const mineNow = [...downloads].filter(([, v]) => v.device === deviceId);
    for (const [k] of mineNow.slice(0, Math.max(0, mineNow.length - DOWNLOADS_PER_DEVICE + 1))) { downloads.delete(k); dropShot(k); }
    downloads.set(name, { device: deviceId, expires: t + DOWNLOAD_MS });
    setTimeout(() => { downloads.delete(name); dropShot(name); }, DOWNLOAD_MS + 1000).unref?.(); // the file goes with its registry entry
    return board.one('SELECT name FROM devices WHERE id = ?', deviceId)?.name ?? null;
  }
  // What this Orb says of itself on every hello and /api/me.
  const versions = () => ({ v: PROTOCOL, min: MIN_PROTOCOL, version });
  const metaV = (d) => Number(parseMeta(d).v ?? 2);
  // a client too old for this Orb is told to update (in its own words: «Actualiza …»).
  const tooOld = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < MIN_PROTOCOL;

  // This PC's own keys: X25519 for the phones, VAPID for notifications. Made once. Kept in the master password's
  // vault (src/domain/security/master.mjs; the database of 3.7 had them in clear: moved by api-master.mjs › migrateSecrets), read
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
  // a phone or browser linked before 3.8 never proved the master password: at the first start of 3.8 they all go,
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

  // A device served: a phone or a browser, used in the last 30 days, without a person. A linked Orb or an Orb
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
    // a busy phone (thousands of requests in 10 min) is not mistaken for a replay and unpaired: the oldest nonces
    // make room (a Map keeps insertion order).
    while (m.size >= 5000) m.delete(m.keys().next().value);
    m.set(nonce, at + 2 * CLOCK_SKEW_MS);
    return 'ok';
  }
  // Opens a request sealed by this device: { body, nonce }, { clock: true } or null.
  function openRequest(device, box, expected) {
    let msg; try { msg = open(keyOf(device), box, AAD.request(device.id)); } catch { return null; }
    if (!msg || msg.m !== expected) return null;
    // A resent call whose first request already got through: its answer comes before the time check (the resend carries the
    // first request's stamp, which may have aged). Only for a nonce the PC holds an answer for, so new nonces are checked as ever.
    if (expected === 'call') {
      const kept = answers.get(device.id)?.get(box.n);
      if (kept && kept.exp > Date.now() && seen.get(device.id)?.has(box.n)) return { again: kept, nonce: box.n };
    }
    const f = freshness(device.id, box.n, Number(msg.t));
    // Same device, same nonce, still inside its window, and a call already run or running: not a new request. It only
    // got through the device's own key and a fresh time stamp, and what it is given is sealed for that device alone.
    if (f === 'replay' && expected === 'call') {
      const again = answers.get(device.id)?.get(box.n);
      if (again && again.exp > Date.now()) return { again, nonce: box.n };
    }
    return f === 'ok' ? { body: msg.b ?? null, nonce: box.n } : f === 'clock' ? { clock: true } : null;
  }
  // The same for the requests whose envelope travels in a header (live events, pictures).
  function openHeader(req, device, expected) {
    const text = String(req.headers['x-orb-auth'] ?? '');
    let msg; try { msg = openText(keyOf(device), text, AAD.request(device.id)); } catch { return null; }
    const nonce = text.split('.')[0];
    if (!msg || msg.m !== expected) return null;
    const f = freshness(device.id, nonce, Number(msg.t));
    // d: 1, a client that takes the streamed answer as deltas (src/shared/chat-stream.mjs; older ones never say it).
    return f === 'ok' ? { nonce, deltas: msg.d === 1, name: typeof msg.name === 'string' ? msg.name.slice(0, 120) : '' } : f === 'clock' ? { clock: true } : null;
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
    if (!(rel === 'index.html' || rel === 'icon.png' || rel === 'icon-o.png' || rel === 'orb-exe-32.png' || rel === 'orb-exe-128.png' || rel === 'icon-maskable.png' || /^assets\/[\w.-]+$/.test(rel) || /^(robot|apps)\/[\w-]+\.png$/.test(rel) || /^juegos\/ajedrez\/rhosgfx\/[wb][KQRBNP]\.svg$/.test(rel) || /^excalidraw\/fonts\/[A-Za-z]+\/[\w.-]+\.woff2$/.test(rel))) return send(res, 404, 'no encontrado', 'text/plain');
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
    // only the home network, Tailscale and this PC (never the internet: Tailscale Funnel requests are refused too).
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
    // «Aprobar» / «Rechazar» from a notification of the phone's browser (its service worker has no keys).
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
      const client = { res, device: device.id, key: keyOf(device), at: Date.now(), stream: auth.deltas ? streamFeed() : null };
      // A phone that lost its stream says the last event it saw: what came after goes first, in order, or a `resync`
      // (no id) tells it to reload its whole state. All written in this same tick, so no live event slips in between.
      const lastId = req.headers['last-event-id'] ?? url.searchParams.get('since');
      if (lastId) {
        const back = journal.since(lastId, { notBefore: Date.parse(device.created_at) || 0 });
        try {
          if (back.resync) res.write(`data: ${sealText(client.key, { e: 'resync', p: null }, AAD.event(device.id))}\n\n`);
          else for (const x of back.items) res.write(`id: ${x.id}\ndata: ${sealText(client.key, x.value, AAD.event(device.id))}\n\n`);
        } catch { /* closed */ }
      }
      const mine = [...clients].filter((c) => c.device === device.id);
      if (mine.length >= STREAMS_PER_DEVICE) { try { mine[0].res.end(); } catch { /* closed */ } clients.delete(mine[0]); }
      clients.add(client);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, PING_MS);
      req.on('close', () => { clearInterval(ping); clients.delete(client); });
      return undefined;
    }
    if (req.method === 'GET' && p === '/api/download') return download(req, res, device, url);
    if (req.method !== 'POST') return send(res, 404, { error: 'no encontrado' });
    if (p === '/api/upload') return upload(req, res, device);

    const what = { '/api/call': 'call', '/api/me': 'me', '/api/push': 'push' }[p];
    if (!what) { req.resume(); return send(res, 404, { error: 'no encontrado' }); }
    let box; try { box = await readJson(req); } catch (error) { return send(res, error.status ?? 400, { error: error.message }); }
    const msg = openRequest(device, box, what);
    if (!msg) return send(res, 401, { error: tr('msg.remote.notLinked') });
    if (msg.clock) return clockOff(res);
    if (msg.again) {
      // A resent call does not count as the device being seen again (its address is not updated from it).
      const sealed = await msg.again.done;
      // The answer was not kept (too big, or pushed out): 410, never 401 (which unlinks the phone) or 409 (the clock).
      return sealed ? send(res, 200, sealed) : send(res, 410, { error: tr('msg.remote.gone'), reason: 'gone' });
    }
    touch(device, req);

    if (what === 'me') {
      // this device's name here, and the versions of both sides (the client says its own).
      const cv = Number(msg.body?.v);
      // client: who is calling (e.g. "android-native"), informational only; it never changes what the device may do.
      const client = typeof msg.body?.client === 'string' && /^[a-z0-9-]{1,32}$/.test(msg.body.client) ? msg.body.client : null;
      const meta = parseMeta(device);
      const next = { ...meta, ...(Number.isFinite(cv) && cv > 0 ? { v: cv } : {}), ...(client ? { client } : {}) };
      if (next.v !== meta.v || next.client !== meta.client) board.run('UPDATE devices SET meta = ? WHERE id = ?', JSON.stringify(next), device.id);
      if (tooOld(cv)) return reply(res, device, msg.nonce, { ok: false, status: 426, update: 'me', error: tr('msg.link.updateClient', { has: versionOfProtocol(cv), need: versionOfProtocol(MIN_PROTOCOL) }) });
      return reply(res, device, msg.nonce, { ok: true, result: { device: device.name, name: ctx.config.assistantName, orb: orbName(), ...versions(), pc: pcFingerprint(), push: Boolean(device.push), vapid: own().vapid.publicKey,
        // what this PC accepts from a phone, so a client can offer only that
        methods: [...REMOTE_METHODS].sort(), uploads: { max: UPLOAD_MAX, types: UPLOAD_TYPES },
        // how each way in is doing, so «Este móvil» can tell Wi-Fi from Tailscale (sealed to this phone only)
        entries: Object.values(entries).filter((e) => e && ctx.config.mobile?.[e.tipo] !== false) } });
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
    let mine = answers.get(device.id); if (!mine) answers.set(device.id, (mine = new Map()));
    mine.held ??= 0; // how many answers this device has stored
    for (const [n, a] of mine) if (a.exp < Date.now()) { if (a.held) mine.held--; mine.delete(n); }
    // Only answers already given are pushed out, and the nonce stays as an empty mark (a resend then gets 410).
    for (const a of mine.values()) { if (mine.held < ANSWERS_PER_DEVICE) break; if (a.held) { a.held = false; mine.held--; a.done = Promise.resolve(null); } }
    let settle; const entry = { exp: Date.now() + 2 * CLOCK_SKEW_MS, held: false, done: new Promise((r) => { settle = r; }) };
    mine.set(msg.nonce, entry);
    let answered = false;
    const answer = (dev, nonce, value) => {
      const sealed = seal(keyOf(dev), { r: nonce, ...value }, AAD.response(dev.id));
      answered = true;
      settle(sealed);
      // the ones already waiting get it; later resends of a very big one get 410
      if (JSON.stringify(sealed).length > ANSWER_KEEP_MAX) entry.done = Promise.resolve(null); else { entry.held = true; mine.held++; }
      send(res, 200, sealed);
    };
    try {
    const deny = (error) => answer(device, msg.nonce, { ok: false, status: 403, error });
    const principal = principalOf({ device });
    // A picture it uploaded comes back by the name /api/upload gave it (never a path of the PC).
    if (Array.isArray(params.images)) params.images = params.images.map((f) => (typeof f === 'string' && IMAGE_NAME.test(f) ? path.join(uploads(), f) : f));
    const why = guardCall(board, method, params, { uploadsDir: uploads() });
    if (why) return deny(why);
    try {
      // What this device may call (src/domain/security/permissions.mjs), and the settings without paths or secrets (phoneConfig).
      // A call that never ends is answered with a clear error (the work itself cannot be stopped from here). A retry of
      // the same nonce gets that error too, and does not start the work again.
      const raw = await withDeadline(() => api.call(method, params, principal), CALL_MS, () => Object.assign(new Error(tr('msg.remote.callTimeout')), { reason: 'timeout', status: 504 }));
      const result = shapeResult(method, raw ?? null);
      return answer(device, msg.nonce, { ok: true, result });
    }
    catch (error) { return answer(device, msg.nonce, { ok: false, error: withoutPaths(oneLine(error?.message ?? String(error), 1000)), ...(error?.reason ? { reason: error.reason, status: error.status ?? 403 } : error?.status === 403 ? { status: 403 } : {}) }); }
    } finally {
      // Something failed before any answer: those waiting on this nonce must not wait for ever.
      if (!answered) { settle(null); entry.done = Promise.resolve(null); } // the nonce stays as an empty mark: a resend gets 410, not a replay's 401
    }
  }

  // what a device that has only the short code needs to know (only while a code is on screen). urls: the other
  // addresses of this same PC (Wi-Fi, Tailscale, name.local).
  function helloInfo(res) {
    if (!pairing || Date.now() > pairing.expires) return send(res, 404, { error: tr('msg.link.noCode') });
    // short: 3: the short code is tied to this key (src/ui/lib/web-bridge.js refuses an Orb without it).
    return send(res, 200, { v: PROTOCOL, short: 3, pc: b64.enc(own().pub), fp: pcFingerprint(), name: orbName(), urls: (state.routes ?? []).map((r) => r.url) });
  }

  // Linking (two steps; src/shared/mobile-crypto.mjs › linkDevice has the phone's side). Phones and browsers alike.
  //   start   the phone sends its public key and a proof sealed with the key of this QR (the one-time code never travels),
  //           or of the short code typed by hand (via: 'code3'); the PC answers, sealed with that same key, a session id
  //           and the salt and cost of the master password's verifier.
  //   finish  the phone's MAC over the exchange, keyed with the code, ECDH(phone, PC) and ECDH(password key, PC): right
  //           only when it knew the password, which never travels. The PC answers with its own MAC (only the real PC can).
  // A wrong password does not use the code up: five per code, then a new code; and the waits of src/domain/security/master.mjs (the
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
    // a page served over the home Wi-Fi in plain http could have been changed on the way (and the master
    // password is typed in it): a browser links only over https (Tailscale), the Tailscale address or this PC itself. The
    // Android app brings its own code and checks the key, so it may.
    if (plainBrowser(req)) return send(res, 403, { error: tr('msg.link.httpBrowser') });
    let devPub; try { devPub = b64.dec(body.pub); } catch { return fail(); }
    if (devPub.length !== 32) return fail();
    if (body.step === 'finish') return finishPair(res, body, devPub, fail, who);
    // The short code: code3 (stretched and tied to this key).
    const secretOf = body.via === 'code3' ? pairing.short3 : pairing.code;
    const codeKey = pairingKey(own().priv, devPub, secretOf);
    let proof; try { proof = open(codeKey, body.proof, AAD.pair); } catch { return fail(); }
    if (!proof || proof.pub !== body.pub) return fail();
    // The QR was right but the phone's clock is off: it tries again with the PC's time (the QR is not used up).
    if (!(Math.abs(Date.now() - Number(proof.t)) <= CLOCK_SKEW_MS)) return clockOff(res);
    // a device too old for this Orb is told to update first (the QR is not used up). Linking needs protocol 4
    // and its two steps (the master password); an app of 3.7 is told to update.
    if (!(Number(proof.v) >= PAIR_PROTOCOL) || body.step !== 'start') return send(res, 426, { error: tr('msg.link.updatePair', { need: versionOfProtocol(PAIR_PROTOCOL) }), update: 'pair' });
    // what the device is was chosen when the QR was made: that kind wins over what the device says (kindForPairing;
    // one made for no kind takes the device's word). Another Orb or an Orb Terminal is refused (the QR stays).
    // another Orb is never linked.
    const kind = kindForPairing(pairing.device, typeof proof.kind === 'string' ? proof.kind : kindOf({ name: proof.name }));
    if (!kind) return send(res, 403, { error: tr('msg.link.notForOrb') });
    const m = ctx.master;
    if (!m?.hasPassword()) return send(res, 403, { error: tr('msg.link.noMaster'), reason: 'noMaster' });
    const until = m.waitOf('pair');
    if (until) return send(res, 429, { error: tr('msg.link.passWait', { s: Math.max(1, Math.ceil((until - Date.now()) / 1000)) }), reason: 'wait' });
    // the verifier itself stays in the vault (Rust); only its salt and cost come out, for the phone.
    let vkdf = null; try { vkdf = m.pairInfo(); } catch { vkdf = null; }
    if (!vkdf || !pairKdfOk(vkdf)) return send(res, 403, { error: tr('msg.link.noVerifier'), reason: 'noVerifier' });
    // One exchange per device key, a few at a time, while the code lives.
    const sid = crypto.randomBytes(16).toString('base64url');
    const kdf = { N: vkdf.N, r: vkdf.r, p: vkdf.p, salt: vkdf.salt };
    for (const [k, x] of pairing.pending) if (x.pub === body.pub) pairing.pending.delete(k);
    if (pairing.pending.size >= 8) pairing.pending.delete(pairing.pending.keys().next().value);
    pairing.pending.set(sid, { pub: body.pub, via: body.via === 'code3' ? 'code3' : 'qr', secret: secretOf, kdf, kind, name: proof.name, v: proof.v });
    return send(res, 200, { sid, box: seal(codeKey, { sid, kdf }, AAD.pairChallenge) });
  }

  async function finishPair(res, body, devPub, fail, who) {
    const issued = pairing;
    const x = typeof body.sid === 'string' ? issued.pending.get(body.sid) : null;
    if (!x || x.pub !== body.pub) return fail();
    issued.pending.delete(body.sid); // one try per exchange
    // the key confirmation is checked in the vault (Rust), with the verifier and this PC's key there: K never
    // reaches the engine. The PC's own MAC comes back for the id this device will get.
    const id = crypto.randomUUID();
    let r;
    try { r = await ctx.master.serial(() => ctx.master.pairFinish({ via: x.via, devPub: body.pub, pcPub: b64.enc(own().pub), sid: body.sid, kdf: x.kdf, secret: x.secret, mac: typeof body.mac === 'string' ? body.mac : '', id })); } catch { return fail(); }
    if (r.reason === 'noVerifier' || r.reason === 'bad') return fail();
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
    const name = oneLine(typeof x.name === 'string' && x.name ? x.name : tr('msg.remote.defaultName'), 60);
    board.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, ip, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, name, `clave:${id}`, now(), now(), body.pub, route, x.kind, who, JSON.stringify({ v: Number(x.v) || PAIR_PROTOCOL }));
    board.event(null, 'usuario', 'device.paired', name);
    board.notice(tr('msg.remote.deviceLinked', { name }), 'success');
    // The PC's MAC proves it is the PC of the code and of the verifier; the answer is sealed with the new session key.
    const key = sessionKey(own().priv, devPub); keys.set(id, key);
    linkChanged();
    return send(res, 200, { id, mac: r.pcMac, box: seal(key, { id, name: ctx.config.assistantName, orb: orbName(), ...versions(), pc: pcFingerprint() }, AAD.paired(id)) });
  }

  // a request from a browser's page that came over plain http on the home network (not this PC, not Tailscale's
  // https through loopback, not the Tailscale address).
  const plainBrowser = (req) => plainHttpBrowser({ origin: req.headers.origin, app: Boolean(appOrigin(req)), localAddress: req.socket?.localAddress, routes: state.routes });


  // A picture, PDF or text file from the phone (encrypted): checked by its first bytes (not its name), stored in the app's folder, path returned.
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
      // the client's name only tells md/csv/json apart inside plain text and is echoed back sanitized; it never reaches the stored path
      const shown = sanitizeUploadName(auth.name);
      const ext = sniffUpload(b, path.extname(shown).slice(1));
      if (!ext || !UPLOAD_TYPES.includes(ext)) return reply(res, device, auth.nonce, { ok: false, status: 415, error: tr('msg.remote.fileTypes') });
      await fs.promises.mkdir(mine, { recursive: true });
      await pruneUploads(b.length);
      const file = path.join(mine, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
      await fs.promises.writeFile(file, b);
      return reply(res, device, auth.nonce, { ok: true, result: { path: path.basename(file), name: shown } }); // its name: the PC knows where
    } catch (error) { log(`móvil: subida: ${error.message}`); return reply(res, device, auth.nonce, { ok: false, error: tr('msg.remote.cannotSaveImage') }); }
    finally { uploading--; }
  }
  // A screenshot made for this phone, sealed with the key of the link and bound to its name (AAD.download).
  async function download(req, res, device, url) {
    const auth = openHeader(req, device, 'download');
    if (!auth) return send(res, 401, { error: tr('msg.remote.notLinked') });
    if (auth.clock) return clockOff(res);
    const name = url.searchParams.get('name') ?? '';
    // the sealed message names the file too: a captured header cannot be replayed for another one
    // 400, not 401: the app takes a 401 as «this device was unlinked»
    if (!SHOT_NAME.test(name) || auth.name !== name) return send(res, 400, { error: tr('msg.remote.badJson') });
    const entry = downloads.get(name);
    const miss = () => send(res, 404, { error: 'no encontrado' });
    if (entry && entry.expires <= Date.now()) downloads.delete(name);
    if (!entry || entry.device !== device.id || entry.expires <= Date.now()) return miss();
    const dir = path.resolve(shots());
    const file = path.resolve(path.join(dir, name));
    if (path.dirname(file) !== dir) return miss();
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile()) return miss();
      if (st.size > UPLOAD_MAX) return send(res, 413, { error: tr('sys.remote.tooLarge') });
      const bytes = await fs.promises.readFile(file);
      return send(res, 200, Buffer.from(sealBytes(keyOf(device), new Uint8Array(bytes), AAD.download(device.id, name))), 'application/octet-stream');
    } catch { return miss(); }
  }
  // Old pictures go (7 days), and the oldest ones too while the folder would pass its quota.
  // The oldest first (older per-person subfolders too).
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
  // as a messaging app's (deliverNote): the chat's name and picture, one per chat, its actions; muted: none.
  function notify(payload) {
    if (!payload || payload.role === 'usuario') return;
    deliverNote({ conversation: payload.conversation ?? null, line: { id: payload.id ?? null, role: payload.role, body: payload.body, meta: payload.meta ?? null } });
  }

  // ---- notifications as a messaging app's (src/shared/notes.mjs builds them).
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
  // One line of a chat, to every linked device (the preview and the mute of Ajustes); the apps open get it as a
  // sealed «note» event (the Android app shows it while in the background), the others a Web Push.
  function deliverNote({ conversation = null, line }) {
    let chat; try { chat = chatOf(conversation); } catch { chat = null; }
    if (!chat) return false;
    let muted = false; try { muted = conversation != null && isMuted(board, conversation); } catch { /* no marks yet */ }
    const built = buildNote({ chat, line, preview: pushPreview(ctx.config), muted, assistantName: ctx.config.assistantName ?? 'Orb', words: noteWords() });
    const n = built ? dress(built) : null;
    if (!n) return false;
    return pushNote(n, conversation);
  }
  // The notices that are not a chat line (a task done and reviewed, one held, a new version, a limit gone): same
  // delivery, no chat and no mute (a global switch does not exist beyond the preview and the access itself).
  function announce(fact) {
    const once = fact?.kind === 'update' ? `note_update:${String(fact.version ?? '').slice(0, 30)}` : null;
    if (once && board.setting(once)) return false; // once per version
    const built = noticeNote(fact, { preview: pushPreview(ctx.config), assistantName: ctx.config.assistantName ?? 'Orb' });
    const delivered = built ? pushNote(dress(built), null) : false;
    // a version nobody was told about (no phone linked yet) is still news the day a phone links
    if (once && delivered) board.setting(once, '1');
    return delivered;
  }
  // What was kept for the phones goes when the last phone is unlinked (a new link starts with a clean list).
  const clearNotes = () => { try { board.run('DELETE FROM mobile_notes'); } catch (error) { log(`avisos: ${error.message}`); } };
  // The note goes out (sealed event to the open apps, Web Push to the others) and is kept in the short list a phone reads
  // back with notes.list. What is kept has no actions, no card and no token.
  function pushNote(note, conversation) {
    // Nothing is kept while no phone is linked: the first one to link must not read notices from before it existed.
    if (!board.all('SELECT * FROM devices WHERE public_key IS NOT NULL').some(validDevice)) return false;
    // The saved row's id (the `id` notes.list gives) travels as `nid`, so a phone tells two notices with the same text apart.
    // The row is written before the delivery; if it cannot be written the notice goes out without `nid`.
    let n = note;
    try { n = { ...note, nid: recordNote(board, { key: n.key, kind: n.kind, title: n.title, body: n.body, hidden: n.hidden, route: n.route, line: n.line, target: targetOfNote(n) }, { conversation }) }; } catch (error) { log(`avisos: ${error.message}`); }
    const openNow = new Set();
    for (const c of clients) {
      openNow.add(c.device);
      try { c.res.write(`data: ${sealText(c.key, { e: 'note', p: n }, AAD.event(c.device))}\n\n`); } catch { /* gone */ }
    }
    for (const d of board.all('SELECT * FROM devices WHERE push IS NOT NULL')) {
      if (openNow.has(d.id) || !validDevice(d)) continue;
      let sub; try { sub = JSON.parse(d.push); } catch { continue; }
      const data = { title: n.title, body: n.body, hidden: n.hidden, ...(n.nid != null ? { nid: n.nid } : {}), tag: `orb-${n.key}`, icon: n.icon, url: '/', route: n.route, kind: n.kind,
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
  // node:http is loaded when the access starts (~18 ms the engine's start does not wait for).
  const listen = async (address, port) => { const { default: http } = await import('node:http'); return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { handle(req, res).catch((error) => { log(`móvil: ${error.stack}`); try { send(res, 500, { error: tr('msg.remote.internalError') }); } catch { /* sent */ } }); });
    srv.headersTimeout = 15_000; srv.requestTimeout = 60_000;    srv.once('error', (error) => resolve({ error }));
    srv.listen(port, address, () => { ownPorts.add(srv.address().port); resolve({ srv }); });
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
  // Is our port still forwarded? true / false, or null when it cannot be told (the answer is cut or the command failed:
  // nothing is touched then).
  async function serveAlive(port) {
    const r = await quickRun(tailscaleExe(), ['serve', 'status', '--json'], { timeoutMs: 10_000 }).catch(() => null);
    if (!r?.ok) return null;
    try {
      const st = JSON.parse(r.out);
      return Boolean(st?.TCP?.[String(port)] || Object.keys(st?.Web ?? {}).some((k) => k.endsWith(`:${port}`)));
    } catch { return null; }
  }

  // What each way in opened ({ routes, hosts, origins, errors, … }), so one can be redone without touching the other,
  // and what the screen and the phone show of each: { tipo, url, abierta, ultimoOk, ultimoError }.
  const parts = { wifi: null, tailscale: null };
  const entries = { wifi: null, tailscale: null };
  // Only changes are logged (the watcher looks every few seconds): opened, closed, failed.
  function note(kind, { ok = false, url, error = null } = {}) {
    const e = (entries[kind] ??= { tipo: kind, url: null, abierta: false, ultimoOk: null, ultimoError: null });
    const before = { open: e.abierta, error: e.ultimoError };
    if (url !== undefined) e.url = url;
    e.abierta = ok;
    if (ok) e.ultimoOk = new Date().toISOString();
    else if (error) e.ultimoError = withoutPaths(oneLine(error, 200));
    if (ok && !before.open) log(`móvil: entrada ${kind} abierta${e.url ? ` en ${e.url}` : ''}`);
    else if (!ok && before.open) log(`móvil: entrada ${kind} cerrada${error ? `: ${e.ultimoError}` : ''}`);
    else if (!ok && error && e.ultimoError !== before.error) log(`móvil: entrada ${kind} no abierta: ${e.ultimoError}`);
  }
  function composeState() {
    const list = [parts.wifi, parts.tailscale].filter(Boolean);
    const routes = list.flatMap((p) => p.routes); const errors = list.flatMap((p) => p.errors);
    state = { running: routes.length > 0, routes, hosts: list.flatMap((p) => p.hosts), origins: list.flatMap((p) => p.origins), local: parts.wifi?.local ?? null, lan: parts.wifi?.lan ?? '',
      error: routes.length ? (errors[0] ?? null) : (errors.join(' ') || tr('msg.remote.noNetwork')) };
  }
  const settle = (kind, part) => {
    parts[kind] = part;
    const r = part?.routes[0];
    if (!part) { if (entries[kind]) note(kind, { ok: false }); } else if (r) note(kind, { ok: true, url: r.url }); else note(kind, { ok: false, url: null, error: part.errors[0] ?? tr('msg.remote.noEntry') });
  };

  // The home network: one server per local address, plus this PC's name there. → the part, or null when stop() ran meanwhile.
  async function openWifi(port, mine) {
    const part = { routes: [], hosts: [], origins: [], errors: [], local: null, lan: lanAddresses().join(',') };
    const bind = async (address) => {
      const r = await listen(address, port);
      if (r.error) { part.errors.push(tr('msg.remote.portBusy', { address, port, error: r.error.message })); return false; }
      r.srv.orbKind = 'wifi'; servers.push(r.srv); return true;
    };
    if (process.env.ORB_REMOTE_BIND === '127.0.0.1') {
      // Tests: only loopback.
      if (await bind('127.0.0.1')) { part.hosts.push(`127.0.0.1:${port}`); part.origins.push(`http://127.0.0.1:${port}`); part.routes.push({ kind: 'wifi', url: `http://127.0.0.1:${port}/`, secure: false, address: '127.0.0.1' }); }
      return part;
    }
    const lan = lanAddresses();
    if (!lan.length) part.errors.push(tr('msg.remote.noWifi'));
    for (const address of lan) {
      if (mine !== generation) return null;
      if (await bind(address)) { part.hosts.push(`${address}:${port}`); part.origins.push(`http://${address}:${port}`); if (!part.routes.length) part.routes.push({ kind: 'wifi', url: `http://${address}:${port}/`, secure: false, address }); }
    }
    // this computer's name on the home network (<name>.local, answered by the system's mDNS), so a phone
    // still finds it when the Wi-Fi address changes.
    const local = localName();
    if (local && part.routes.length) { part.hosts.push(`${local}:${port}`); part.origins.push(`http://${local}:${port}`); part.local = `http://${local}:${port}/`; }
    return part;
  }
  // Tailscale: https through `tailscale serve` when the tailnet has it, plain http on its address otherwise. → the part, or
  // null when stop() ran meanwhile.
  async function openTailscale(port, mine) {
    const part = { routes: [], hosts: [], origins: [], errors: [] };
    const ts = await tailscaleAddress();
    if (mine !== generation) return null;
    const bind = async (address) => {
      const r = await listen(address, port);
      if (r.error) { part.errors.push(tr('msg.remote.portBusy', { address, port, error: r.error.message })); return false; }
      r.srv.orbKind = 'tailscale'; servers.push(r.srv); return true;
    };
    // The loopback server is only of use while `tailscale serve` forwards https to it: otherwise plain http.
    let https = false;
    if (ts?.https && ts.dns && await bind('127.0.0.1')) { https = await serveHttps(port); if (!https) { try { servers.pop()?.close(); } catch { /* closed */ } } }
    if (mine !== generation) return null;
    if (!ts) part.errors.push(tr('msg.remote.noTailscale'));
    else if (https) {
      part.hosts.push(`${ts.dns}:${port}`); part.origins.push(`https://${ts.dns}:${port}`);
      part.routes.push({ kind: 'tailscale', url: `https://${ts.dns}:${port}/`, secure: true, address: ts.address });
    } else if (await bind(ts.address)) {
      part.hosts.push(`${ts.address}:${port}`, ...(ts.dns ? [`${ts.dns}:${port}`] : [])); part.origins.push(`http://${ts.address}:${port}`, ...(ts.dns ? [`http://${ts.dns}:${port}`] : []));
      part.routes.push({ kind: 'tailscale', url: `http://${ts.dns ?? ts.address}:${port}/`, secure: false, address: ts.address });
    }
    return part;
  }

  async function startNow() {
    const mine = generation;
    const m = ctx.config.mobile ?? {};
    const port = m.port ?? 3131;
    const gaveUp = () => { closeAll(); return state; }; // stop() ran while we waited: what we bound goes too
    parts.wifi = parts.tailscale = null;
    const testing = process.env.ORB_REMOTE_BIND === '127.0.0.1';
    if (testing || m.wifi !== false) { const w = await openWifi(port, mine); if (!w) return gaveUp(); settle('wifi', w); }
    if (!testing && m.tailscale !== false) { const t = await openTailscale(port, mine); if (!t) return gaveUp(); settle('tailscale', t); }
    if (mine !== generation) return gaveUp();
    composeState();
    pruneUploads().catch(() => {});
    sweepShots(shots()).catch(() => {});
    return state;
  }
  // The watcher's repairs: each redoes one entry and leaves the other (and every phone connected to it) alone.
  const repairs = createRepairGate();
  const portOf = () => ctx.config.mobile?.port ?? 3131;
  async function reopenWifi() {
    const mine = generation;
    await closeKind('wifi');
    const w = await openWifi(portOf(), mine);
    if (!w) return;
    settle('wifi', w); composeState();
  }
  async function reopenTailscale() {
    const mine = generation;
    await closeKind('tailscale');
    await unserve();
    const t = await openTailscale(portOf(), mine);
    if (!t) return;
    settle('tailscale', t); composeState();
  }
  async function reserve(mine) {
    if (served === null || mine !== generation) return false;
    const ok = await serveHttps(served);
    if (mine !== generation) { await unserve(); return false; } // stop() ran meanwhile: nothing may stay forwarded
    note('tailscale', ok ? { ok: true } : { ok: false, error: tr('msg.remote.tailscaleServeDown') });
    return ok;
  }
  // closing waits until every server and its open connections are really gone (2 s at most), so a restart on the same
  // port never answers through a half-closed old one: a phone's request could hang on it for ~20 s and then fail (the
  // «reabrir el acceso» test failed now and then for that).
  function closeKind(kind) {
    const mineKind = servers.filter((s) => !kind || s.orbKind === kind);
    servers = servers.filter((s) => !mineKind.includes(s));
    const closing = mineKind.map((s) => new Promise((resolve) => { try { s.close(() => resolve()); s.closeAllConnections?.(); } catch { resolve(); } setTimeout(resolve, 2000).unref?.(); }));
    return Promise.all(closing);
  }
  const closeAll = () => closeKind(null);

  // ---- Magic Link: the linked phones and browsers.
  const onlineIds = () => new Set([...clients].map((c) => c.device));
  function deviceView(d, on = onlineIds()) {
    return { id: d.id, name: d.name, kind: d.kind ?? kindOf({ name: d.name }), createdAt: d.created_at, lastSeen: d.last_seen ?? null, ip: d.ip ?? null, v: metaV(d), client: parseMeta(d).client ?? null,
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
    announce,
    // Engine events go to the paired phones too (only the ones the interface needs), each sealed for its phone.
    broadcast(event, payload) {
      if (event === 'chat:new') notify(payload);
      if (!EVENTS.has(event) || !(clients.size || state.running)) return;
      // The settings themselves never travel to a phone (the page just reloads what it is allowed to see).
      const value = { e: event, p: event === 'config:changed' ? null : withoutPaths(payload) };
      // Kept even with no phone connected: the one that comes back asks for what it missed.
      const id = journal.add(value, event === 'chat:state' && payload?.conversation != null ? `chat:${payload.conversation}` : null);
      for (const c of clients) {
        if (c.res.writableLength > STREAM_BACKLOG) { try { c.res.destroy(); } catch { /* gone */ } clients.delete(c); continue; }
        // the streamed answer as deltas to a client that asked for them; the whole text to the others.
        const own = c.stream && event === 'chat:state' ? { e: event, p: c.stream(value.p) } : value;
        try { c.res.write(`id: ${id}\ndata: ${sealText(c.key, own, AAD.event(c.device))}\n\n`); } catch { clients.delete(c); }
      }
    },
    start() {
      if (servers.length) return Promise.resolve(state);
      // never on a database of 3.5–3.7 that the 3.8 migration could not finish yet (its devices may be other users').
      if (isLegacy(board.db)) { const e = new Error(tr('msg.remote.notMigrated')); e.userFacing = true; return Promise.reject(e); }
      // and never while the vault with this PC's keys is locked (it opens with the master password).
      try { own(); } catch (error) { return Promise.reject(error); }
      starting ??= startNow().finally(() => { starting = null; });
      // The watcher redoes only the entry that needs it: a Wi-Fi address that changed, Tailscale that was not ready when
      // Orb started, `tailscale serve` that was lost, or whatever a suspended PC left behind.
      if (!watcher && !process.env.ORB_REMOTE_BIND) {
        const mine = generation;
        const lw = createLinkWatcher({ every: NETWORK_CHECK_MS, log,
          wifiOn: () => ctx.config.mobile?.wifi !== false, tailscaleOn: () => ctx.config.mobile?.tailscale !== false,
          lanKey: () => lanAddresses().join(','), openedLan: () => state.lan ?? '',
          tsOpen: () => Boolean(parts.tailscale?.routes.length), tsServed: () => served !== null, tsAdapter: tailscaleAdapterUp,
          reopenWifi: () => repairs.run(reopenWifi), openTailscale: () => repairs.run(reopenTailscale), tsServeAlive: () => (mine === generation ? repairs.run(() => serveAlive(served)) : null), reserve: () => (mine === generation ? repairs.run(() => reserve(mine)) : false),
          seen: (kind) => { if (entries[kind]?.abierta) note(kind, { ok: true }); } });
        watcher = setInterval(() => { if (!starting) lw.tick(); }, NETWORK_CHECK_MS);
        watcher.unref?.();
      }
      return starting;
    },
    async restart() { await remote.stop(); return remote.start(); },
    async stop() {
      generation++;
      clearInterval(watcher); watcher = null;
      await repairs.idle(); // a repair still opening a server or `serve` finishes first, so nothing is left open after this
      await starting?.catch(() => {}); // a start() still waiting for the network gives up and closes what it bound
      for (const c of clients) { try { c.res.end(); } catch { /* closed */ } }
      clients.clear(); await closeAll(); pairing = null; state = { running: false, routes: [], error: null };
      for (const kind of Object.keys(entries)) if (entries[kind]?.abierta) note(kind, { ok: false });
      parts.wifi = parts.tailscale = null;
      await unserve();
    },
    allowDownload,
    status() {
      let pc = null; try { pc = pcFingerprint(); } catch { /* the vault is locked */ }
      return { enabled: Boolean(ctx.config.mobile?.enabled), running: Boolean(state.running), routes: state.routes ?? [], error: state.error ?? null, pc,
        wifi: ctx.config.mobile?.wifi !== false, tailscale: ctx.config.mobile?.tailscale !== false, name: orbName(),
        // how each way in is doing: { tipo, url, abierta, ultimoOk, ultimoError }, only for the ways that are turned on
        entries: Object.values(entries).filter((e) => e && ctx.config.mobile?.[e.tipo] !== false),
        preview: pushPreview(ctx.config), screenshot: ctx.config.mobile?.screenshot !== false,
        devices: board.all('SELECT id, name, created_at, last_seen, route, kind, ip, push IS NOT NULL AS push FROM devices ORDER BY created_at DESC').map((d) => ({ ...d, push: Boolean(d.push) })) };
    },
    // A one-time QR for 5 minutes, for one of the ways in (Wi-Fi or Tailscale). The code and this PC's key travel in the
    // URL fragment (#), which the browser never sends to any server.
    // the fragment also names this Orb and its other addresses (Wi-Fi, Tailscale, name.local); and a
    // short code (8 letters and digits) can be typed by hand instead, together with the address.
    // device: what it is for (phone or browser), chosen here by the owner, never by the device.
    pair(kind, { device = null } = {}) {
      if (!state.running) throw new Error(tr('msg.remote.enableFirst'));
      const route = state.routes.find((r) => r.kind === kind) ?? state.routes[0];
      const code = crypto.randomBytes(18).toString('base64url');
      const short = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
      const forKind = PAIR_KINDS.includes(device) ? device : null;
      pairing = { code, short, short3: shortSecret(short, b64.enc(own().pub)), expires: Date.now() + PAIR_MINUTES * 60_000, route: route.kind, fails: 0, passFails: 0, pending: new Map(),
        device: forKind };
      const others = state.routes.filter((r) => r !== route).map((r) => r.url);
      // the name of this computer on the home network (name.local) too, for when the Wi-Fi address changes.
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
      if (!board.one('SELECT 1 AS x FROM devices WHERE public_key IS NOT NULL')) clearNotes();
      keys.delete(d.id); seen.delete(d.id); answers.delete(d.id);
      for (const c of clients) if (c.device === d.id) { try { c.res.end(); } catch { /* closed */ } clients.delete(c); }
      board.event(null, 'usuario', 'device.revoked', d.name);
      linkChanged();
      return true;
    },
    devices,
    fingerprint: () => pcFingerprint(),
    // «He olvidado la contraseña»: every linked phone and browser goes (they link again with the new password), and
    // the keys are read again (a new vault makes new ones). → how many went.
    revokeAll() {
      const list = board.all('SELECT id, name FROM devices');
      board.run('DELETE FROM devices');
      clearNotes();
      keys.clear(); seen.clear(); answers.clear(); pairing = null; ownKeys = null;
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
