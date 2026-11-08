// 3.8.1 (D2): a small Chrome DevTools Protocol client for the agents' browser, with Node's own WebSocket (no
// dependencies, no Playwright in the app). Under Tauri the agents' pages are hidden WebView2 windows of a browser
// environment of their own, with a local DevTools port; the engine drives them from here (src/engine/browser-cdp.mjs).
// One connection to the browser and one flat session per page (Target.attachToTarget with flatten).
// Node's WebSocket sends no Origin header: Chromium lets such a client in without --remote-allow-origins, while a web
// page (which always sends its Origin) is refused. So the browser is started without that switch.
import fs from 'node:fs';
import path from 'node:path';

// The port and the browser's endpoint a Chromium started with --remote-debugging-port=0 writes in its data folder.
export function readDevToolsActivePort(dataDir) {
  let text; try { text = fs.readFileSync(path.join(dataDir, 'DevToolsActivePort'), 'utf8'); } catch { return null; }
  const [port, browserPath] = text.split(/\r?\n/);
  if (!/^\d{2,5}$/.test(port ?? '') || !/^\/devtools\/browser\/[\w-]+$/.test(browserPath ?? '')) return null;
  return { port: Number(port), ws: `ws://127.0.0.1:${port}${browserPath}` };
}

// Connects to a browser endpoint (ws://127.0.0.1:<port>/devtools/browser/<id>). Only this PC's loopback is accepted.
//   send(method, params, sessionId) → result (throws the protocol's error)
//   on(method, fn, sessionId) → off()      events of the browser (sessionId null) or of one page's session
//   close(); closed: a promise that settles when the connection ends
export function connectCdp(wsUrl, { timeoutMs = 10_000, callMs = 30_000 } = {}) {
  let u; try { u = new URL(wsUrl); } catch { return Promise.reject(new Error('CDP: dirección no válida')); }
  if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return Promise.reject(new Error('CDP: solo este equipo'));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let next = 0; let open = false;
    const pending = new Map(); const listeners = new Map();
    let endClosed; const closed = new Promise((r) => { endClosed = r; });
    const timer = setTimeout(() => { try { ws.close(); } catch { /* closing */ } reject(new Error('CDP: sin respuesta')); }, timeoutMs);
    const fail = (why) => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); } pending.clear(); };
    ws.addEventListener('open', () => {
      open = true; clearTimeout(timer);
      resolve({
        send(method, params = {}, sessionId = null) {
          if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP: conexión cerrada'));
          const id = ++next;
          return new Promise((res, rej) => {
            const t = setTimeout(() => { pending.delete(id); rej(new Error(`CDP: ${method} sin respuesta`)); }, callMs);
            t.unref?.();
            pending.set(id, { resolve: res, reject: rej, timer: t, method });
            ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
          });
        },
        on(method, fn, sessionId = null) {
          const k = `${sessionId ?? ''}|${method}`;
          if (!listeners.has(k)) listeners.set(k, new Set());
          listeners.get(k).add(fn);
          return () => listeners.get(k)?.delete(fn);
        },
        close() { try { ws.close(); } catch { /* closed */ } },
        closed
      });
    });
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')); } catch { return; }
      if (m.id != null) {
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message ?? 'error'}`)); else p.resolve(m.result ?? {});
        return;
      }
      for (const fn of listeners.get(`${m.sessionId ?? ''}|${m.method}`) ?? []) { try { fn(m.params ?? {}, m.sessionId ?? null); } catch { /* a listener's problem */ } }
    });
    ws.addEventListener('error', () => { if (!open) { clearTimeout(timer); reject(new Error('CDP: no se pudo conectar')); } });
    ws.addEventListener('close', () => { clearTimeout(timer); fail('CDP: conexión cerrada'); endClosed(); if (!open) reject(new Error('CDP: conexión rechazada')); });
  });
}
