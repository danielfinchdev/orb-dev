// The engine's events the window follows (src/shared catalog in test/fixtures/superficie.json): what refreshes the
// state, what streams into a conversation, what passes by as a notice and what reloads the window.
import { useEffect } from 'react';
import { bridge, go, refreshSoon, chatStateSoon, loadOrbInboxSoon } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { t as tNow } from '@/lib/i18n.js';

// 3.8: whether core went missing while Orb ran (an engine restarted after it reloads the window).
let coreLost = false;

// While the app is up (phase 'app'), from Root.
export function useEngineEvents(phase) {
  useEffect(() => {
    if (phase !== 'app') return undefined;
    return bridge.on('*', (event, payload) => {
      if (event === 'board:changed' || event === 'session:update' || event === 'session:removed' || event === 'config:changed' || event === 'approval:changed') refreshSoon();
      // 3.2: what one conversation is doing now (answering, waiting its turn or idle again). 3.8.1 (H4a): an answer
      // streams in many small pieces; the screen takes them once per frame (the newest state of each conversation).
      if (event === 'chat:state' && payload?.conversation != null) chatStateSoon(payload);
      // 2.7: what only informs (working folder, brain in use, schedule created…) passes by as a notification.
      // 3.2: through lib/notify.js: one at a time, never repeated, kept under the bell.
      if (event === 'notice' && payload?.body) notify({ body: payload.body, tone: payload.tone });
      if (event === 'ui:navigate') go(payload);
      if (event === 'inbox:changed') loadOrbInboxSoon(120);
      // 3.6 (M3): the chat list follows what its conversations do (a new line comes with inbox:changed).
      if (event === 'chat:state' && !payload?.partial && payload?.append == null) loadOrbInboxSoon(400);
      if (event === 'engine:stopped') notify({ body: tNow('app.engineStopped'), tone: 'error' });
      // 3.8: core went missing while Orb ran: the engine starts again and brings it back (or says why it cannot).
      if (event === 'core:lost') coreLost = true;
      if (event === 'engine:restarted') { if (coreLost) { location.reload(); return; } notify({ body: tNow('app.engineRestarted'), tone: 'warning' }); refreshSoon(); }
    });
  }, [phase]);
}
