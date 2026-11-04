// 3.5: the Android app («Orb», android-app/). The same interface, packed with Capacitor; this file gives web-bridge.js
// what is different there: the page is the app's own (not served by the Orb), so it says where the linked Orb is, keeps
// this phone's keys in the Android Keystore, and adds the phone's extras: scan the QR with the camera, dictate, «Share with
// Orb» from other apps and notifications. Does nothing outside the app (Electron or a phone's browser). Must be imported
// before web-bridge.js. The plugins load only inside the app.
import * as L from './link-payload.js';
import { upcomingReminderNotes, REMINDER_IDS } from './reminder-notes.js';
import * as N from '../../core/notes.mjs';

const native = Boolean(window.Capacitor?.isNativePlatform?.());
if (L.pickBridge({ hasOrb: Boolean(window.orb), native }) === 'app') {
  const tl = (key, vars) => parts.tl(key, vars); // web-bridge.js's (the texts load with the interface)
  const core$ = () => import('@capacitor/core');
  let orbNative = null;
  const Native = async () => (orbNative ??= (await core$()).registerPlugin('OrbNative'));
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
    // The phone's keys and the Orb's addresses: encrypted with a key of the Android Keystore that never leaves the phone.
    store: {
      get: async () => { try { const r = await (await Native()).secureGet({ key: KEY }); return r?.value ? JSON.parse(r.value) : null; } catch { return null; } },
      set: async (v) => { try { const n = await Native(); if (v) await n.secureSet({ key: KEY, value: JSON.stringify(v) }); else await n.secureRemove({ key: KEY }); } catch (e) { console.error(e); } }
    },
    deviceName: async () => { try { const r = await (await Native()).info(); return r?.model ? `${r.model} (app)` : 'Android'; } catch { return 'Android'; } },
    extend(orb, pieces) {
      parts = pieces;
      // Read the QR with the camera (Google's scanner: no camera permission for the app, nothing kept).
      orb.scanLink = async () => {
        const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
        const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable().catch(() => ({ available: true }));
        if (!available) { await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => {}); throw new Error(await tl('app.scanPreparing')); }
        const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
        return barcodes?.[0]?.rawValue ?? null;
      };
      // Link with what was scanned or typed: the QR's text, a pasted link, or the short code and the address.
      orb.link = async (input) => {
        let p; try { p = typeof input === 'string' ? L.parseLinkPayload(input) : L.parseManual(input); } catch (e) { throw new Error(await tl(e.key ?? 'app.linkBadQr')); }
        await pieces.pairWith(p);
        return true;
      };
      orb.unlink = async () => { pieces.unpaired(); return true; };
      // Dictation with Android's own speech recognition (the WebView has no Web Speech API).
      orb.dictate = async (lang) => {
        const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
        const { available } = await SpeechRecognition.available();
        if (!available) throw new Error(await tl('app.dictateUnavailable'));
        const perm = await SpeechRecognition.requestPermissions();
        if (perm?.speechRecognition !== 'granted') throw new Error(await tl('app.dictateDenied'));
        const r = await SpeechRecognition.start({ language: lang === 'en' ? 'en-US' : 'es-ES', maxResults: 1, partialResults: false, popup: true });
        return r?.matches?.[0] ?? '';
      };
      orb.takeShared = () => { const s = shared; shared = null; return s; };
      orb.hasShared = () => shared != null;
      // 3.6 (messaging, M4): the chats' notifications as a messaging app's. The Orb builds each one for this person
      // (src/core/notes.mjs: the sender's picture, the chat's name, the text as chosen for the lock screen, muted chats
      // none) and sends it as «note» over the live connection; shown while the app is in the background (there is no
      // push service: they arrive while Android keeps the app alive). One per chat: new lines join it. «Responder» writes
      // back from the notification; «Aprobar» / «Rechazar» answer a card (one that needs the PIN opens the app for it).
      const threads = new Map(); // chat key → { lines, count }
      const LN = async () => (await import('@capacitor/local-notifications')).LocalNotifications;
      const slim = (n) => ({ key: n.key, route: n.route, kind: n.kind, card: n.card ?? null, actions: (n.actions ?? []).map(({ id, open }) => ({ id, ...(open ? { open: true } : {}) })) });
      const typeOf = (n) => (n.actions?.some((a) => a.id === 'reply') ? 'orb-msg' : n.actions?.some((a) => a.id === 'deny') ? 'orb-card' : n.actions?.some((a) => a.id === 'allow') ? 'orb-task' : undefined);
      const openNote = (detail) => window.dispatchEvent(new CustomEvent('orb:open-note', { detail }));
      (async () => {
        const L = await LN();
        const [reply, allow, deny] = await Promise.all([tl('msg.notes.reply'), tl('msg.notes.allow'), tl('msg.notes.deny')]);
        await L.registerActionTypes({ types: [
          { id: 'orb-msg', actions: [{ id: 'reply', title: reply, input: true, inputButtonTitle: reply }] },
          { id: 'orb-card', actions: [{ id: 'deny', title: deny }, { id: 'allow', title: allow }] },
          { id: 'orb-task', actions: [{ id: 'allow', title: allow }] }
        ] }).catch(() => {});
        // Android opens the app for every action (its intents are the app's own): the answer is sent, then the chat shows.
        L.addListener('localNotificationActionPerformed', async ({ actionId, inputValue, notification }) => {
          const note = notification?.extra?.note;
          if (!note?.route) return;
          threads.delete(note.key);
          const r = N.actionRoute(note, actionId, { text: inputValue });
          if (r.call) {
            try {
              await orb.call(...r.call);
              const done = actionId === 'reply' ? 'notes.sent' : actionId === 'allow' ? 'notes.allowed' : 'notes.denied';
              parts.fire('notice', { body: await tl(done), tone: 'success' });
            } catch (e) {
              // A card that needs the PIN after all: asked in the app.
              if (e?.reason === 'strong' && actionId === 'allow') return openNote({ route: note.route, approve: note.card });
              parts.fire('notice', { body: await tl('notes.failed', { error: e?.message ?? String(e) }), tone: 'error' });
            }
            return openNote({ route: note.route });
          }
          return openNote({ route: r.open ?? note.route, approve: r.approve ?? null });
        }).catch(() => {});
      })().catch(() => {});
      orb.on('note', async (n) => {
        if (document.visibilityState === 'visible' || localStorage.getItem(NOTIFY) !== '1' || !n?.key) return;
        const L = await LN();
        const c = N.collapse(threads.get(n.key), n);
        threads.set(n.key, { lines: c.lines, count: c.count });
        const many = c.count > 1 && !n.hidden;
        L.schedule({ notifications: [{
          id: n.id, title: c.count > 1 ? `${n.title} (${c.count})` : n.title, body: n.hidden ? n.body : c.lines[c.lines.length - 1], largeBody: c.body,
          ...(many ? { inboxList: c.lines, summaryText: await tl('notes.count', { n: c.count }) } : {}),
          group: `orb-${n.key}`, largeIcon: n.largeIcon || undefined, actionTypeId: typeOf(n), extra: { note: slim(n) }
        }] }).catch(() => {});
      });
      // Back in the app: the chats' notifications go (the app shows the chats themselves).
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible' || !threads.size) return;
        threads.clear();
        try {
          const L = await LN();
          const shown = (await L.getDeliveredNotifications())?.notifications ?? [];
          const ours = shown.filter((x) => x.id >= N.NOTE_IDS.first && x.id < N.NOTE_IDS.first + N.NOTE_IDS.size);
          if (ours.length) await L.removeDeliveredNotifications({ notifications: ours });
        } catch { /* nothing shown */ }
      });
      // 3.6: what this person chose for the lock screen (persons.prefs.get), else the Orb's setting (before 3.6).
      const previewOf = async () => {
        const mine = await orb.call('persons.prefs.get').catch(() => null);
        if (mine?.preview) return mine.preview;
        return (await orb.call('app.state').catch(() => null))?.config?.mobile?.preview ?? 'chat';
      };
      // 3.6: the app lock's fingerprint or face (Android's own prompt); the PIN stays the way in without it.
      orb.appLock = {
        available: async () => { try { return Boolean((await (await Native()).biometricAvailable())?.available); } catch { return false; } },
        verify: async (reason) => {
          try { return Boolean((await (await Native()).biometricVerify({ title: await tl('app.lockBiometricTitle'), subtitle: reason ? String(reason).slice(0, 120) : '', cancel: await tl('app.lockBiometricCancel') }))?.ok); }
          catch { return false; }
        }
      };
      // 3.6: the bots' reminders of the next 48 h, scheduled on the phone (they sound with the app closed or offline).
      // Only when notifications are on; read again when a bot or the board changes, or another person is linked.
      let remindTimer = null;
      const scheduleReminders = async () => {
        if (!(await pieces.record())) return;
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const pending = (await LocalNotifications.getPending().catch(() => null))?.notifications ?? [];
        const ours = pending.filter((x) => x.id >= REMINDER_IDS.first && x.id < REMINDER_IDS.first + REMINDER_IDS.size);
        if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((x) => ({ id: x.id })) }).catch(() => {});
        if (localStorage.getItem(NOTIFY) !== '1') return;
        const reminders = await orb.call('bots.reminders.list').catch(() => null);
        if (!Array.isArray(reminders)) return;
        const bots = await orb.call('bots.list').catch(() => null);
        const names = new Map((bots?.bots ?? []).map((b) => [b.id, b.name]));
        const notes = upcomingReminderNotes(reminders, Date.now(), {
          preview: await previewOf(),
          titleFor: (r) => names.get(r.bot_id) ?? '',
          hidden: { title: await tl('app.reminderTitle'), body: await tl('app.reminderHidden') }
        });
        if (notes.length) await LocalNotifications.schedule({ notifications: notes.map((x) => ({ id: x.id, title: x.title, body: x.body, group: x.group, schedule: { at: new Date(x.at), allowWhileIdle: true } })) }).catch(() => {});
      };
      const remindSoon = () => { clearTimeout(remindTimer); remindTimer = setTimeout(() => { scheduleReminders().catch(() => {}); }, 1500); };
      for (const e of ['bot.updated', 'board:changed', 'persons:switched']) orb.on(e, remindSoon);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') remindSoon(); });
      remindSoon();
      orb.push = {
        supported: () => true,
        installed: () => true,
        ios: () => false,
        enabled: () => localStorage.getItem(NOTIFY) === '1',
        async enable() {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          const p = await LocalNotifications.requestPermissions();
          if (p.display !== 'granted') throw new Error(await tl('app.pushDeniedApp'));
          localStorage.setItem(NOTIFY, '1');
          remindSoon();
          return true;
        },
        async disable() { localStorage.setItem(NOTIFY, '0'); remindSoon(); return false; }
      };
      // What another app shared: on start and each time the app is opened with something new.
      Native().then(async (nat) => {
        nat.addListener('shared', (s) => receive(s).catch(console.error));
        const first = await nat.takeShared().catch(() => null);
        if (first?.text || first?.files?.length) {
          const wait = () => pieces.record().then((r) => (r ? receive(first) : null));
          wait().catch(console.error);
        }
      }).catch(() => {});
    }
  };
}
