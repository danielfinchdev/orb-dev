// When the interface runs in a phone's browser there is no Electron bridge: this one talks to the PC over HTTP
// (/api/call, live events on /api/events), every message encrypted end to end (src/core/mobile-crypto.mjs). It must be
// imported before anything else. Not imported statically: i18n.js needs the store, which reads window.orb when it loads
// (and this file defines it); the encryption code is loaded only on the phone.
import * as L from './link-payload.js'; // tiny and pure: what a QR or a typed code says (also the Android app's)
const tl = async (key, vars) => (await import('./i18n.js')).t(key, vars);
const crypto$ = () => import('../../core/mobile-crypto.mjs');
// 3.5: the Android app (src/ui/lib/app-bridge.js, loaded first) gives this bridge its own host: where the Orb is (the
// page is not served by it), a key store backed by the Android Keystore, and the app's extras. In a browser, this page.
const host = window.__orbHost ?? null;
if (!window.orb) {
  const listeners = new Map();
  const fire = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload); } catch (e) { console.error(e); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload); } catch (e) { console.error(e); } }
  };
  // This phone's pairing with the PC: its id, its own private key and the PC's public key. Kept by this page only (this
  // exact address and port), never sent anywhere: the PC only ever sees the public half.
  const KEY = 'orb.movil';
  const store = host?.store ?? {
    get: async () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
    set: async (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); localStorage.removeItem('orb.dispositivo'); } catch { /* storage unavailable */ } }
  };
  let saved; // what the store holds, read once
  const record = async () => { if (saved === undefined) saved = await store.get(); return saved; };
  const keep = async (v) => { saved = v; await store.set(v); };
  let session = null; // { id, key }
  const ready = async () => {
    if (session) return session;
    const s = await record(); if (!s) return null;
    const C = await crypto$();
    session = { id: s.id, key: C.sessionKey(C.b64.dec(s.priv), C.b64.dec(s.pc)) };
    return session;
  };
  const unpaired = () => { keep(null); session = null; window.dispatchEvent(new Event('orb:unpaired')); };
  // Where the Orb answers: this page's own server in a browser; in the app, the linked Orb's addresses (urls), the one
  // that answered last first. A network error moves to the next one.
  const at = (p) => (host ? `${saved?.urls?.[saved.at ?? 0] ?? ''}${p}` : p);
  const reach = async (p, init) => {
    const n = host ? Math.max(1, saved?.urls?.length ?? 1) : 1;
    for (let i = 0; ; i++) {
      try { return await fetch(at(p), init); }
      catch (e) { if (i + 1 >= n || init?.signal?.aborted) throw e; saved.at = ((saved.at ?? 0) + 1) % n; store.set(saved); }
    }
  };
  const headersOf = (s) => ({ 'X-Orb-Device': s.id });
  // The PC refuses requests stamped too far from its own time (they could be replays). A phone whose clock is off gets
  // the PC's time in that answer (409) and stamps its requests with it from then on.
  let skew = 0;
  const stamp = () => Date.now() + skew;
  const clockFixed = async (res) => {
    if (res.status !== 409) return false;
    const d = await res.clone().json().catch(() => ({}));
    if (!Number.isFinite(d.now)) return false;
    skew = d.now - Date.now();
    return true;
  };

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
  const post = async (url, kind, body, retry = true) => {
    const s = await ready(); if (!s) { unpaired(); throw new Error(await tl('app.notLinked')); }
    const C = await crypto$();
    const box = C.seal(s.key, { t: stamp(), m: kind, b: body }, C.AAD.request(s.id));
    const res = await reach(url, { method: 'POST', credentials: 'omit', headers: { ...headersOf(s), 'Content-Type': 'application/json' }, body: JSON.stringify(box) });
    if (retry && await clockFixed(res)) return post(url, kind, body, false);
    return answer(res, s, box.n);
  };
  // The envelope of a request whose body is not JSON (live events, pictures): in a header.
  const authHeader = async (s, kind) => { const C = await crypto$(); return C.sealText(s.key, { t: stamp(), m: kind }, C.AAD.request(s.id)); };

  // Live events over a streamed fetch (EventSource cannot send headers); reconnects with a growing pause.
  let stream = null;
  const connect = async (wait = 1000) => {
    stream?.abort(); const ctrl = new AbortController(); stream = ctrl;
    try {
      const s = await ready(); if (!s) return;
      const C = await crypto$();
      const res = await reach('/api/events', { headers: { ...headersOf(s), 'X-Orb-Auth': await authHeader(s, 'events') }, credentials: 'omit', signal: ctrl.signal });
      if (res.status === 401) return unpaired();
      if (await clockFixed(res)) wait = 100; // again at once, with the PC's time
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
  const uploadOne = async (file, retry = true) => {
    const s = await ready(); if (!s) throw new Error(await tl('app.notLinked'));
    const C = await crypto$();
    const auth = await authHeader(s, 'upload');
    const body = C.sealBytes(s.key, new Uint8Array(await file.arrayBuffer()), C.AAD.upload(s.id));
    const res = await reach('/api/upload', { method: 'POST', credentials: 'omit', headers: { ...headersOf(s), 'X-Orb-Auth': auth, 'Content-Type': 'application/octet-stream' }, body });
    if (retry && await clockFixed(res)) return uploadOne(file, false);
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

  // Pairing from the QR: #vincular=<one-time code>&pc=<the PC's public key> (or what the app scanned or was typed in,
  // src/ui/lib/link-payload.js). The code never travels: the phone proves it read it by sealing its own public key with
  // a key derived from it. 3.8: the link waits for the PC's master password (main.jsx asks for it: pairPending), and a
  // page that came in plain http over the Wi-Fi never asks for it (insecure).
  let pending = null;
  const pairFromHash = async () => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('vincular')) return;
    history.replaceState(null, '', location.pathname);
    if (!h.get('pc')) throw new Error(await tl('app.oldQr'));
    pending = { urls: [''], code: h.get('vincular'), pc: h.get('pc'), via: 'qr', name: h.get('n') }; // in a browser: this page's own server
  };
  // What the PC's screen should show (its key's fingerprint), worked out here (never taken from the other side's word).
  const fingerprintOf = async (pc) => { const C = await crypto$(); try { const k = C.b64.dec(pc); return k.length === 32 ? C.fingerprint(k) : null; } catch { return null; } };
  // A link ready to ask for the password: the short code does not carry the Orb's key, the Orb gives it (GET /api/hello,
  // while its code is on screen). → the link with pc and fp (the person compares fp with the PC's screen before typing).
  const resolveLink = async (link) => {
    let p = link;
    if (!p.pc) {
      const r = await fetch(`${p.urls[0]}/api/hello`, { credentials: 'omit' }).catch(() => null);
      if (!r) throw new Error(await tl('app.linkOffline'));
      const d = await r.json().catch(() => ({}));
      if (!r.ok || typeof d?.pc !== 'string') throw new Error(await tl('app.linkNoShortCode'));
      // 3.5.1: only an Orb that ties the code to its own key (an older one, or an answer changed on the way: the QR).
      if (!(Number(d.short) >= 3)) throw new Error(await tl('app.linkOldOrb'));
      p = { ...p, pc: d.pc };
      if (Array.isArray(d.urls)) p = { ...p, urls: [p.urls[0], ...L.orderBases(d.urls).filter((u) => u !== p.urls[0])] };
    }
    const fp = await fingerprintOf(p.pc);
    if (!fp) throw new Error(await tl('app.oldQr'));
    return { ...p, fp };
  };
  // password: the PC's master password. It never leaves this page: the PC's verifier and the exchange of
  // src/core/mobile-crypto.mjs › linkDevice prove it is known. A refusal says why (reason: 'password' wrong, the code
  // still good; 'newCode' too many, 'wait'; status 426: update).
  const pairWith = async (link, { password = '' } = {}) => {
    const C = await crypto$();
    const p = await resolveLink(link);
    const pcPub = C.b64.dec(p.pc);
    const name = (await host?.deviceName?.()) ?? (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : await tl('app.browser'));
    const secret = p.via === 'code' ? await C.shortSecretAsync(L.normalCode(p.code), p.pc) : L.pairingSecret(p);
    const via = p.via === 'code' ? 'code3' : p.via;
    // 3.5 (Magic Link): it also says what it is (a phone or a computer's browser), for the list of linked devices.
    const kind = host || /iPhone|iPad|Android|Mobile/.test(navigator.userAgent) ? 'phone' : 'browser';
    let last = null;
    for (const base of p.urls) {
      let r;
      try { r = await C.linkDevice({ base, pcPub, secret, via, name, kind, v: L.PROTOCOL, min: L.MIN_PROTOCOL, password: String(password ?? ''), now: stamp }); }
      catch (e) {
        if (e.code === 'offline') { last = new Error(await tl('app.linkOffline')); continue; } // not reachable this way: the next address
        if (e.code === 'badAnswer') throw new Error(await tl('app.badAnswer'));
        throw e; // the PC's own words (status, reason)
      }
      skew += r.skew;
      await keep({ id: r.id, priv: C.b64.enc(r.priv), pc: p.pc, fp: r.pc, ...(host ? { urls: [base, ...p.urls.filter((u) => u !== base)], at: 0, name: r.info?.name ?? p.name ?? null } : {}) });
      session = { id: r.id, key: r.key };
      return true;
    }
    throw last ?? new Error(await tl('app.linkOffline'));
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
    protocol: L.PROTOCOL,
    // 3.6: what the Orb said on /api/me (its versions).
    me: () => me,
    push,
    async call(method, params) {
      const r = await post('/api/call', 'call', { method, params: params ?? {} });
      if (!r.ok) throw Object.assign(new Error(r.error), r.reason ? { reason: r.reason } : {});
      return r.result;
    },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    async info() {
      let pairError = null;
      try { await pairFromHash(); } catch (e) { pairError = e.message; }
      // A new QR opened on a page already linked links it again (after the password), as before 3.8.
      // 3.8: insecure: this page came in plain http over the Wi-Fi, so it never asks for the master password.
      if (!await record() || pending) {
        const pairLink = pending ? { name: pending.name ?? null, fp: await fingerprintOf(pending.pc), insecure: !L.passwordPageOk(location, { app: Boolean(host) }) } : null;
        return { mobile: true, needsPairing: true, needsSetup: false, pairError, app: Boolean(host), pairLink };
      }
      // 3.6: the page says its protocol; an Orb that needs a newer one answers 426 (or a min above ours): update first.
      let r = null;
      try { r = await post('/api/me', 'me', { v: L.PROTOCOL }); me = r.ok ? r.result : null; }
      catch { if (!await record()) return { mobile: true, needsPairing: true, needsSetup: false, pairError, app: Boolean(host) }; }
      const gap = r && !r.ok && (r.status === 426 || r.update) ? { has: L.PROTOCOL, need: L.PROTOCOL + 1 } : L.updateNeeded(me);
      if (gap) return { mobile: true, needsSetup: false, needsUpdate: { message: (r && !r.ok && r.error) || await tl('app.updateNeeded'), ...gap, ...(host ? { app: true } : {}) }, app: Boolean(host) };
      connect();
      if (!host && window.isSecureContext && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
        // 3.6 (M4): a notification tapped while this page is open: the service worker says which chat (lib/notes.js).
        navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.orbOpen) window.dispatchEvent(new CustomEvent('orb:open-note', { detail: e.data.orbOpen })); });
      }
      return { mobile: true, needsSetup: false, platform: host ? 'android' : 'web', pc: me?.pc ?? saved?.fp ?? null };
    },
    // 3.8: the link read from the QR (a browser), with the master password typed on this page.
    async pairPending(password) {
      if (!pending) throw new Error(await tl('app.linkBadQr'));
      if (!L.passwordPageOk(location, { app: Boolean(host) })) throw new Error(await tl('app.linkHttp'));
      try { await pairWith(pending, { password }); pending = null; return true; }
      catch (e) { if (e.reason === 'newCode' || e.status === 426) pending = null; throw e; }
    },
    setup: async () => { throw new Error(await tl('app.pcOnly')); },
    switchHome: async () => { throw new Error(await tl('app.pcOnly')); },
    pickFolder: async () => null,
    pickImages,
    openPath: async () => { throw new Error(await tl('app.foldersPc')); },
    openExternal: async (url) => { if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener'); },
    pathForFile: () => null
  };
  // The app's extras (scan the QR, dictate, share, notifications): they need the bridge's own pieces.
  host?.extend?.(window.orb, { tl, fire, pairWith, resolveLink, uploadOne, unpaired, record });
}
