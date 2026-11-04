// 3.6 «Personas»: the people of this Orb (src/core/persons.mjs keeps them; src/core/policy.mjs says who may call what).
// The owner sees everyone's name and numbers (persons.overview), never their content.
import { getPerson, mustPerson, listPersons, personsCount, createPerson, renamePerson, updatePerson, setCaps, removePerson, setPin, verifyPin, dropTickets, overview, ownerId } from '../core/persons.mjs';
import { tr, ctx, saveConfig } from '../core/context.mjs';
import { fail, str, oneOf } from './api-common.mjs';

const PREVIEWS = ['all', 'chat', 'none'];

const pin = (v) => (v == null || v === '' ? null : String(v).slice(0, 12));

export function personMethods(shared) {
  const { board, emit, desktop } = shared;
  const changed = () => board.changed('persons');
  const shown = (p, who) => (who.role === 'owner' || p.id === who.person
    ? { id: p.id, name: p.name, role: p.role, color: p.color, language: p.language, tz: p.tz, caps: p.caps, hasPin: p.hasPin, locked: p.locked, created_at: p.created_at, me: p.id === who.person }
    : { id: p.id, name: p.name, role: p.role, color: p.color, me: false });
  return {
    // Everyone sees the names (to share with them); the owner, also their settings and whether they have a PIN.
    'persons.list': (_, who) => listPersons(board).map((p) => shown(p, who)),
    'persons.me': (_, who) => {
      const p = getPerson(board, who.person);
      return { person: p ? shown(p, who) : null, role: who.role, channel: who.channel, rights: who.rights, personsCount: personsCount(board) };
    },
    'persons.create': ({ name, language, tz, color, caps }) => { const p = createPerson(board, { name: str(name, 'nombre', 40), language, tz, color, caps }); changed(); return p; },
    'persons.rename': ({ id, name }, who) => {
      const p = renamePerson(board, id ?? who.person, str(name, 'nombre', 40)); changed();
      // The admin's name is also the settings' userName (what the assistant calls them): both stay the same.
      if (p.role === 'owner' && ctx.config?.userName !== p.name) { try { emit('config:changed', saveConfig({ userName: p.name })); } catch { /* kept in the person */ } }
      return p;
    },
    // WS1: marked as removed only (WS5 removes the person's data, with the export first).
    // 3.6 (WS5): the full removal (rows, files, 30-day trash: src/core/export.mjs › deletePerson).
    'persons.remove': ({ id }, who) => { if (shared.removePersonData) return shared.removePersonData(id ?? who.person); const r = removePerson(board, id ?? who.person); dropTickets(r.id); changed(); return r; },
    // A new PIN (or none: pin null). For oneself, with the PIN in use typed again (current) or a strong ticket; the owner
    // may only take another person's PIN away (they set a new one themselves).
    'persons.setPin': ({ id, pin: next, current }, who) => {
      const target = mustPerson(board, id ?? who.person);
      if (target.id !== who.person && pin(next) != null) fail(tr('msg.persons.notYours'));
      if (target.id === who.person && target.hasPin && current != null && !verifyPin(board, target.id, pin(current), { device: who.device ?? null }).ok) fail(tr('msg.persons.wrongPin'));
      const r = setPin(board, target.id, pin(next)); dropTickets(target.id); changed(); return r;
    },
    // → { ok, ticket, until } | { ok: false, reason, triesLeft?, lockedUntil? }. The ticket works only on this device.
    'persons.verifyPin': ({ pin: given }, who) => verifyPin(board, who.person, pin(given), { device: who.device ?? (who.channel === 'desktop' ? 'desktop' : null) }),
    // This PC's window changes person (their PIN, if they have one). WS2: the lock screen and the router.
    'persons.switch': ({ id, pin: given }) => {
      const target = mustPerson(board, str(id, 'persona', 40));
      if (target.hasPin) {
        const r = verifyPin(board, target.id, pin(given), { device: 'desktop' });
        if (!r.ok) return { ok: false, reason: r.reason, triesLeft: r.triesLeft, lockedUntil: r.lockedUntil };
      }
      desktop.person = target.id;
      emit('persons:switched', { person: target.id });
      return { ok: true, person: { id: target.id, name: target.name, role: target.role } };
    },
    'persons.overview': () => overview(board),
    // ---- 3.6 (WS6): what the screens need. Mi perfil: language and time zone (oneself; the owner may fix anyone's).
    'persons.update': ({ id, language, tz, color }, who) => { const p = updatePerson(board, id ?? who.person, { language, tz, color }); changed(); return shown(p, who); },
    // Ajustes › Personas (owner): what someone may do (program, use the house, approve the house's cards).
    'persons.setCaps': ({ id, caps }) => { const p = setCaps(board, str(id, 'persona', 40), caps && typeof caps === 'object' ? caps : {}); changed(); return p; },
    // The caller's own preferences kept per person: what notifications show on a locked screen.
    'persons.prefs.get': (_, who) => ({ preview: board.personSetting(who.person, 'preview') ?? 'chat' }),
    'persons.prefs.set': ({ preview }, who) => { board.personSetting(who.person, 'preview', oneOf(preview, PREVIEWS, 'avisos')); return { preview: board.personSetting(who.person, 'preview') }; },
    // Ajustes › Personas (owner): pause or resume all the bots of someone (their names and content stay theirs).
    'persons.pauseBots': ({ id, paused }) => {
      const p = mustPerson(board, str(id, 'persona', 40));
      const rows = p.id === ownerId(board) ? board.all('SELECT id FROM bots WHERE person_id = ? OR person_id IS NULL', p.id) : board.all('SELECT id FROM bots WHERE person_id = ?', p.id);
      board.run(`UPDATE bots SET paused = ? WHERE id IN (${rows.map(() => '?').join(',') || 'NULL'})`, paused === false ? 0 : 1, ...rows.map((r) => r.id));
      if (paused !== false) for (const r of rows) { try { shared.bots?.stop?.(r.id); } catch { /* not running */ } }
      board.changed('bots', { person: p.id });
      return { bots: rows.length, paused: paused !== false };
    }
  };
}
