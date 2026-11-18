// The engine reads behind the turn cards and the Changes panel (sessions.turns, sessions.turnDiff), shared by both and kept light:
// see lib/turn-cards.js for how the requests are folded and queued.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { call } from '@/lib/store.js';
import { createDiffQueue, createTurnsStore } from '@/lib/turn-cards.js';

const turnsStore = createTurnsStore((id) => call('sessions.turns', { id }));
const NONE = Object.freeze({ available: false, turns: [] });

// → { available, turns } once read (null before). Read again only when the chat has finished a new turn, never on each update.
export function useTurns(session, enabled = true) {
  const id = session.id; const running = session.status === 'running';
  const subscribe = useCallback((fn) => turnsStore.subscribe(id, fn), [id]);
  const value = useSyncExternalStore(subscribe, () => turnsStore.get(id));
  useEffect(() => {
    if (!enabled) return;
    turnsStore.setRunning(id, running);
    turnsStore.load(id);
  }, [id, running, enabled]);
  return enabled ? value : NONE;
}

const summaryOf = (r) => ({ files: (r?.files ?? []).map((f) => ({ path: f.path, status: f.status, added: f.added ?? 0, removed: f.removed ?? 0, binary: Boolean(f.binary) })), more: Number(r?.more) || 0 });
const diffs = createDiffQueue((p) => call('sessions.turnDiff', { id: p.id, scope: 'turn', n: p.n, stat: true }).then(summaryOf));

// at: the turn's photo time, so a turn that was rewound and written again does not reuse the numbers of the old one.
export const diffKey = (sessionId, turn) => `${sessionId}:${turn.n}:${turn.at}`;
export const readDiff = (sessionId, turn) => diffs.peek(diffKey(sessionId, turn));
export const requestDiff = (sessionId, turn, wanted) => diffs.request(diffKey(sessionId, turn), { id: sessionId, n: turn.n }, wanted);
