// 3.6 (messaging lists): the chat list, as a messaging app shows it: the conversations with Orbe, grouped by project,
// and the marks of the direct conversations with an agent.
// Each item: what it is (kind conversation | session, id), its title and avatar, its marks (pinned and its order,
// section, muted), the last message (short plain text, when, from whom: the user or Orbe), how many are unread and what
// it is doing (working, paused, idle). Sorted: pinned (in their order), then the sections (in theirs), then the rest,
// most recent first. The marks live in src/core/inbox.mjs; a new line tells the lists (inbox:changed).
import { tr } from '../platform/context.mjs';
import { userName } from '../core/board.mjs';
import { oneLine } from '../core/safety.mjs';
import * as I from '../core/inbox.mjs';
import { fail, str, int, oneOf } from './api-common.mjs';

export function inboxMethods({ board, emit, orchestrator }) {
  const zoneOf = (v) => oneOf(v, I.ZONES, 'zona', 'orb');
  const kindOf = (v) => oneOf(v ?? '', I.KINDS, 'tipo') ?? fail(tr('msg.api.missing', { name: 'kind' }));
  // The item as the caller names it ({ kind, id }).
  function itemOf(p) {
    const kind = kindOf(p.kind);
    let id = p.id ?? fail(tr('msg.api.missing', { name: 'id' }));
    if (kind === 'session') { const s = board.one("SELECT id FROM sessions WHERE id = ? AND kind = 'chat'", String(id)); if (!s) fail(tr('msg.board.noConversation')); id = s.id; }
    else { const c = board.conversation(int(id, 'conversación')); if (!c || c.bot_id != null || c.group_id != null) fail(tr('msg.board.noConversation')); id = c.id; }
    return { kind, id: String(id) };
  }
  const told = (extra = {}) => emit('inbox:changed', extra);
  const keyList = (list) => (Array.isArray(list) ? list.slice(0, 200).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? I.keyOf(x.kind, x.id) : '')).filter(Boolean) : fail(tr('msg.api.invalid', { name: 'order' })));
  const sectionOf = (id) => I.section(board, int(id, 'sección')) ?? fail(tr('msg.api.invalid', { name: 'sección' }));
  const sectionName = (v) => { const n = oneLine(str(v, 'nombre', 60), 60).trim(); if (!n) fail(tr('msg.api.missing', { name: 'nombre' })); return n.slice(0, 40); };

  // ---- the items of the list
  function items() {
    const marks = I.marks(board);
    const conversations = board.conversations();
    const lines = I.lastLines(board, conversations.map((c) => c.id));
    const unread = I.unreadMany(board, conversations.map((c) => [c.id, (marks.get(I.keyOf('conversation', c.id)) ?? I.noMark()).lastRead]));
    const user = userName();
    const out = [];
    const add = (kind, id, base, conversation) => {
      // 3.8.1: marks() holds every row; a chat without one has the default marks (no query each).
      const m = marks.get(I.keyOf(kind, id)) ?? I.noMark();
      const last = I.describeLine(lines.get(Number(conversation)) ?? null, { userName: user });
      out.push({ key: I.keyOf(kind, id), kind, id: Number(id), conversation: conversation ?? null, ...base,
        pinned: m.pinned, pinOrder: m.pinned ? m.pinOrder : null, section: m.section, muted: m.muted, snoozedUntil: m.snoozedUntil,
        lastMessage: last, unread: conversation == null ? 0 : unread.get(Number(conversation)) ?? 0, at: last?.at ?? base.at ?? null });
    };
    const running = new Set(board.all("SELECT DISTINCT conversation_id AS c FROM tasks WHERE conversation_id IS NOT NULL AND status = 'running'").map((r) => r.c));
    const paused = board.setting('paused') === '1';
    for (const c of conversations) {
      const busy = Boolean(orchestrator?.state?.(c.id)?.busy) || running.has(c.id);
      add('conversation', c.id, { title: c.title, project: c.project ?? null, done: c.status === 'done', avatar: c.project ? { type: 'project', project: c.project } : { type: 'orbe' },
        state: busy ? 'working' : paused ? 'paused' : 'idle', at: c.updated_at }, c.id);
    }
    // 3.6: the marks of the direct conversations with an agent (pinned, muted); their rows are built by the window.
    for (const [key, m] of marks) {
      if (!key.startsWith('session:')) continue;
      const id = key.slice(8);
      const s = board.one("SELECT id FROM sessions WHERE id = ? AND kind = 'chat'", id);
      if (!s) continue;
      out.push({ key, kind: 'session', id: s.id, conversation: null, pinned: m.pinned, pinOrder: m.pinned ? m.pinOrder : null, section: m.section, muted: m.muted, snoozedUntil: m.snoozedUntil, lastMessage: null, unread: 0, at: null });
    }
    return out;
  }
  function sorted(list, sections) {
    const pos = new Map(sections.map((s, i) => [s.id, i]));
    const recent = (a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || b.id - a.id;
    const rank = (x) => (x.pinned ? 0 : x.section != null && pos.has(x.section) ? 1 : 2);
    return list.map((x) => (x.section != null && !pos.has(x.section) ? { ...x, section: null } : x)).sort((a, b) => rank(a) - rank(b)
      || (rank(a) === 0 ? (a.pinOrder ?? 1e9) - (b.pinOrder ?? 1e9) : 0)
      || (rank(a) === 1 ? pos.get(a.section) - pos.get(b.section) : 0)
      || recent(a, b));
  }
  function list(zone) {
    I.since(board);
    const sections = I.sections(board, zone);
    const all = sorted(items(), sections);
    const out = { zone, items: all,
      sections: sections.map((s) => ({ ...s, count: all.filter((x) => !x.pinned && x.section === s.id).length, unread: all.filter((x) => x.section === s.id).reduce((n, x) => n + x.unread, 0) })),
      unread: all.reduce((n, x) => n + (x.muted || x.snoozedUntil ? 0 : x.unread), 0) };
    // The conversations grouped by project (no project: null), the most recent project first.
    const by = new Map();
    for (const x of [...all].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))) {
      if (!by.has(x.project)) by.set(x.project, { project: x.project, at: x.at, items: [], unread: 0, working: 0 });
      const g = by.get(x.project); g.items.push(x.key); g.unread += x.unread; if (x.state === 'working') g.working++;
    }
    out.projects = [...by.values()];
    return out;
  }
  const zoneItem = (zone, it) => (I.zoneOf(it.kind) === zone ? it : fail(tr('msg.api.invalid', { name: 'kind' })));

  // ---- a new line of a conversation: the lists are told; the user's own line marks it read up to it (WhatsApp does the same)
  function arrived(conversation, { line = null, role = null } = {}) {
    const it = I.itemOfConversation(board, conversation); if (!it) return;
    try {
      I.since(board, { before: line });
      if (role === 'usuario' && line != null) I.setMark(board, it.kind, it.id, { lastRead: line });
      told({ kind: it.kind, id: Number(it.id), conversation: Number(conversation) });
    } catch { /* a list mark must never break a line */ }
  }
  board.onChange((what, hints) => { if (what === 'chat' && hints?.conversation != null && hints.role !== 'notice') arrived(hints.conversation, hints); });

  return {
    'inbox.list': ({ zone }) => list(zoneOf(zone)),
    'inbox.pin': (p) => {
      const it = itemOf(p);
      if (!I.mark(board, it.kind, it.id).pinned) I.setMark(board, it.kind, it.id, { pinned: true, pinOrder: I.nextPinOrder(board, I.zoneOf(it.kind)) });
      told(it); return I.mark(board, it.kind, it.id);
    },
    // Unpinned, it goes back to the section it was in (kept while pinned).
    'inbox.unpin': (p) => {
      const it = itemOf(p);
      I.setMark(board, it.kind, it.id, { pinned: false, pinOrder: null });
      I.reorderPins(board, I.zoneOf(it.kind));
      told(it); return I.mark(board, it.kind, it.id);
    },
    'inbox.reorderPins': ({ zone, order }) => { const z = zoneOf(zone); const out = I.reorderPins(board, z, keyList(order)); told({ zone: z }); return out; },
    // 3.8.2: hidden from the list until `until` (an ISO time, at most a year ahead); until null: back now.
    'inbox.snooze': (p) => {
      const it = itemOf(p);
      const until = I.snoozeUntil(p.until);
      if (until === undefined) fail(tr('msg.api.invalid', { name: 'until' }));
      const m = I.setMark(board, it.kind, it.id, { snoozedUntil: until }); told(it); return m;
    },
    'inbox.mute': (p) => { const it = itemOf(p); const m = I.setMark(board, it.kind, it.id, { muted: p.muted !== false }); told(it); return m; },
    // upTo: the last line read (a chat line id; default: the last one).
    'inbox.markRead': (p) => {
      const it = itemOf(p);
      const conv = I.conversationOf(board, it.kind, it.id);
      const m = I.markRead(board, it.kind, it.id, conv, p.upTo == null ? null : int(p.upTo, 'línea'));
      told(it); return { ...m, unread: I.unread(board, conv, m.lastRead) };
    },
    'inbox.sections.list': ({ zone }) => I.sections(board, zoneOf(zone)),
    'inbox.sections.create': ({ zone, name }) => {
      const z = zoneOf(zone);
      if (I.sections(board, z).length >= 30) fail(tr('msg.api.invalid', { name: 'sección' }));
      const s = I.createSection(board, z, sectionName(name)); told({ zone: z }); return s;
    },
    'inbox.sections.rename': ({ id, name }) => { const s = sectionOf(id); board.run('UPDATE inbox_sections SET name = ? WHERE id = ?', sectionName(name), s.id); told({ zone: s.zone }); return I.section(board, s.id); },
    // Its chats stay, out of any section.
    'inbox.sections.delete': ({ id }) => { const s = sectionOf(id); I.deleteSection(board, s.id); told({ zone: s.zone }); return { ok: true }; },
    'inbox.sections.reorder': ({ zone, order }) => {
      const z = zoneOf(zone);
      if (!Array.isArray(order)) fail(tr('msg.api.invalid', { name: 'order' }));
      const mine = I.sections(board, z).map((s) => s.id);
      const next = [...new Set([...order.map(Number).filter((n) => mine.includes(n)), ...mine])];
      board.transaction(() => next.forEach((sid, i) => board.run('UPDATE inbox_sections SET position = ? WHERE id = ? AND person_id = ?', i, sid, I.ME)));
      told({ zone: z }); return I.sections(board, z);
    },
    // A chat into a section of its zone (section null: out of any).
    'inbox.sections.move': (p) => {
      const it = itemOf(p);
      const s = p.section == null || p.section === '' ? null : sectionOf(p.section);
      if (s) zoneItem(s.zone, it);
      const m = I.setMark(board, it.kind, it.id, { section: s?.id ?? null }); told(it); return m;
    },
    // Titles and the text of the messages of the chats (without case or accents).
    'inbox.search': ({ q, zone }) => {
      const z = zoneOf(zone);
      const words = oneLine(String(q ?? ''), 100).trim();
      if (words.length < 2) return { zone: z, items: [], messages: [] };
      const needle = I.fold(words);
      const all = items();
      const titles = all.filter((x) => I.fold(x.title).includes(needle)).map((x) => x.key);
      const byConv = new Map(all.filter((x) => x.conversation != null).map((x) => [x.conversation, x]));
      const messages = [];
      if (byConv.size) {
        const ids = [...byConv.keys()];
        const rows = board.all(`SELECT id, conversation_id, role, body, meta, at FROM chat WHERE conversation_id IN (${ids.map(() => '?').join(',')}) AND role != 'notice' ORDER BY id DESC LIMIT 20000`, ...ids);
        for (const r of rows) {
          if (messages.length >= 50) break;
          if (!I.fold(r.body).includes(needle)) continue;
          const x = byConv.get(r.conversation_id);
          const line = I.describeLine(r, { userName: userName() });
          messages.push({ key: x.key, kind: x.kind, id: x.id, conversation: r.conversation_id, title: x.title, line: { ...line, text: I.snippet(r.body, words) } });
        }
      }
      return { zone: z, items: sorted(all.filter((x) => titles.includes(x.key)), I.sections(board, z)), messages };
    }
  };
}
