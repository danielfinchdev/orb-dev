// Phone access: the same interface as a web app, served ONLY on this PC's Tailscale address (a private, encrypted network
// between the user's own devices). Off by default. A phone is paired by scanning a one-time QR shown on the PC; it then
// keeps its own session (a token the page keeps and sends in a header; never a cookie, which the browser would also hand
// to any other port of this PC), which the PC can revoke. What a phone may do is a subset of the PC's actions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ctx } from '../core/context.mjs';
import { oneLine } from '../core/safety.mjs';
import { quickRun } from '../agents/index.mjs';
import { IS_WIN } from '../agents/common.mjs';

const RENDERER = process.env.ORB_RENDERER || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const SESSION_DAYS = 30; // a phone unused for this long has to be paired again
const PAIR_MINUTES = 5;
const UPLOAD_MAX = 10 * 1024 * 1024;
const UPLOADS_TOTAL = 300 * 1024 * 1024; // phone pictures kept at most (oldest go first), and never older than 7 days
const UPLOADS_DAYS = 7;
const STREAM_BACKLOG = 1024 * 1024; // a live-event stream that stops reading is dropped instead of filling the memory
const STREAMS_PER_DEVICE = 3;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
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
  'tasks.list', 'tasks.get', 'tasks.create', 'tasks.approve', 'tasks.retry', 'tasks.cancel', 'tasks.reassign', 'tasks.followup', 'tasks.undo', 'tasks.launchAnyway', 'tasks.accept',
  'sessions.list', 'sessions.create', 'sessions.items', 'sessions.send', 'sessions.stop', 'sessions.update',
  'projects.list', 'projects.info', 'projects.setActive', 'projects.create', 'logs.list', 'logs.read', 'activity.list', 'usage.get', 'agents.status',
  'control.pause', 'control.resume']);
const EVENTS = new Set(['board:changed', 'chat:state', 'chat:new', 'session:item', 'session:update', 'session:removed', 'config:changed']);

