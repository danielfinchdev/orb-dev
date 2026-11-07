// 3.7 (WS2): the app's side of its Orb Server.
// - «Añadir Orb Server»: the install command's one-time code (remote.serverCode) and the link made when the server comes
//   back with it (remote.onServerOffer: the app links to the server with the server's own offer, as with a QR).
// - Who is who: the persons of this app mapped to persons of the server (link_persons on both sides, confirmed by the
//   owner; never by name). Their forwarded calls and their bots' events follow the mapping (forward.mjs, link.relay).
// - The hub handoff (3.7 Q1): with a Server linked, this app hands its phones to it (link:handoff: a one-time
//   offer of the server, sealed for each device on its existing link); they link there by themselves and their Orb mode
//   comes back here through the server's taller.* relay. Unlinking the server hands them back (link:handback).
// - The guide after pairing: the server's own Claude / Codex sign-in (agents.login on the server, windowless; the server
//   keeps its own session: nothing of this app's accounts travels), moving the bots (bots.move), vault, browser logins.
import { tr } from '../core/context.mjs';
import { ownerOfBoard, audit } from '../core/authz.mjs';
import { createPerson, listPersons, getPerson } from '../core/persons.mjs';
import { mappedPerson } from '../core/link-persons.mjs';
import { serverInstallCommand, serverInstallSteps } from '../core/server-install.mjs';
import { serverSkew, missingCap, CAPS } from '../core/server-pair.mjs';
import { HOME_SQL } from '../core/replica.mjs';
import { oneLine } from '../core/safety.mjs';

const KINDS = ['phone', 'browser'];
const HANDBACK_MS = 3 * 86_400_000;
const err = (message, extra = {}) => Object.assign(new Error(message), { userFacing: true, ...extra });
const now = () => new Date().toISOString();

