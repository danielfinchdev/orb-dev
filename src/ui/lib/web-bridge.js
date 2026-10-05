// When the interface runs in a phone's browser (phone access through Tailscale) there is no Electron bridge: this one
// talks to the PC over HTTP (/api/call) and receives live events (/api/events). It must be imported before anything else.
// Not imported statically: i18n.js needs the store, which reads window.orb when it loads (and this file defines it).
const tl = async (key, vars) => (await import('./i18n.js')).t(key, vars);
if (!window.orb) {
  const listeners = new Map();
  const fire = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload); } catch (e) { console.error(e); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload); } catch (e) { console.error(e); } }
  };
  // The device's key: kept by this page only (this exact address and port) and sent as a header, never as a cookie.
  const KEY = 'orb.dispositivo';
  const token = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } } };
  const auth = () => (token.get() ? { Authorization: `Bearer ${token.get()}` } : {});
  const unpaired = () => { token.set(null); window.dispatchEvent(new Event('orb:unpaired')); };
  const post = async (url, body, headers = {}) => {
    const res = await fetch(url, { method: 'POST', credentials: 'omit', headers: { 'X-Orb': '1', ...auth(), ...headers }, body });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { unpaired(); throw new Error(data.error ?? await tl('app.notLinked')); }
    if (!res.ok) throw new Error(data.error ?? await tl('app.httpError', { n: res.status }));
    return data;
  };
  // Live events over a streamed fetch (EventSource cannot send the key); reconnects with a growing pause.
  let stream = null;
  const connect = async (wait = 1000) => {
    stream?.abort(); const ctrl = new AbortController(); stream = ctrl;
    try {
      const res = await fetch('/api/events', { headers: auth(), credentials: 'omit', signal: ctrl.signal });
      if (res.status === 401) return unpaired();
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      wait = 1000;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data) { try { const { event, payload } = JSON.parse(data); fire(event, payload); } catch { /* ignore */ } }
        }
      }
    } catch { if (ctrl.signal.aborted) return; }
    if (stream === ctrl) setTimeout(() => { if (stream === ctrl) connect(Math.min(wait * 2, 30_000)); }, wait);
  };
  // Pictures chosen on the phone are uploaded first; the PC only accepts these uploaded files as attachments.
  const pickImages = () => new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
    input.onchange = async () => {
      const out = [];
      for (const file of [...input.files].slice(0, 10)) {
        try { out.push((await post('/api/upload', file, { 'Content-Type': 'application/octet-stream' })).path); } catch (e) { console.error(e); }
      }
      resolve(out);
    };
    input.click();
  });
  window.orb = {
    mobile: true,
    async call(method, params) { const r = await post('/api/call', JSON.stringify({ method, params: params ?? {} }), { 'Content-Type': 'application/json' }); if (!r.ok) throw new Error(r.error); return r.result; },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    async info() {
      const code = new URLSearchParams(location.hash.slice(1)).get('vincular');
      if (code) {
        history.replaceState(null, '', location.pathname); // the one-time code leaves the address bar at once
        const r = await post('/api/pair', JSON.stringify({ token: code, name: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : await tl('app.browser') }), { 'Content-Type': 'application/json' });
        token.set(r.token);
      }
      if (!token.get()) return { mobile: true, needsPairing: true, needsSetup: false };
      const me = await fetch('/api/me', { headers: auth(), credentials: 'omit' });
      if (me.status === 401) { token.set(null); return { mobile: true, needsPairing: true, needsSetup: false }; }
      connect();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
      return { mobile: true, needsSetup: false, platform: 'web' };
    },
    setup: async () => { throw new Error(await tl('app.pcOnly')); },
    switchHome: async () => { throw new Error(await tl('app.pcOnly')); },
    pickFolder: async () => null,
    pickImages,
    openPath: async () => { throw new Error(await tl('app.foldersPc')); },
    openExternal: async (url) => { if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener'); },
    pathForFile: () => null
  };
}
