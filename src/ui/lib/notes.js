// 3.6 (messaging, M4): what the window does with a notification that was tapped (the phone's browser: its service
// worker, src/engine/remote.mjs; the Android app: lib/app-bridge.js). It opens the exact chat and, when «Aprobar» could
// not be done right there (a card that needs the PIN, a task whose exact version is approved here), asks here.
// Opened only once the phone is unlocked (NoteOpener lives inside PhoneLock): what arrives before waits.
import { useEffect } from 'react';
import { bridge, botsVia, call, act, go } from './store.js';
import { t } from './i18n.js';
import { askPin } from '@/components/person-menu.jsx';

// Answers a bot's card. A sensitive card of someone with a PIN needs it (the Orb refuses with reason «strong»): asked
// here, then the same answer again with the ticket it gives (valid on this device only, for a few minutes).
export async function decideCard(item, decision) {
  const method = `${botsVia()}bots.decide`;
  try { return await bridge.call(method, { item, decision }); }
  catch (error) {
    if (error?.reason !== 'strong' || decision !== 'allow') throw error;
    let ticket = null;
    const ok = await askPin({ title: t('notes.pinTitle'), description: t('notes.pinDesc'), send: async (pin) => { const r = await call('persons.verifyPin', { pin }); if (r?.ok) ticket = r.ticket; return r; } });
    if (!ok || !ticket) return undefined; // closed without the PIN
    return bridge.call(method, { item, decision }, { ticket });
  }
}

// Open what a notification is for: { route, approve? } (approve: the card or task to approve, from src/core/notes.mjs).
export async function openFromNote({ route, approve } = {}) {
  if (!route?.view) return;
  go(route);
  if (!approve) return;
  if (approve.method === 'bots.decide') await act(decideCard(Number(approve.item), 'allow'), t('notes.allowed'));
  else if (approve.method === 'sessions.approve') await act(call('sessions.approve', { id: String(approve.id), request: String(approve.request), decision: 'allow' }), t('notes.allowed'));
  else if (approve.method === 'tasks.approve') { const { approveTask } = await import('@/components/task-approval.jsx'); await approveTask({ id: Number(approve.task) }); }
}

// What came before the window could open it waits here (the page opened by a notification: /#abrir=…, or an event).
const waiting = [];
let opener = null;
const take = (detail) => { if (!detail?.route) return; if (opener) opener(detail); else waiting.push(detail); };
if (typeof window !== 'undefined') {
  window.addEventListener('orb:open-note', (e) => take(e.detail));
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('abrir');
    if (raw) { history.replaceState(null, '', location.pathname); take(JSON.parse(raw)); }
  } catch { /* not ours */ }
}
export function NoteOpener() {
  useEffect(() => {
    opener = (d) => { openFromNote(d).catch(console.error); };
    while (waiting.length) opener(waiting.shift());
    return () => { opener = null; };
  }, []);
  return null;
}
