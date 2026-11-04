// 3.6 «Personas» (WS2): this PC's window as a door. The lock screen is the engine's: while it is up, engine.mjs refuses
// every call of the window but these (persons.unlock, app.lockState and a minimal app.state), whatever the interface
// does. Switching person (persons.switch, api-persons.mjs) and unlocking ask the PIN of whoever sits down.
import { getPerson, listPersons, verifyPin, mustPerson } from '../core/persons.mjs';
import { ownerOfBoard } from '../core/authz.mjs';
import { str } from './api-common.mjs';

export function gatewayMethods({ board, emit, desktop, version }) {
  const who = () => desktop.person ?? ownerOfBoard(board);
  return {
    // What the lock screen shows: who was here and who may unlock (names only).
    'app.lockState': () => {
      const me = getPerson(board, who());
      return { locked: Boolean(desktop.locked), version, person: me ? { id: me.id, name: me.name, hasPin: me.hasPin } : null,
        persons: listPersons(board).map((p) => ({ id: p.id, name: p.name, hasPin: p.hasPin })) };
    },
    // Lock this PC's window now (nothing of anyone shows until someone unlocks it with their PIN).
    'persons.lock': () => { desktop.locked = true; emit('persons:locked', { locked: true }); return { locked: true }; },
    // Unlock: the person who sits down (default the one who was here) and their PIN, if they have one.
    'persons.unlock': ({ id, pin }) => {
      const target = mustPerson(board, id == null || id === '' ? who() : str(id, 'persona', 40));
      if (target.hasPin) {
        const r = verifyPin(board, target.id, pin == null ? null : String(pin).slice(0, 12), { device: 'desktop' });
        if (!r.ok) return { ok: false, reason: r.reason, triesLeft: r.triesLeft, lockedUntil: r.lockedUntil };
      }
      const switched = target.id !== who();
      desktop.person = target.id; desktop.locked = false;
      emit('persons:unlocked', { locked: false });
      if (switched) emit('persons:switched', { person: target.id });
      return { ok: true, person: { id: target.id, name: target.name, role: target.role } };
    }
  };
}
