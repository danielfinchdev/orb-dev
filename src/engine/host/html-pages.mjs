// HTML pages an agent shows inside the chat (orb_html_show). The page is untrusted code: it is served by a tiny HTTP
// server of its own, bound to 127.0.0.1 only, and every response carries a CSP with `sandbox allow-scripts` (an opaque
// origin: no cookies, no storage of Orb, no access to the window, no popups, no navigation of the top page). The window
// shows it in an <iframe sandbox="allow-scripts"> (src/ui/components/html-page.jsx). It is NOT the phone's server
// (remote.mjs) and never sees its token. Pages live in memory only and are gone when Orb locks or the chat is deleted.
// Internet is OFF for every page and is switched on, page by page, only by the user on this PC (permissions.mjs:
// htmlPages.* 'pc'); the switch is read on every request, so reloading the frame applies the new policy.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { tr } from '../../platform/context.mjs';

export const MAX_HTML = 512 * 1024;
export const MAX_TITLE = 120;
export const PER_SESSION = 20;
export const MAX_PAGES = 100;
export const SHOWS_PER_MINUTE = 10;
export const MAX_CHOICES = 6;
export const MAX_CHOICE = 120;
const ID_RE = /^[0-9a-f]{32}$/;
// The only origins allowed to frame a page: the packaged window (Windows: http://tauri.localhost; macOS/Linux:
// tauri://localhost; the https variant too). Loopback origins (the dev server) are added only in a development build
// (ORB_PAGES_DEV=1, set by the app for debug builds): a packaged Orb must not let a page on any local port frame these.
const PACKAGED_ANCESTORS = 'frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost';
export const FRAME_ANCESTORS = PACKAGED_ANCESTORS;
export const frameAncestors = (dev = process.env.ORB_PAGES_DEV === '1') => (dev ? `${PACKAGED_ANCESTORS} http://localhost:* http://127.0.0.1:*` : PACKAGED_ANCESTORS);
// The answers an agent offers as buttons under the page: plain one-line texts, at most MAX_CHOICES, without repeats. They are
// drawn by Orb's own window (never by the page) and sent as a message only when the person presses one.
export function cleanChoices(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw userError('msg.html.badChoices', { n: MAX_CHOICES });
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') throw userError('msg.html.badChoices', { n: MAX_CHOICES });
    const text = cleanTitle(item).slice(0, MAX_CHOICE);
    if (text.startsWith('/')) throw userError('msg.html.badChoices', { n: MAX_CHOICES }); // «/clear» would run as an Orb command
    if (text && !out.includes(text)) out.push(text);
  }
  if (out.length > MAX_CHOICES) throw userError('msg.html.badChoices', { n: MAX_CHOICES });
  return out;
}
const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });

