// 3.6: moving an Orb to another machine, and (with persons) exporting or deleting one person's data.
//   moveExport: a .orbbak marked move:true that opens only with a passphrase; this Orb is then marked «moved» (it stops
//               serving phones and linked Orbs until the user chooses «mantener ambos» or undoes the move).
//   moveImport: on the new machine, into a folder that is not an Orb: the same orbId with incarnation + 1.
//   cloneVerdict: what a peer makes of an Orb it sees (same orbId: the newer incarnation wins; two at once is a clone).
// TODO(WS5, after WS1): exportPerson / deletePerson (30-day trash) need the persons tables; see PLAN-3.6 §9.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { isHome } from './home.mjs';
import { tr } from './context.mjs';
import { createBackup, restoreInto, orbIdOf, setOrbId, readHeader, openKey } from './backup.mjs';

const fail = (key, vars) => { const e = new Error(tr(key, vars)); e.userFacing = true; throw e; };

export async function moveExport({ home, secret, passphrase, version = null, folder = null, log = () => {} }) {
  if (!passphrase || String(passphrase).length < 12) fail('data.backup.err.shortPassphrase');
  const r = await createBackup({ home, secret, kind: 'move', version, folder, passphrase, move: true, log });
  setOrbId(home, { moved: { at: new Date().toISOString(), file: r.file.split(/[\\/]/).pop() } });
  return r;
}
// The user changed their mind (the copy was not imported anywhere): this Orb serves again, as before.
export const moveUndo = (home) => setOrbId(home, { moved: null });
// Both Orbs stay: this one becomes a new Orb (new orbId), so nobody takes it for the one that moved.
export const moveKeepBoth = (home) => setOrbId(home, { orbId: crypto.randomBytes(16).toString('hex'), incarnation: 1, moved: null });
export const movedAway = (home) => orbIdOf(home).moved ?? null;

export async function moveImport({ target, file, passphrase }) {
  if (fs.existsSync(target) && (isHome(target) || fs.readdirSync(target).length)) fail('data.nucleo.notEmpty');
  const { header } = await readHeader(file);
  if (!header.move) fail('data.move.notMove');
  openKey(header, { passphrase }); // a wrong passphrase leaves nothing behind
  const fresh = !fs.existsSync(target);
  let r;
  try { r = await restoreInto(target, file, { passphrase }); }
  catch (error) { if (fresh) fs.rmSync(target, { recursive: true, force: true }); throw error; }
  const id = setOrbId(target, { orbId: header.orbId, incarnation: (Number(header.incarnation) || 1) + 1, moved: null });
  return { ...r, orbId: id.orbId, incarnation: id.incarnation };
}

// known: what a peer remembers of this orbId ({ incarnation, host }); seen: what just said hello. →
//   'new' (never seen), 'same', 'moved' (a newer incarnation: the peer follows it), 'clone' (an older incarnation, or the
//   same incarnation from another machine: two Orbs claim to be one; the peer refuses it and tells the user).
export function cloneVerdict(known, seen) {
  if (!known?.orbId || !seen?.orbId || known.orbId !== seen.orbId) return 'new';
  const [a, b] = [Number(known.incarnation) || 1, Number(seen.incarnation) || 1];
  if (b > a) return 'moved';
  if (b < a) return 'clone';
  return known.host && seen.host && known.host !== seen.host ? 'clone' : 'same';
}
