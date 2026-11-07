// 3.6 (messaging lists): the chat list, as a messaging app shows it, each person's own: their conversations with Orbe,
// grouped by project, and the marks of their direct conversations with an agent.
// Each item: what it is (kind conversation | session, id), its title and avatar, the person's marks (pinned and its
// order, section, muted), the last message (short plain text, when, from whom: a person or Orbe), how many are unread
// and what it is doing (working, paused, idle). Sorted: pinned (in their order), then the
// person's sections (in theirs), then the rest, most recent first. The marks live in src/core/inbox.mjs; who may see
// each chat is authz's (policy: src/core/policy.mjs › INBOX); a new line tells only its people (inbox:changed).
import { tr } from '../core/context.mjs';
import { peopleWith, AuthzError, audit, rightOn } from '../core/authz.mjs';
import { oneLine } from '../core/safety.mjs';
import * as I from '../core/inbox.mjs';
import { fail, str, int, oneOf } from './api-common.mjs';

export function inboxMethods({ board, emit, orchestrator }) {
  const scoped = (who) => (who && who.channel !== 'system' ? who : null);
  const me = (who) => (scoped(who) ? who.person : board.ownerId());
  const zoneOf = (v) => oneOf(v, I.ZONES, 'zona', 'orb');
  const kindOf = (v) => oneOf(v ?? '', I.KINDS, 'tipo') ?? fail(tr('msg.api.missing', { name: 'kind' }));
  const notFound = (who, method, res) => { audit(board, who, method, res, 'deny', 'notFound'); throw new AuthzError('notFound', { method, resource: res }); };
  // The item as the caller names it ({ kind, id }). The policy already checked «view» on it.
  function itemOf(p, who, method) {
    const kind = kindOf(p.kind);
    let id = p.id ?? fail(tr('msg.api.missing', { name: 'id' }));
    if (kind === 'session') { const s = board.one("SELECT id FROM sessions WHERE id = ? AND kind = 'chat'", String(id)); if (!s) fail(tr('msg.board.noConversation')); id = s.id; }
    else { const c = board.conversation(int(id, 'conversación')); if (!c || c.bot_id != null || c.group_id != null) fail(tr('msg.board.noConversation')); id = c.id; }
    const res = { type: kind, id };
    if (scoped(who) && !rightOn(board, who.person, res)) notFound(who, method, res);
    return { kind, id: String(id) };
  }
  const told = (person, extra = {}) => emit('inbox:changed', { person, ...extra }, { person });
  const keyList = (list) => (Array.isArray(list) ? list.slice(0, 200).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? I.keyOf(x.kind, x.id) : '')).filter(Boolean) : fail(tr('msg.api.invalid', { name: 'order' })));
  const sectionOf = (who, id, method) => I.section(board, me(who), int(id, 'sección')) ?? notFound(who, method, { type: 'section', id });
  const sectionName = (v) => { const n = oneLine(str(v, 'nombre', 60), 60).trim(); if (!n) fail(tr('msg.api.missing', { name: 'nombre' })); return n.slice(0, 40); };

  // ---- the items of a person's list
  function items(who) {
    const person = me(who);
    const marks = I.marks(board, person);
    const names = new Map(); const personName = (id) => { if (!names.has(id)) names.set(id, board.personName(id)); return names.get(id); };
    const out = [];
    const add = (kind, id, base, conversation) => {
      const m = marks.get(I.keyOf(kind, id)) ?? I.mark(board, person, kind, id);
      const last = I.describeLine(board, I.lastLine(board, conversation), { personName });
      out.push({ key: I.keyOf(kind, id), kind, id: Number(id), conversation: conversation ?? null, ...base,
        pinned: m.pinned, pinOrder: m.pinned ? m.pinOrder : null, section: m.section, muted: m.muted,
        lastMessage: last, unread: I.unread(board, person, conversation, m.lastRead), at: last?.at ?? base.at ?? null });
    };
    const running = new Set(board.all("SELECT DISTINCT conversation_id AS c FROM tasks WHERE conversation_id IS NOT NULL AND status = 'running'").map((r) => r.c));
    const paused = board.setting('paused') === '1';
    for (const c of board.conversations({ principal: scoped(who) })) {
      const busy = Boolean(orchestrator?.state?.(c.id)?.busy) || running.has(c.id);
      add('conversation', c.id, { title: c.title, project: c.project ?? null, done: c.status === 'done', avatar: c.project ? { type: 'project', project: c.project } : { type: 'orbe' },
        state: busy ? 'working' : paused ? 'paused' : 'idle', at: c.updated_at }, c.id);
    }
    // 3.6: the marks of the direct conversations with an agent (pinned, muted); their rows are built by the window.
    for (const [key, m] of marks) {
      if (!key.startsWith('session:')) continue;
      const id = key.slice(8);
      const s = board.one("SELECT id, person_id FROM sessions WHERE id = ? AND kind = 'chat'", id);
      if (!s || (scoped(who) && !rightOn(board, who.person, { type: 'session', id: s.id }))) continue;
      out.push({ key, kind: 'session', id: s.id, conversation: null, pinned: m.pinned, pinOrder: m.pinned ? m.pinOrder : null, section: m.section, muted: m.muted, lastMessage: null, unread: 0, at: null });
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
  function list(zone, who) {
    const person = me(who);
    I.since(board, person);
    const sections = I.sections(board, person, zone);
    const all = sorted(items(who), sections);
    const out = { zone, items: all,
      sections: sections.map((s) => ({ ...s, count: all.filter((x) => !x.pinned && x.section === s.id).length, unread: all.filter((x) => x.section === s.id).reduce((n, x) => n + x.unread, 0) })),
      unread: all.reduce((n, x) => n + (x.muted ? 0 : x.unread), 0) };
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

  // ---- a new line of a conversation: its people are told, its author has read up to it (WhatsApp does the same)
  function arrived(conversation, { line = null, role = null, author = null } = {}) {
    const it = I.itemOfConversation(board, conversation); if (!it) return;
    let people; try { people = [...peopleWith(board, { type: 'conversation', id: conversation })]; } catch { return; }
    for (const p of people) {
      try {
        I.since(board, p, { before: line });
        if (role === 'usuario' && line != null && (author ?? board.ownerId()) === p) I.setMark(board, p, it.kind, it.id, { lastRead: line });
        told(p, { kind: it.kind, id: Number(it.id), conversation: Number(conversation) });
      } catch { /* a list mark must never break a line */ }
    }
  }
  board.onChange((what, hints) => { if (what === 'chat' && hints?.conversation != null && hints.role !== 'notice') arrived(hints.conversation, hints); });

  return {
    'inbox.list': ({ zone }, who) => list(zoneOf(zone), who),
    'inbox.pin': (p, who) => {
      const it = itemOf(p, who, 'inbox.pin'); const person = me(who);
      if (!I.mark(board, person, it.kind, it.id).pinned) I.setMark(board, person, it.kind, it.id, { pinned: true, pinOrder: I.nextPinOrder(board, person, I.zoneOf(it.kind)) });
      told(person, it); return I.mark(board, person, it.kind, it.id);
    },
    // Unpinned, it goes back to the section it was in (kept while pinned).
    'inbox.unpin': (p, who) => {
      const it = itemOf(p, who, 'inbox.unpin'); const person = me(who);
      I.setMark(board, person, it.kind, it.id, { pinned: false, pinOrder: null });
      I.reorderPins(board, person, I.zoneOf(it.kind));
      told(person, it); return I.mark(board, person, it.kind, it.id);
    },
    'inbox.reorderPins': ({ zone, order }, who) => { const z = zoneOf(zone); const person = me(who); const out = I.reorderPins(board, person, z, keyList(order)); told(person, { zone: z }); return out; },
    'inbox.mute': (p, who) => { const it = itemOf(p, who, 'inbox.mute'); const person = me(who); const m = I.setMark(board, person, it.kind, it.id, { muted: p.muted !== false }); told(person, it); return m; },
    // upTo: the last line read (a chat line id; default: the last one).
    'inbox.markRead': (p, who) => {
      const it = itemOf(p, who, 'inbox.markRead'); const person = me(who);
      const conv = I.conversationOf(board, it.kind, it.id);
      const m = I.markRead(board, person, it.kind, it.id, conv, p.upTo == null ? null : int(p.upTo, 'línea'));
      told(person, it); return { ...m, unread: I.unread(board, person, conv, m.lastRead) };
    },
    'inbox.sections.list': ({ zone }, who) => I.sections(board, me(who), zoneOf(zone)),
    'inbox.sections.create': ({ zone, name }, who) => {
      const z = zoneOf(zone); const person = me(who);
      if (I.sections(board, person, z).length >= 30) fail(tr('msg.api.invalid', { name: 'sección' }));
      const s = I.createSection(board, person, z, sectionName(name)); told(person, { zone: z }); return s;
    },
    'inbox.sections.rename': ({ id, name }, who) => { const s = sectionOf(who, id, 'inbox.sections.rename'); board.run('UPDATE inbox_sections SET name = ? WHERE id = ?', sectionName(name), s.id); told(me(who), { zone: s.zone }); return I.section(board, me(who), s.id); },
    // Its chats stay, out of any section.
    'inbox.sections.delete': ({ id }, who) => { const s = sectionOf(who, id, 'inbox.sections.delete'); I.deleteSection(board, me(who), s.id); told(me(who), { zone: s.zone }); return { ok: true }; },
    'inbox.sections.reorder': ({ zone, order }, who) => {
      const z = zoneOf(zone); const person = me(who);
      if (!Array.isArray(order)) fail(tr('msg.api.invalid', { name: 'order' }));
      const mine = I.sections(board, person, z).map((s) => s.id);
      const next = [...new Set([...order.map(Number).filter((n) => mine.includes(n)), ...mine])];
      board.transaction(() => next.forEach((sid, i) => board.run('UPDATE inbox_sections SET position = ? WHERE id = ? AND person_id = ?', i, sid, person)));
      told(person, { zone: z }); return I.sections(board, person, z);
    },
    // A chat into a section of its zone (section null: out of any).
    'inbox.sections.move': (p, who) => {
      const it = itemOf(p, who, 'inbox.sections.move'); const person = me(who);
      const s = p.section == null || p.section === '' ? null : sectionOf(who, p.section, 'inbox.sections.move');
      if (s) zoneItem(s.zone, it);
      const m = I.setMark(board, person, it.kind, it.id, { section: s?.id ?? null }); told(person, it); return m;
    },
    // Titles and the text of the messages of the caller's chats (without case or accents).
    'inbox.search': ({ q, zone }, who) => {
      const z = zoneOf(zone);
      const words = oneLine(String(q ?? ''), 100).trim();
      if (words.length < 2) return { zone: z, items: [], messages: [] };
      const needle = I.fold(words);
      const all = items(who);
      const titles = all.filter((x) => I.fold(x.title).includes(needle)).map((x) => x.key);
      const byConv = new Map(all.filter((x) => x.conversation != null).map((x) => [x.conversation, x]));
      const messages = [];
      if (byConv.size) {
        const ids = [...byConv.keys()];
        const rows = board.all(`SELECT id, conversation_id, role, body, meta, at, person_id FROM chat WHERE conversation_id IN (${ids.map(() => '?').join(',')}) AND role != 'notice' ORDER BY id DESC LIMIT 20000`, ...ids);
        for (const r of rows) {
          if (messages.length >= 50) break;
          if (!I.fold(r.body).includes(needle)) continue;
          const x = byConv.get(r.conversation_id);
          const line = I.describeLine(board, r, { personName: (id) => board.personName(id) });
          messages.push({ key: x.key, kind: x.kind, id: x.id, conversation: r.conversation_id, title: x.title, line: { ...line, text: I.snippet(r.body, words) } });
        }
      }
      return { zone: z, items: sorted(all.filter((x) => titles.includes(x.key)), I.sections(board, me(who), z)), messages };
    }
  };
}
