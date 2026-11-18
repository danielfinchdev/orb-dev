// Which HTML pages of a chat may be mounted as a live frame. Frames of one window can reach each other
// (parent.frames, postMessage), so a page without internet must never sit beside one that has it: while any page has
// internet, only the first of those is mounted and the rest wait as cards. Otherwise all of them are mounted.
export function mountable(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const net = list.find((p) => p?.internet === true);
  return new Set(net ? [net.id] : list.map((p) => p.id));
}

// The agent sessions whose pages a conversation shows beside its box: one entry per session, the one of the newest task first.
// All of them feed ONE list of pages, so mountable() sees the whole set and never leaves a page without internet beside one with it.
export function sideSessionIds(tasks, conversation, max = 5) {
  if (conversation == null) return [];
  const mine = (Array.isArray(tasks) ? tasks : []).filter((x) => x.conversation_id === conversation && x.session_id);
  const seen = new Set();
  const out = [];
  for (const x of [...mine].sort((a, b) => b.id - a.id)) {
    const sid = String(x.session_id);
    if (!seen.has(sid)) { seen.add(sid); out.push(sid); }
  }
  return out.slice(0, max);
}
