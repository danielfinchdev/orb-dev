// 3.7 (WS3 ↔ WS2): who a person of a linked Orb is here, through ONE small interface. WS2 builds the flow that fills
// link_persons (the owner confirms «María aquí = María en el Server», never matched by name); the bots' homes and
// replicas (src/engine/replica.mjs) only call these functions.
//
// A peer is { id, key, person, remotePerson }: id = the link's id here (a link of src/core/link.mjs or a device of
// src/engine/remote.mjs), key = the other Orb's identity (orbId), person = whose link it is here (null: the owner),
// remotePerson = { id } whom the other side counts it as (known on the side that made the link).
import { ownerOfBoard } from './authz.mjs';

const owner = (board) => { try { return ownerOfBoard(board) ?? board.ownerId?.() ?? null; } catch { return null; } };
const rows = (board, peer) => {
  const ids = [peer?.id, peer?.key].filter(Boolean).map(String);
  if (!ids.length) return [];
  try { return board.all(`SELECT local_person, remote_person FROM link_persons WHERE confirmed_at IS NOT NULL AND peer IN (${ids.map(() => '?').join(', ')})`, ...ids); } catch { return []; }
};
// The person of the link itself (the one who made it here).
export const linkPerson = (board, peer) => peer?.person ?? owner(board);

// Whom `localPerson` (a person of this Orb) is on the other Orb. → its id there, or null (not mapped).
export function mappedPerson(board, peer, localPerson) {
  const hit = rows(board, peer).find((r) => r.local_person === localPerson);
  if (hit) return hit.remote_person;
  if (localPerson === linkPerson(board, peer)) return peer?.remotePerson?.id ?? null;
  return null;
}
// The other way round: who here is `remotePerson` of the other Orb. → a person id here, or null.
export function localPersonFor(board, peer, remotePerson) {
  if (remotePerson == null) return null;
  const hit = rows(board, peer).find((r) => r.remote_person === String(remotePerson));
  if (hit) return hit.local_person;
  if (peer?.remotePerson?.id && String(peer.remotePerson.id) === String(remotePerson)) return linkPerson(board, peer);
  return null;
}
// Whose bots this Orb shares with that peer as replicas: the link's person always; the other mapped persons only if
// they turned on «Copia en el PC» themselves (3.7 Q3, default off).
export function servedPersons(board, peer) {
  const out = new Set([linkPerson(board, peer)].filter(Boolean));
  for (const r of rows(board, peer)) if (replicaAllowed(board, r.local_person)) out.add(r.local_person);
  return out;
}
export function replicaAllowed(board, person) {
  if (!person) return false;
  if (person === owner(board)) return true;
  try { return board.personSetting(person, 'replica.pc') === true; } catch { return false; }
}
