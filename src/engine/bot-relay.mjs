// 3.7 (WS2): a bot's live event as it is mirrored to a linked Orb (its phones get it as taller:bot.*): with the bot's uid
// and, for a line, the line's uid; null for the events of a copy (its home mirrors its own) or of a group.
export function botRelay(board, event, payload) {
  if (!/^bot\.(updated|message|state|home)$/.test(event)) return payload;
  try {
    const id = event === 'bot.state' ? payload?.bot : event === 'bot.message' ? board.one('SELECT bot_id FROM conversations WHERE id = ?', Number(payload?.conversation))?.bot_id : payload?.id;
    if (id == null) return event === 'bot.updated' ? payload : null;
    const row = board.one("SELECT id, uid, home, home_state FROM bots WHERE id = ?", Number(id));
    if (!row?.uid) return null;
    const self = board.setting('orb_self');
    if (row.home && self && row.home !== self) return null;
    const line = event === 'bot.message' && payload?.id != null ? board.one('SELECT uid FROM chat WHERE id = ?', Number(payload.id))?.uid ?? null : null;
    return { ...payload, botUid: row.uid, ...(line ? { uid: line } : {}) };
  } catch { return null; }
}
