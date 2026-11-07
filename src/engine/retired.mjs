// 3.7: what is left of features Orb no longer has, tidied once when the engine starts. «Monitoreo del equipo» and Opti Bot
// (2.7–3.6) are gone. Nothing of the user's is deleted: Opti Bot's conversation stays as an archived chat (its proposals
// still waiting say they expired), and its settings leave orb.json.
import fs from 'node:fs';
import { ctx } from '../core/context.mjs';
import { writeJson } from '../core/home.mjs';

// orb.json without «monitor» (loadConfig already dropped it from ctx.config). → true when the file changed.
export function migrateRetiredConfig(file = ctx.paths?.config) {
  if (!file || !fs.existsSync(file)) return false;
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  if (!raw || typeof raw !== 'object' || raw.monitor === undefined) return false;
  const { monitor: _monitor, ...rest } = raw;
  writeJson(file, rest);
  return true;
}

// Opti Bot's conversation and its pending cards. → { session, expired } (what was tidied; null when nothing).
export function retireOpti(board) {
  if (board.setting('opti_retired') === '1') return null;
  const id = board.setting('opti_session') || null;
  let expired = 0;
  if (id && board.one('SELECT id FROM sessions WHERE id = ?', id)) {
    for (const row of board.all("SELECT id, body FROM session_items WHERE session_id = ? AND kind = 'opti_action'", id)) {
      let body = null; try { body = JSON.parse(row.body); } catch { /* not a card */ }
      if (body?.status === 'pending' || body?.status === 'running') { board.run('UPDATE session_items SET body = ? WHERE id = ?', JSON.stringify({ ...body, status: 'expired' }), row.id); expired++; }
    }
    board.run('UPDATE sessions SET archived = 1 WHERE id = ?', id);
  }
  board.run("DELETE FROM settings WHERE key IN ('opti_session', 'opti_pending')");
  board.setting('opti_retired', '1');
  return { session: id, expired };
}

export function tidyRetired(board, log = () => {}) {
  try { if (migrateRetiredConfig()) log('3.7: orb.json sin «monitor» (Monitoreo del equipo ya no existe)'); } catch (error) { log(`retirados: ${error.message}`); }
  try { const r = retireOpti(board); if (r?.session) log(`3.7: la conversación de Opti Bot queda archivada (${r.expired} propuestas caducadas)`); } catch (error) { log(`retirados: ${error.message}`); }
}
