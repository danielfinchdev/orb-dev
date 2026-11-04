// The bots' part of the engine's API (3.5; split out of api.mjs in 3.6, unchanged): src/engine/bots.mjs does the work,
// src/core/bots.mjs keeps the data. Also where the bots live (bots.where, bots.moveTo) and centro.<method>.
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { hostsBots } from '../core/home.mjs';
import { protectedList } from '../core/guard.mjs';
import { oneLine } from '../core/safety.mjs';
import * as B from '../core/bots.mjs';
import { serverStatus, haFetch } from '../core/server-admin.mjs';
import { CENTRO_FORWARD } from './remote.mjs';
import { ownerOfBoard } from '../core/authz.mjs';
import { fail, str, int, oneOf } from './api-common.mjs';

// The linked Orbs that keep bots and «Llevar mis bots» (shared by bots.where/moveTo and centro.*).
function hub({ board, bots, remoteRef }) {
  // 3.5: the linked Orbs that keep bots («centro» or «todo»), the one chosen in «¿Dónde quieres tus bots?» (bots.location)
  // and a call to its bots. Without a choice, centro.* still reaches the first of them (the one on now first), but this
  // Orb's own bots are the ones shown (active: false).
  const hubPeers = () => (remoteRef.link?.peers() ?? []).filter((p) => hostsBots(p.role ?? 'taller') && !p.revoked);
  const botsLocation = () => String(ctx.config.bots?.location || 'local');
  // 3.6 (WS2): who: only the links of that person here (a link without a person is the owner's).
  const centroPeer = (who = null) => {
    const owner = who ? ownerOfBoard(board) : null;
    const list = hubPeers().filter((p) => !who || (p.person ?? owner) === who.person); const loc = botsLocation();
    return (loc !== 'local' && list.find((p) => p.id === loc)) || list.find((p) => p.online) || list[0] || null;
  };
  // The Orbs already asked about (the card after linking is shown once for each).
  const askedList = () => board.settingJson('bots_location_asked') ?? [];
  const asked = (id) => { if (id && !askedList().includes(id)) board.settingJson('bots_location_asked', [...askedList(), id].slice(-50)); };
  function botsWhere() {
    const loc = botsLocation(); const peers = hubPeers();
    const here = board.one('SELECT COUNT(*) AS n FROM bots WHERE paused = 0').n;
    const ask = loc === 'local' ? peers.find((p) => !askedList().includes(p.id)) ?? null : null;
    return { location: loc, peer: loc === 'local' ? null : peers.find((p) => p.id === loc) ?? null, peers: peers.map(({ id, name, role: r, online }) => ({ id, name, role: r, online })),
      localBots: here, ask: ask ? { id: ask.id, name: ask.name } : null };
  }
  // «Llevar mis bots»: each bot of this Orb is made again on the other one (an untouched «Asistente» of the same name is
  // not), with its memory and its reminders; then it is paused here and its reminders here are cancelled (they would ring
  // twice). The global memory is added to the other one's.
  async function bringBots(peer) {
    const call = (m, p) => remoteRef.link.call(peer.id, m, p);
    const there = await call('bots.list', {}).catch((error) => { const e = new Error(tr('msg.link.centroOffline', { name: peer.name })); e.userFacing = true; e.cause = error; throw e; });
    const taken = new Set((there.bots ?? []).map((b) => String(b.name).toLowerCase()));
    let chief = (there.bots ?? []).some((b) => b.is_chief);
    let moved = 0; const skipped = [];
    for (const b of B.listBots(board)) {
      const memory = B.readMemory(b.id).trim();
      const reminders = B.listReminders(board, { bot: b.id });
      const untouched = !b.role_text && !memory && !reminders.length;
      let name = b.name;
      if (taken.has(name.toLowerCase())) {
        if (untouched) { skipped.push(b.name); continue; }
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${b.name.slice(0, 36)} ${n}`;
      }
      const copy = await call('bots.create', { name, icon: b.icon, role_text: b.role_text, agent: b.agent, model: b.model, effort: b.effort, tools: b.tools, accounts: b.accounts ?? {}, exclusive: b.exclusive ?? [], is_chief: Boolean(b.is_chief) && !chief, paused: Boolean(b.paused) });
      taken.add(name.toLowerCase()); if (copy.is_chief) chief = true;
      if (memory) await call('bots.memory.set', { id: copy.id, text: B.readMemory(b.id) });
      for (const r of reminders) {
        await call('bots.reminders.create', { id: copy.id, text: r.text, when: r.every === 'once' ? r.next_run : r.start_at, every: r.every, weekdays: r.weekdays ?? [] }).catch(() => {});
        try { B.cancelReminder(board, r.id); } catch { /* gone */ }
      }
      if (!b.paused) { B.updateBot(board, b.id, { paused: true }); bots?.stop(b.id); }
      bots?.updated(b.id); moved++;
    }
    const global = B.readMemory('global').trim();
    if (global) {
      const theirs = (await call('bots.memory.get', { id: 'global' }).catch(() => ({ text: '' }))).text ?? '';
      if (!theirs.includes(global)) await call('bots.memory.set', { id: 'global', text: `${theirs.trim()}${theirs.trim() ? '\n\n' : ''}${global}` });
    }
    return { moved, skipped };
  }
  return { hubPeers, botsLocation, centroPeer, asked, botsWhere, bringBots };
}

export function botMethods({ board, emit, remoteRef, bots }) {
  const { hubPeers, asked, botsWhere, bringBots } = hub({ board, bots, remoteRef });
  const need = () => bots ?? fail(tr('msg.bots.off'));
  const botId = (id) => B.mustBot(board, id ?? fail(tr('msg.api.missing', { name: 'bot' }))).id;
  const groupId = (id) => (B.getGroup(board, int(id, 'grupo')) ?? fail(tr('msg.bots.noGroup'))).id;
  const view = (b) => ({ ...b, effectiveTools: B.effectiveTools(board, b), conversation: B.botConversation(board, b), state: bots?.state(b.id) ?? null,
    reminders: board.one('SELECT COUNT(*) AS n FROM bot_reminders WHERE bot_id = ? AND enabled = 1', b.id).n });
  const fields = (p) => Object.fromEntries(['name', 'icon', 'role_text', 'agent', 'model', 'effort', 'tools', 'accounts', 'exclusive', 'is_chief', 'paused'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  const VIA = new Set(['phone', 'terminal']); // 3.5: set by the link (remote.mjs) from the device's kind
  const lines = (conv, p) => board.chat(conv, Math.min(Number(p.limit) || 200, 500), { before: p.before ? int(p.before, 'línea') : null });
  const changed = (id) => { bots?.updated(id); return true; };
  return {
    'bots.list': () => ({ bots: B.listBots(board).map(view), groups: B.listGroups(board), states: bots?.states() ?? [], tools: B.TOOL_GROUPS }),
    'bots.get': ({ id }) => { const b = B.mustBot(board, botId(id)); return { ...view(b), memory: B.readMemory(b.id), reminderList: B.listReminders(board, { bot: b.id }) }; },
    'bots.create': (p) => { const b = B.createBot(board, fields(p)); changed(b.id); return view(b); },
    'bots.update': ({ id, ...p }) => { const b = B.updateBot(board, botId(id), fields(p)); if (b.paused) bots?.stop(b.id); changed(b.id); return view(b); },
    'bots.delete': ({ id }) => { const b = B.deleteBot(board, botId(id)); bots?.drop(b.id); changed(b.id); return true; },
    'bots.pause': ({ id, paused }) => { const b = B.updateBot(board, botId(id), { paused: paused !== false }); if (b.paused) bots?.stop(b.id); changed(b.id); return view(b); },
    'bots.chat': ({ id, ...p }) => { const b = B.mustBot(board, botId(id)); const conv = B.botConversation(board, b); return { conversation: conv, lines: lines(conv, p), state: bots?.state(b.id) ?? null }; },
    'bots.send': ({ id, text, via }) => { const r = need().send(botId(id), str(text, 'mensaje', 20000), { via: VIA.has(via) ? via : null }); return { conversation: r.conversation, bot: r.bot }; },
    'bots.stop': ({ id }) => { need().stop(botId(id)); return true; },
    // 3.5.1: by: who answers (a linked device, set by remote.mjs from its own record; null: this PC).
    'bots.decide': ({ item, decision, by }) => need().decide(int(item, 'tarjeta'), oneOf(decision, ['allow', 'deny'], 'decisión'), { by: by && typeof by === 'object' ? by : null }),
    'bots.answer': ({ item, text }) => { const r = need().answer(int(item, 'tarjeta'), str(text, 'respuesta', 4000)); return { conversation: r.conversation, bot: r.bot }; },
    'bots.groups.list': () => B.listGroups(board),
    'bots.groups.create': ({ name, icon, members }) => { const g = B.createGroup(board, { name, icon, members: members ?? [] }); changed(null); return g; },
    'bots.groups.update': ({ id, name, icon, members }) => { const g = B.updateGroup(board, groupId(id), { name, icon, members }); changed(null); return g; },
    'bots.groups.delete': ({ id }) => { B.deleteGroup(board, groupId(id)); changed(null); return true; },
    'bots.groups.chat': ({ id, ...p }) => { const conv = B.groupConversation(board, groupId(id)); return { conversation: conv, lines: lines(conv, p) }; },
    'bots.groups.send': ({ id, text, via }) => { const r = need().sendGroup(groupId(id), str(text, 'mensaje', 20000), { via: VIA.has(via) ? via : null }); return { conversation: r.conversation, group: r.group, members: r.members }; },
    'bots.memory.get': ({ id }) => ({ id: id === 'global' ? 'global' : botId(id), text: B.readMemory(id === 'global' ? 'global' : botId(id)) }),
    'bots.memory.set': ({ id, text }) => { const which = id === 'global' ? 'global' : botId(id); B.writeMemory(which, str(text, 'memoria', 64 * 1024, { optional: true }), { mode: 'replace' }); return { id: which, text: B.readMemory(which) }; },
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
    'bots.reminders.list': ({ id, all }) => B.listReminders(board, { bot: id ? botId(id) : null, all: all === true }),
    'bots.reminders.create': ({ id, text, when, every, weekdays }) => { const r = B.createReminder(board, { bot_id: botId(id), text, when, every: every ?? 'once', weekdays: weekdays ?? [] }, 'usuario'); changed(r.bot_id); return r; },
    'bots.reminders.cancel': ({ id }) => { const r = B.cancelReminder(board, int(id, 'recordatorio')); changed(r.bot_id); return r; },
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
    // 3.5: where this Orb's bots live ('local' or a linked Orb that keeps bots) and the Orbs that could keep them.
    'bots.where': () => botsWhere(),
    // 3.5: move the bots: location 'local' or a linked Orb's id; bring: copy the bots of this Orb there (with their memories
    // and reminders) and pause them here. Without bring, this Orb's bots stay as they are (paused or not).
    'bots.moveTo': async ({ location, bring }) => {
      const loc = str(location, 'lugar', 64);
      const peer = loc === 'local' ? null : (hubPeers().find((p) => p.id === loc) ?? fail(tr('msg.link.noCentro')));
      asked(peer?.id ?? null);
      const result = peer && bring === true ? await bringBots(peer) : { moved: 0, skipped: [] };
      const c = saveConfig({ bots: { location: loc } }); emit('config:changed', c);
      return { ...botsWhere(), ...result };
    },
  };
}

// 3.5: centro.<method> on a workshop: the bots of the centre it is linked with.
export function centroApi({ board, bots, remoteRef }) {
  const { centroPeer, botsLocation } = hub({ board, bots, remoteRef });
  async function centroCall(sub, params, who = null) {
    const peer = centroPeer(who);
    if (sub === 'status') return peer ? { linked: true, id: peer.id, name: peer.name, online: peer.online, lastSeen: peer.lastSeen, active: botsLocation() === peer.id } : { linked: false };
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
