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
// A count in words: key for many, `${key}.one` for one («1 bot», «2 bots»).
export const tn = (t, key, n, vars = {}) => t(Number(n) === 1 ? `${key}.one` : key, { n, ...vars });
