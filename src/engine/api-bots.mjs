// The bots' part of the engine's API (3.5; split out of api.mjs in 3.6): src/engine/bots.mjs does the work,
// src/core/bots.mjs keeps the data.
// 3.6 «Personas» (WS4): every method gets the caller (who, a principal; none: the engine itself). Lists show the caller's
// own bots, groups and reminders and the ones shared with them; a conversation with a bot, its live session and a memory
// file are each person's own; creates are stamped with the caller. authz.authorize already checked the right on the
// resource (src/core/policy.mjs › BOTSP); what depends on more than that is checked here.
import { saveConfig, tr } from '../core/context.mjs';
import { protectedList } from '../core/guard.mjs';
import { oneLine } from '../core/safety.mjs';
import { rightOn, rank, AuthzError, audit } from '../core/authz.mjs';
import * as B from '../core/bots.mjs';
import { serverStatus, haFetch } from '../core/server-admin.mjs';
import { botBrainProblem, isSensitiveCard } from './bots.mjs';
import { fail, str, int, oneOf } from './api-common.mjs';
import { isHomeHere } from '../core/replica.mjs';

export function botMethods({ board, emit, remoteRef, bots, setShare, removeShare }) {
  const need = () => bots ?? fail(tr('msg.bots.off'));
  const scoped = (who) => (who && who.channel !== 'system' ? who : null);
  const me = (who) => (scoped(who) ? who.person : board.ownerId());
  const botId = (id, who) => B.mustBot(board, id ?? fail(tr('msg.api.missing', { name: 'bot' })), scoped(who) ? { person: who.person } : {}).id;
  const groupId = (id) => (B.getGroup(board, int(id, 'grupo')) ?? fail(tr('msg.bots.noGroup'))).id;
  const right = (who, res) => (scoped(who) ? rightOn(board, who.person, res) : 'own');
  const deny = (who, method, res) => { audit(board, who, method, res, 'deny', 'right'); throw new AuthzError('right', { method, resource: res }); };
  // 3.7 (WS3): where each bot runs (src/engine/replica.mjs › homeView): homeHere, homeKind ('here' | 'server' | 'orb'),
  // homeName, homeOnline, readOnly (a copy of a bot run on another Orb), queued (messages waiting for that Orb).
  const replica = () => remoteRef.replica ?? null;
  const homeOf = (b) => { try { return replica()?.homeView(board.one('SELECT * FROM bots WHERE id = ?', b.id) ?? b) ?? {}; } catch { return {}; } };
  const view = (b, who) => {
    const person = me(who);
    const owner = B.personOf(board, b);
    return { ...b, effectiveTools: B.effectiveTools(board, b), conversation: B.botConversation(board, b, { person }), state: bots?.state(b.id, person) ?? null,
      reminders: B.listReminders(board, { bot: b.id, person }).length, right: right(who, { type: 'bot', id: b.id }),
      ...(owner !== person ? { sharedBy: { person: owner, name: board.personName(owner) } } : {}), ...homeOf(b) };
  };
  // 3.7: a write on a copy of a bot run on another Orb goes to that Orb (or waits for it): never applied here.
  const rowOf = (id) => board.one('SELECT * FROM bots WHERE id = ?', Number(id));
  const elsewhere = (row) => Boolean(row?.uid && !isHomeHere(board, row));
  const viaHome = async (row, method, params, who, refs = null) => {
    if (!replica()) fail(tr('msg.home.runsElsewhere', { name: row.name }));
    return replica().forwardWrite(row, method, params, scoped(who) ?? { person: board.ownerId() }, { refs });
  };
  const cardBot = (item) => { const r = board.chatRow(int(item, 'tarjeta')); return r?.meta?.bot ? { line: r, row: rowOf(r.meta.bot) } : { line: r, row: null }; };
  const fields = (p) => Object.fromEntries(['name', 'icon', 'avatar', 'role_text', 'agent', 'model', 'effort', 'tools', 'accounts', 'exclusive', 'is_chief', 'paused', 'caps'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  // 3.6 (S1): a brain that cannot run confined is refused when it is chosen (and again when the bot starts).
  const brainOk = (f) => { if (f.agent) { const why = botBrainProblem(board, f.agent); if (why) fail(why); } return f; };
  const VIA = new Set(['phone']); // 3.5: set by the link (remote.mjs) from the device's kind
  // 3.6 (M4): in a group, each line of a person carries its author's name.
  const lines = (conv, p) => board.chat(conv, Math.min(Number(p.limit) || 200, 500), { before: p.before ? int(p.before, 'línea') : null })
    .map((l) => (l.role === 'usuario' && l.person_id ? { ...l, author: board.personName(l.person_id) } : l));
  const changed = (id) => { bots?.updated(id); return true; };
  const which = (v) => oneOf(v, ['bot', 'mine'], 'memoria', 'bot');
  const memTarget = (id, w, who) => (id === 'global' ? { id: 'global', person: me(who), which: 'bot' } : { id: botId(id, who), person: me(who), which: which(w) });
  // A memory change of memory_log the caller may settle or undo: their own memories, or a bot-wide one with «edit».
  const mayChangeMemory = (who, entry) => {
    const t = entry && B.scopeTarget(entry.scope);
    if (!t) return false;
    if (!scoped(who)) return true;
    if (t.id === 'global' || t.which === 'mine') return t.person === who.person;
    return rank(rightOn(board, who.person, { type: 'bot', id: t.id })) >= rank('edit');
  };
  const memoryEntryFor = (who, logId, method) => {
    const e = B.memoryEntry(board, int(logId, 'cambio'));
    if (!e) fail(tr('msg.bots.memoryGone'));
    if (!mayChangeMemory(who, e)) deny(who, method, { type: 'memory', id: e.id });
    return e;
  };
  // The card of a pending memory change, answered from the editor instead of the chat.
  const closeMemoryCard = (logId, status) => {
    for (const r of board.all("SELECT id, payload FROM bot_requests WHERE kind = 'memory' AND status = 'waiting'")) {
      let p = {}; try { p = JSON.parse(r.payload); } catch { /* none */ }
      if (Number(p.log) !== Number(logId)) continue;
      B.setRequest(board, r.id, status === 'applied' ? 'done' : 'denied');
      const row = board.all("SELECT * FROM chat WHERE meta LIKE ? ORDER BY id DESC LIMIT 5", `%"request":${r.id},%`).map((x) => board.chatRow(x.id)).find((x) => x?.meta?.kind === 'bot_card' && x.meta.request === r.id);
      if (row && row.meta.status === 'pending') bots?.patch(row, { status: status === 'applied' ? 'done' : 'denied' });
    }
  };
  const groupView = (gid, who) => {
    const g = B.getGroup(board, gid);
    const owner = B.personOf(board, g);
    const people = board.all("SELECT person_id AS person, right FROM shares WHERE resource_type = 'group' AND resource_id = ? ORDER BY created_at, person_id", String(g.id)).map((x) => ({ ...x, name: board.personName(x.person) }));
    return { id: g.id, name: g.name, icon: g.icon, owner: { person: owner, name: board.personName(owner) }, right: right(who, { type: 'group', id: g.id }),
      members: B.groupMembers(board, g.id).map((b) => ({ id: b.id, name: b.name, icon: b.icon, is_chief: Boolean(b.is_chief), paused: Boolean(b.paused) })), people };
  };
  return {
    'bots.list': (p, who) => {
      const person = me(who);
      return { bots: B.listBots(board, { principal: scoped(who) }).map((b) => view(b, who)), groups: B.listGroups(board, { principal: scoped(who) }), states: bots?.states(scoped(who) ? person : null) ?? [], tools: B.TOOL_GROUPS };
    },
    'bots.get': ({ id }, who) => {
      const b = B.mustBot(board, botId(id, who));
      const person = me(who);
      return { ...view(b, who), memory: B.readMemory(b.id), mine: B.readMemory(b.id, { person, which: 'mine' }), reminderList: B.listReminders(board, { bot: b.id, person }) };
    },
    // 3.7: home: where it runs («¿Dónde se ejecuta?»: a linked Orb's identity; default this one). Made here, then moved.
    'bots.create': async ({ home, ...p }, who) => {
      const b = B.createBot(board, brainOk(fields(p)), { person: me(who) }); changed(b.id);
      if (home && home !== 'here' && replica()) { const moved = await replica().move(b.id, String(home), {}); return { ...view(B.getBot(board, b.id), who), move: moved }; }
      return view(b, who);
    },
    'bots.update': async ({ id, ...p }, who) => {
      const row = rowOf(botId(id, who));
      if (elsewhere(row)) { const f = brainOk(fields(p)); const r = await viaHome(row, 'bots.update', f, who); return { ...view(B.getBot(board, row.id), who), forwarded: r }; }
      const b = B.updateBot(board, row.id, brainOk(fields(p))); if (b.paused) bots?.stop(b.id); changed(b.id); return view(b, who);
    },
    'bots.delete': async ({ id }, who) => {
      const row = rowOf(botId(id, who));
      // A frozen copy (its Orb was unlinked, or is no longer linked): only the copy here goes; the bot, if it still
      // runs there, is not touched.
      if (elsewhere(row) && (row.home_state === 'archived' || !replica()?.peers().some((p) => p.key === row.home))) { B.deleteBot(board, row.id); bots?.drop(row.id); changed(row.id); return true; }
      // Deleted at its home: the copy here goes at once (the other Orbs' copies, at their next sync).
      if (elsewhere(row)) { const r = await viaHome(row, 'bots.delete', {}, who); if (r?.forwarded) { try { B.deleteBot(board, row.id); } catch { /* gone */ } changed(row.id); } return true; }
      const b = B.deleteBot(board, row.id); bots?.drop(b.id); changed(b.id); return true;
    },
    'bots.pause': async ({ id, paused }, who) => {
      const row = rowOf(botId(id, who));
      if (elsewhere(row)) { const r = await viaHome(row, 'bots.pause', { paused: paused !== false }, who); return { ...view(B.getBot(board, row.id), who), forwarded: r }; }
      const b = B.updateBot(board, row.id, { paused: paused !== false }); if (b.paused) bots?.stop(b.id); changed(b.id); return view(b, who);
    },
    'bots.chat': ({ id, ...p }, who) => { const b = B.mustBot(board, botId(id, who)); const conv = B.botConversation(board, b, { person: me(who) }); return { conversation: conv, lines: lines(conv, p), state: bots?.state(b.id, me(who)) ?? null, ...homeOf(b) }; },
    'bots.send': async ({ id, text, via }, who) => {
      const row = rowOf(botId(id, who));
      if (elsewhere(row)) {
        const r = await viaHome(row, 'bots.send', { text: str(text, 'mensaje', 20000), via: VIA.has(via) ? via : null }, who);
        return { conversation: B.botConversation(board, B.getBot(board, row.id), { person: me(who) }), bot: row.id, forwarded: Boolean(r.forwarded), queued: Boolean(r.queued) };
      }
      const r = need().send(row.id, str(text, 'mensaje', 20000), { via: VIA.has(via) ? via : null, person: me(who) }); return { conversation: r.conversation, bot: r.bot };
    },
    'bots.stop': async ({ id }, who) => {
      const row = rowOf(botId(id, who));
      if (elsewhere(row)) { await viaHome(row, 'bots.stop', {}, who); return true; }
      need().stop(row.id, scoped(who) ? who.person : null); return true;
    },
    // 3.5.1: by: who answers (a linked device, set by remote.mjs from its own record; null: this PC). 3.6: who: the person.
    'bots.decide': async ({ item, decision, by }, who) => {
      const { line, row } = cardBot(item);
      // 3.7: a card of a bot run on another Orb is answered there (its approvers are that Orb's people).
      if (elsewhere(row)) { const r = await viaHome(row, 'bots.decide', { decision: oneOf(decision, ['allow', 'deny'], 'decisión') }, who, { item: line.uid }); return { ok: r.result?.ok !== false, status: r.result?.status ?? (r.queued ? 'queued' : null), forwarded: true }; }
      return need().decide(int(item, 'tarjeta'), oneOf(decision, ['allow', 'deny'], 'decisión'), { by: by && typeof by === 'object' ? by : null, principal: scoped(who) });
    },
    // 3.6: the cards waiting for the caller's answer, wherever they are (a card of someone else's turn that only the
    // caller may approve: the house, the server, a change of the caller's bot).
    'bots.cards': (p, who) => {
      const person = me(who);
      return board.all("SELECT id FROM chat WHERE meta LIKE '%\"kind\":\"bot_card\"%' AND meta LIKE '%\"status\":\"pending\"%' ORDER BY id DESC LIMIT 200").map((r) => board.chatRow(r.id))
        .filter((r) => r?.meta?.status === 'pending' && (Array.isArray(r.meta.approvers) ? r.meta.approvers : [r.meta.talker ?? board.ownerId()]).includes(person))
        .slice(0, 50).map((r) => ({ id: r.id, conversation: r.conversation_id, body: r.body, at: r.at, card: r.meta.card, bot: r.meta.bot, sensitive: isSensitiveCard(r.meta), by: r.meta.talker && r.meta.talker !== person ? board.personName(r.meta.talker) : null }));
    },
    'bots.answer': async ({ item, text }, who) => {
      const { line, row } = cardBot(item);
      if (elsewhere(row)) { await viaHome(row, 'bots.answer', { text: str(text, 'respuesta', 4000) }, who, { item: line.uid }); return { conversation: line.conversation_id, bot: row.id, forwarded: true }; }
      const r = need().answer(int(item, 'tarjeta'), str(text, 'respuesta', 4000), { person: scoped(who) ? who.person : null }); return { conversation: r.conversation, bot: r.bot };
    },
    'bots.groups.list': (p, who) => B.listGroups(board, { principal: scoped(who) }),
    // 3.6 (messaging lists): people: persons the group is shared with to talk (the same rules as shares.set).
    'bots.groups.create': ({ name, icon, members, people }, who) => {
      if (people != null && (!Array.isArray(people) || people.length > 30)) fail(tr('msg.api.invalid', { name: 'people' }));
      const g = B.createGroup(board, { name, icon, members: members ?? [] }, { person: me(who) });
      try { for (const p of new Set(people ?? [])) setShare({ type: 'group', id: String(g.id), person: p, right: 'talk' }, who); }
      catch (error) { B.deleteGroup(board, g.id); throw error; }
      changed(null); return g;
    },
    // 3.6 (messaging lists): a group as its info screen shows it: its bots (the chief first), its people and whose it is.
    'bots.groups.get': ({ id }, who) => groupView(groupId(id), who),
    // Add or remove one bot (bot) or one person (person; to talk, or right 'view'). Anyone in the group may leave it.
    'bots.groups.members.add': ({ id, bot, person, right: r }, who) => {
      const g = B.getGroup(board, groupId(id));
      if (bot != null) B.updateGroup(board, g.id, { members: [...g.members, B.mustBot(board, bot, { person: B.personOf(board, g) }).id] });
      else setShare({ type: 'group', id: String(g.id), person, right: oneOf(r, ['view', 'talk'], 'permiso', 'talk') }, who);
      changed(null); return groupView(g.id, who);
    },
    'bots.groups.members.remove': ({ id, bot, person }, who) => {
      const g = B.getGroup(board, groupId(id));
      const res = { type: 'group', id: g.id };
      const leaving = bot == null && person === me(who);
      if (!leaving && rank(right(who, res)) < rank('edit')) deny(who, 'bots.groups.members.remove', res);
      if (bot != null) { const b = B.mustBot(board, bot, { person: B.personOf(board, g) }).id; B.updateGroup(board, g.id, { members: g.members.filter((m) => m !== b) }); }
      else removeShare({ type: 'group', id: String(g.id), person }, who);
      changed(null); return leaving ? { ok: true } : groupView(g.id, who);
    },
    'bots.groups.update': ({ id, name, icon, members }) => { const g = B.updateGroup(board, groupId(id), { name, icon, members }); changed(null); return g; },
    'bots.groups.delete': ({ id }) => { B.deleteGroup(board, groupId(id)); changed(null); return true; },
    'bots.groups.chat': ({ id, ...p }) => { const conv = B.groupConversation(board, groupId(id)); return { conversation: conv, lines: lines(conv, p) }; },
    // 3.6 (messaging lists): members: who answers (with @Name in the text, only those named: mentioned).
    'bots.groups.send': async ({ id, text, via }, who) => {
      const g = board.one('SELECT * FROM bot_groups WHERE id = ?', groupId(id));
      if (elsewhere(g)) { const r = await viaHome(g, 'bots.groups.send', { text: str(text, 'mensaje', 20000), via: VIA.has(via) ? via : null }, who); return { conversation: B.groupConversation(board, g.id), group: g.id, members: [], mentioned: [], forwarded: Boolean(r.forwarded), queued: Boolean(r.queued) }; }
      const r = need().sendGroup(g.id, str(text, 'mensaje', 20000), { via: VIA.has(via) ? via : null, person: me(who) }); return { conversation: r.conversation, group: r.group, members: r.members, mentioned: r.mentioned ?? [] };
    },
    // 3.6: id 'global': the caller's global memory; which: 'bot' (the bot's, as 3.5) or 'mine' (the caller's file of it).
    'bots.memory.get': ({ id, which: w }, who) => { const t = memTarget(id, w, who); return { id: t.id, which: t.which, text: B.readMemory(t.id, { person: t.person, which: t.which }) }; },
    'bots.memory.set': async ({ id, text, which: w }, who) => {
      const t = memTarget(id, w, who);
      if (t.id !== 'global' && elsewhere(rowOf(t.id))) { await viaHome(rowOf(t.id), 'bots.memory.set', { text: str(text, 'memoria', 64 * 1024, { optional: true }), which: t.which }, who); return { id: t.id, which: t.which, text: str(text, 'memoria', 64 * 1024, { optional: true }), forwarded: true }; }
      B.writeMemory(t.id, str(text, 'memoria', 64 * 1024, { optional: true }), { mode: 'replace', person: t.person, which: t.which, board, actor: me(who) });
      if (t.id !== 'global') changed(t.id);
      return { id: t.id, which: t.which, text: B.readMemory(t.id, { person: t.person, which: t.which }) };
    },
    // 3.6 (A5): the history of a memory (newest first), its pending changes, approving one and undoing one.
    'bots.memory.history': ({ id, which: w, limit }, who) => { const t = memTarget(id, w, who); return B.memoryHistory(board, B.memoryScope(t.id, { person: t.person, which: t.which }), { limit }); },
    'bots.memory.pending': (p, who) => {
      const person = me(who);
      const own = (() => { try { return board.all("SELECT id, at, person_id, scope, actor, op, status, text FROM memory_log WHERE status = 'pending' AND person_id = ? ORDER BY id DESC LIMIT 100", person); } catch { return []; } })();
      return own.filter((e) => mayChangeMemory(who, e));
    },
    'bots.memory.approve': ({ id, approve }, who) => {
      const e = memoryEntryFor(who, id, 'bots.memory.approve');
      const out = B.settleMemory(board, e.id, approve !== false);
      closeMemoryCard(e.id, out.status);
      const t = B.scopeTarget(e.scope); if (t?.id !== 'global') changed(t.id);
      return out;
    },
    'bots.memory.undo': ({ id }, who) => {
      const e = memoryEntryFor(who, id, 'bots.memory.undo');
      const out = B.undoMemory(board, e.id);
      const t = B.scopeTarget(e.scope); if (t?.id !== 'global') changed(t.id);
      return out;
    },
    'bots.rules.get': () => B.goldenRules(),
    'bots.rules.set': ({ rules }) => {
      if (!Array.isArray(rules)) fail(tr('msg.api.invalid', { name: 'rules' }));
      const c = saveConfig({ bots: { rules: rules.map((r) => oneLine(String(r ?? ''), 400).trim()).filter(Boolean) } }); emit('config:changed', c); changed(null);
      return B.goldenRules();
    },
    // 3.5: «Cosas que nadie toca» (config.protected): names, paths or containers no agent and no bot touches.
    'bots.protected.get': () => protectedList(),
    'bots.protected.set': ({ items }) => {
      if (!Array.isArray(items)) fail(tr('msg.api.invalid', { name: 'items' }));
      const seen = new Set(); const list = [];
      for (const x of items) { const v = oneLine(String(x ?? ''), 200).trim(); if (v.length >= 2 && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); list.push(v); } }
      const c = saveConfig({ protected: list.slice(0, 50) }); emit('config:changed', c); changed(null);
      return protectedList();
    },
    // 3.6: each person's own reminders (of their bots and of the ones shared with them).
    // 3.7: each reminder with its uid (the phone keeps one per uid) and executor: whether this Orb rings it (only the home
    // of its bot does; the phone schedules only those).
    'bots.reminders.list': ({ id, all }, who) => B.listReminders(board, { bot: id ? botId(id, who) : null, all: all === true, person: scoped(who) ? who.person : null })
      .map((r) => { const row = rowOf(r.bot_id); return { ...r, executor: Boolean(row && isHomeHere(board, row) && (row.home_state ?? 'active') === 'active') }; }),
    'bots.reminders.create': async ({ id, text, when, every, weekdays, tz, skip_missed }, who) => {
      const row = rowOf(botId(id, who));
      if (elsewhere(row)) { const r = await viaHome(row, 'bots.reminders.create', { text, when, every: every ?? 'once', weekdays: weekdays ?? [], tz: typeof tz === 'string' ? tz : null, skip_missed: skip_missed !== false }, who); return { forwarded: Boolean(r.forwarded), queued: Boolean(r.queued), bot_id: row.id }; }
      const r = B.createReminder(board, { bot_id: botId(id, who), text, when, every: every ?? 'once', weekdays: weekdays ?? [], tz: typeof tz === 'string' ? tz : null, skip_missed: skip_missed !== false }, 'usuario', { person: me(who) });
      changed(r.bot_id); return r;
    },
    'bots.reminders.cancel': async ({ id }, who) => {
      const rem = B.getReminder(board, int(id, 'recordatorio')); const row = rem ? rowOf(rem.bot_id) : null;
      if (elsewhere(row)) { if (scoped(who) && B.personOf(board, rem) !== who.person) fail(tr('msg.bots.noReminder')); const r = await viaHome(row, 'bots.reminders.cancel', {}, who, { reminder: rem.uid }); return { ...rem, forwarded: Boolean(r.forwarded), queued: Boolean(r.queued) }; }
      const r = B.cancelReminder(board, int(id, 'recordatorio'), { person: scoped(who) ? who.person : null }); changed(r.bot_id); return r;
    },
    // Home Assistant: its address in the settings, its token in the database (PC only: not in the phone's list).
    'bots.ha.get': () => { const h = B.haConfig(board); return { url: h.url, hasToken: Boolean(h.token) }; },
    // 3.5 (interface): «Casa» and «Servidor» of the Bots mode, read only. Home Assistant not set: { configured: false }.
    'bots.ha.states': async () => {
      const h = B.haConfig(board);
      if (!h.url || !h.token) return { configured: false, states: [] };
      const out = await haFetch(h, 'GET', 'states');
      const states = (Array.isArray(out) ? out : []).slice(0, 400).map((s) => ({ entity_id: String(s.entity_id ?? ''), state: oneLine(String(s.state ?? ''), 60), name: oneLine(String(s.attributes?.friendly_name ?? s.entity_id ?? ''), 80), unit: s.attributes?.unit_of_measurement ? oneLine(String(s.attributes.unit_of_measurement), 12) : null, changed: s.last_changed ?? null }));
      return { configured: true, states };
    },
    'bots.srv.status': () => serverStatus(),
    // 3.5.1: the token belongs to the address it was given for: a new address without a new token leaves no token.
    'bots.ha.set': ({ url, token }) => {
      if (url !== undefined) {
        const next = str(url, 'dirección', 300, { optional: true }).trim().replace(/\/+$/, '');
        if (next !== B.haConfig(board).url) B.setHaToken(board, '', next);
        const c = saveConfig({ bots: { homeAssistant: { url: next } } }); emit('config:changed', c);
      }
      if (token !== undefined) B.setHaToken(board, str(token, 'token', 4000, { optional: true }).trim(), B.haConfig(board).url);
      const h = B.haConfig(board); return { url: h.url, hasToken: Boolean(h.token) };
    },
    // 3.6 (A7): the caller's list of Home Assistant calls their bots make without a card («light.turn_on light.salon»,
    // «light.turn_on *»); null: none yet (only the always-card ones ask). The always-card ones go free only by exact entity.
    'bots.ha.allow.get': (p, who) => ({ list: B.haAllowList(board, me(who)), always: B.HA_ALWAYS }),
    'bots.ha.allow.set': ({ list }, who) => ({ list: B.setHaAllowList(board, me(who), list == null ? null : list), always: B.HA_ALWAYS }),
    // 3.6 (A14): the conversation with a bot brought from another Orb («Llevar mis bots» with its history), as it was.
    'bots.history.import': ({ id, lines: rows }, who) => {
      const b = B.mustBot(board, botId(id, who));
      if (!Array.isArray(rows) || rows.length > 500) fail(tr('msg.api.invalid', { name: 'lines' }));
      const conv = B.botConversation(board, b, { person: me(who) });
      let n = 0;
      for (const l of rows) {
        const role = l?.role === 'bot' ? 'bot' : 'usuario';
        const body = str(String(l?.body ?? ''), 'mensaje', 20000, { optional: true }); if (!body.trim()) continue;
        board.addChat(role, body, role === 'bot' ? { bot: b.id, name: b.name, imported: true } : { imported: true }, conv, { person: role === 'usuario' ? me(who) : null }); n++;
      }
      return { conversation: conv, lines: n };
    },
    // ---- 3.7 (WS3): one home per bot (src/engine/replica.mjs)
    // Where a bot can run: this Orb and every linked Orb of 3.7 ({ key, name, here, online, server, brains }).
    'bots.homes': () => replica()?.homes() ?? [],
    // «Pasar al PC» / «Pasar al Server»: id, to (an Orb's identity from bots.homes, or 'here'), force (its home is off:
    // take it over here), group ('group' | 'leave'), brain ({ agent, model }). → { ok, step?: 'group' | 'brain' | 'confirm', … }
    'bots.move': async ({ id, to, force, group, brain }, who) => {
      if (!replica()) fail(tr('msg.bots.off'));
      const row = rowOf(botId(id, who));
      const r = await replica().move(row.id, str(to ?? 'here', 'lugar', 64), { force: force === true, group: group == null ? null : oneOf(group, ['group', 'leave'], 'grupo'), brain: brain && typeof brain === 'object' ? { agent: str(brain.agent, 'cerebro', 40), model: brain.model ? str(brain.model, 'modelo', 80) : null } : null });
      changed(row.id); return r;
    },
    // A copy whose home is gone (unlinked, a server reinstalled): it runs here (to: here) or on a new Orb.
    'bots.restore': async ({ id, to }, who) => { if (!replica()) fail(tr('msg.bots.off')); const row = rowOf(botId(id, who)); const r = await replica().restore(row.id, to ? str(to, 'lugar', 64) : null); changed(row.id); return r; },
    // Two bots of the same name after a move: survivor keeps its memory; the other's becomes proposals, it is archived.
    'bots.merge': async ({ survivor, other }, who) => {
      if (!replica()) fail(tr('msg.bots.off'));
      const a = rowOf(botId(survivor, who)); const b = rowOf(botId(other, who));
      if (elsewhere(a)) { await viaHome(a, 'bots.merge', {}, who, { other: b.uid }); return { ok: true, forwarded: true }; }
      const r = replica().merge(a.id, b.id); changed(a.id); return r;
    },
    // «Es el mismo bot»: a bot here (left paused by «Llevar mis bots» of 3.6) is the copy of one run on a linked Orb (uid).
    'bots.sameBot': ({ id, uid }, who) => { if (!replica()) fail(tr('msg.bots.off')); const r = replica().sameBot(botId(id, who), str(uid, 'uid', 40)); changed(null); return r; },
    // Unlink an Orb that runs bots: mode 'bring' (every bot of the caller comes here first), 'leave' (they stay there;
    // frozen copies here, «Restaurar aquí»), 'cancel'.
    'bots.unlink': async ({ peer, mode }, who) => { if (!replica()) fail(tr('msg.bots.off')); const r = await replica().unlink(str(peer, 'enlace', 80), oneOf(mode, ['bring', 'leave', 'cancel'], 'modo'), scoped(who)); changed(null); return r; },
    // The sync of the copies with each linked Orb (owner): peers, the moves' journal, what waits.
    'replica.status': () => replica()?.status() ?? { peers: [], moves: [], queued: 0 },
    'replica.sync': async () => replica()?.syncNow() ?? { peers: [] }
  };
}
