// The engine's events the window follows (src/shared catalog in test/fixtures/superficie.json): what refreshes the
// state, what streams into a conversation, what passes by as a notice and what reloads the window.
import { useEffect } from 'react';
import { bridge, call, go, refreshSoon, chatStateSoon, loadOrbInboxSoon, getState } from '@/lib/store.js';
import { notify, markNoticesSeen } from '@/lib/notify.js';
import { t as tNow } from '@/lib/i18n.js';

// whether core went missing while Orb ran (an engine restarted after it reloads the window).
let coreLost = false;

// While the app is up (phase 'app'), from Root.
export function useEngineEvents(phase) {
  useEffect(() => {
    if (phase !== 'app') return undefined;
    return bridge.on('*', (event, payload) => {
      if (event === 'board:changed' || event === 'session:update' || event === 'session:removed' || event === 'config:changed' || event === 'approval:changed') refreshSoon();
      // what one conversation is doing now (answering, waiting its turn or idle again). an answer
      // streams in many small pieces; the screen takes them once per frame (the newest state of each conversation).
      if (event === 'chat:state' && payload?.conversation != null) chatStateSoon(payload);
      // what only informs (working folder, brain in use, schedule created…) passes by as a notification.
      // through lib/notify.js: one at a time, never repeated, kept under the bell.
      if (event === 'notice' && payload?.body) notify({ body: payload.body, tone: payload.tone, always: payload.always === true });
      // an agent asked to merge or comment on a PR in a chat that is not the one on screen: its card only shows inside that
      // chat and the request expires, so the bell says it is waiting (a click opens the chat).
      if (event === 'pr:request' && payload?.session != null) {
        const here = getState().route;
        if (!(here?.view === 'session' && String(here.id) === String(payload.session))) {
          const chat = (getState().sessions ?? []).find((x) => String(x.id) === String(payload.session));
          notify({ body: tNow('app.prCardWaiting', { number: payload.number ?? '?' }), tone: 'warning', always: true, go: chat ? { view: 'session', id: chat.id } : null });
        }
      }
      // the phone read its notices; its ids are not the bell's, so the whole bell counts as seen.
      if (event === 'notes:read') markNoticesSeen();
      // a linked phone sent a chat to the trash: this PC shows it with an «Undo» (the trash is kept for days)
      if (event === 'trash:added' && payload?.id != null) {
        const method = payload.kind === 'session' ? 'sessions.restore' : 'conversations.restore';
        notify({ body: tNow('app.trashAdded', { device: payload.device || '?', title: payload.title || '' }), tone: 'warning', always: true,
          action: { label: tNow('app.trashUndo'), onClick: () => { call(method, { id: payload.id }).then(() => refreshSoon()).catch((error) => notify({ body: String(error?.message ?? error), tone: 'error' })); } } }, { ms: 15000 });
      }
      if (event === 'ui:navigate') go(payload);
      if (event === 'inbox:changed') loadOrbInboxSoon(120);
      // the chat list follows what its conversations do (a new line comes with inbox:changed).
      if (event === 'chat:state' && !payload?.partial && payload?.append == null) loadOrbInboxSoon(400);
      if (event === 'engine:stopped') notify({ body: tNow('app.engineStopped'), tone: 'error' });
      // core went missing while Orb ran: the engine starts again and brings it back (or says why it cannot).
      if (event === 'core:lost') coreLost = true;
      if (event === 'engine:restarted') { if (coreLost) { location.reload(); return; } notify({ body: tNow('app.engineRestarted'), tone: 'warning' }); refreshSoon(); }
    });
  }, [phase]);
}
