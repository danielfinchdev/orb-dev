// 3.7 (Orb Server, WS3): the bots' homes and live copies between linked Orbs (the data side: src/core/replica.mjs).
// - Sync (pull): every Orb asks each linked Orb of 3.7 for its index (the bots it shares with this one, with their home
//   and epoch) and pulls the changes of the bots that one runs after the last it has (replica_cursor), then their files.
//   When a bot changes, its home tells the others («replica.poke»); a quiet sync also runs every ORB_REPLICA_MS.
// - Writes on a copy (send a message, pause, change it, answer its card…) go to its home (home.forward), or wait in
//   link_queue («pendiente-hogar») while the home is off; never applied to the copy here.
// - Move (bots.move): the source runs it in two phases: prepare (the target makes a full copy), moving (new messages wait,
//   a running turn ends or is cut after ORB_MOVE_TURN_MS), the last changes and a check of counts and hashes on both
//   sides, then commit (epoch + 1, home = target; the target runs it). Journal in bot_moves; after a crash the higher
//   epoch wins.
// - Takeover: «Pasar al PC» with the home off makes the copy here the home (epoch + 1). When the old home comes back, the
//   new home adds what the old one did meanwhile (lines marked, memory changes as pending proposals, reminders it rang)
//   and tells it to step down (home.claim).
// Transport: a link of src/core/link.mjs (link.op(id, 'replica', …)) or a device of src/engine/remote.mjs (callOrb, down
// its live stream). Both sides check who the other Orb is and whose bots it may see (src/core/link-persons.mjs).
import crypto from 'node:crypto';
import { ctx, tr } from '../core/context.mjs';
import { AGENT_IDS } from '../core/home.mjs';
import { oneLine } from '../core/safety.mjs';
import { principalOf, authorize } from '../core/authz.mjs';
import { PHONE_SET, BOTS_OWNER } from '../core/policy.mjs';
import { servedPersons, mappedPerson, localPersonFor, linkPerson } from '../core/link-persons.mjs';
import * as R from '../core/replica.mjs';
import * as B from '../core/bots.mjs';

const SYNC_MS = Number(process.env.ORB_REPLICA_MS) || 15_000;
const TURN_WAIT_MS = Number(process.env.ORB_FAKE_AGENTS && process.env.ORB_MOVE_TURN_MS) || 180_000;
// Orb Server runs only these brains (3.7 spec); an Orb with a window runs any it has.
// What a linked Orb may ask here about the bots' copies.
const PEER_CEILING = new Set([...PHONE_SET, ...BOTS_OWNER]);
export const SERVER_BRAINS = ['claude', 'codex'];
// What a copy may ask its home to do (the home checks the person's rights as for any forwarded call).
export const FORWARDABLE = new Set(['bots.send', 'bots.stop', 'bots.pause', 'bots.update', 'bots.delete', 'bots.memory.set', 'bots.reminders.create', 'bots.reminders.cancel',
  'bots.decide', 'bots.answer', 'bots.groups.send', 'bots.relay', 'bots.merge']);
// What waits for the home while it is off (the rest needs it on: say so).
export const QUEUEABLE = new Set(['bots.send', 'bots.pause', 'bots.memory.set', 'bots.reminders.create', 'bots.reminders.cancel', 'bots.groups.send', 'bots.relay']);
export const QUEUE_STATUS = 'pendiente-hogar';
const now = () => new Date().toISOString();
const json = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const err = (message, extra = {}) => Object.assign(new Error(message), { userFacing: true }, extra);
// A call to a linked Orb that never answers (the link went away while it waited) ends as «offline» instead of holding
// that Orb's sync forever (a later sync, after linking it again, would wait on it).
const CALL_MS = Number(process.env.ORB_REPLICA_CALL_MS) || 120_000;
const patient = (p) => { let t; return Promise.race([p, new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error('sin respuesta'), { offline: true })), CALL_MS); t.unref?.(); })]).finally(() => clearTimeout(t)); };
const isOffline = (e) => Boolean(e?.offline || e?.extra?.offline || e?.status === 0 || e?.status === 503 || e?.extra?.status === 503);

