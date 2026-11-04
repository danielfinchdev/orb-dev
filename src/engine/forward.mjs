// 3.6 «Personas», the workshop's side of a call its centre forwards (A13, A12):
// - whoAsks: the centre says who asked there (principal.person, its person id on the centre). The workshop trusts it only
//   when it is the person the centre counts this link as (remotePerson, from the hello), and then runs the call as the
//   person this link belongs to here (the one who linked it; null = the owner). Anything else is refused and audited.
//   A centre of 3.5 (no principal) speaks for the owner of the link only.
// - once: a request_id runs once; asked again, the stored answer comes back (link_seen), so a call the centre sends again
//   after a timeout does not create a second task or message.
import { principalOf, audit, AuthzError, ownerOfBoard } from '../core/authz.mjs';

export function whoAsks(board, peer, principal) {
  const local = peer?.person ?? ownerOfBoard(board);
  const res = { type: 'link', id: peer?.id ?? '' };
  if (!principal) {
    const p = principalOf(board, { forwarded: true, person: local });
    return p;
  }
  const remote = peer?.remotePerson?.id ?? null;
  if (!remote || String(principal.person ?? '') !== remote) {
    const p = principalOf(board, { forwarded: true, person: local });
    audit(board, p, 'forward', res, 'deny', 'otherPerson');
    throw new AuthzError('otherPerson');
  }
  const p = principalOf(board, { forwarded: true, person: local });
  // The rights the device had on the centre go with it: never more than a forwarded call has here.
  const approve = principal.rights?.approve !== false && p.rights.approve;
  return approve === p.rights.approve ? p : Object.freeze({ ...p, rights: Object.freeze({ ...p.rights, approve }) });
}

const KEEP_DAYS = 7;
export async function once(board, requestId, peerId, fn) {
  if (!requestId) return fn();
  try { board.run('DELETE FROM link_seen WHERE at < ?', new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()); } catch { /* no table */ }
  const seen = board.one('SELECT result FROM link_seen WHERE request_id = ?', requestId);
  if (seen) {
    if (seen.result == null) throw Object.assign(new Error('en curso'), { status: 409, busy: true });
    const r = JSON.parse(seen.result);
    if (r.ok) return r.value;
    throw Object.assign(new Error(r.error), { status: r.status ?? 400, ...(r.reason ? { reason: r.reason } : {}) });
  }
  board.run('INSERT INTO link_seen (request_id, peer, result, at) VALUES (?, ?, NULL, ?)', requestId, peerId ?? null, new Date().toISOString());
  try {
    const value = await fn();
    const text = JSON.stringify({ ok: true, value: value ?? null });
    board.run('UPDATE link_seen SET result = ? WHERE request_id = ?', text.length <= 200_000 ? text : JSON.stringify({ ok: true, value: null }), requestId);
    return value;
  } catch (error) {
    board.run('UPDATE link_seen SET result = ? WHERE request_id = ?', JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 1000), status: error?.status ?? 400, reason: error?.reason ?? null }), requestId);
    throw error;
  }
}
