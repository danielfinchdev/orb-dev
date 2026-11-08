// 3.5: the Android app («Orb»; 3.8.1: Tauri's Android app, src-tauri/gen/android). The same interface; this file gives
// web-bridge.js what is different there: the page is the app's own (not served by the Orb), so it says where the linked
// Orb is, keeps this phone's keys in the Android Keystore, and adds the phone's extras: scan the QR with the camera,
// dictate, «Share with Orb» from other apps, Android's back button and notifications. They live in the app's Kotlin
// plugin «orb-native» (OrbNativePlugin.kt). Does nothing outside the app (the desktop or a phone's browser). Must be
// imported before web-bridge.js.
import { invoke, addPluginListener } from '@tauri-apps/api/core';
import * as L from './link-payload.js';
import * as N from '../../core/notes.mjs';

// Only the Android build (vite --mode android) inside Tauri: the desktop app is Tauri too, with its own bridge.
const native = import.meta.env.MODE === 'android' && Boolean(window.__TAURI_INTERNALS__);
if (L.pickBridge({ hasOrb: Boolean(window.orb), native }) === 'app') {
  const tl = (key, vars) => parts.tl(key, vars); // web-bridge.js's (the texts load with the interface)
  const nat = (command, args = {}) => invoke(`plugin:orb-native|${command}`, args);
  const listen = (event, fn) => addPluginListener('orb-native', event, fn);
  // What a refusal of the plugin says (Kotlin's invoke.reject(message, code)): a string or { message, code }.
  const said = (e) => (typeof e === 'string' ? e : `${e?.code ?? ''} ${e?.message ?? ''}`);
  const KEY = 'orb.movil';
  const NOTIFY = 'orb.avisos';

  // Shared from another app (text or pictures): waits here until the chat takes it (lib/app-bridge.js › takeShared).
  let shared = null;
  let parts = null; // the bridge's own pieces (web-bridge.js › extend)
  const receive = async (s) => {
    if (!s || (!s.text && !s.files?.length)) return;
    const lines = [s.text?.trim()].filter(Boolean);
    for (const f of (s.files ?? []).slice(0, 10)) {
      try {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        const path = await parts.uploadOne(new Blob([bytes], { type: f.type || 'image/jpeg' }));
        lines.push(await tl('app.sharedImage', { path }));
      } catch (e) { console.error(e); }
    }
    if (!lines.length) return;
    shared = [shared, lines.join('\n')].filter(Boolean).join('\n');
    window.dispatchEvent(new Event('orb:shared'));
  };

  window.__orbHost = {
    app: true,
    // The phone's keys and the Orb's addresses: encrypted with a key of the Android Keystore that never leaves the phone
    // (the same key and file as Orb 3.8.0's app: updating keeps the link).
    store: {
      // The Keystore busy for a moment (review Android B1): tried again; never taken for «not linked» on the first error.
      get: async () => {
        for (let i = 0; ; i++) {
          try { const r = await nat('secure_get', { key: KEY }); return r?.value ? JSON.parse(r.value) : null; }
          catch (e) { if (!said(e).includes('busy') || i >= 4) return null; await new Promise((r) => setTimeout(r, 400)); }
        }
      },
      set: async (v) => { try { if (v) await nat('secure_set', { key: KEY, value: JSON.stringify(v) }); else await nat('secure_remove', { key: KEY }); } catch (e) { console.error(e); } }
    },
    deviceName: async () => { try { const r = await nat('info'); return r?.model ? `${r.model} (app)` : 'Android'; } catch { return 'Android'; } },
    extend(orb, pieces) {
      parts = pieces;
      // Read the QR with the camera (Google's scanner: no camera permission for the app, nothing kept). Closed without
      // reading (back, «cancel»): nothing to say.
      orb.scanLink = async () => {
        try { const r = await nat('scan_qr'); return r?.value ?? null; }
        catch (e) { if (said(e).includes('preparing')) throw new Error(await tl('app.scanPreparing')); throw new Error(said(e).trim()); }
      };
      // Link with what was scanned or typed: the QR's text, a pasted link, or the short code and the address. 3.8: read
      // first (checkLink: { name, fp, short }; a typed short code asks the Orb for its key now, and the person compares its
      // fingerprint with the PC's screen before the password), then linked with the PC's master password ({ password })
      // and the very key that was shown.
      const parse = async (input) => { try { return typeof input === 'string' ? L.parseLinkPayload(input) : L.parseManual(input); } catch (e) { throw new Error(await tl(e.key ?? 'app.linkBadQr')); } };
      let checked = null; // { input, link }
      orb.checkLink = async (input) => {
        const link = await pieces.resolveLink(await parse(input));
        checked = { input, link };
        return { name: link.name ?? null, fp: link.fp, short: link.via === 'code' };
      };
      orb.link = async (input, { password = '' } = {}) => {
        const link = checked?.input === input ? checked.link : await pieces.resolveLink(await parse(input));
        await pieces.pairWith(link, { password });
        checked = null;
        return true;
      };
      orb.unlink = async () => { pieces.unpaired(); return true; };
      // 3.8: Android's back button or gesture (Tauri's app plugin hands it over: main.jsx goes back inside the app) and,
      // on the first screen, the app goes to the background instead of closing.
      orb.onBack = (fn) => {
        let handle = null; let gone = false;
        addPluginListener('app', 'back-button', () => fn()).then((h) => { if (gone) h?.unregister?.(); else handle = h; }).catch(() => {});
        return () => { gone = true; handle?.unregister?.(); };
      };
      orb.minimize = async () => { try { await nat('minimize'); } catch { /* stays */ } };
      // A link out of Orb opens in the phone's browser (review Android A2): the app's WebView only ever shows Orb's page
      // (src-tauri/src/mobile.rs › on_navigation), so window.open would do nothing.
      orb.openExternal = async (url) => { if (/^https:\/\//.test(String(url ?? ''))) await nat('open_url', { url: String(url) }).catch(console.error); };
      // Dictation with Android's own speech recognition (its own window; the WebView has no Web Speech API).
      orb.dictate = async (lang) => {
        try { const r = await nat('dictate', { lang: lang === 'en' ? 'en' : 'es' }); return r?.text ?? ''; }
        catch (e) { if (said(e).includes('unavailable')) throw new Error(await tl('app.dictateUnavailable')); throw new Error(said(e).trim()); }
      };
      orb.takeShared = () => { const s = shared; shared = null; return s; };
      orb.hasShared = () => shared != null;
      // 3.6 (messaging, M4): the chats' notifications as a messaging app's. The Orb builds each one
      // (src/core/notes.mjs: the sender's picture, the chat's name, the text as chosen for the lock screen, muted chats
      // none) and sends it as «note» over the live connection; shown while the app is in the background (there is no
      // push service: they arrive while Android keeps the app alive). One per chat: new lines join it. 3.8.1: «Responder»
      // (with the text typed there), «Aprobar» and «Rechazar» are answered by the app itself without opening it, also
      // after it was closed (Notes.kt › NoteReceiver, with the call worked out here: notes.mjs › backgroundCall); the
      // other buttons and a tap open the app, which does it here.
      const threads = new Map(); // chat key → { lines, count }
      const slim = (n) => ({ key: n.key, route: n.route, kind: n.kind, card: n.card ?? null, actions: (n.actions ?? []).map(({ id, open, input }) => ({ id, ...(open ? { open: true } : {}), ...(input ? { input: true } : {}) })) });
      const openNote = (detail) => window.dispatchEvent(new CustomEvent('orb:open-note', { detail }));
      const noteOf = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
      // A notification (or a button of it) that opened the app: { action ('tap' or the button), note (slim, as JSON) }.
      const opened = async ({ action, note: raw } = {}) => {
        const note = noteOf(raw);
        if (!note?.route) return;
        threads.delete(note.key);
        if (action === 'tap') return openNote({ route: note.route });
        const r = N.actionRoute(note, action, {});
        if (r.call) {
          try {
            await orb.call(...r.call);
            parts.fire('notice', { body: await tl(action === 'allow' ? 'notes.allowed' : action === 'deny' ? 'notes.denied' : 'notes.sent'), tone: 'success' });
          } catch (e) {
            parts.fire('notice', { body: await tl('notes.failed', { error: e?.message ?? String(e) }), tone: 'error' });
          }
          return openNote({ route: note.route });
        }
        return openNote({ route: r.open ?? note.route, approve: r.approve ?? null });
      };
      const take = (r) => { if (r?.action) pieces.record().then((linked) => (linked ? opened(r) : null)).catch(console.error); };
      listen('note', take).catch(() => {});
      listen('noteDone', ({ note } = {}) => { const n = noteOf(note); if (n?.key) threads.delete(n.key); }).catch(() => {});
      nat('take_note_action').then(take).catch(() => {});
      // The texts the app shows by itself after a button (in the Orb's language).
      const words = async () => {
        const [sending, sent, allowed, denied, failed, locked, offline, timeout, notLinked, badAnswer] = await Promise.all([
          tl('notes.sending'), tl('notes.sent'), tl('notes.allowed'), tl('notes.denied'), tl('notes.failed', { error: '{error}' }), tl('notes.locked'),
          tl('app.pcOffline'), tl('app.pcSlow'), tl('app.notLinked'), tl('app.badAnswer')
        ]);
        return { sending, sent, allowed, denied, failed, locked, err_offline: offline, err_timeout: timeout, err_notLinked: notLinked, err_badAnswer: badAnswer };
      };
      orb.on('note', async (n) => {
        if (document.visibilityState === 'visible' || localStorage.getItem(NOTIFY) !== '1' || !n?.key) return;
        const c = N.collapse(threads.get(n.key), n);
        threads.set(n.key, { lines: c.lines, count: c.count });
        const many = c.count > 1 && !n.hidden;
        const actions = (n.actions ?? []).map((a) => { const call = N.backgroundCall(n, a.id); return { id: a.id, title: a.title, ...(a.input ? { input: true } : {}), ...(call ? { call } : {}) }; });
        nat('notify', {
          id: n.id, title: c.count > 1 ? `${n.title} (${c.count})` : n.title, body: n.hidden ? n.body : c.lines[c.lines.length - 1], largeBody: c.body,
          ...(many ? { lines: c.lines, summary: await tl('notes.count', { n: c.count }) } : {}),
          group: `orb-${n.key}`, largeIcon: n.largeIcon || '', silent: Boolean(n.silent), note: JSON.stringify(slim(n)), actions, words: await words()
        }).catch(() => {});
      });
      // Back in the app: the chats' notifications go (the app shows the chats themselves).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        threads.clear();
        nat('notify_clear').catch(() => {});
      });
      orb.push = {
        supported: () => true,
        installed: () => true,
        ios: () => false,
        whenClosed: () => false, // no push service: only while Android keeps the app alive in the background
        enabled: () => localStorage.getItem(NOTIFY) === '1',
        // Never answered here (a new install, or updated from 3.8.0, whose choice stayed with its old origin).
        undecided: () => localStorage.getItem(NOTIFY) === null,
        // Turned on without asking when Android already allows Orb's notifications (the person allowed them in 3.8.0).
        async adopt() {
          const r = await nat('notify_permission', { ask: false }).catch(() => null);
          if (!r?.granted) return false;
          localStorage.setItem(NOTIFY, '1');
          return true;
        },
        decline() { localStorage.setItem(NOTIFY, '0'); },
        async enable() {
          const r = await nat('notify_permission').catch(() => null);
          if (!r?.granted) throw new Error(await tl('app.pushDeniedApp'));
          localStorage.setItem(NOTIFY, '1');
          return true;
        },
        async disable() { localStorage.setItem(NOTIFY, '0'); return false; }
      };
      // What another app shared: on start and each time the app is opened with something new.
      listen('shared', (s) => receive(s).catch(console.error)).catch(() => {});
      nat('take_shared').then((first) => {
        if (first?.text || first?.files?.length) pieces.record().then((r) => (r ? receive(first) : null)).catch(console.error);
      }).catch(() => {});
    }
  };
}