const inCgnat = (ip) => { const [x, y] = String(ip).split('.').map(Number); return x === 100 && y >= 64 && y <= 127; };
const tailscaleExe = () => (IS_WIN ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale');

// This PC's Tailscale IPv4 and MagicDNS name, as Tailscale itself reports them. The 100.64.0.0/10 range is also used by
// operators' shared NAT and other VPNs, so an address there is only trusted when Tailscale confirms it or the network
// adapter is Tailscale's. Tests may bind to loopback with ORB_REMOTE_BIND=127.0.0.1.
export async function tailscaleAddress() {
  if (process.env.ORB_REMOTE_BIND === '127.0.0.1') return { address: '127.0.0.1', dns: 'localhost' };
  const r = await quickRun(tailscaleExe(), ['status', '--json'], { timeoutMs: 8000 });
  if (r.ok) {
    try {
      const self = JSON.parse(r.out)?.Self;
      const address = (self?.TailscaleIPs ?? []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && inCgnat(ip));
      if (address) return { address, dns: self.DNSName ? String(self.DNSName).replace(/\.$/, '') : null };
    } catch { /* fall back to the adapter */ }
  }
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!/tailscale/i.test(name)) continue;
    const a = (list ?? []).find((x) => x.family === 'IPv4' && !x.internal && inCgnat(x.address));
    if (a) return { address: a.address, dns: null };
  }
  return null;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export function createRemote({ board, api, log, name }) {
  let server = null; let state = { running: false, host: null, url: null, error: null };
  let generation = 0; // moved by stop(): a start() still waiting for Tailscale gives up
  let starting = null;
  let pairing = null; // { hash, expires }
  let failures = new Map(); // address -> timestamps of wrong pairing tokens (one noisy device cannot lock out the others)
  const clients = new Set(); // SSE responses
  const uploads = () => path.join(ctx.paths.internal, 'adjuntos-movil');

  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const deviceOf = (req) => {
    const m = String(req.headers.authorization ?? '').match(/^Bearer ([A-Za-z0-9_-]{40,60})$/);
    if (!m) return null;
    const d = board.one('SELECT * FROM devices WHERE token_hash = ?', sha(m[1]));
    if (!d) return null;
    if (Date.now() - Date.parse(d.last_seen ?? d.created_at) > SESSION_DAYS * 86_400_000) return null;
    if (!d.last_seen || Date.now() - Date.parse(d.last_seen) > 60_000) board.run('UPDATE devices SET last_seen = ? WHERE id = ?', now(), d.id);
    return d;
  };

  // Only requests addressed to this server by its own name pass (stops DNS rebinding), and state changes must come from
  // our own page (Origin + a custom header that other sites cannot send without a CORS preflight we never answer).
  const hostOk = (req) => state.hosts?.includes(String(req.headers.host ?? '').toLowerCase());
  const originOk = (req) => !req.headers.origin || state.origins?.includes(String(req.headers.origin).toLowerCase());

  const readJson = (req, max = 200_000) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON no válido')); } });
    req.on('error', reject);
  });

  function serveStatic(req, res, pathname) {
    if (pathname === '/manifest.webmanifest') {
      return send(res, 200, JSON.stringify({ name: ctx.config.assistantName, short_name: ctx.config.assistantName, start_url: '/', scope: '/', display: 'standalone', background_color: '#1d2257', theme_color: '#5b6ee8', icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }), TYPES['.webmanifest']);
    }
    if (pathname === '/sw.js') return send(res, 200, "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});", TYPES['.js'], { 'Service-Worker-Allowed': '/' });
    let rel; try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return send(res, 404, 'no encontrado', 'text/plain'); }
    // Only what the phone's page needs (not the desktop-only pages such as the agent's browser window).
    if (!(rel === 'index.html' || rel === 'icon.png' || /^assets\/[\w.-]+$/.test(rel))) return send(res, 404, 'no encontrado', 'text/plain');
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return send(res, 404, 'no encontrado', 'text/plain');
    fs.readFile(file, (error, data) => {
      if (error) return send(res, 404, 'no encontrado', 'text/plain');
      let body = data;
      // The installed web app needs the manifest and the service worker: added to the page served to phones only.
      if (rel === 'index.html') body = Buffer.from(String(data).replace('</head>', '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#5b6ee8"><meta name="apple-mobile-web-app-capable" content="yes"></head>'));
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
    if (req.method === 'POST' && req.headers['x-orb'] !== '1') return send(res, 403, { error: 'petición no permitida' });

    if (req.method === 'POST' && p === '/api/pair') {
      const who = req.socket.remoteAddress ?? '?';
      const recent = (failures.get(who) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
      failures.set(who, recent);
      if (recent.length >= 10) return send(res, 429, { error: 'demasiados intentos: espera unos minutos y genera otro QR' });
      let body = await readJson(req).catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
      const token = typeof body.token === 'string' ? body.token : '';
      const ok = pairing && Date.now() < pairing.expires && token.length > 20 && crypto.timingSafeEqual(Buffer.from(sha(token)), Buffer.from(pairing.hash));
      if (!ok) { recent.push(Date.now()); return send(res, 401, { error: 'el código QR no es válido o ha caducado: genera otro en el PC' }); }
      pairing = null; // one use
      const session = crypto.randomBytes(32).toString('base64url');
      const id = crypto.randomUUID();
      const name = oneLine(typeof body.name === 'string' && body.name ? body.name : 'Móvil', 60);
      board.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)', id, name, sha(session), now(), now());
      board.event(null, 'usuario', 'device.paired', name);
      board.addChat('system', `📱 Nuevo dispositivo vinculado: ${name}. Puedes quitarlo en Ajustes → Móvil.`);
      // The page keeps it in its own storage (only this exact address and port can read it) and sends it as a header.
      return send(res, 200, { ok: true, token: session });
    }

    const device = deviceOf(req);
    if (!device) return send(res, 401, { error: 'este dispositivo no está vinculado' });

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': hola\n\n');
      const client = { res, device: device.id };
      const mine = [...clients].filter((c) => c.device === device.id);
      if (mine.length >= STREAMS_PER_DEVICE) { try { mine[0].res.end(); } catch { /* closed */ } clients.delete(mine[0]); }
      clients.add(client);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
      req.on('close', () => { clearInterval(ping); clients.delete(client); });
      return undefined;
    }
    if (req.method === 'GET' && p === '/api/me') return send(res, 200, { device: device.name, name: ctx.config.assistantName });
    if (req.method === 'POST' && p === '/api/upload') return upload(req, res);
    if (req.method === 'POST' && p === '/api/call') {
      let body; try { body = await readJson(req); } catch (error) { return send(res, 400, { error: error.message }); }
      const method = String(body.method ?? '');
      const params = body.params && typeof body.params === 'object' ? body.params : {};
      if (!ALLOWED.has(method)) return send(res, 403, { error: 'esa acción solo se puede hacer desde el PC' });
      if (params.permission === 'total') return send(res, 403, { error: 'el acceso total solo se da desde el PC' });
      // A conversation the PC gave total access to is driven from the PC only.
      if (method.startsWith('sessions.') && method !== 'sessions.stop' && params.id !== undefined && board.one('SELECT permission FROM sessions WHERE id = ?', String(params.id))?.permission === 'total') return send(res, 403, { error: 'esta conversación tiene acceso total: solo se usa desde el PC' });
      // Pictures from a phone are only the ones it uploaded itself (never other files of the PC).
      if (params.images !== undefined) {
        const dir = uploads() + path.sep;
        if (!Array.isArray(params.images) || params.images.some((f) => typeof f !== 'string' || !path.resolve(f).startsWith(dir))) return send(res, 403, { error: 'solo imágenes subidas desde el móvil' });
      }
      try { const result = (await api.call(method, params)) ?? null; return send(res, 200, { ok: true, result: method === 'app.state' ? { ...result, config: phoneConfig(result.config) } : result }); }
      catch (error) { return send(res, 200, { ok: false, error: oneLine(error?.message ?? String(error), 1000) }); }
    }
    return send(res, 404, { error: 'no encontrado' });
  }

  // A picture from the phone: checked by its first bytes (not its name), stored in the app's folder, path returned.
  let uploading = 0;
  function upload(req, res) {
    if (uploading >= 3) { req.resume(); return send(res, 429, { error: 'espera a que terminen las otras imágenes' }); }
    uploading++;
    const chunks = []; let size = 0; let done = false;
    const finish = (status, body) => { if (done) return; done = true; uploading--; send(res, status, body); };
    req.on('data', (c) => { size += c.length; if (size > UPLOAD_MAX) { finish(413, { error: 'la imagen pasa de 10 MB' }); req.destroy(); } else chunks.push(c); });
    req.on('error', () => { if (!done) { done = true; uploading--; } });
    req.on('end', async () => {
      if (done) return;
      const b = Buffer.concat(chunks);
      const ext = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
        : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : b.subarray(0, 3).toString() === 'GIF' ? 'gif' : null;
      if (!ext) return finish(415, { error: 'solo imágenes PNG, JPG, WEBP o GIF' });
      try {
        await fs.promises.mkdir(uploads(), { recursive: true });
        await pruneUploads(b.length);
        const file = path.join(uploads(), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
        await fs.promises.writeFile(file, b);
        finish(200, { ok: true, path: file });
      } catch (error) { log(`móvil: subida: ${error.message}`); finish(500, { error: 'no se pudo guardar la imagen' }); }
    });
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

  return {
    // Engine events go to the paired phones too (only the ones the interface needs).
    broadcast(event, payload) {
      if (!clients.size || !EVENTS.has(event)) return;
      // The settings themselves never travel to a phone (the page just reloads what it is allowed to see).
      const data = `event: message\ndata: ${JSON.stringify({ event, payload: event === 'config:changed' ? null : payload })}\n\n`;
      for (const c of clients) {
        if (c.res.writableLength > STREAM_BACKLOG) { try { c.res.destroy(); } catch { /* gone */ } clients.delete(c); continue; }
        try { c.res.write(data); } catch { clients.delete(c); }
      }
    },
    start() {
      if (server) return Promise.resolve(state);
      starting ??= (async () => {
        const mine = generation;
        try {
          const found = await tailscaleAddress();
          if (mine !== generation) return state; // turned off meanwhile
          if (!found) { state = { running: false, error: 'No encuentro Tailscale en este PC. Instálalo, inicia sesión y vuelve a activar el acceso.' }; return state; }
          const { address, dns } = found;
          const port = ctx.config.mobile?.port ?? 3131;
          const hosts = [`${address}:${port}`, ...(dns ? [`${dns.toLowerCase()}:${port}`] : [])];
          const srv = http.createServer((req, res) => { handle(req, res).catch((error) => { log(`móvil: ${error.stack}`); try { send(res, 500, { error: 'error interno' }); } catch { /* sent */ } }); });
          srv.headersTimeout = 15_000; srv.requestTimeout = 60_000;
          const error = await new Promise((resolve) => { srv.once('error', resolve); srv.listen(port, address, () => resolve(null)); });
          if (error) { state = { running: false, error: `No se pudo abrir el puerto ${port}: ${error.message}` }; return state; }
          if (mine !== generation) { srv.close(); return state; }
          server = srv;
          state = { running: true, address, port, dns, hosts, origins: hosts.map((h) => `http://${h}`), url: `http://${dns ?? address}:${port}/` };
          log(`acceso móvil en ${state.url}`);
          pruneUploads().catch(() => {});
          return state;
        } finally { starting = null; }
      })();
      return starting;
    },
    stop() { generation++; for (const c of clients) { try { c.res.end(); } catch { /* closed */ } } clients.clear(); server?.close(); server = null; pairing = null; state = { running: false }; },
    status() {
      return { enabled: Boolean(ctx.config.mobile?.enabled), running: Boolean(state.running), url: state.url ?? null, error: state.error ?? null,
        devices: board.all('SELECT id, name, created_at, last_seen FROM devices ORDER BY created_at DESC') };
    },
    // A one-time QR for 5 minutes. The token travels in the URL fragment (#), so it never reaches a server log.
    pair() {
      if (!state.running) throw new Error('activa antes el acceso desde el móvil');
      const token = crypto.randomBytes(24).toString('base64url');
      pairing = { hash: sha(token), expires: Date.now() + PAIR_MINUTES * 60_000 };
      return { url: `${state.url}#vincular=${token}`, expiresAt: pairing.expires };
    },
    revoke(id) {
      const d = board.one('SELECT * FROM devices WHERE id = ?', String(id)); if (!d) throw new Error('ese dispositivo no existe');
      board.run('DELETE FROM devices WHERE id = ?', d.id);
      for (const c of clients) if (c.device === d.id) { try { c.res.end(); } catch { /* closed */ } clients.delete(c); }
      board.event(null, 'usuario', 'device.revoked', d.name);
      return true;
    }
  };
}
