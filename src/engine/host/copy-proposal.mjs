// The agent's tool «orb_copy_propose»: it suggests that the chat go on in a separate copy (a git worktree) and says why. The
// user answers on a card of this PC; nothing moves unless they accept, and not even then right away: the tool answers the agent
// to end its turn without touching anything, and when the turn ends the window shows the list of files that would move
// (`copy:ready`), as it does for the user's own request. A «no», no answer in 5 minutes or a locked Orb leaves the chat where
// it is. The card is bound to the chat, like the pull-request ones (pr-tools.mjs); only the PC's window answers it.
import { randomInt } from 'node:crypto';
import { tr } from '../../platform/context.mjs';
import { oneLine } from '../../shared/text.mjs';

export const ASK_MS = 5 * 60_000;
const WRITERS = new Set(['editar', 'preguntar', 'auto', 'total']);
const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });

export function createCopyProposals({ board, sessions, copy, emit = () => {}, log = () => {}, askMs = ASK_MS }) {
  let seq = randomInt(1, 1_000_000); // random start: ids must not repeat after a restart, or a stale card could answer another
  const pending = new Map(); // id -> { id, session, project, reason, done(text), timer, busy }

  const finish = (r, text) => {
    if (pending.get(r.id) !== r) return;
    pending.delete(r.id); clearTimeout(r.timer);
    emit('copy:done', { id: r.id, session: r.session });
    r.done(text);
  };
  const note = (r, key) => { try { sessions.addItem(r.session, 'system', 'status', tr(key)); } catch { /* the chat went */ } };
  const must = (ref) => {
    const r = pending.get(Number(ref?.id));
    if (!r || r.busy || String(ref.session) !== r.session) throw userError('msg.copy.askGone');
    return r;
  };
  const dropSession = (session) => { for (const r of [...pending.values()]) if (r.session === String(session) && !r.busy) finish(r, tr('msg.copy.askLocked')); };

  return {
    // The agent's call; `s` is the chat of its signed grant. → { text } for the agent once the user answered.
    async run(s, args = {}) {
      if (!s) throw userError('msg.pr.noChat');
      const project = s.project ? board.project(String(s.project)) : null;
      if (!project) throw userError('msg.pr.noProject');
      if (!WRITERS.has(s.permission)) throw userError('msg.copy.askReadOnly');
      if (copy.where(s.id) === 'copy') throw userError('msg.copy.askExists');
      const reason = oneLine(typeof args?.reason === 'string' ? args.reason : '', 400);
      if ([...pending.values()].some((r) => r.session === String(s.id))) throw userError('msg.copy.askTooMany');
      return new Promise((resolve) => {
        const id = ++seq;
        const r = { id, session: String(s.id), project: project.name, reason, done: (text) => resolve({ text }), timer: null, busy: false };
        r.timer = setTimeout(() => { log(`copia: sin respuesta · chat ${r.session}`); finish(r, tr('msg.copy.askNoAnswer')); }, askMs); r.timer.unref?.();
        pending.set(id, r);
        log(`copia: propuesta · chat ${r.session}`);
        note(r, 'msg.copy.askNote');
        emit('copy:request', { id, session: r.session, project: r.project, reason });
      });
    },
    pending: () => [...pending.values()].filter((r) => !r.busy).map(({ id, session, project, reason }) => ({ id, session, project, reason })),
    // «Pasar a copia aparte» on the card: the agent is told to end its turn; Orb moves the chat when it has.
    answer(ref) {
      const r = must(ref);
      const s = sessions.get(r.session);
      if (!s || !WRITERS.has(s.permission)) { finish(r, tr('msg.copy.askReadOnly')); throw userError('msg.copy.askReadOnly'); }
      copy.wait(r.session, true);
      log(`copia: aceptada · chat ${r.session}`);
      finish(r, tr('msg.copy.askAccepted'));
      return { ok: true, waiting: true };
    },
    // «Seguir aquí»
    decline(ref) {
      const r = must(ref);
      log(`copia: rechazada · chat ${r.session}`);
      finish(r, tr('msg.copy.askDeclined'));
      return true;
    },
    dropSession,
    wipe() { for (const r of [...pending.values()]) if (!r.busy) finish(r, tr('msg.copy.askLocked')); },
  };
}
