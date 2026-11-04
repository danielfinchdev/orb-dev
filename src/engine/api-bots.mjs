// The bots' part of the engine's API (3.5; split out of api.mjs in 3.6): src/engine/bots.mjs does the work,
// src/core/bots.mjs keeps the data. Also where the bots live (bots.where, bots.moveTo) and centro.<method>.
// 3.6 «Personas» (WS4): every method gets the caller (who, a principal; none: the engine itself). Lists show the caller's
// own bots, groups and reminders and the ones shared with them; a conversation with a bot, its live session and a memory
// file are each person's own; creates are stamped with the caller. authz.authorize already checked the right on the
// resource (src/core/policy.mjs › BOTSP); what depends on more than that is checked here.
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { hostsBots } from '../core/home.mjs';
import { protectedList } from '../core/guard.mjs';
import { oneLine } from '../core/safety.mjs';
import { rightOn, rank, AuthzError, audit } from '../core/authz.mjs';
import { account as findAccount } from '../core/accounts.mjs';
import * as B from '../core/bots.mjs';
import { serverStatus, haFetch } from '../core/server-admin.mjs';
import { CENTRO_FORWARD } from './remote.mjs';
import { botBrainProblem, isSensitiveCard } from './bots.mjs';
import { fail, str, int, oneOf } from './api-common.mjs';

