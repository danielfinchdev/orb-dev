// 3.7: Opti Bot (2.7–3.6) is gone, tidied once when the engine starts. Nothing of the user's is deleted: its conversation
// stays as an archived chat (its proposals still waiting say they expired). (Its «monitor» settings leave orb.json with
// the 3.8 migration, src/domain/data/legacy/migrate-38.mjs.)

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
  try { const r = retireOpti(board); if (r?.session) log(`3.7: la conversación de Opti Bot queda archivada (${r.expired} propuestas caducadas)`); } catch (error) { log(`retirados: ${error.message}`); }
}
