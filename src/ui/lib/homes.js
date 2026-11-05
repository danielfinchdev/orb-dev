// 3.7 (WS4): the pure pieces of «one home per bot» in the interface (no React, no store): where a bot runs and what its
// badge says, what can be done with it from here, the migration wizard's plan and report, the person mapping rows and
// the steps after pairing an Orb Server. Tested in test/servidor-ui.test.mjs. The engine side is docs/BOTS.md › «One
// home per bot» (bots.homes, bots.move, bots.restore, bots.merge, bots.unlink) and src/engine/hub.mjs (link.server.*).

// Where a bot runs, for its badge and its state line. A bot without home fields (an Orb before 3.7) runs here.
// → { kind: 'here' | 'server' | 'orb', label key, name, online, readOnly, archived, unknown, queued }
export function homeOf(bot) {
  if (!bot || bot.homeKind == null) return { kind: 'here', here: true, name: '', online: true, readOnly: false, archived: false, unknown: false, queued: 0 };
  const here = bot.homeHere !== false && bot.homeKind === 'here';
  return {
    kind: here ? 'here' : bot.homeKind === 'server' ? 'server' : 'orb',
    here,
    name: bot.homeName ?? '',
    online: here || bot.homeOnline !== false,
    readOnly: Boolean(bot.readOnly) && !here,
    archived: bot.homeState === 'archived',
    moving: bot.homeState === 'moving' || bot.homeState === 'demoting',
    unknown: !here && bot.homeKnown === false,
    queued: Number(bot.queued) || 0
  };
}
// Badges only make sense once bots may run in two places (a Server linked, or a bot already elsewhere).
export const showHomeBadges = (bots, serverLinked = false) => serverLinked || (Array.isArray(bots) && bots.some((b) => b?.homeKind && b.homeKind !== 'here'));
// The badge's words: «Server» / «Este PC» / the other Orb's name. serverHere: this device talks to the Orb Server itself
// (a phone linked to it), so «here» is the Server and the PC is called by its name.
export function badgeOf(bot, t, { serverHere = false } = {}) {
  const h = homeOf(bot);
  if (h.kind === 'here') return serverHere ? { kind: 'server', text: t('home.badge.server'), offline: false } : { kind: 'here', text: t('home.badge.here'), offline: false };
  if (h.kind === 'server') return { kind: 'server', text: t('home.badge.server'), offline: !h.online };
  return { kind: 'orb', text: h.name || t('home.badge.orb'), offline: !h.online };
}

// The Orbs a bot can move to (bots.homes → [{ key, name, here, online, server, brains }]), without the one it runs on.
// The labels: «Pasar al Server» / «Pasar a este PC» / «Pasar a <name>».
export function moveTargets(bot, homes = []) {
  const h = homeOf(bot);
  const list = Array.isArray(homes) ? homes : [];
  return list.filter((x) => (h.here ? !x.here : x.here || x.key !== bot?.home))
    .map((x) => ({ key: x.here ? 'here' : x.key, name: x.name, here: Boolean(x.here), server: Boolean(x.server), online: x.here || x.online !== false, brains: x.brains ?? [] }));
}
export const moveLabel = (target, t, { serverHere = false } = {}) => (target.here ? (serverHere ? t('home.moveServer') : t('home.moveHere')) : target.server ? t('home.moveServer') : t('home.moveTo', { name: target.name }));

// What this device may do with a bot that runs elsewhere: talk (queued when its home is off), pause or change it (only
// while its home answers: the change is made there), move it here (its home on, or a takeover with a warning), restore a
// frozen copy whose home is gone.
export function replicaActions(bot) {
  const h = homeOf(bot);
  if (h.here) return { talk: true, change: true, move: true, restore: false, takeover: false, queued: false };
  if (h.archived || h.unknown) return { talk: false, change: false, move: false, restore: true, takeover: false, queued: false };
  return { talk: true, change: h.online && !h.moving, move: !h.moving, restore: false, takeover: !h.online, queued: !h.online };
}