export function createHub({ board, remote: getRemote, link: getLink, log = () => {}, version = null }) {
  const owner = () => ownerOfBoard(board);
  const records = () => board.settingJson('hub_handoffs') ?? {};
  const saveRecords = (r) => board.settingJson('hub_handoffs', r);
  // The linked Orb Server: the one linked with «Añadir Orb Server», else an Orb that keeps bots and does not program
  // (a 3.6 Orb Núcleo linked by hand). The owner's link only.
  function serverPeer() {
    const list = (getLink()?.peers() ?? []).filter((p) => !p.revoked && !p.clone && !p.person && (p.server || p.role === 'centro'));
    return list.find((p) => p.server && p.online) ?? list.find((p) => p.server) ?? list.find((p) => p.online) ?? list[0] ?? null;
  }
  const needPeer = () => serverPeer() ?? (() => { throw err(tr('msg.server.notLinked'), { status: 404 }); })();
  const peerObj = (p) => ({ id: p.id, key: p.orb ?? null, person: p.person ?? null, remotePerson: p.remotePerson ?? null });
  const keyOf = (p) => p.orb ?? p.id;
  const features = (p) => p?.remote?.features ?? [];
  // The persons of this app mapped to persons of that Orb (for link.relay: their events go to that person there).
  function mapped(p) {
    try { return board.all('SELECT local_person AS local, remote_person AS remote FROM link_persons WHERE confirmed_at IS NOT NULL AND peer IN (?, ?)', String(p.id), String(p.orb ?? p.id)); } catch { return []; }
  }

  // ---- «Añadir Orb Server»
  // The install command with this app's one-time code. kind: the way in the server should use to reach this app
  // ('tailscale' or 'wifi'; Tailscale by default when there is one).
  function code({ kind = null } = {}) {
    const r = getRemote().serverCode({ kind });
    const cmd = serverInstallCommand({ code: r.code, address: r.address, fp: r.fp, version });
    return { ...r, command: cmd.command, ready: cmd.ready, sha256: cmd.sha256, url: cmd.url, pair: cmd.pair, steps: serverInstallSteps({ code: r.code, address: r.address, fp: r.fp, version }),
      // Without the command: the short code the server prints, typed here with its address (link.connect).
      manual: { method: 'link.connect', params: ['code', 'address'] } };
  }
  async function onServerOffer({ offer }) {
    const link = getLink(); if (!link) throw err(tr('msg.link.unavailable'));
    const peer = await link.connect({ qr: offer, person: null });
    link.mark(peer.id, { server: true });
    board.notice(tr('msg.server.paired', { name: peer.name }), 'success');
    afterPair(peer.id).catch((e) => log(`servidor: ${e.message}`));
    return peer;
  }
  // Once the server said hello (its features, whom it counts this link as): its phones go to it.
  async function afterPair(id) {
    const end = Date.now() + 30_000;
    while (Date.now() < end) {
      const p = getLink()?.peers().find((x) => x.id === id);
      if (p?.online && p.remote && p.remotePerson) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await handoffAll();
  }

  // ---- status and versions
  function status() {
    const p = serverPeer();
    const st = getRemote()?.serverCodeState?.() ?? { active: false };
    if (!p) return { linked: false, code: st };
    const skew = p.remote ? serverSkew({ app: version, server: p.remote.version, features: features(p) }) : null;
    const recs = Object.values(records()).filter((r) => r.peer === p.id);
    return { linked: true, code: st, peer: { id: p.id, name: p.name, online: p.online, fp: p.fp, version: p.remote?.version ?? null, features: features(p), lastSeen: p.lastSeen },
      skew: skew ? { ...skew, message: tr(skew.key, { has: skew.has ?? '?', need: skew.need ?? '?' }), ...(skew.upgrade ? { command: serverInstallCommand({ version }).command } : {}) } : null,
      handoffs: recs.map(({ ref, name, kind, person, status: s, reason, at }) => ({ ref, name, kind, person, status: s, reason: reason ?? null, at })) };
  }

  // ---- who is who
  async function persons() {
    const p = needPeer();
    const there = await getLink().op(p.id, 'persons', { action: 'list' });
    const mine = listPersons(board);
    const rows = mapped(p);
    const linkThere = p.remotePerson?.id ?? null;
    return {
      peer: p.id,
      here: mine.map((x) => ({ id: x.id, name: x.name, role: x.role, mappedTo: x.id === owner() ? linkThere : rows.find((r) => r.local === x.id)?.remote ?? null, fixed: x.id === owner() })),
      there: (there?.persons ?? []).map((x) => ({ id: x.id, name: x.name, role: x.role, mappedTo: x.id === linkThere ? owner() : rows.find((r) => r.remote === x.id)?.local ?? null, fixed: x.id === linkThere }))
    };
  }
  // «María aquí = María en el Server» (remote + local), or someone new: here (create: their name there) or there
  // (createThere: true, named as the person here).
  async function map({ remote = null, local = null, create = false, createThere = false }, who = null) {
    const p = needPeer();
    if (!p.online) throw err(tr('msg.home.homeOffline', { name: p.name }), { status: 503 });
    const there = (await getLink().op(p.id, 'persons', { action: 'list' }))?.persons ?? [];
    if (createThere) {
      const me = getPerson(board, local); if (!me) throw err(tr('msg.persons.noPerson'), { status: 404 });
      if (local === owner()) throw err(tr('msg.server.mapOwner'), { status: 409 });
      const r = await getLink().op(p.id, 'persons', { action: 'map', create: me.name, remote: local });
      remote = r.local;
    } else {
      const them = there.find((x) => x.id === remote); if (!them) throw err(tr('msg.persons.noPerson'), { status: 404 });
      if (remote === p.remotePerson?.id) throw err(tr('msg.server.mapOwner'), { status: 409 });
      if (create) { local = createPerson(board, { name: oneLine(String(them.name), 40) }).id; board.changed('persons'); }
      if (!getPerson(board, local)) throw err(tr('msg.persons.noPerson'), { status: 404 });
      if (local === owner()) throw err(tr('msg.server.mapOwner'), { status: 409 });
      await getLink().op(p.id, 'persons', { action: 'map', local: remote, remote: local });
    }
    const key = keyOf(p);
    board.run('DELETE FROM link_persons WHERE peer IN (?, ?) AND (local_person = ? OR remote_person = ?)', key, p.id, local, remote);
    board.run('INSERT INTO link_persons (peer, local_person, remote_person, confirmed_at) VALUES (?, ?, ?, ?)', key, local, String(remote), now());
    if (who) audit(board, who, 'link.server.map', { type: 'person', id: local }, 'allow', 'owner');
    board.changed('persons');
    handoffAll().catch((e) => log(`servidor: traspaso: ${e.message}`));
    return { ok: true, local, remote };
  }
  async function unmap({ remote = null, local = null }) {
    const p = needPeer();
    const row = board.one('SELECT * FROM link_persons WHERE peer IN (?, ?) AND (remote_person = ? OR local_person = ?)', keyOf(p), p.id, String(remote ?? ''), String(local ?? ''));
    if (!row) return { ok: true };
    board.run('DELETE FROM link_persons WHERE peer IN (?, ?) AND local_person = ?', keyOf(p), p.id, row.local_person);
    if (p.online) await getLink().op(p.id, 'persons', { action: 'unmap', remote: row.local_person }).catch(() => {});
    return { ok: true };
  }

  // ---- the hub handoff
  // Who a device's person is on the server: the link's own person (the owner) or a mapped one; null: not mapped yet.
  const thereFor = (p, person) => mappedPerson(board, peerObj(p), person ?? owner());
  let handing = null;
  async function handoffAll({ only = null } = {}) {
    if (handing) return handing;
    handing = (async () => {
      const p = serverPeer(); const remote = getRemote();
      if (!p?.online || !features(p).includes(CAPS.home) || !remote) return { sent: 0 };
      const recs = records(); const list = [];
      for (const d of remote.devices()) {
        if (!KINDS.includes(d.kind) || (only && d.id !== only)) continue;
        const r = recs[d.id];
        if (r && ['done', 'returning'].includes(r.status)) continue;
        const person = thereFor(p, d.person);
        recs[d.id] = { ref: d.id, peer: p.id, name: d.name, kind: d.kind, person: d.person, approve: d.approve !== false, status: person ? (r?.status ?? 'pending') : 'unmapped', at: now() };
        if (person && d.online) list.push({ ref: d.id, kind: d.kind, person, name: d.name, approve: d.approve !== false });
      }
      saveRecords(recs);
      if (!list.length) return { sent: 0 };
      const answers = await getLink().op(p.id, 'handoff', { action: 'offers', list });
      let sent = 0; const again = records();
      for (const a of answers ?? []) {
        const r = again[a.ref]; if (!r) continue;
        if (!a.offer) { r.status = a.error === 'unmapped' ? 'unmapped' : 'error'; r.reason = a.error ?? null; continue; }
        if (remote.sendToDevice(a.ref, 'link:handoff', { offer: a.offer, hub: a.hub, from: { name: getRemote().status().name, fp: remote.fingerprint() } })) { r.status = 'sent'; r.at = now(); sent++; }
      }
      saveRecords(again);
      return { sent };
    })().finally(() => { handing = null; });
    return handing;
  }
  // The server says a device is linked there now: this app forgets its old link.
  function onHandoffDone(payload, peer) {
    const p = serverPeer(); if (!p || peer?.id !== p.id) return;
    const recs = records(); const r = recs[String(payload?.ref ?? '')];
    if (!r || r.peer !== p.id) return;
    r.status = 'done'; r.at = now(); saveRecords(recs);
    try { getRemote().revoke(r.ref, { quiet: true }); } catch { /* it said goodbye already */ }
    board.notice(tr('msg.server.handedOff', { name: r.name, server: p.name }), 'info', r.person && r.person !== owner() ? { person: r.person, owner: true } : {});
  }
  function onDeviceOnline(device) {
    if (!KINDS.includes(device?.kind)) return;
    const r = records()[device.id];
    if (r && ['done', 'returning'].includes(r.status)) return;
    if (serverPeer()?.online) handoffAll({ only: device.id }).catch((e) => log(`servidor: traspaso: ${e.message}`));
  }
  // Before the server is unlinked: the devices handed to it come back here (offers of this app, sent by the server now
  // or when each one connects; they last a few days).
  async function handback(peerView) {
    if (!peerView?.server && peerView?.role !== 'centro') return { sent: 0 };
    const recs = records(); const remote = getRemote();
    const mine = Object.values(recs).filter((r) => r.peer === peerView.id && r.status === 'done');
    if (!mine.length || !remote) { for (const r of Object.values(recs)) if (r.peer === peerView.id && r.status !== 'done') delete recs[r.ref]; saveRecords(recs); return { sent: 0 }; }
    if (!remote.status().running) await remote.start();
    const list = mine.map((r) => ({ ref: r.ref, offer: remote.handoffOffer({ kind: r.kind, person: r.person, approve: r.approve, ms: HANDBACK_MS, meta: { back: true, ref: r.ref } }), hub: { name: remote.status().name, fp: remote.fingerprint() } }));
    const res = await getLink().op(peerView.id, 'handoff', { action: 'back', list });
    for (const r of mine) { r.status = 'returning'; r.at = now(); }
    for (const r of Object.values(recs)) if (r.peer === peerView.id && !['returning'].includes(r.status)) delete recs[r.ref];
    saveRecords(recs);
    return res;
  }
  // A device paired with one of this app's offers (back from the server).
  function onHandoff({ ref, back }) {
    if (!back || !ref) return;
    const recs = records(); if (recs[ref]) { delete recs[ref]; saveRecords(recs); }
  }

  // ---- the guide after pairing
  async function guide(who = null) {
    const p = needPeer();
    const person = who?.person ?? owner();
    let agents = [];
    if (p.online) {
      try {
        const st = await getLink().call(p.id, 'agents.status', {});
        agents = (Array.isArray(st) ? st : []).filter((a) => ['claude', 'codex'].includes(a.id)).map((a) => ({ agent: a.id, label: a.label ?? a.id, installed: a.installed !== false,
          signedIn: (a.accounts ?? []).some((x) => x.login === 'si'), accounts: (a.accounts ?? []).map((x) => ({ id: x.id, label: x.label ?? x.id, login: x.login ?? null })) }));
      } catch (e) { log(`servidor: agentes: ${e.message}`); }
    }
    const here = board.all(`SELECT b.id FROM bots b WHERE ${HOME_SQL('b')} AND COALESCE(b.home_state, 'active') != 'archived' AND COALESCE(b.person_id, ?) = ?`, owner(), person).length;
    const f = features(p);
    return {
      peer: { id: p.id, name: p.name, online: p.online },
      steps: [
        { id: 'agents', done: agents.some((a) => a.signedIn), agents, call: 'link.server.login' },
        { id: 'bots', done: here === 0, botsHere: here, call: 'bots.move', to: p.orb ?? null },
        { id: 'vault', optional: true, available: f.includes(CAPS.vault), ...(f.includes(CAPS.vault) ? {} : { needs: tr(missingCap(f, CAPS.vault)) }) },
        { id: 'browser', optional: true, available: f.includes(CAPS.browserLive), ...(f.includes(CAPS.browserLive) ? {} : { needs: tr(missingCap(f, CAPS.browserLive)) }) }
      ]
    };
  }
  // The server's own sign-in, from here: what agents.login answers there (its link and code); the code the user pastes
  // goes there. Nothing of this app's accounts is sent.
  const loginCall = async (method, params) => { const p = needPeer(); if (!p.online) throw err(tr('msg.home.homeOffline', { name: p.name }), { status: 503 }); return getLink().call(p.id, method, params); };
  const login = ({ agent, account, mode }) => loginCall('agents.login', { account: account ?? agent, mode: mode ?? 'device' });
  const loginCode = ({ id, code: c }) => loginCall('agents.loginCode', { id, code: c });
  const loginState = ({ id }) => loginCall('agents.loginState', { id });
  const loginCancel = ({ id }) => loginCall('agents.loginCancel', { id });

  return { serverPeer, mapped, code, onServerOffer, status, persons, map, unmap, handoffAll, onHandoffDone, onDeviceOnline, handback, onHandoff, guide, login, loginCode, loginState, loginCancel };
}
