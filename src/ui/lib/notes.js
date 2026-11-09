// 3.6 (messaging, M4): what the window does with a notification that was tapped (the phone's browser: its service
// worker, src/engine/remote.mjs; the Android app: lib/app-bridge.js). It opens the exact chat and, when «Aprobar» could
// not be done right there (a task whose exact version is approved here), asks here.
// Opened once the app is on screen (NoteOpener): what arrives before waits.
import { useEffect } from 'react';
import { call, act, go } from './store.js';
import { t } from './i18n.js';

// Open what a notification is for: { route, approve? } (approve: the permission or task to approve, from src/shared/notes.mjs).
export async function openFromNote({ route, approve } = {}) {
  if (!route?.view) return;
  go(route);
  if (!approve) return;
  if (approve.method === 'sessions.approve') await act(call('sessions.approve', { id: String(approve.id), request: String(approve.request), decision: 'allow' }), t('notes.allowed'));
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
