// The notices of the phone's notice centre that are not a chat line: a task done and reviewed, a task Orb held back,
// a new Orb version, an account that left its usage limit. They are plain notes (src/shared/notes.mjs shape: key, id,
// route, title, body, hidden, kind, icon, actions, silent) with a `target` saying where a tap leads, and no action
// at all (information and destination only, never a token). remote.mjs delivers them like a chat's note.
// The texts live here (not in the locale files) so the note's wording stays next to its shape.
import { ctx, tr } from '../../platform/context.mjs';
import { noteId } from '../../shared/notes.mjs';
import { hiddenNoticeText } from '../../domain/notes/recent.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { oneLine } from '../../shared/text.mjs';
import { cooldownUntil } from '../../domain/usage/budget.mjs';
import { accounts, accountLabel } from '../../domain/usage/accounts.mjs';

export const NOTICE_KINDS = ['done', 'held', 'update', 'limit'];

const say = (key, vars) => tr(`msg.notice.${key}`, vars);

// A text written by an agent or a rule goes out as one short line with no secret and no absolute path.
const PATHS = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'«»]*|\/(?:Users|home|root|mnt|media|var|tmp|opt|private|Volumes|srv|data)\/[^\s"'«»]*/g;
export const plain = (text, max = 120) => oneLine(redactSecrets(String(text ?? '')).replace(PATHS, '…'), max);
const version = (v) => String(v ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 30);

// The note of one fact, or null (nothing to say).
// fact: { kind: 'done', task } | { kind: 'held', task, reasons } | { kind: 'update', version } | { kind: 'limit', account }
// opts: { preview, assistantName } (the hidden text of these notices is fixed: they are not messages)
export function noticeNote(fact, { preview = 'chat', assistantName = 'Orb' } = {}) {
  let key; let body; let route = { view: 'chat' }; let target;
  if (fact?.kind === 'done' || fact?.kind === 'held') {
    const id = Number(fact.task);
    if (!Number.isInteger(id) || id <= 0) return null;
    key = `${fact.kind}:${id}`; route = { view: 'tasks', id }; target = { type: 'task', id };
    if (fact.kind === 'done') body = say('done', { id });
    else { const reasons = plain(fact.reasons); body = reasons ? say('held', { id, reasons }) : say('heldNoReason', { id }); }
  } else if (fact?.kind === 'update') {
    const v = version(fact.version); if (!v) return null;
    key = `update:${v}`; target = { type: 'version', id: v }; body = say('update', { version: v });
  } else if (fact?.kind === 'limit') {
    const id = String(fact.account ?? '').slice(0, 80); if (!id) return null;
    key = `limit:${id}`; target = { type: 'account', id }; body = say('limit', { account: plain(accountLabel(id), 60) });
  } else return null;
  const shown = preview !== 'none';
  return {
    key, id: noteId(key), route, title: assistantName, body: shown ? body : hiddenNoticeText(), hidden: !shown,
    kind: fact.kind, icon: '/icon.png', actions: [], silent: false, target
  };
}

// Where a tap on a chat's note leads, for the saved list (the live note keeps the shape it always had).
export function targetOfNote(note) {
  if (note.target) return note.target;
  if (note.kind === 'task' && note.card?.task != null) return { type: 'task', id: Number(note.card.task) };
  if (note.kind === 'approval' && note.card?.id != null) return { type: 'session', id: String(note.card.id) };
  return { type: 'chat', id: note.route?.id ?? null };
}

// «Limit again»: an account that was paused by its usage limit and is not any more. Only the change is said (the first
// look after the engine starts says nothing), so a tick that finds the same state repeats nothing.
export function createLimitWatch({ board, announce, listAccounts = accounts }) {
  const limited = new Map(); // account id → true while paused by a usage limit
  return {
    tick() {
      const seen = new Set();
      for (const acc of listAccounts()) {
        seen.add(acc.id);
        const paused = cooldownUntil(board, acc.id) > 0;
        const byUsage = paused && !board.setting(`cooldown_reason:${acc.id}`);
        const was = limited.get(acc.id);
        if (was === true && !paused) announce({ kind: 'limit', account: acc.id });
        limited.set(acc.id, paused && byUsage);
      }
      for (const id of [...limited.keys()]) if (!seen.has(id)) limited.delete(id);
    }
  };
}