// The policy of a page. `default-src 'none'` closes everything not listed. With internet on, only https: is added to
// the fetch directives: never http:, 'self', '*' or 'unsafe-eval'; frames, objects, forms and <base> stay closed.
export function pageCsp(internet) {
  const net = internet ? ' https:' : '';
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src 'unsafe-inline'${net}`,
    `style-src 'unsafe-inline'${net}`,
    `img-src data: blob:${net}`,
    `font-src data:${net}`,
    `media-src data:${net}`,
    ...(internet ? ['connect-src https:'] : []),
    "base-uri 'none'", "form-action 'none'", "object-src 'none'", "frame-src 'none'",
    frameAncestors()
  ].join('; ');
}

// control, format (zero-width, bidi) and line-separator characters are dropped so a title cannot spoof or hide text
const cleanTitle = (v) => String(v ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

export function createHtmlPages({ sessions, emit = () => {}, log = () => {}, now = Date.now }) {
  const pages = new Map(); // id -> { id, session, title, html, internet, createdAt }
  const shows = new Map(); // session -> timestamps of recent show() calls (rate limit)
  let server = null; let port = 0; let starting = null;
  let generation = 0; // wipe() bumps it so a show() that was awaiting the server does not outlive the lock

  // The window loads a page through the app's own scheme (ORB_PAGES_ORIGIN, e.g. http://orbpage.localhost): the Rust side
  // proxies exactly this server's port (src-tauri/src/pages.rs), so the window's CSP never has to allow loopback frames.
  // Without it (tests, no app) the frame points at the loopback server directly.
  const origin = () => { const o = process.env.ORB_PAGES_ORIGIN; return /^(https?:\/\/[a-z0-9.-]+|[a-z]+:\/\/localhost)$/.test(o ?? '') ? o : `http://127.0.0.1:${port}`; };
  const view = (p) => ({ id: p.id, session: p.session, title: p.title, url: `${origin()}/p/${p.id}`, internet: p.internet, choices: p.choices ?? [] });
  const note = (session, key, vars) => { try { sessions.addItem(session, 'system', 'status', tr(key, vars)); } catch { /* the chat went */ } };

  function handle(req, res) {
    const headers = {
      'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      // another site cannot embed this one as a subresource (a navigation, i.e. the iframe, is not affected)
      // no DNS prefetch from a page. WebRTC/STUN is NOT covered by the CSP: it is closed separately in the webview.
      'X-DNS-Prefetch-Control': 'off',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=(), clipboard-read=(), clipboard-write=(), fullscreen=()'
    };
    const fail = (code, msg) => { res.writeHead(code, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': pageCsp(false), ...(code === 405 ? { Allow: 'GET' } : {}) }); res.end(msg); };
    // Host must be exactly our loopback address and port: a DNS-rebinding page reaches us under its own name
    if (req.headers.host !== `127.0.0.1:${port}`) return fail(421, 'misdirected');
    if (req.method !== 'GET') return fail(405, 'method not allowed');
    const m = /^\/p\/([0-9a-f]{32})$/.exec(String(req.url ?? ''));
    const p = m ? pages.get(m[1]) : null;
    if (!p || !sessions.get(p.session)) return fail(404, 'not found');
    res.writeHead(200, { ...headers, 'Content-Security-Policy': pageCsp(p.internet) });
    res.end(p.html);
  }

  async function ensureServer() {
    if (server) return;
    if (!starting) {
      starting = new Promise((resolve, reject) => {
        const srv = http.createServer(handle);
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => { srv.removeListener('error', reject); srv.on('error', () => {}); server = srv; srv.unref(); port = srv.address().port; emit('html:server', { port }); resolve(); });
      }).finally(() => { starting = null; });
    }
    await starting;
  }
  const stopServer = () => { const s = server; server = null; port = 0; if (s) emit('html:server', { port: 0 }); if (s) { try { s.close(); s.closeAllConnections?.(); } catch { /* closed */ } } };
  const gone = (p, why) => { if (pages.delete(p.id)) emit('html:closed', { id: p.id, session: p.session }); log(`html: página ${p.id.slice(0, 6)} cerrada (${why})`); };
  const dropSession = (id) => { shows.delete(String(id)); for (const p of [...pages.values()]) if (p.session === String(id)) gone(p, 'chat'); if (!pages.size) stopServer(); };
  const alive = (keepServer = false) => { for (const p of [...pages.values()]) if (!sessions.get(p.session)) gone(p, 'chat'); if (!pages.size && !keepServer) stopServer(); };
  const find = (ref) => {
    const p = ID_RE.test(String(ref?.id)) ? pages.get(String(ref.id)) : null;
    if (!p || String(ref.session) !== p.session || !sessions.get(p.session)) throw userError('msg.html.gone');
    return p;
  };

  return {
    // The agent's tool; `s` is the chat of its signed grant. → { id, url, text, ... }
    async show(s, args = {}) {
      if (!s) throw userError('msg.html.noChat');
      const a = args && typeof args === 'object' ? args : {};
      if (typeof a.html !== 'string' || !a.html.trim()) throw userError('msg.html.empty');
      if (Buffer.byteLength(a.html, 'utf8') > MAX_HTML) throw userError('msg.html.tooBig', { kb: MAX_HTML / 1024 });
      const title = cleanTitle(a.title) || tr('htmlpage.untitled');
      const choices = cleanChoices(a.choices);
      const session = String(s.id);
      const gen = generation;
      await ensureServer();
      // Everything below is synchronous with the insertion, so two simultaneous shows cannot both pass the limits.
      if (gen !== generation) { if (!pages.size) stopServer(); throw userError('msg.html.locked'); }
      alive(true);
      if (!sessions.get(session)) { if (!pages.size) stopServer(); throw userError('msg.html.noChat'); }
      const t = now();
      const recent = (shows.get(session) ?? []).filter((x) => t - x < 60_000);
      if (recent.length >= SHOWS_PER_MINUTE) { shows.set(session, recent); if (!pages.size) stopServer(); throw userError('msg.html.rate', { n: SHOWS_PER_MINUTE }); }
      const mine = [...pages.values()].filter((p) => p.session === session);
      const dropping = Math.max(0, mine.length - PER_SESSION + 1);
      // the global cap never evicts another chat's pages: the new one is refused
      if (pages.size - dropping >= MAX_PAGES) { if (!pages.size) stopServer(); throw userError('msg.html.tooMany', { n: MAX_PAGES }); }
      recent.push(t); shows.set(session, recent);
      for (const old of mine.slice(0, dropping)) { gone(old, 'límite del chat'); note(session, 'msg.html.dropped', { title: old.title, n: PER_SESSION }); }
      // always a new page with the internet switch off, whatever the chat's other pages have
      const p = { id: randomBytes(16).toString('hex'), session, title, html: a.html, choices, internet: false, createdAt: Date.now() };
      pages.set(p.id, p);
      const v = view(p);
      log(`html: página ${p.id.slice(0, 6)} · chat ${session}`);
      note(session, 'msg.html.shown', { title });
      emit('html:page', v);
      return { ...v, text: tr('msg.html.agentText') };
    },
    // The text of one of the page's own buttons. Only the index travels: the text is the one the agent registered for that page,
    // so a button can never carry anything else, and the caller sends it without what the words «ask for».
    choiceText(ref, index) {
      const p = find(ref);
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= (p.choices ?? []).length) throw userError('msg.html.badChoice');
      return p.choices[i];
    },
    list: () => { alive(); return [...pages.values()].map(view); },
    // Only the user's window calls this (htmlPages.setInternet is 'pc'). Changes THIS page only.
    setInternet(ref, on) {
      if (typeof on !== 'boolean') throw userError('msg.html.badSwitch');
      const p = find(ref);
      p.internet = on;
      log(`html: internet ${on ? 'activado' : 'apagado'} · página ${p.id.slice(0, 6)}`);
      const v = view(p);
      emit('html:update', v);
      return v;
    },
    // For the phone: the page as DATA (its HTML, its title, its internet switch and the exact CSP the PC serves it with).
    // It is never run here; the phone must render it in a sandboxed frame under that policy. The id is a 128-bit secret
    // of this run and the chat must match, exactly as for the PC's methods.
    get(ref) { const p = find(ref); return { ...view(p), html: p.html, csp: pageCsp(p.internet) }; },
    close(ref) { const p = find(ref); gone(p, 'usuario'); if (!pages.size) stopServer(); return true; },
    dropSession,
    // Orb locked or shutting down: nothing is kept and nothing is served.
    wipe() { generation++; shows.clear(); for (const p of [...pages.values()]) gone(p, 'bloqueo'); stopServer(); },
    address: () => (server ? server.address() : null)
  };
}
