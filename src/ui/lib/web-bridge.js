// When the interface runs in a phone's browser there is no Electron bridge: this one talks to the PC over HTTP
// (/api/call, live events on /api/events), every message encrypted end to end (src/core/mobile-crypto.mjs). It must be
// imported before anything else. Not imported statically: i18n.js needs the store, which reads window.orb when it loads
// (and this file defines it); the encryption code is loaded only on the phone.
const tl = async (key, vars) => (await import('./i18n.js')).t(key, vars);
const crypto$ = () => import('../../core/mobile-crypto.mjs');
if (!window.orb) {
  const listeners = new Map();
  const fire = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload); } catch (e) { console.error(e); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload); } catch (e) { console.error(e); } }
  };
  // This phone's pairing with the PC: its id, its own private key and the PC's public key. Kept by this page only (this
  // exact address and port), never sent anywhere: the PC only ever sees the public half.
  const KEY = 'orb.movil';
  const store = {
    get: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
    set: (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); localStorage.removeItem('orb.dispositivo'); } catch { /* storage unavailable */ } }
  };
  let session = null; // { id, key }
  const ready = async () => {
    if (session) return session;
    const s = store.get(); if (!s) return null;
    const C = await crypto$();
    session = { id: s.id, key: C.sessionKey(C.b64.dec(s.priv), C.b64.dec(s.pc)) };
    return session;
  };
  const unpaired = () => { store.set(null); session = null; window.dispatchEvent(new Event('orb:unpaired')); };
  const headersOf = (s) => ({ 'X-Orb-Device': s.id });

  // The answer to a sealed request: it must open with this phone's key and echo the request's nonce.
  const answer = async (res, s, nonce) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { unpaired(); throw new Error(data.error ?? await tl('app.notLinked')); }
    if (!res.ok) throw new Error(data.error ?? await tl('app.httpError', { n: res.status }));
    const C = await crypto$();
    let msg; try { msg = C.open(s.key, data, C.AAD.response(s.id)); } catch { throw new Error(await tl('app.badAnswer')); }
    if (msg.r !== nonce) throw new Error(await tl('app.badAnswer'));
    return msg;
  };
  const post = async (url, kind, body) => {
    const s = await ready(); if (!s) { unpaired(); throw new Error(await tl('app.notLinked')); }
    const C = await crypto$();
    const box = C.seal(s.key, { t: Date.now(), m: kind, b: body }, C.AAD.request(s.id));
    const res = await fetch(url, { method: 'POST', credentials: 'omit', headers: { ...headersOf(s), 'Content-Type': 'application/json' }, body: JSON.stringify(box) });
    return answer(res, s, box.n);
  };
  // The envelope of a request whose body is not JSON (live events, pictures): in a header.
  const authHeader = async (s, kind) => { const C = await crypto$(); return C.sealText(s.key, { t: Date.now(), m: kind }, C.AAD.request(s.id)); };

  // Live events over a streamed fetch (EventSource cannot send headers); reconnects with a growing pause.
  let stream = null;
  const connect = async (wait = 1000) => {
    stream?.abort(); const ctrl = new AbortController(); stream = ctrl;
    try {
      const s = await ready(); if (!s) return;
      const C = await crypto$();
      const res = await fetch('/api/events', { headers: { ...headersOf(s), 'X-Orb-Auth': await authHeader(s, 'events') }, credentials: 'omit', signal: ctrl.signal });
      if (res.status === 401) return unpaired();
      if (!res.ok) throw new Error(res.status); // retried with the growing pause, not every second
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      wait = 1000;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (data) { try { const { e, p } = C.openText(s.key, data, C.AAD.event(s.id)); fire(e, p); } catch { /* not for us */ } }
        }
      }
    } catch { if (ctrl.signal.aborted) return; }
    if (stream === ctrl) setTimeout(() => { if (stream === ctrl) connect(Math.min(wait * 2, 30_000)); }, wait);
  };
  // Back from the background (phones pause pages): reconnect at once.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) connect(); });

  // Pictures chosen on the phone are encrypted and uploaded first; the PC only accepts these uploaded files as attachments.
  const uploadOne = async (file) => {
    const s = await ready(); if (!s) throw new Error(await tl('app.notLinked'));
    const C = await crypto$();
    const auth = await authHeader(s, 'upload');
    const body = C.sealBytes(s.key, new Uint8Array(await file.arrayBuffer()), C.AAD.upload(s.id));
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'omit', headers: { ...headersOf(s), 'X-Orb-Auth': auth, 'Content-Type': 'application/octet-stream' }, body });
    const msg = await answer(res, s, auth.split('.')[0]);
    if (!msg.ok) throw new Error(msg.error);
    return msg.result.path;
  };
  const pickImages = () => new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
    input.onchange = async () => {
      const out = [];
      for (const file of [...input.files].slice(0, 10)) { try { out.push(await uploadOne(file)); } catch (e) { console.error(e); } }
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });

  // Pairing from the QR: #vincular=<one-time code>&pc=<the PC's public key>. The code leaves the address bar at once and
  // never travels: the phone proves it read it by sealing its own public key with a key derived from it.
  const pairFromHash = async () => {
    const h = new URLSearchParams(location.hash.slice(1));
    const code = h.get('vincular'); const pc = h.get('pc');
    if (!code) return;
    history.replaceState(null, '', location.pathname);
    if (!pc) throw new Error(await tl('app.oldQr'));
    const C = await crypto$();
    let pcPub; try { pcPub = C.b64.dec(pc); } catch { pcPub = null; }
    if (pcPub?.length !== 32) throw new Error(await tl('app.oldQr'));
    const { priv, pub } = C.newKeyPair();
    const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : await tl('app.browser');
    const proof = C.seal(C.pairingKey(priv, pcPub, code), { pub: C.b64.enc(pub), name, t: Date.now() }, C.AAD.pair);
    const res = await fetch('/api/pair', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pub: C.b64.enc(pub), proof }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? await tl('app.httpError', { n: res.status }));
    // The PC answers with the new session key: if it opens, this is really the PC of the QR.
    const key = C.sessionKey(priv, pcPub);
    let ok; try { ok = C.open(key, data.box, C.AAD.paired(data.id)); } catch { ok = null; }
    if (!ok || ok.id !== data.id) throw new Error(await tl('app.badAnswer'));
    store.set({ id: data.id, priv: C.b64.enc(priv), pc, fp: ok.pc });
    session = { id: data.id, key };
  };

  // Notifications (https only: Tailscale with HTTPS). On an iPhone they work once the app is on the home screen.
  let me = null;
  const push = {
    supported: () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    installed: () => Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true),
    ios: () => /iPhone|iPad/.test(navigator.userAgent),
    enabled: () => Boolean(me?.push) && typeof Notification !== 'undefined' && Notification.permission === 'granted',
    async enable() {
      if (!push.supported()) throw new Error(await tl('app.pushNeedsHttps'));
      if (await Notification.requestPermission() !== 'granted') throw new Error(await tl('app.pushDenied'));
      const reg = await navigator.serviceWorker.ready;
      const C = await crypto$();
      const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: C.b64.dec(me.vapid) });
      const r = await post('/api/push', 'push', { subscription: sub.toJSON() });
      if (!r.ok) throw new Error(r.error);
      me = { ...me, push: true };
      return true;
    },
    async disable() {
      try { const reg = await navigator.serviceWorker.ready; await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch { /* none */ }
      await post('/api/push', 'push', { subscription: null });
      me = { ...me, push: false };
      return false;
    }
  };

  window.orb = {
    mobile: true,
    push,
    async call(method, params) { const r = await post('/api/call', 'call', { method, params: params ?? {} }); if (!r.ok) throw new Error(r.error); return r.result; },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    async info() {
      let pairError = null;
      try { await pairFromHash(); } catch (e) { pairError = e.message; }
      if (!store.get()) return { mobile: true, needsPairing: true, needsSetup: false, pairError };
      try { me = (await post('/api/me', 'me', null)).result; }
      catch { if (!store.get()) return { mobile: true, needsPairing: true, needsSetup: false, pairError }; }
      connect();
      if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
      return { mobile: true, needsSetup: false, platform: 'web', pc: me?.pc ?? store.get()?.fp ?? null };
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