// The linked Orbs that keep bots and «Llevar mis bots» (shared by bots.where/moveTo and centro.*).
function hub({ board, bots, remoteRef }) {
  // 3.5: the linked Orbs that keep bots («centro» or «todo»), the one chosen in «¿Dónde quieres tus bots?» (bots.location)
  // and a call to its bots. Without a choice, centro.* still reaches the first of them (the one on now first), but this
  // Orb's own bots are the ones shown (active: false). 3.6: the choice is each person's (person_settings; the owner's
  // reads orb.json as before).
  const hubPeers = () => (remoteRef.link?.peers() ?? []).filter((p) => hostsBots(p.role ?? 'taller') && !p.revoked);
  const owner = () => board.ownerId();
  const botsLocation = (person = null) => {
    const p = person ?? owner();
    let v; try { v = board.personSetting(p, 'bots.location'); } catch { v = undefined; }
    return String(v || (board.isOwnerPerson(p) ? ctx.config.bots?.location : '') || 'local');
  };
  const setLocation = (person, loc, emit) => {
    if (board.isOwnerPerson(person)) { const c = saveConfig({ bots: { location: loc } }); emit?.('config:changed', c); }
    else board.personSetting(person, 'bots.location', loc);
  };
  // 3.6 (WS2): person: only that person's links here (a link without a person is the owner's).
  const centroPeer = (person = null) => {
    const list = hubPeers().filter((p) => !person || (p.person ?? owner()) === person); const loc = botsLocation(person);
    return (loc !== 'local' && list.find((p) => p.id === loc)) || list.find((p) => p.online) || list[0] || null;
  };
  // The Orbs already asked about (the card after linking is shown once for each).
  const askedList = () => board.settingJson('bots_location_asked') ?? [];
  const asked = (id) => { if (id && !askedList().includes(id)) board.settingJson('bots_location_asked', [...askedList(), id].slice(-50)); };
  function botsWhere(person = null) {
    const loc = botsLocation(person); const peers = hubPeers();
    const s = B.listBots(board, { person: person ?? owner() });
    const here = s.filter((b) => !b.paused).length;
    const ask = loc === 'local' ? peers.find((p) => !askedList().includes(p.id)) ?? null : null;
    return { location: loc, peer: loc === 'local' ? null : peers.find((p) => p.id === loc) ?? null, peers: peers.map(({ id, name, role: r, online }) => ({ id, name, role: r, online })),
      localBots: here, ask: ask ? { id: ask.id, name: ask.name } : null };
  }

  // 3.6 (A14) «Llevar mis bots», in two phases. 1) Copy: each bot of the person (an untouched «Asistente» whose name is
  // taken there is not), with the accounts and connectors mapped to the other Orb's (the step the user is shown first:
  // mapping), the bot's memory and the person's own memory of it, the reminders in their wall time and zone and,
  // optionally, the conversation; each copy is read back and checked. 2) Only when everything was copied and checked,
  // the bots are paused here and their reminders cancelled (they would ring twice), at once. If anything fails, the copies
  // made there are deleted and nothing here changes; a run cut half way (the app closed) is cleaned up the next time
  // (bots_move journal). → a report.
  const JOURNAL = 'bots_move';
  async function cleanLeftovers(call, peer) {
    const j = board.settingJson(JOURNAL);
    if (!j || j.peer !== peer.id || !j.copies?.length) { if (j && j.peer === peer.id) board.run('DELETE FROM settings WHERE key = ?', JOURNAL); return 0; }
    let n = 0;
    for (const id of j.copies) { try { await call('bots.delete', { id }); n++; } catch { /* already gone */ } }
    board.run('DELETE FROM settings WHERE key = ?', JOURNAL);
    return n;
  }
  async function bringBots(peer, { person = null, mapping = null, history = false } = {}) {
    const me = person ?? owner();
    const call = (m, p) => remoteRef.link.call(peer.id, m, p);
    const offline = (error) => { const e = new Error(tr('msg.link.centroOffline', { name: peer.name })); e.userFacing = true; e.cause = error; throw e; };
    const there = await call('bots.list', {}).catch(offline);
    const mine = B.listBots(board, { person: me });
    const accounts = [...new Set(mine.map((b) => b.accounts?.account).filter(Boolean))];
    const connectors = [...new Set(mine.flatMap((b) => b.accounts?.mcp ?? []))];
    // The mapping step: what the bots spend and use here, and the bots already there (the user chooses, then calls again).
    // Bots that spend no chosen account and use no connector have nothing to map: straight to the copy.
    if ((accounts.length || connectors.length) && (!mapping || typeof mapping !== 'object')) {
      return { step: 'mapping', peer: { id: peer.id, name: peer.name }, bots: mine.map((b) => ({ id: b.id, name: b.name, account: b.accounts?.account ?? null, connectors: b.accounts?.mcp ?? [] })),
        accounts: accounts.map((id) => ({ id, label: findAccount(id)?.label ?? id })), connectors, there: (there.bots ?? []).map((b) => b.name) };
    }
    mapping = mapping && typeof mapping === 'object' ? mapping : {};
    const cleaned = await cleanLeftovers(call, peer);
    const mapAccount = (id) => (id && Object.hasOwn(mapping.accounts ?? {}, id) ? mapping.accounts[id] || null : null);
    const mapMcp = (list) => (list ?? []).map((n) => (Object.hasOwn(mapping.connectors ?? {}, n) ? mapping.connectors[n] : null)).filter((n) => typeof n === 'string' && n);
    const taken = new Set((there.bots ?? []).map((b) => String(b.name).toLowerCase()));
    let chief = (there.bots ?? []).some((b) => b.is_chief);
    const report = []; const skipped = []; const copies = [];
    board.settingJson(JOURNAL, { peer: peer.id, at: new Date().toISOString(), copies: [] });
    const step = (b, what) => (error) => { const e = new Error(oneLine(error?.message ?? String(error), 300)); e.bot = b.name; e.step = what; throw e; };
    try {
      for (const b of mine) {
        const wide = B.readMemory(b.id);
        const own = B.readMemory(b.id, { person: me, which: 'mine' });
        const reminders = B.listReminders(board, { bot: b.id, person: me });
        const untouched = !b.role_text && !wide.trim() && !own.trim() && !reminders.length;
        let name = b.name;
        if (taken.has(name.toLowerCase())) {
          if (untouched) { skipped.push(b.name); continue; }
          for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${b.name.slice(0, 36)} ${n}`;
        }
        const acc = { ...(b.accounts ?? {}) };
        const mappedAccount = mapAccount(acc.account); if (mappedAccount) acc.account = mappedAccount; else delete acc.account;
        if (acc.mcp) acc.mcp = mapMcp(acc.mcp);
        const copy = await call('bots.create', { name, icon: b.icon, role_text: b.role_text, agent: b.agent, model: b.model, effort: b.effort, tools: b.tools, accounts: acc, exclusive: b.exclusive ?? [], is_chief: Boolean(b.is_chief) && !chief, paused: Boolean(b.paused), ...(b.caps ? { caps: b.caps } : {}) }).catch(step(b, 'create'));
        copies.push({ local: b, copy, reminders });
        board.settingJson(JOURNAL, { peer: peer.id, at: new Date().toISOString(), copies: copies.map((c) => c.copy.id) });
        taken.add(name.toLowerCase()); if (copy.is_chief) chief = true;
        if (wide.trim()) await call('bots.memory.set', { id: copy.id, text: wide }).catch(step(b, 'memory'));
        if (own.trim()) await call('bots.memory.set', { id: copy.id, which: 'mine', text: own }).catch(step(b, 'memory'));
        for (const r of reminders) {
          await call('bots.reminders.create', { id: copy.id, text: r.text, when: r.local_at ?? (r.every === 'once' ? r.next_run : r.start_at), tz: r.tz ?? undefined, every: r.every, weekdays: r.weekdays ?? [], skip_missed: r.skip_missed !== false }).catch(step(b, 'reminders'));
        }
        let lines = 0;
        if (history === true) {
          const conv = B.botConversation(board, b, { person: me });
          const rows = board.chat(conv, 500).filter((l) => l.role === 'usuario' || l.role === 'bot').map((l) => ({ role: l.role, body: l.body, at: l.at, name: l.meta?.name ?? null }));
          if (rows.length) { await call('bots.history.import', { id: copy.id, lines: rows }).catch(step(b, 'history')); lines = rows.length; }
        }
        // Read back and checked: the memory, the person's memory and the number of reminders.
        const back = await call('bots.get', { id: copy.id }).catch(step(b, 'verify'));
        const same = (x, y) => String(x ?? '').trim() === String(y ?? '').trim();
        if (!same(back.memory, wide) || !same(back.mine, own) || (back.reminderList ?? []).length !== reminders.length) step(b, 'verify')(new Error(tr('msg.bots.moveMismatch', { name: b.name })));
        report.push({ bot: b.name, copy: copy.id, name: copy.name, memory: Boolean(wide.trim() || own.trim()), reminders: reminders.length, history: lines, account: acc.account ?? null });
      }
      const global = B.readMemory('global', { person: me }).trim();
      if (global) {
        const theirs = (await call('bots.memory.get', { id: 'global' }).catch(() => ({ text: '' }))).text ?? '';
        if (!theirs.includes(global)) await call('bots.memory.set', { id: 'global', text: `${theirs.trim()}${theirs.trim() ? '\n\n' : ''}${global}` }).catch((e) => step({ name: 'global' }, 'memory')(e));
      }
    } catch (error) {
      // Nothing half: the copies made there go, everything here stays as it was.
      const kept = [];
      for (const c of copies.reverse()) { try { await call('bots.delete', { id: c.copy.id }); } catch { kept.push(c.copy.id); } }
      if (kept.length) board.settingJson(JOURNAL, { peer: peer.id, at: new Date().toISOString(), copies: kept }); else board.run('DELETE FROM settings WHERE key = ?', JOURNAL);
      return { ok: false, moved: 0, skipped, cleaned, failed: { bot: error.bot ?? null, step: error.step ?? null, message: oneLine(error.message, 300) }, report };
    }
    // Phase 2: everything is there and checked. Here, at once: paused, reminders cancelled.
    board.transaction(() => {
      for (const c of copies) {
        for (const r of c.reminders) { try { B.cancelReminder(board, r.id); } catch { /* gone */ } }
        if (!c.local.paused) B.updateBot(board, c.local.id, { paused: true });
      }
      board.run('DELETE FROM settings WHERE key = ?', JOURNAL);
    });
    for (const c of copies) { bots?.stop(c.local.id); bots?.updated(c.local.id); }
    return { ok: true, moved: copies.length, skipped, cleaned, report };
  }
  return { hubPeers, botsLocation, setLocation, centroPeer, asked, botsWhere, bringBots };
}

export function botMethods({ board, emit, remoteRef, bots }) {
  const { hubPeers, asked, botsWhere, bringBots, setLocation } = hub({ board, bots, remoteRef });
  const need = () => bots ?? fail(tr('msg.bots.off'));
  const scoped = (who) => (who && who.channel !== 'system' ? who : null);
  const me = (who) => (scoped(who) ? who.person : board.ownerId());
  const botId = (id, who) => B.mustBot(board, id ?? fail(tr('msg.api.missing', { name: 'bot' })), scoped(who) ? { person: who.person } : {}).id;
  const groupId = (id) => (B.getGroup(board, int(id, 'grupo')) ?? fail(tr('msg.bots.noGroup'))).id;
  const right = (who, res) => (scoped(who) ? rightOn(board, who.person, res) : 'own');
  const deny = (who, method, res) => { audit(board, who, method, res, 'deny', 'right'); throw new AuthzError('right', { method, resource: res }); };
  const view = (b, who) => {
    const person = me(who);
    const owner = B.personOf(board, b);
    return { ...b, effectiveTools: B.effectiveTools(board, b), conversation: B.botConversation(board, b, { person }), state: bots?.state(b.id, person) ?? null,
      reminders: B.listReminders(board, { bot: b.id, person }).length, right: right(who, { type: 'bot', id: b.id }),
      ...(owner !== person ? { sharedBy: { person: owner, name: board.personName(owner) } } : {}) };
  };
  const fields = (p) => Object.fromEntries(['name', 'icon', 'role_text', 'agent', 'model', 'effort', 'tools', 'accounts', 'exclusive', 'is_chief', 'paused', 'caps'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  // 3.6 (S1): a brain that cannot run confined is refused when it is chosen (and again when the bot starts).
  const brainOk = (f) => { if (f.agent) { const why = botBrainProblem(board, f.agent); if (why) fail(why); } return f; };
  const VIA = new Set(['phone', 'terminal']); // 3.5: set by the link (remote.mjs) from the device's kind
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
    'bots.create': (p, who) => { const b = B.createBot(board, brainOk(fields(p)), { person: me(who) }); changed(b.id); return view(b, who); },
    'bots.update': ({ id, ...p }, who) => { const b = B.updateBot(board, botId(id, who), brainOk(fields(p))); if (b.paused) bots?.stop(b.id); changed(b.id); return view(b, who); },
    'bots.delete': ({ id }, who) => { const b = B.deleteBot(board, botId(id, who)); bots?.drop(b.id); changed(b.id); return true; },
    'bots.pause': ({ id, paused }, who) => { const b = B.updateBot(board, botId(id, who), { paused: paused !== false }); if (b.paused) bots?.stop(b.id); changed(b.id); return view(b, who); },
    'bots.chat': ({ id, ...p }, who) => { const b = B.mustBot(board, botId(id, who)); const conv = B.botConversation(board, b, { person: me(who) }); return { conversation: conv, lines: lines(conv, p), state: bots?.state(b.id, me(who)) ?? null }; },
    'bots.send': ({ id, text, via }, who) => { const r = need().send(botId(id, who), str(text, 'mensaje', 20000), { via: VIA.has(via) ? via : null, person: me(who) }); return { conversation: r.conversation, bot: r.bot }; },
    'bots.stop': ({ id }, who) => { need().stop(botId(id, who), scoped(who) ? who.person : null); return true; },
    // 3.5.1: by: who answers (a linked device, set by remote.mjs from its own record; null: this PC). 3.6: who: the person.
    'bots.decide': ({ item, decision, by }, who) => need().decide(int(item, 'tarjeta'), oneOf(decision, ['allow', 'deny'], 'decisión'), { by: by && typeof by === 'object' ? by : null, principal: scoped(who) }),
    // 3.6: the cards waiting for the caller's answer, wherever they are (a card of someone else's turn that only the
    // caller may approve: the house, the server, a change of the caller's bot).
    'bots.cards': (p, who) => {
      const person = me(who);
      return board.all("SELECT id FROM chat WHERE meta LIKE '%\"kind\":\"bot_card\"%' AND meta LIKE '%\"status\":\"pending\"%' ORDER BY id DESC LIMIT 200").map((r) => board.chatRow(r.id))
        .filter((r) => r?.meta?.status === 'pending' && (Array.isArray(r.meta.approvers) ? r.meta.approvers : [r.meta.talker ?? board.ownerId()]).includes(person))
        .slice(0, 50).map((r) => ({ id: r.id, conversation: r.conversation_id, body: r.body, at: r.at, card: r.meta.card, bot: r.meta.bot, sensitive: isSensitiveCard(r.meta), by: r.meta.talker && r.meta.talker !== person ? board.personName(r.meta.talker) : null }));
    },
    'bots.answer': ({ item, text }, who) => { const r = need().answer(int(item, 'tarjeta'), str(text, 'respuesta', 4000), { person: scoped(who) ? who.person : null }); return { conversation: r.conversation, bot: r.bot }; },
    'bots.groups.list': (p, who) => B.listGroups(board, { principal: scoped(who) }),
    'bots.groups.create': ({ name, icon, members }, who) => { const g = B.createGroup(board, { name, icon, members: members ?? [] }, { person: me(who) }); changed(null); return g; },
    'bots.groups.update': ({ id, name, icon, members }) => { const g = B.updateGroup(board, groupId(id), { name, icon, members }); changed(null); return g; },
    'bots.groups.delete': ({ id }) => { B.deleteGroup(board, groupId(id)); changed(null); return true; },
    'bots.groups.chat': ({ id, ...p }) => { const conv = B.groupConversation(board, groupId(id)); return { conversation: conv, lines: lines(conv, p) }; },
    'bots.groups.send': ({ id, text, via }, who) => { const r = need().sendGroup(groupId(id), str(text, 'mensaje', 20000), { via: VIA.has(via) ? via : null, person: me(who) }); return { conversation: r.conversation, group: r.group, members: r.members }; },
    // 3.6: id 'global': the caller's global memory; which: 'bot' (the bot's, as 3.5) or 'mine' (the caller's file of it).
    'bots.memory.get': ({ id, which: w }, who) => { const t = memTarget(id, w, who); return { id: t.id, which: t.which, text: B.readMemory(t.id, { person: t.person, which: t.which }) }; },
    'bots.memory.set': ({ id, text, which: w }, who) => {
      const t = memTarget(id, w, who);
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
    'bots.reminders.list': ({ id, all }, who) => B.listReminders(board, { bot: id ? botId(id, who) : null, all: all === true, person: scoped(who) ? who.person : null }),
    'bots.reminders.create': ({ id, text, when, every, weekdays, tz, skip_missed }, who) => {
      const r = B.createReminder(board, { bot_id: botId(id, who), text, when, every: every ?? 'once', weekdays: weekdays ?? [], tz: typeof tz === 'string' ? tz : null, skip_missed: skip_missed !== false }, 'usuario', { person: me(who) });
      changed(r.bot_id); return r;
    },
    'bots.reminders.cancel': ({ id }, who) => { const r = B.cancelReminder(board, int(id, 'recordatorio'), { person: scoped(who) ? who.person : null }); changed(r.bot_id); return r; },
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
    // 3.5: where this person's bots live ('local' or a linked Orb that keeps bots) and the Orbs that could keep them.
    'bots.where': (p, who) => botsWhere(me(who)),
    // 3.5: move the bots: location 'local' or a linked Orb's id; bring: copy the bots there (with their memories and
    // reminders) and pause them here. 3.6 (A14): with bring and without mapping, the first answer is the mapping step
    // ({ step: 'mapping' }: what the bots spend and use here, to choose what they use there); with mapping, the copy. The
    // place changes only when the copy went well. Without bring, the bots here stay as they are.
    'bots.moveTo': async ({ location, bring, mapping, history }, who) => {
      const loc = str(location, 'lugar', 64);
      const peer = loc === 'local' ? null : (hubPeers().find((p) => p.id === loc) ?? fail(tr('msg.link.noCentro')));
      asked(peer?.id ?? null);
      let result = { moved: 0, skipped: [] };
      if (peer && bring === true) {
        result = await bringBots(peer, { person: me(who), mapping: mapping ?? null, history: history === true });
        if (result.step === 'mapping' || result.ok === false) return { ...botsWhere(me(who)), ...result };
      }
      setLocation(me(who), loc, emit);
      return { ...botsWhere(me(who)), ...result };
    },
  };
}

// 3.5: centro.<method> on a workshop: the bots of the centre it is linked with. 3.6: the centre the caller chose.
export function centroApi({ board, bots, remoteRef }) {
  const { centroPeer, botsLocation } = hub({ board, bots, remoteRef });
  async function centroCall(sub, params, who = null) {
    const person = who && who.channel !== 'system' ? who.person : null;
    const peer = centroPeer(person);
    if (sub === 'status') return peer ? { linked: true, id: peer.id, name: peer.name, online: peer.online, lastSeen: peer.lastSeen, active: botsLocation(person) === peer.id } : { linked: false };
    if (!peer) fail(tr('msg.link.noCentro'));
    if (!CENTRO_FORWARD.has(sub)) fail(tr('msg.remote.pcOnly'));
    try { return await remoteRef.link.call(peer.id, sub, params); }
    catch (error) {
      if (error.offline || error.status === 0) { const e = new Error(tr('msg.link.centroOffline', { name: peer.name })); e.userFacing = true; e.offline = true; throw e; }
      error.userFacing = true; throw error;
    }
  }
  return centroCall;
}