export function createReplica({ board, bots, emit = () => {}, log = () => {}, link: getLink = () => null, remote: getRemote = () => null, api = null, product = () => ctx.product ?? process.env.ORB_PRODUCT ?? 'app' }) {
  const self = () => R.selfId(board);
  const owner = () => board.ownerId();
  const cursors = {
    get: (peer, uid) => board.one('SELECT seq, files FROM replica_cursor WHERE peer = ? AND bot_uid = ?', peer, uid) ?? { seq: 0, files: null },
    set: (peer, uid, seq, files) => board.run('INSERT INTO replica_cursor (peer, bot_uid, seq, files, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(peer, bot_uid) DO UPDATE SET seq = excluded.seq, files = excluded.files, at = excluded.at', peer, uid, Number(seq) || 0, files ?? null, now())
  };

  // ---- the linked Orbs of 3.7 (one per identity)
  function peers() {
    const out = new Map();
    for (const p of getLink()?.peers?.() ?? []) {
      if (p.revoked || p.clone || !p.orb) continue;
      out.set(p.orb, { via: 'link', id: p.id, key: p.orb, name: p.name, online: Boolean(p.online), person: p.person ?? null, remotePerson: p.remotePerson ?? null, features: p.remote?.features ?? [], role: p.role ?? null,
        call: (method, params) => patient(getLink().op(p.id, 'replica', { method, params })) });
    }
    for (const d of getRemote()?.orbPeers?.() ?? []) {
      if (!d.key) continue;
      const have = out.get(d.key);
      if (have && (have.online || !d.online)) continue;
      out.set(d.key, { ...d, call: (method, params) => patient(getRemote().callOrb(d.id, method, params)) });
    }
    return [...out.values()];
  }
  const peerByKey = (key) => (key ? peers().find((p) => p.key === key) ?? null : null);
  const capable = (p) => Boolean(p && (p.features ?? []).includes('replica.v1'));
  const isServer = (p) => Boolean(p && ((p.features ?? []).includes('server') || p.role === 'centro'));
  const peerName = (key) => (key === self() ? tr('msg.home.thisOrb') : peerByKey(key)?.name ?? tr('msg.home.otherOrb'));

  // Who a person of that Orb is here: the mapping (link-persons), or the one it says when that is a person this link
  // carries (never anyone else).
  const mapFrom = (peer) => (remote, forPerson) => {
    const local = localPersonFor(board, peer, remote);
    if (local) return local;
    if (forPerson && board.one('SELECT 1 FROM persons WHERE id = ? AND deleted_at IS NULL', String(forPerson))
      && (forPerson === linkPerson(board, peer) || (remote != null && mappedPerson(board, peer, forPerson) === String(remote)))) return forPerson;
    return null;
  };
  // Whether that Orb may touch this bot or group here (sync, move, takeover): only when its person is one this Orb serves
  // to it (or the bot is shared with one of them). Knowing a uid is never enough.
  const mayTouch = (peer, row, persons = servedPersons(board, peer)) => {
    if (!row) return false;
    if (persons.has(row.person_id ?? owner())) return true;
    const type = 'agent' in row ? 'bot' : 'group'; // bot_groups rows have no agent
    try { return board.all('SELECT person_id FROM shares WHERE resource_type = ? AND resource_id = ?', type, String(row.id)).some((s) => persons.has(s.person_id)); } catch { return false; }
  };
  const resolve = (idOrUid) => (R.isUid(String(idOrUid ?? '')) ? R.botByUid(board, idOrUid) : board.one('SELECT * FROM bots WHERE id = ?', Number(idOrUid))) ?? null;
  const parsed = (row) => (row ? B.getBot(board, row.id) : null);
  const homeEvent = (row, extra = {}) => { const b = board.one('SELECT * FROM bots WHERE id = ?', row.id) ?? row; emit('bot.home', { id: b.id, uid: b.uid, home: b.home, epoch: Number(b.home_epoch) || 0, state: b.home_state, here: R.isHomeHere(board, b), ...extra }); bots?.updated(b.id); };
  const moveEvent = (row, phase, extra = {}) => emit('bots.move', { id: row.id, uid: row.uid, phase, person: row.person_id ?? owner(), ...extra });
  const setState = (row, state) => { board.run('UPDATE bots SET home_state = ? WHERE id = ?', state, row.id); homeEvent(row); };

  // ---- this Orb becomes / stops being a bot's home
  function promote(row, epoch, { fork = null, group = false } = {}) {
    const table = group ? 'bot_groups' : 'bots';
    board.transaction(() => {
      if (group) board.run('UPDATE bot_groups SET home = ?, home_epoch = ? WHERE id = ?', self(), epoch, row.id);
      else board.run("UPDATE bots SET home = ?, home_epoch = ?, home_state = 'active', home_fork = ? WHERE id = ?", self(), epoch, fork ? JSON.stringify(fork) : null, row.id);
      R.relogAll(board, board.one(`SELECT * FROM ${table} WHERE id = ?`, row.id), { group });
    });
    if (!group) homeEvent(row);
  }
  function demote(row, home, epoch) {
    bots?.drop(row.id);
    board.run("UPDATE bots SET home = ?, home_epoch = ?, home_state = 'active', home_fork = NULL WHERE id = ?", home, epoch, row.id);
    homeEvent(row);
  }

  // ---- the journal of moves (bot_moves)
  const journal = {
    start: (row, to, detail = {}) => { const id = crypto.randomUUID(); board.run('INSERT INTO bot_moves (id, bot_uid, from_home, to_home, phase, epoch, detail, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, row.uid, self(), to, 'prepare', Number(row.home_epoch) || 0, JSON.stringify(detail), now(), now()); return id; },
    phase: (id, phase, detail = null) => board.run(`UPDATE bot_moves SET phase = ?, updated_at = ?${detail ? ', detail = ?' : ''} WHERE id = ?`, phase, now(), ...(detail ? [JSON.stringify(detail)] : []), id),
    open: () => board.all("SELECT * FROM bot_moves WHERE phase NOT IN ('done', 'aborted', 'takeover', 'restored') ORDER BY started_at")
  };
  // At start: a move cut before its commit is undone here (the bot runs here again; the copy there stays a copy); one cut
  // after it is finished when the target is on (home.commit again: the same epoch twice is a no-op there).
  function recover() {
    for (const j of journal.open()) {
      const row = R.botByUid(board, j.bot_uid);
      if (j.phase === 'committed') continue;
      if (row && R.isHomeHere(board, row) && row.home_state === 'moving') setState(row, 'active');
      journal.phase(j.id, 'aborted');
      log(`hogar: traslado de ${j.bot_uid} cortado antes de confirmar; sigue aquí`);
    }
  }

  // ---- sync with one Orb
  const syncing = new Map(); const timers = new Map(); const lastSync = new Map(); const wasOnline = new Map();
  // The links unlinked here: a sync of theirs still on its way never wakes their frozen copies (only a new link does).
  const unlinkedLinks = new Set();
  function schedule(key, delay = 60) {
    if (!key || timers.has(key)) return;
    const t = setTimeout(() => { timers.delete(key); syncKey(key).catch((e) => log(`hogar: sync ${key.slice(0, 8)}: ${e.message}`)); }, delay); t.unref?.();
    timers.set(key, t);
  }
  async function syncKey(key) {
    const run = syncing.get(key);
    // A sync of an older link with that Orb (unlinked and linked again meanwhile) may still wait on a call that link
    // will never answer: the new link gets its own.
    const now_ = peerByKey(key)?.id ?? null;
    if (run && (!now_ || run.peer === now_)) { run.again = true; return run.promise; }
    const state = { again: false, peer: now_ };
    state.promise = (async () => {
      try { do { state.again = false; const p = peerByKey(key); if (p) await syncPeer(p); } while (state.again); }
      finally { if (syncing.get(key) === state) syncing.delete(key); }
    })();
    syncing.set(key, state);
    return state.promise;
  }
  async function syncPeer(peer) {
    if (!peer.online || !capable(peer)) return { skipped: true };
    const idx = await peer.call('replica.index', {});
    const map = mapFrom(peer);
    for (const e of idx?.bots ?? []) { try { await syncEntry(peer, e, map); } catch (error) { if (isOffline(error)) throw error; log(`hogar: ${e.name ?? e.uid}: ${error.message}`); } }
    for (const e of idx?.groups ?? []) { try { await syncEntry(peer, e, map); } catch (error) { if (isOffline(error)) throw error; log(`hogar: grupo ${e.uid}: ${error.message}`); } }
    // A copy here of a bot that no longer is in that Orb's list: deleted there (its log says so) → it goes here too.
    const listed = new Set((idx?.bots ?? []).map((e) => e.uid));
    for (const row of board.all("SELECT uid FROM bots WHERE home = ? AND uid IS NOT NULL AND COALESCE(home_state, 'active') != 'archived'", peer.key)) {
      if (listed.has(row.uid)) continue;
      try { const page = await peer.call('replica.pull', { uid: row.uid, since: cursors.get(peer.key, row.uid).seq }); if (page?.deleted) { dropReplica(row.uid); cursors.set(peer.key, row.uid, page.seq, null); log(`hogar: ${row.uid} se eliminó en ${peer.name ?? peer.key}`); } }
      catch (error) { if (isOffline(error)) throw error; }
    }
    await finishMoves(peer);
    await flushQueue(peer);
    // Just back: it is told to pull from here too (it may not see this Orb's changes otherwise).
    if (!wasOnline.get(peer.key)) peer.call('replica.poke', {}).catch(() => {});
    wasOnline.set(peer.key, true); lastSync.set(peer.key, Date.now());
    return { ok: true };
  }
  async function syncEntry(peer, e, map) {
    if (!R.isUid(e?.uid)) return;
    const me = self();
    const group = e.kind === 'group';
    const local = group ? R.groupByUid(board, e.uid) : R.botByUid(board, e.uid);
    const lepoch = Number(local?.home_epoch) || 0; const epoch = Number(e.epoch) || 0;
    // Another person's bot (or one this Orb does not share with that one): its entry changes nothing here.
    if (local && !mayTouch(peer, local)) return;
    if (local && R.isHomeHere(board, local, me)) {
      if (e.home === me) return; // its copy of a bot run here
      if (group) return;
      // The old home of a bot taken over here came back: what it did meanwhile joins in, then it steps down.
      if (e.home === peer.key && epoch < lepoch) return reconcile(peer, local, map);
      // Someone else took it over (a forced «Pasar al …» while this Orb was off): stop running it.
      if (epoch > lepoch || (epoch === lepoch && String(e.home) < String(me))) {
        if (e.home === peer.key) { if (local.home_state !== 'demoting') { bots?.drop(local.id); setState(local, 'demoting'); } peer.call('replica.poke', {}).catch(() => {}); }
        else demote(local, e.home, epoch);
      }
      return;
    }
    if (e.home === me) {
      // It says this Orb is the home (a move whose commit did not arrive): it runs here now.
      if (local && local.home === peer.key && epoch >= lepoch && !group) { if (e.uid) await pull(peer, { ...e, home: peer.key }, map, { quiet: true }).catch(() => {}); promote(local, epoch); }
      return;
    }
    if (e.home === peer.key) {
      if (local && epoch < lepoch) return; // stale: a newer home is known
      // A copy frozen when that Orb was unlinked («Dejarlos en el Server»): linked again and still its home, the copy is a
      // live one again (it pulls what changed meanwhile). A copy restored here has a newer epoch and never gets here.
      if (local?.home_state === 'archived' && epoch <= lepoch && !group && e.state !== 'archived' && !unlinkedLinks.has(peer.id)) {
        board.run("UPDATE bots SET home_state = 'active' WHERE id = ? AND home_state = 'archived'", local.id);
        bots?.updated(local.id);
        log(`hogar: «${local.name}» vuelve a ser la copia de ${peer.name ?? peer.key}`);
        return pull(peer, e, map);
      }
      if (local?.home_state === 'archived' && epoch <= lepoch) return; // frozen copy (unlinked)
      return pull(peer, e, map);
    }
    // Run on a third Orb: only its place is learnt.
    if (local && epoch > lepoch) board.run(`UPDATE ${group ? 'bot_groups' : 'bots'} SET home = ?, home_epoch = ? WHERE id = ?`, e.home, epoch, local.id);
  }
  async function pull(peer, e, map, { quiet = false } = {}) {
    const cur = cursors.get(peer.key, e.uid);
    if (e.seq != null && Number(e.seq) <= cur.seq && (!e.files || e.files === cur.files)) {
      // Nothing new, but its place may have changed (epoch).
      const local = e.kind === 'group' ? R.groupByUid(board, e.uid) : R.botByUid(board, e.uid);
      if (local && !R.isHomeHere(board, local) && (local.home !== e.home || Number(local.home_epoch) !== Number(e.epoch))) board.run(`UPDATE ${e.kind === 'group' ? 'bot_groups' : 'bots'} SET home = ?, home_epoch = ? WHERE id = ?`, e.home, Number(e.epoch) || 0, local.id);
      return null;
    }
    let since = cur.seq; let files = cur.files; let page; let changed = false; let id = null;
    do {
      page = await peer.call('replica.pull', { uid: e.uid, since });
      if (peer.id && unlinkedLinks.has(peer.id)) return null; // unlinked while it waited: its copies stay as they were frozen
      if (page?.deleted) { dropReplica(e.uid); cursors.set(peer.key, e.uid, page.seq, null); return null; }
      const r = R.applyPage(board, page, { map });
      if (r.unmapped || r.here) return r;
      id = r.id ?? id; changed = changed || r.lines > 0 || r.updated > 0 || r.created || r.reminders > 0 || r.memlog > 0;
      if (page.manifest && id) { await fetchFiles(peer, e.uid, id, page, map); files = page.files; }
      since = page.seq;
      cursors.set(peer.key, e.uid, since, files);
    } while (page.more);
    if (id && changed && !quiet) bots?.updated(id);
    return { id };
  }
  async function fetchFiles(peer, uid, id, page, map) {
    const need = R.filesToFetch(id, page.manifest, (p) => map(p, page.who?.[p] ?? null));
    for (const f of need) {
      const parts = []; let offset = 0;
      for (let i = 0; i < 20; i++) {
        const c = await peer.call('replica.file', { uid, path: f.p, offset });
        const buf = Buffer.from(String(c.data ?? ''), 'base64'); parts.push(buf); offset += buf.length;
        if (c.done || !buf.length) break;
      }
      try { R.writeFetched(id, f, Buffer.concat(parts)); } catch (error) { log(`hogar: archivo ${f.p}: ${error.message}`); }
    }
  }
  function dropReplica(uid) {
    const row = R.botByUid(board, uid);
    if (row && !R.isHomeHere(board, row)) { try { B.deleteBot(board, row.id); } catch { /* gone */ } bots?.updated(row.id); return; }
    const g = R.groupByUid(board, uid);
    if (g && !R.isHomeHere(board, g)) { try { B.deleteGroup(board, g.id); } catch { /* gone */ } bots?.updated(null); }
  }
  // The old home came back after a forced takeover here: its changes since the fork join this bot (marked), then it is
  // told to step down; what it did while being told comes back with its answer.
  async function reconcile(peer, row, map) {
    const fork = json(row.home_fork, null);
    let since = fork?.from === peer.key ? Number(fork.seq) || 0 : 0;
    const mark = { offline: peer.name, offlineHome: peer.key };
    const fired = (r, person) => { const bot = parsed(row); bots?.say('system', tr('msg.home.rangOffline', { text: oneLine(r.text, 200), name: peer.name }), { bot: row.id, kind: 'reconciled' }, B.botConversation(board, bot, { person }), { notify: [] }); };
    const add = { lines: 0, proposals: 0, rang: 0 };
    const take = (page) => { const r = R.reconcilePage(board, page, board.one('SELECT * FROM bots WHERE id = ?', row.id), { map, mark, fired }); for (const k of Object.keys(add)) add[k] += r[k]; };
    let page;
    do {
      try { page = await peer.call('replica.pull', { uid: row.uid, since }); } catch (error) { if (error.status === 409 || /no se ejecuta/.test(error.message)) break; throw error; }
      take(page); since = page.seq;
      if (page.manifest) await memoryProposal(peer, row, page, map);
    } while (page.more);
    const r = await peer.call('home.claim', { uid: row.uid, home: self(), epoch: Number(row.home_epoch) || 0, since });
    if (r?.tail) take(r.tail);
    for (const h of r?.held ?? []) { const person = map(h.person, h.forPerson); if (person) bots?.turn(row.id, String(h.text ?? ''), { person, via: h.via ?? null, sentAt: h.at ?? null }); }
    board.run('UPDATE bots SET home_fork = NULL WHERE id = ?', row.id);
    if (add.lines || add.proposals || add.rang) {
      const bot = parsed(row);
      bots?.say('system', tr('msg.home.reconciled', { name: peer.name, lines: add.lines, proposals: add.proposals }), { bot: row.id, kind: 'reconciled' }, B.botConversation(board, bot, { person: row.person_id ?? owner() }), { notify: [] });
    }
    log(`hogar: ${row.name}: ${peer.name} vuelve; ${add.lines} línea(s), ${add.proposals} propuesta(s) de memoria`);
    homeEvent(row, { reconciled: add });
    return add;
  }
  // The old home's memory file, when it differs from this one: a pending proposal (never written over this one).
  async function memoryProposal(peer, row, page, map) {
    const f = (page.manifest ?? []).find((x) => x.p === 'memoria.md'); if (!f) return;
    const need = R.filesToFetch(row.id, [f], (p) => map(p, page.who?.[p] ?? null)); if (!need.length) return;
    const c = await peer.call('replica.file', { uid: row.uid, path: 'memoria.md', offset: 0 }).catch(() => null); if (!c) return;
    const text = Buffer.from(String(c.data ?? ''), 'base64').toString('utf8');
    if (!text.trim() || text.trim() === B.readMemory(row.id).trim()) return;
    try { B.proposeMemory(board, row.id, text, { mode: 'replace', which: 'bot', actor: peer.name }); } catch (error) { log(`hogar: memoria: ${error.message}`); }
  }

  // ---- what this Orb answers to a linked Orb
  const normal = (raw) => {
    const key = raw?.key ?? raw?.orb ?? null;
    if (!key) throw err(tr('msg.home.noIdentity'), { status: 409 });
    return peerByKey(key) ?? { via: raw.via ?? 'link', id: raw.id, key, name: raw.name, online: true, person: raw.person ?? null, remotePerson: raw.remotePerson ?? null, features: raw.features ?? raw.remote?.features ?? [], call: () => Promise.reject(err('sin enlace', { status: 0, offline: true })) };
  };
  async function serve(raw, method, params = {}) {
    const peer = normal(raw);
    const persons = servedPersons(board, peer);
    const forPerson = (p) => mappedPerson(board, peer, p);
    switch (method) {
      case 'replica.index': return R.buildIndex(board, persons, { forPerson });
      case 'replica.pull': return R.buildPage(board, String(params.uid ?? ''), Number(params.since) || 0, { persons, forPerson });
      case 'replica.file': return R.buildFile(board, String(params.uid ?? ''), String(params.path ?? ''), Number(params.offset) || 0, { persons });
      case 'replica.poke': wasOnline.set(peer.key, wasOnline.get(peer.key) ?? false); schedule(peer.key); return true;
      case 'home.prepare': return prepareHere(peer, params);
      case 'home.verify': return verifyHere(peer, params);
      case 'home.commit': return commitHere(peer, params);
      case 'home.abort': return true;
      case 'home.moveTo': {
        const row = R.botByUid(board, String(params.uid ?? '')) ?? R.groupByUid(board, String(params.uid ?? ''));
        if (!row || !persons.has(row.person_id ?? owner())) throw err(tr('msg.bots.noBot', { name: '' }), { status: 404 });
        return move(row.uid, String(params.to ?? ''), { ...(params.opts ?? {}), by: peer.key });
      }
      case 'home.forward': return forwardHere(peer, params, persons);
      case 'home.claim': return claimHere(peer, params);
      default: throw err('operación desconocida', { status: 404 });
    }
  }
  // Target of a move: a full copy now (files too). → what this Orb can run of it
  // A copy here that this Orb may take from that one: none yet, or one of a person served to it whose home is that Orb.
  const fromItsHome = (peer, row) => !row || (mayTouch(peer, row) && (row.home === peer.key || R.isHomeHere(board, row)));
  async function prepareHere(peer, { uid }) {
    const e = { uid: String(uid ?? ''), home: peer.key };
    if (!fromItsHome(peer, R.botByUid(board, e.uid))) return { ok: false, reason: 'unmapped' };
    const r = await pull(peer, e, mapFrom(peer), { quiet: true });
    const row = R.botByUid(board, e.uid);
    if (!row || r?.unmapped) return { ok: false, reason: 'unmapped' };
    const bot = parsed(row);
    const brains = product() === 'server' ? SERVER_BRAINS : AGENT_IDS;
    const person = row.person_id ?? owner();
    const have = new Set((ctx.config.mcpServers ?? []).filter((s) => s.enabled !== false && (s.person ?? owner()) === person).map((s) => s.name));
    const missing = { connectors: (bot.accounts?.mcp ?? []).filter((n) => !have.has(n)), ha: bot.tools.includes('casa') && !B.haConfig(board).token };
    const same = board.one(`SELECT id, uid, name FROM bots WHERE uid != ? AND name = ? COLLATE NOCASE AND ${person === owner() ? '(person_id = ? OR person_id IS NULL)' : 'person_id = ?'}`, row.uid, String(row.name).replace(/ · \d+$/, ''), person);
    return { ok: true, id: row.id, name: row.name, brains, missing, sameName: same ? { uid: same.uid, name: same.name, kept: row.name } : null, counts: R.verifyCounts(board, row) };
  }
  async function verifyHere(peer, { uid }) {
    const e = { uid: String(uid ?? ''), home: peer.key };
    if (!fromItsHome(peer, R.botByUid(board, e.uid))) return { ok: false };
    await pull(peer, e, mapFrom(peer), { quiet: true });
    const row = R.botByUid(board, e.uid); if (!row) return { ok: false };
    return { ok: true, ...R.verifyCounts(board, row), seq: cursors.get(peer.key, e.uid).seq };
  }
  async function commitHere(peer, { uid, epoch, tail = null, brain = null, held = [], from = null, cancelled = 0, kind = 'bot' }) {
    const map = mapFrom(peer);
    if (kind === 'group') {
      const g = R.groupByUid(board, String(uid ?? '')); if (!g || !mayTouch(peer, g)) throw err(tr('msg.bots.noGroup'), { status: 404 });
      if (!R.isHomeHere(board, g) && g.home !== peer.key) throw err(tr('msg.home.claimRefused'), { status: 409 });
      if (R.isHomeHere(board, g) && Number(g.home_epoch) >= Number(epoch)) return { ok: true, already: true };
      if (tail) R.applyPage(board, tail, { map });
      promote(g, Number(epoch) || 0, { group: true }); bots?.updated(null);
      return { ok: true };
    }
    const row = R.botByUid(board, String(uid ?? '')); if (!row || !mayTouch(peer, row)) throw err(tr('msg.bots.noBot', { name: '' }), { status: 404 });
    if (R.isHomeHere(board, row) && Number(row.home_epoch) >= Number(epoch)) return { ok: true, already: true };
    // Only the bot's home hands it over (its source in a move): never a third Orb.
    if (!R.isHomeHere(board, row) && row.home !== peer.key) throw err(tr('msg.home.claimRefused'), { status: 409 });
    if (tail) R.applyPage(board, tail, { map });
    promote(row, Number(epoch) || 0);
    board.settingJson(`bot_handoff:${row.id}`, { from: from ?? peer.name, at: now(), cancelled: Number(cancelled) || 0, done: [] });
    if (brain && typeof brain === 'object' && AGENT_IDS.includes(brain.agent)) { try { B.updateBot(board, row.id, { agent: brain.agent, model: brain.model ?? null }); } catch (error) { log(`hogar: cerebro: ${error.message}`); } }
    // What this Orb lacks (connectors, Home Assistant): the bot is told in its view; those tools stay off until set.
    const bot = parsed(row);
    const have = new Set((ctx.config.mcpServers ?? []).filter((s) => s.enabled !== false).map((s) => s.name));
    const needs = { connectors: (bot.accounts?.mcp ?? []).filter((n) => !have.has(n)), ha: bot.tools.includes('casa') && !B.haConfig(board).token };
    board.run('UPDATE bots SET needs = ? WHERE id = ?', needs.connectors.length || needs.ha ? JSON.stringify(needs) : null, row.id);
    for (const h of Array.isArray(held) ? held : []) {
      const person = map(h.person, h.forPerson); if (!person) continue;
      bots?.turn(row.id, String(h.text ?? ''), { person, via: h.via ?? null, sentAt: h.at ?? null });
    }
    moveEvent(row, 'arrived', { from: peer.key });
    return { ok: true, id: row.id };
  }
  // The new home after a takeover tells this one (the old home) to step down. → { ok, tail } (what happened here since
  // its last look, while this one still ran it)
  function claimHere(peer, { uid, home, epoch, since = 0 }) {
    const row = R.botByUid(board, String(uid ?? '')); if (!row) return { ok: true };
    // Only an Orb this bot's person is served to (one that holds its copy) may claim it.
    if (!mayTouch(peer, row)) return { ok: true };
    const lepoch = Number(row.home_epoch) || 0;
    if (!R.isHomeHere(board, row)) { if (Number(epoch) > lepoch) board.run('UPDATE bots SET home = ?, home_epoch = ? WHERE id = ?', home, Number(epoch), row.id); return { ok: true }; }
    if (home !== peer.key || Number(epoch) <= lepoch) throw err(tr('msg.home.claimRefused'), { status: 409 });
    let tail = null; try { tail = R.buildPage(board, row.uid, Number(since) || 0, { persons: servedPersons(board, peer), forPerson: (p) => mappedPerson(board, peer, p) }); } catch { /* nothing */ }
    bots?.cancelCards(row.id);
    // What waited here while it stepped down: the new home runs those turns (their lines come in the tail).
    const held = (bots?.takeHeld(row.uid) ?? []).map((h) => ({ ...h, forPerson: mappedPerson(board, peer, h.person) }));
    demote(row, home, Number(epoch));
    log(`hogar: ${row.name} se ejecuta ahora en ${peer.name}`);
    return { ok: true, tail, held };
  }

  // ---- writes on a copy: to its home (or its queue)
  async function forwardHere(peer, p, persons) {
    const method = String(p.method ?? '');
    if (!FORWARDABLE.has(method)) throw err(tr('msg.remote.pcOnly'), { status: 403 });
    const group = method === 'bots.groups.send';
    const row = group ? R.groupByUid(board, String(p.uid ?? '')) : R.botByUid(board, String(p.uid ?? ''));
    if (!row) throw err(tr(group ? 'msg.bots.noGroup' : 'msg.bots.noBot', { name: '' }), { status: 404 });
    if (!R.isHomeHere(board, row)) throw err(tr('msg.home.runsElsewhere', { name: row.name }), { status: 409, notHome: true });
    const person = mapFrom(peer)(p.person, p.forPerson);
    if (!person || !persons.has(person) && !board.one("SELECT 1 FROM shares WHERE resource_type = ? AND resource_id = ? AND person_id = ?", group ? 'group' : 'bot', String(row.id), person)) throw err(tr('msg.home.notMapped'), { status: 403, reason: 'notMapped' });
    // As that person, with what an Orb of theirs may do here: a phone's calls and the bots' owner's.
    const who = principalOf(board, { forwarded: true, person, ceiling: PEER_CEILING });
    const params = { ...(p.params ?? {}), id: row.id };
    if (p.refs?.item) { const line = board.one('SELECT id FROM chat WHERE uid = ?', String(p.refs.item)); if (!line) throw err(tr('msg.bots.cardGone'), { status: 404 }); params.item = line.id; }
    if (p.refs?.reminder) { const r = board.one('SELECT id FROM bot_reminders WHERE uid = ?', String(p.refs.reminder)); if (!r) throw err(tr('msg.bots.noReminder'), { status: 404 }); params.id = r.id; }
    if (method === 'bots.merge') { const other = R.botByUid(board, String(p.refs?.other ?? '')); if (!other) throw err(tr('msg.bots.noBot', { name: '' }), { status: 404 }); params.survivor = row.id; params.other = other.id; }
    // A message keeps its uid (the copy already shows it) and says when it was written.
    if (method === 'bots.send') {
      authorize(board, who, 'bots.send', { id: row.id });
      const r = bots.send(row.id, String(params.text ?? ''), { person, uid: R.isUid(p.lineUid) ? p.lineUid : null, sentAt: p.sentAt ?? null, via: params.via === 'phone' ? 'phone' : null });
      return { ok: true, conversation: r.conversation };
    }
    if (method === 'bots.relay') { authorize(board, who, 'bots.send', { id: row.id }); bots.relayIn(row.id, { from: params.from, text: String(params.text ?? '').slice(0, 8000), topic: params.topic ?? null, person }); return { ok: true }; }
    if (!api) throw err('sin API', { status: 500 });
    const result = await api.call(method, params, who);
    return { ok: true, result: result && typeof result === 'object' ? { status: result.status ?? null, ok: result.ok ?? true } : result };
  }
  // On a copy: the write goes to the home (who: the caller here). → { forwarded, queued?, conversation? }
  async function forwardWrite(bot, method, params, who, { refs = null, resend = false } = {}) {
    const row = bot?.uid ? bot : null;
    if (!row) throw err(tr('msg.bots.noBot', { name: '' }));
    const home = peerByKey(row.home);
    if (!home) throw err(tr('msg.home.homeGone', { name: row.name }), { status: 409, reason: 'homeGone' });
    const person = who?.person ?? owner();
    // person: the caller here; forPerson: who that is on the home (when this Orb knows it; the home maps it otherwise).
    const payload = { uid: row.uid, method, params: { ...params, id: undefined }, person, forPerson: mappedPerson(board, home, person), refs, sentAt: now() };
    if (method === 'bots.send' && !resend) {
      // The line shows here at once (marked «pendiente» until the home has it: the same uid comes back from there).
      payload.lineUid = R.uuidv7();
      const conv = B.botConversation(board, B.getBot(board, row.id), { person });
      board.addChat('usuario', String(params.text ?? ''), { pending: true }, conv, { person, uid: payload.lineUid });
      emit('bot.message', { conversation: conv, role: 'usuario', body: oneLine(String(params.text ?? ''), 600), meta: { pending: true } });
    }
    if (home.online && capable(home)) {
      try { const r = await home.call('home.forward', payload); schedule(home.key, 30); return { forwarded: true, ...r }; }
      catch (error) {
        if (!isOffline(error)) {
          // Not taken there (it moved meanwhile, or it refused): the line shown here goes (if the home did take it, it
          // comes back from there with the same uid). A bot that runs here now gets it here.
          if (payload.lineUid) board.run('DELETE FROM chat WHERE uid = ?', payload.lineUid);
          const now_ = R.botByUid(board, row.uid);
          if (method === 'bots.send' && now_ && R.isHomeHere(board, now_)) { const r = bots.send(now_.id, String(params.text ?? ''), { person, uid: payload.lineUid ?? null }); return { forwarded: false, here: true, conversation: r.conversation }; }
          throw Object.assign(error, { userFacing: true });
        }
      }
    }
    if (!QUEUEABLE.has(method)) throw err(tr('msg.home.homeOffline', { name: home.name }), { status: 503, offline: true });
    const id = Number(board.run('INSERT INTO link_queue (method, params, from_device, created_at, status, person_id, request_id) VALUES (?, ?, NULL, ?, ?, ?, ?)', 'home.forward', JSON.stringify({ home: home.key, ...payload }).slice(0, 200_000), now(), QUEUE_STATUS, person, crypto.randomUUID()).lastInsertRowid);
    emit('link:queue', { id, status: QUEUE_STATUS, method, person, home: home.key });
    return { forwarded: false, queued: true, queueId: id, home: home.name };
  }
  // What waited for a home: sent there when it is on; run here if the bot runs here now (a takeover, a move back);
  // aimed at the new home if it moved elsewhere meanwhile.
  const done = (q, p, r) => { board.run("UPDATE link_queue SET status = 'hecho', result = ?, done_at = ? WHERE id = ?", JSON.stringify(r ?? null).slice(0, 20_000), now(), q.id); emit('link:queue', { id: q.id, status: 'hecho', method: p.method, person: q.person_id }); };
  async function deliverHere(row, p) {
    const person = p.person ?? owner();
    if (p.method === 'bots.send') {
      const line = p.lineUid ? board.one('SELECT id FROM chat WHERE uid = ?', p.lineUid) : null;
      if (line) { board.run('UPDATE chat SET meta = NULL WHERE id = ?', line.id); bots.turn(row.id, String(p.params?.text ?? ''), { person, sentAt: p.sentAt ?? null }); return { here: true }; }
      bots.send(row.id, String(p.params?.text ?? ''), { person, uid: p.lineUid ?? null, sentAt: p.sentAt ?? null }); return { here: true };
    }
    if (p.method === 'bots.relay') { bots.relayIn(row.id, { from: p.params?.from, text: String(p.params?.text ?? ''), topic: p.params?.topic ?? null, person }); return { here: true }; }
    if (!api) return null;
    const params = { ...(p.params ?? {}), id: row.id };
    if (p.refs?.reminder) { const r = board.one('SELECT id FROM bot_reminders WHERE uid = ?', String(p.refs.reminder)); if (!r) return null; params.id = r.id; }
    return api.call(p.method, params, principalOf(board, { forwarded: true, person, ceiling: PEER_CEILING }));
  }
  async function drainQueue() {
    for (const q of board.all('SELECT * FROM link_queue WHERE status = ? ORDER BY id LIMIT 200', QUEUE_STATUS)) {
      const p = json(q.params, {});
      const row = p.method === 'bots.groups.send' ? R.groupByUid(board, p.uid) : R.botByUid(board, p.uid);
      if (!row) continue;
      if (R.isHomeHere(board, row)) {
        if (p.method !== 'bots.groups.send' && (row.home_state ?? 'active') !== 'active') continue;
        try { done(q, p, await deliverHere(row, p)); } catch (error) { board.run("UPDATE link_queue SET status = 'error', result = ?, done_at = ? WHERE id = ?", JSON.stringify({ error: oneLine(error.message, 500) }), now(), q.id); }
      } else if (row.home !== p.home) board.run('UPDATE link_queue SET params = ? WHERE id = ?', JSON.stringify({ ...p, home: row.home, forPerson: mappedPerson(board, peerByKey(row.home) ?? { key: row.home }, p.person) }), q.id);
    }
  }
  async function flushQueue(peer) {
    await drainQueue();
    for (const q of board.all('SELECT * FROM link_queue WHERE status = ? ORDER BY id LIMIT 200', QUEUE_STATUS)) {
      const p = json(q.params, {}); if (p.home !== peer.key) continue;
      try {
        const r = await peer.call('home.forward', p);
        board.run("UPDATE link_queue SET status = 'hecho', result = ?, done_at = ? WHERE id = ?", JSON.stringify(r ?? null).slice(0, 20_000), now(), q.id);
        emit('link:queue', { id: q.id, status: 'hecho', method: p.method, person: q.person_id });
      } catch (error) {
        if (isOffline(error)) return;
        // It moved meanwhile: it waits until this Orb learns where it runs now.
        if (error.status === 409 || error.notHome || /se ejecuta en otro Orb|runs on another Orb/.test(error.message)) continue;
        board.run("UPDATE link_queue SET status = 'error', result = ?, done_at = ? WHERE id = ?", JSON.stringify({ error: oneLine(error.message, 500) }), now(), q.id);
        emit('link:queue', { id: q.id, status: 'error', method: p.method, error: oneLine(error.message, 300), person: q.person_id });
      }
    }
  }
  const queued = (uid) => board.all('SELECT id, params, created_at FROM link_queue WHERE status = ?', QUEUE_STATUS).filter((q) => json(q.params, {}).uid === uid).length;

  // ---- moves
  const waitTurn = async (row) => {
    const end = Date.now() + TURN_WAIT_MS;
    while (bots?.busyWith(row.id) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    if (bots?.busyWith(row.id)) {
      bots.holdQueued(row.id); // stopping drops what waits in its lanes: kept for the new home first
      bots.stop(row.id);
      const bot = parsed(row);
      bots.say('system', tr('msg.home.turnCut'), { bot: row.id, kind: 'moving' }, B.botConversation(board, bot, { person: row.person_id ?? owner() }), { notify: [] });
      for (let i = 0; i < 50 && bots.busyWith(row.id); i++) await new Promise((r) => setTimeout(r, 100));
      return true;
    }
    return false;
  };
  // Move a bot (id or uid) to the Orb `to` (its identity; 'here' = this one). opts: force (take it over with its home
  // off), group ('group': its whole group goes; 'leave': it leaves the group), brain ({ agent, model } when the target
  // does not run its brain). → { ok, step?, … }
  async function move(idOrUid, to, opts = {}) {
    const me = self();
    let row = resolve(idOrUid);
    if (!row) { const g = R.groupByUid(board, idOrUid); if (g) return moveGroup(g, to, opts); throw err(tr('msg.bots.noBot', { name: String(idOrUid ?? '') }), { status: 404 }); }
    const target = !to || to === 'here' ? me : String(to);
    if (row.home === target && (row.home_state ?? 'active') === 'active') return { ok: true, already: true, uid: row.uid, home: target };
    if (!R.isHomeHere(board, row, me)) {
      const home = peerByKey(row.home);
      // Its home is off (or gone): with the user's OK, it runs here from its copy.
      if (target === me && (!home || !home.online || row.home_state === 'archived')) {
        if (opts.force || row.home_state === 'archived' || !home) return takeover(row);
        return { ok: false, step: 'confirm', confirm: tr('msg.home.forceWarn', { name: peerName(row.home) }), uid: row.uid };
      }
      if (!home?.online) throw err(tr('msg.home.homeOffline', { name: home?.name ?? peerName(row.home) }), { status: 503, offline: true, canForce: target === me });
      const r = await home.call('home.moveTo', { uid: row.uid, to: target, opts: { group: opts.group ?? null, brain: opts.brain ?? null } });
      schedule(home.key, 10);
      return r;
    }
    const peer = peerByKey(target);
    if (!peer || !capable(peer)) throw err(tr('msg.home.noTarget'), { status: 409 });
    if (!peer.online) throw err(tr('msg.home.homeOffline', { name: peer.name }), { status: 503, offline: true });
    // A bot of a group run here: the whole group goes (default) or it leaves the group.
    const groups = board.all('SELECT g.* FROM bot_groups g JOIN bot_group_members m ON m.group_id = g.id WHERE m.bot_id = ?', row.id).filter((g) => R.isHomeHere(board, g, me));
    if (groups.length && !['group', 'leave', 'done'].includes(opts.group)) return { ok: false, step: 'group', uid: row.uid, groups: groups.map((g) => ({ id: g.id, uid: g.uid, name: g.name, members: B.groupMembers(board, g.id).map((b) => b.name) })) };
    if (groups.length && opts.group === 'leave') for (const g of groups) { const x = B.getGroup(board, g.id); B.updateGroup(board, g.id, { members: x.members.filter((m) => m !== row.id) }); }
    if (groups.length && opts.group === 'group') { const out = []; for (const g of groups) out.push(await moveGroup(g, target, opts)); return { ok: out.every((x) => x.ok), groups: out, uid: row.uid }; }
    return moveOne(row, peer, opts);
  }
  async function moveOne(row, peer, opts = {}) {
    const persons = servedPersons(board, peer);
    const forPerson = (p) => mappedPerson(board, peer, p);
    const jid = journal.start(row, peer.key, { brain: opts.brain ?? null });
    const fail = (why, extra = {}) => {
      const r = R.botByUid(board, row.uid);
      if (r && R.isHomeHere(board, r) && r.home_state === 'moving') setState(r, 'active');
      journal.phase(jid, 'aborted'); peer.call('home.abort', { uid: row.uid }).catch(() => {});
      moveEvent(row, 'aborted', { reason: why });
      return { ok: false, uid: row.uid, failed: why, ...extra };
    };
    moveEvent(row, 'prepare', { to: peer.key });
    let prep;
    try { prep = await peer.call('home.prepare', { uid: row.uid }); } catch (error) { return fail('prepare', { message: oneLine(error.message, 300) }); }
    if (!prep?.ok) return fail(prep?.reason ?? 'prepare', { reason: prep?.reason ?? null });
    const bot = parsed(row);
    if (!(prep.brains ?? AGENT_IDS).includes(bot.agent) && !(opts.brain && (prep.brains ?? []).includes(opts.brain.agent))) {
      journal.phase(jid, 'aborted');
      return { ok: false, step: 'brain', uid: row.uid, agent: bot.agent, brains: prep.brains ?? [] };
    }
    const sites = sitesOf(row);
    // Moving: new messages wait (Bots.hold); a running turn finishes (or is cut).
    setState(row, 'moving'); journal.phase(jid, 'moving'); moveEvent(row, 'moving', { to: peer.key });
    bots?.holdQueued(row.id);
    const cut = await waitTurn(row);
    const cancelled = bots?.cancelCards(row.id) ?? 0;
    if (cancelled) bots?.say('system', tr('msg.home.cardsCancelled', { n: cancelled }), { bot: row.id, kind: 'moving' }, B.botConversation(board, bot, { person: row.person_id ?? owner() }), { notify: [] });
    // The last changes, then both sides compare.
    let v = null; const mine = () => R.verifyCounts(board, board.one('SELECT * FROM bots WHERE id = ?', row.id), { persons });
    for (let i = 0; i < 3; i++) {
      try { v = await peer.call('home.verify', { uid: row.uid }); } catch (error) { return fail('verify', { message: oneLine(error.message, 300) }); }
      const m = mine();
      if (v?.ok && v.lines === m.lines && v.linesHash === m.linesHash && v.reminders === m.reminders && v.files === m.files) break;
      v = { ...v, mismatch: { here: m, there: { lines: v?.lines, reminders: v?.reminders, files: v?.files } } };
    }
    if (!v?.ok || v.mismatch) return fail('verify', { mismatch: v?.mismatch ?? null });
    // Commit: epoch + 1, the home is the target (in one transaction with the journal).
    const epoch = (Number(board.one('SELECT home_epoch FROM bots WHERE id = ?', row.id)?.home_epoch) || 0) + 1;
    let tail = null; try { tail = R.buildPage(board, row.uid, Number(v.seq) || 0, { persons, forPerson }); } catch { tail = null; }
    let held = [];
    board.transaction(() => {
      held = (bots?.takeHeld(row.uid) ?? []).map((h) => ({ ...h, forPerson: mappedPerson(board, peer, h.person) }));
      board.run("UPDATE bots SET home = ?, home_epoch = ?, home_state = 'active', home_fork = NULL WHERE id = ?", peer.key, epoch, row.id);
      journal.phase(jid, 'committed', { epoch, brain: opts.brain ?? null, tail, held, cancelled, from: ctx.config?.mobile?.name || ctx.config?.assistantName || null });
    });
    bots?.drop(row.id);
    homeEvent(row);
    const commit = { uid: row.uid, epoch, tail, brain: opts.brain ?? null, held, cancelled, from: ctx.config?.mobile?.name || null };
    let pendingCommit = false;
    try { await peer.call('home.commit', commit); journal.phase(jid, 'done'); }
    catch (error) { pendingCommit = true; log(`hogar: confirmar en ${peer.name}: ${error.message} (se reintenta)`); }
    moveEvent(row, 'done', { to: peer.key, epoch });
    schedule(peer.key, 30);
    return { ok: true, uid: row.uid, id: row.id, to: peer.key, toName: peer.name, epoch, cut, cancelledCards: cancelled, held: held.length, sites, missing: prep.missing ?? null, sameName: prep.sameName ?? null, pendingCommit };
  }
  // A group goes as one: its members first (each one checked), then the group itself.
  async function moveGroup(g, to, opts = {}) {
    const me = self();
    if (!R.isHomeHere(board, g, me)) { const home = peerByKey(g.home); if (!home?.online) throw err(tr('msg.home.homeOffline', { name: home?.name ?? peerName(g.home) }), { status: 503, offline: true }); return home.call('home.moveTo', { uid: g.uid, to, opts }); }
    const peer = peerByKey(to);
    if (!peer || !capable(peer) || !peer.online) throw err(tr('msg.home.noTarget'), { status: 409 });
    const members = B.groupMembers(board, g.id).filter((b) => R.isHomeHere(board, b, me));
    const results = [];
    for (const b of members) {
      const r = await moveOne(board.one('SELECT * FROM bots WHERE id = ?', b.id), peer, { ...opts, group: 'done' });
      results.push({ name: b.name, ...r });
      if (!r.ok) return { ok: false, group: g.uid, name: g.name, members: results };
    }
    const epoch = (Number(g.home_epoch) || 0) + 1;
    let tail = null; try { tail = R.buildPage(board, g.uid, 0, { persons: servedPersons(board, peer), forPerson: (p) => mappedPerson(board, peer, p) }); } catch { tail = null; }
    board.run('UPDATE bot_groups SET home = ?, home_epoch = ? WHERE id = ?', peer.key, epoch, g.id);
    try { await peer.call('home.commit', { uid: g.uid, epoch, tail, kind: 'group' }); } catch (error) { log(`hogar: grupo: ${error.message}`); }
    bots?.updated(null);
    return { ok: true, group: g.uid, name: g.name, members: results };
  }
  // A move whose commit did not reach the target: again, now that it is on.
  async function finishMoves(peer) {
    for (const j of board.all("SELECT * FROM bot_moves WHERE phase = 'committed' AND to_home = ?", peer.key)) {
      const d = json(j.detail, {});
      const row = R.botByUid(board, j.bot_uid);
      // Only while that is still where it goes, with that epoch (a takeover since then supersedes it).
      if (!row || row.home !== peer.key || Number(row.home_epoch) !== Number(d.epoch)) { journal.phase(j.id, 'done'); continue; }
      try { await peer.call('home.commit', { uid: j.bot_uid, epoch: Number(d.epoch), tail: d.tail ?? null, brain: d.brain ?? null, held: d.held ?? [], cancelled: d.cancelled ?? 0, from: d.from ?? null }); journal.phase(j.id, 'done'); }
      catch (error) { if (isOffline(error)) return; log(`hogar: confirmar: ${error.message}`); }
    }
  }
  // «Pasar al PC» with the home off: the copy here becomes the home (epoch + 1). If that home is still on somewhere, both
  // may act until they see each other; then the higher epoch wins and what the old one did is added here.
  function takeover(row, { restore = false } = {}) {
    if (R.isHomeHere(board, row)) return { ok: true, already: true, uid: row.uid };
    const from = row.home;
    const fork = { from, seq: cursors.get(from, row.uid).seq, at: now() };
    const epoch = (Number(row.home_epoch) || 0) + 1;
    const id = crypto.randomUUID();
    board.run('INSERT INTO bot_moves (id, bot_uid, from_home, to_home, phase, epoch, detail, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, row.uid, from, self(), restore ? 'restored' : 'takeover', epoch, JSON.stringify({ fork }), now(), now());
    promote(row, epoch, { fork });
    board.settingJson(`bot_handoff:${row.id}`, { from: peerName(from), at: now(), done: [] });
    const bot = parsed(row);
    bots?.say('system', tr(restore ? 'msg.home.restored' : 'msg.home.takenOver', { name: peerName(from) }), { bot: row.id, kind: 'takeover' }, B.botConversation(board, bot, { person: row.person_id ?? owner() }), { notify: [] });
    moveEvent(row, restore ? 'restored' : 'takeover', { from, epoch });
    return { ok: true, uid: row.uid, epoch, forced: true, signIn: true };
  }
  // A copy whose home is gone (unlinked or a server reinstalled): it runs here, or here first and then on `to`.
  async function restore(idOrUid, to = null) {
    const row = resolve(idOrUid); if (!row) throw err(tr('msg.bots.noBot', { name: String(idOrUid ?? '') }), { status: 404 });
    const r = takeover(row, { restore: true });
    if (!to || to === 'here' || to === self()) return r;
    const m = await move(row.uid, to, {});
    return { ...m, restored: true };
  }
  // The sites a bot used (its one-time OKs and the pages of its purchase cards): sign-ins do not move with it.
  function sitesOf(row) {
    const hosts = new Set();
    const g = board.settingJson(`bot_grant:${row.id}`); if (g?.host) hosts.add(g.host);
    for (const r of board.all("SELECT payload FROM bot_requests WHERE bot_id = ? AND kind = 'confirm' ORDER BY id DESC LIMIT 200", row.id)) { const h = B.siteOf(json(r.payload, {})?.url ?? ''); if (h) hosts.add(h); }
    return [...hosts].slice(0, 30);
  }

  // ---- unlinking an Orb
  function archiveFrom(key) {
    if (!key) return 0;
    const n = Number(board.run("UPDATE bots SET home_state = 'archived' WHERE home = ? AND home_state != 'archived'", key).changes) || 0;
    if (n) bots?.updated(null);
    return n;
  }
  // mode: 'bring' (every bot of the caller run there comes here first; then the link goes), 'leave' (they stay there; the
  // copies here are kept frozen with «Restaurar aquí»), 'cancel'.
  async function unlink(peerIdOrKey, mode, who = null) {
    const peer = peers().find((p) => p.id === peerIdOrKey || p.key === peerIdOrKey);
    if (!peer) throw err(tr('msg.link.noCentro'), { status: 404 });
    if (mode === 'cancel') return { ok: true, cancelled: true };
    const person = who?.person ?? owner();
    const theirs = board.all("SELECT * FROM bots WHERE home = ? AND home_state != 'archived'", peer.key).filter((b) => (b.person_id ?? owner()) === person || who?.role === 'owner');
    const report = [];
    if (mode === 'bring') {
      if (!peer.online) throw err(tr('msg.home.homeOffline', { name: peer.name }), { status: 503, offline: true });
      for (const b of theirs) {
        let r; try { r = await move(b.uid, 'here', { group: 'group' }); } catch (error) { r = { ok: false, failed: oneLine(error.message, 200) }; }
        report.push({ name: b.name, uid: b.uid, ...r });
        if (!r.ok) return { ok: false, mode, report, kept: true };
      }
      await until(() => theirs.every((b) => R.isHomeHere(board, R.botByUid(board, b.uid))), 15_000);
    }
    if (peer.id) unlinkedLinks.add(peer.id);
    const archived = archiveFrom(peer.key);
    // Whatever was on its way with that Orb is over: linked again later, its sync starts afresh.
    syncing.delete(peer.key); wasOnline.delete(peer.key); lastSync.delete(peer.key);
    if (peer.via === 'link') await getLink()?.disconnect(peer.id).catch(() => {});
    else getRemote()?.revoke(peer.id);
    return { ok: true, mode, report, archived };
  }
  const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

  // «These are the same bot» (an Orb Núcleo's bots brought by 3.6 and the paused ones left here): the one here becomes
  // the copy of the one there; its old chat stays with it.
  function sameBot(localId, uid) {
    const local = board.one('SELECT * FROM bots WHERE id = ?', Number(localId));
    if (!local || !R.isUid(uid)) throw err(tr('msg.bots.noBot', { name: String(localId ?? '') }), { status: 404 });
    if (!R.isHomeHere(board, local)) throw err(tr('msg.home.runsElsewhere', { name: local.name }));
    const copy = R.botByUid(board, uid);
    if (copy && copy.id === local.id) return { ok: true, id: local.id };
    if (copy && R.isHomeHere(board, copy)) throw err(tr('msg.home.bothHere'));
    if (copy) {
      board.transaction(() => { board.run('UPDATE conversations SET bot_id = ? WHERE bot_id = ?', copy.id, local.id); board.run('UPDATE bot_reminders SET enabled = 0 WHERE bot_id = ?', local.id); });
      bots?.drop(local.id); B.deleteBot(board, local.id);
      bots?.updated(copy.id);
      return { ok: true, id: copy.id, merged: true };
    }
    const home = peers().find((p) => p.online && capable(p));
    board.run("UPDATE bots SET uid = ?, home = ?, home_state = 'active' WHERE id = ?", uid, home?.key ?? local.home, local.id);
    bots?.drop(local.id);
    if (home) schedule(home.key, 10);
    return { ok: true, id: local.id };
  }
  // Two bots of the same name (one came with a move): the survivor keeps its own; the other's memory becomes pending
  // proposals for it and the other is archived (paused, its chat kept).
  function merge(survivorId, otherId) {
    const a = resolve(survivorId); const b = resolve(otherId);
    if (!a || !b || a.id === b.id) throw err(tr('msg.bots.noBot', { name: '' }), { status: 404 });
    if (!R.isHomeHere(board, a) || !R.isHomeHere(board, b)) throw err(tr('msg.home.runsElsewhere', { name: R.isHomeHere(board, a) ? b.name : a.name }));
    const text = B.readMemory(b.id).trim();
    let proposals = 0;
    if (text) { B.proposeMemory(board, a.id, text, { mode: 'append', which: 'bot', actor: b.name }); proposals++; }
    for (const f of board.all('SELECT DISTINCT person_id FROM conversations WHERE bot_id = ?', b.id)) {
      const person = f.person_id ?? owner(); const mine = B.readMemory(b.id, { person, which: 'mine' }).trim();
      if (mine) { B.proposeMemory(board, a.id, mine, { mode: 'append', person, which: 'mine', actor: b.name }); proposals++; }
    }
    bots?.drop(b.id);
    const name = `${b.name.slice(0, 26)} (${tr('msg.home.archivedName')})`.slice(0, 40);
    let free = name; try { B.checkBotFields(board, { name }, { partial: true, id: b.id }); } catch { free = `${name.slice(0, 32)} ${b.id}`.slice(0, 40); }
    board.run("UPDATE bots SET paused = 1, is_chief = 0, home_state = 'archived', name = ? WHERE id = ?", free, b.id);
    board.run('UPDATE bot_reminders SET enabled = 0 WHERE bot_id = ?', b.id);
    bots?.updated(a.id); bots?.updated(b.id);
    return { ok: true, survivor: a.id, archived: b.id, proposals };
  }

  // ---- views and status
  function homeView(row) {
    const me = self(); const here = R.isHomeHere(board, row, me);
    const p = here ? null : peerByKey(row.home);
    const state = row.home_state ?? 'active';
    return { uid: row.uid ?? null, home: row.home ?? me, homeEpoch: Number(row.home_epoch) || 0, homeState: state, homeHere: here,
      homeKind: here ? 'here' : isServer(p) ? 'server' : 'orb', homeName: here ? tr('msg.home.thisOrb') : p?.name ?? tr('msg.home.otherOrb'),
      homeOnline: here ? true : Boolean(p?.online), homeKnown: here || Boolean(p), readOnly: !here || state !== 'active', executor: here && state === 'active',
      queued: here ? 0 : queued(row.uid), needs: json(row.needs, null) };
  }
  function status() {
    return { self: self(), product: product(), peers: peers().map((p) => ({ key: p.key, id: p.id, name: p.name, online: p.online, capable: capable(p), server: isServer(p), lastSync: lastSync.get(p.key) ? new Date(lastSync.get(p.key)).toISOString() : null })),
      moves: board.all('SELECT id, bot_uid, from_home, to_home, phase, epoch, started_at, updated_at FROM bot_moves ORDER BY started_at DESC LIMIT 30'),
      queued: board.one('SELECT COUNT(*) AS n FROM link_queue WHERE status = ?', QUEUE_STATUS)?.n ?? 0 };
  }
  // Where a bot of this person can run: here and every linked Orb of 3.7 (Orb Server: only Claude and Codex).
  function homes() {
    return [{ key: self(), name: tr('msg.home.thisOrb'), here: true, online: true, server: product() === 'server', brains: product() === 'server' ? SERVER_BRAINS : AGENT_IDS },
      ...peers().filter(capable).map((p) => ({ key: p.key, id: p.id, name: p.name, here: false, online: p.online, server: isServer(p), brains: isServer(p) ? SERVER_BRAINS : AGENT_IDS }))];
  }

  // ---- the loop: pokes after local changes, a quiet sync now and then
  let lastSeq = board.one('SELECT MAX(seq) AS s FROM bot_changes')?.s ?? 0; let pokeTimer = null; let loop = null; let tick = null; let ticks = 0;
  const poke = () => { for (const p of peers()) if (p.online && capable(p)) p.call('replica.poke', {}).catch(() => {}); };
  function start() {
    recover();
    tick = setInterval(() => {
      try {
        const s = board.one('SELECT MAX(seq) AS s FROM bot_changes')?.s ?? 0;
        if (s !== lastSeq) { lastSeq = s; clearTimeout(pokeTimer); pokeTimer = setTimeout(poke, 200); pokeTimer.unref?.(); }
        for (const p of peers()) { if (!p.online) wasOnline.set(p.key, false); else if (!wasOnline.get(p.key)) schedule(p.key, 50); }
        if (++ticks % 5 === 0) drainQueue().catch((e) => log(`hogar: cola: ${e.message}`));
      } catch (error) { log(`hogar: ${error.message}`); }
    }, 400);
    tick.unref?.();
    loop = setInterval(() => { for (const p of peers()) if (p.online && capable(p)) schedule(p.key, 0); }, SYNC_MS);
    loop.unref?.();
    if (bots) {
      // A message to a bot run on another Orb (bot_send): there, as a relay.
      bots.crossSend = (from, to, p, person) => { forwardWrite(board.one('SELECT * FROM bots WHERE id = ?', to.id), 'bots.relay', { from: from.name, text: p.text, topic: p.topic }, { person }).catch((e) => log(`hogar: bot_send: ${e.message}`)); };
    }
    return api_;
  }
  function stop() { clearInterval(tick); clearInterval(loop); clearTimeout(pokeTimer); for (const t of timers.values()) clearTimeout(t); timers.clear(); }
  const syncNow = async () => { for (const p of peers()) if (p.online && capable(p)) await syncKey(p.key).catch((e) => log(`hogar: ${e.message}`)); return status(); };

  const api_ = { start, stop, serve, peers, homes, status, syncNow, move, takeover: (id) => { const r = resolve(id); if (!r) throw err(tr('msg.bots.noBot', { name: '' })); return takeover(r); }, restore, unlink, sameBot, merge,
    forwardWrite, homeView, archiveFrom, isHomeHere: (row) => R.isHomeHere(board, row), onOrbGone: (peer) => archiveFrom(peer?.key) };
  return api_;
}