// ---- the migration wizard («¿Dónde quieres que se ejecuten tus bots?»)
// The bots of this person that run here and could go (not archived; the copies of other Orbs' bots are not theirs to move).
export const movableHere = (bots, me = null) => (Array.isArray(bots) ? bots : []).filter((b) => homeOf(b).here && b.homeState !== 'archived' && (me == null || b.person_id == null || b.person_id === me || b.right === 'own'));
// choice: 'all' | 'pick' | 'none'; picked: ids chosen in «Elegir cuáles». → the ids to move, in the list's order.
export function planMove(bots, choice, picked = []) {
  if (choice === 'none') return [];
  const ids = (Array.isArray(bots) ? bots : []).map((b) => b.id);
  if (choice === 'all') return ids;
  const set = new Set((Array.isArray(picked) ? picked : []).map(Number));
  return ids.filter((id) => set.has(Number(id)));
}
// The report after moving: what went, what failed, sites to sign in again on the Server, connectors missing there and
// same-name bots to merge. results: [{ id, name, ...bots.move answer }].
export function moveReport(results = []) {
  const ok = []; const failed = []; const sites = new Set(); const missing = new Set(); const sameName = []; let ha = false;
  for (const r of Array.isArray(results) ? results : []) {
    if (r?.ok) ok.push(r.name); else failed.push({ name: r?.name ?? '', why: r?.failed ?? r?.error ?? null });
    for (const s of r?.sites ?? []) sites.add(String(s));
    for (const c of r?.missing?.connectors ?? []) missing.add(String(c));
    if (r?.missing?.ha) ha = true;
    if (r?.ok && r.sameName?.uid) sameName.push({ id: r.id, uid: r.uid, name: r.name, other: r.sameName.uid, otherName: r.sameName.name });
  }
  return { ok, failed, sites: [...sites].sort(), missing: [...missing].sort(), ha, sameName };
}

// ---- who is who (link.server.persons → { here: [...], there: [...] })
// One row per user of this app other than the admin, with the person there they are (or null) and the choices.
export function mappingRows(persons) {
  const there = persons?.there ?? [];
  return (persons?.here ?? []).filter((p) => !p.fixed).map((p) => ({
    id: p.id, name: p.name, mappedTo: p.mappedTo ?? null,
    choices: there.filter((x) => !x.fixed && (x.mappedTo == null || x.mappedTo === p.id)).map((x) => ({ value: x.id, label: x.name }))
  }));
}

// ---- the steps after pairing (link.server.guide → { peer, steps: [{ id, done, optional, available, ... }] })
export const GUIDE_ORDER = ['agents', 'bots', 'persons', 'vault', 'browser'];
// The steps to show, in order: «persons» only with two or more users here; the optional ones only when the Server can.
export function guideSteps(guide, { personsCount = 1 } = {}) {
  const byId = new Map((guide?.steps ?? []).map((s) => [s.id, s]));
  const out = [];
  for (const id of GUIDE_ORDER) {
    if (id === 'persons') { if (Number(personsCount) > 1) out.push({ id, done: false, optional: false }); continue; }
    const s = byId.get(id); if (!s) continue;
    if (s.optional && s.available === false) continue;
    out.push({ ...s, done: Boolean(s.done) });
  }
  return out;
}
// The first step still to do (or the last one when all are done).
export function firstOpenStep(steps) { const i = (steps ?? []).findIndex((s) => !s.done && !s.optional); return i === -1 ? 0 : i; }

// «Reconectar Claude en el Server»: the agents the Server's bots think with that are not signed in there.
// agents: the guide's [{ agent, signedIn, installed }]; bots: bots.list's bots.
export function expiredOnServer(agents, bots) {
  const out = new Set(); const signed = new Map((Array.isArray(agents) ? agents : []).map((a) => [a.agent, Boolean(a.signedIn)]));
  if (!signed.size) return [];
  for (const b of Array.isArray(bots) ? bots : []) {
    const h = homeOf(b);
    if (h.kind !== 'server' || h.archived) continue;
    if (signed.has(b.agent) && !signed.get(b.agent)) out.add(b.agent);
  }
  return [...out];
}

// ---- the phone: one reminder per uid, only those the connected Orb rings (executor), on a stable id.
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
export function dedupeReminders(list) {
  const seen = new Set(); const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.executor === false) continue;
    const key = r.uid ? `u:${r.uid}` : `i:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.uid ? { ...r, id: hash(r.uid) } : r);
  }
  return out;
}
// A notification seen once (by its uid) is not shown again (the same bot's line coming from two Orbs).
export function onceByUid(max = 300) {
  const seen = [];
  return (uid) => { if (!uid) return true; if (seen.includes(uid)) return false; seen.push(uid); if (seen.length > max) seen.shift(); return true; };
}

// A count in words: key for many, `${key}.one` for one («1 bot», «2 bots»).
export const tn = (t, key, n, vars = {}) => t(Number(n) === 1 ? `${key}.one` : key, { n, ...vars });
