// 3.6 «Personas»: what the screens decide about people, kept pure (no React, no bridge) so test/personas-ui.test.mjs
// checks it. The server decides who may see what; these only pick what to draw. With one person nothing of this shows.

export const ROLES = ['owner', 'user'];
export const RIGHTS = ['view', 'talk', 'edit'];
export const CAPS = ['dev', 'house', 'approveHouse'];
export const PREVIEWS = ['all', 'chat', 'none'];
export const SHARE_TYPES = ['bot', 'group', 'project'];

// state.me: { person: { id, name, role, language, tz, hasPin }, role, personsCount } (persons.me), or null on an Orb
// before 3.6 (then it behaves as one person).
export const personsOn = (me) => Number(me?.personsCount ?? 1) > 1;
export const isOwner = (me) => !me || me.role === 'owner';
// The screens of people: the person menu, «Mi perfil», badges, «Compartido conmigo», «¿Para quién?». The owner's
// Ajustes › Personas shows always (it is where the second person is added).
export const showPersonUi = (me) => personsOn(me);
export const showPersonsSettings = (me, { mobile = false } = {}) => !mobile && isOwner(me);
export const myName = (me) => me?.person?.name ?? '';
// What the app calls the person using it (the greeting): their own name; the admin's is the settings' userName.
export const userNameOf = (me, config) => (me?.person && !isOwner(me) ? me.person.name : config?.userName?.trim() || '');
export const initials = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// A PIN: 4 to 12 digits (src/core/persons.mjs checks it again).
export const pinOk = (pin) => /^\d{4,12}$/.test(String(pin ?? ''));
// The words for a refused PIN (persons.verifyPin / persons.switch / persons.unlock): a locale key and its values.
export function pinRefusal(r, now = Date.now()) {
  if (!r || r.ok) return null;
  if (r.reason === 'locked') return { key: 'persons.pin.locked', vars: { s: Math.max(1, Math.ceil((Date.parse(r.lockedUntil ?? '') - now) / 1000) || 30) } };
  if (Number.isFinite(r.triesLeft)) return { key: 'persons.pin.wrongLeft', vars: { n: r.triesLeft } };
  return { key: 'persons.pin.wrong', vars: {} };
}

// Magic Link: the linked devices grouped by person (the owner sees everyone's; others only their own). The owner's
// group first, then the others by name; a device without a person is the owner's.
export function devicesByPerson(devices, persons = [], ownerId = null) {
  const owner = ownerId ?? persons.find((p) => p.role === 'owner')?.id ?? null;
  const nameOf = (id) => persons.find((p) => p.id === id)?.name ?? null;
  const groups = new Map();
  for (const d of devices ?? []) {
    const pid = d.person ?? owner;
    if (!groups.has(pid)) groups.set(pid, { person: pid, name: d.personName ?? nameOf(pid) ?? '', owner: pid === owner, devices: [] });
    groups.get(pid).devices.push(d);
  }
  return [...groups.values()].sort((a, b) => (a.owner === b.owner ? a.name.localeCompare(b.name) : a.owner ? -1 : 1));
}

// Agentes › Cuentas: whose an account is for the person looking (accounts[].person; none = the owner's) and the loans
// they got (accounts.loans().got).
export const accountOwner = (acc, ownerId) => acc?.person ?? ownerId ?? null;
export function accountRole(acc, me, loans, ownerId) {
  const mine = me?.person?.id ?? ownerId;
  if (accountOwner(acc, ownerId) === mine) return 'own';
  if ((loans?.got ?? []).some((l) => l.account === acc.id)) return 'borrowed';
  return 'other';
}
// «de Ana · te quedan 34 turnos hoy»: what is left of a loan, the tightest cap first ({ key, vars } for the locale).
export function loanLeftText(loan) {
  const l = loan?.left ?? {};
  if (loan?.expired) return { key: 'persons.loan.expired', vars: {} };
  if (l.turns != null) return { key: 'persons.loan.leftTurns', vars: { n: l.turns } };
  if (l.tokens != null) return { key: 'persons.loan.leftTokens', vars: { n: l.tokens } };
  if (l.usd != null) return { key: 'persons.loan.leftUsd', vars: { n: l.usd } };
  return { key: 'persons.loan.noCap', vars: {} };
}
// What the «Prestar a…» form sends (accounts.lend): empty caps are no cap; at least bots or programming.
export function lendPayload(account, v) {
  const n = (x) => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  const days = n(v.days);
  return {
    id: account, person: v.person,
    daily_turns: n(v.turns), daily_tokens: n(v.tokens), daily_usd: n(v.usd),
    reserve_pct: Math.min(95, Math.max(0, n(v.reserve) ?? 20)),
    bots: v.bots !== false, dev: v.dev === true,
    expires_at: days && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null
  };
}

// The bot editor's account picker: the person's own accounts of that agent, then the ones lent to them for bots.
export function botAccountChoices({ accounts = [], loans = null, me = null, ownerId = null, agent }) {
  const mine = me?.person?.id ?? ownerId;
  const own = accounts.filter((a) => a.agent === agent && accountOwner(a, ownerId) === mine && a.enabled !== false).map((a) => ({ id: a.id, label: a.label, lent: false }));
  const got = (loans?.got ?? []).filter((l) => l.bots && !l.expired && (accounts.find((a) => a.id === l.account)?.agent ?? agent) === agent && !own.some((o) => o.id === l.account))
    .map((l) => ({ id: l.account, label: l.label ?? l.account, lent: true, lender: l.lender }));
  return [...own, ...got];
}

// Share dialog: who it can go to (everyone but oneself and the resource's person), with the right each one has now.
export function shareRows(persons = [], shares = [], { me = null, owner = null } = {}) {
  const has = new Map((shares ?? []).map((s) => [s.person, s.right]));
  return persons.filter((p) => p.id !== me && p.id !== owner).map((p) => ({ id: p.id, name: p.name, right: has.get(p.id) ?? null }));
}
// «Compartido conmigo» (shares.list().withMe), grouped by kind and matched with the lists the store already has.
export function sharedWithMe(withMe = [], { bots = [], groups = [], projects = [] } = {}) {
  const find = (type, id) => (type === 'bot' ? bots.find((b) => String(b.id) === String(id)) : type === 'group' ? groups.find((g) => String(g.id) === String(id)) : type === 'project' ? projects.find((p) => p.name?.toLowerCase() === String(id).toLowerCase()) : null);
  return withMe.filter((s) => SHARE_TYPES.includes(s.type)).map((s) => { const x = find(s.type, s.id); return { ...s, name: x?.name ?? String(s.id), icon: x?.icon ?? null, found: Boolean(x), item: x ?? null }; });
}
// The badge «Compartido por Ana» on a resource the caller does not own (its person field, the shares of the caller).
export function sharedBy(withMe = [], type, id) {
  const s = withMe.find((x) => x.type === type && String(x.id).toLowerCase() === String(id).toLowerCase());
  return s ? { by: s.by, right: s.right } : null;
}

// The welcome wizard (setup.jsx): three screens, one question each. «¿Para qué lo quieres?»: each tile applies one
// template as it is (src/core/templates); «Más tarde» makes nothing.
export const WIZARD_STEPS = ['nombre', 'quien', 'para'];
export const WIZARD_USES = [
  { id: 'dev', template: 'desarrollo' },
  { id: 'business', template: 'negocio' },
  { id: 'home', template: 'casa' },
  { id: 'later', template: null }
];

// The usage table «Quién ha gastado qué» (usage.byPerson): sorted by today's spend, the total on top.
export function usageRows(rows = []) {
  const list = [...rows].sort((a, b) => (b.today?.turns ?? 0) - (a.today?.turns ?? 0) || (b.month?.turns ?? 0) - (a.month?.turns ?? 0));
  const total = list.reduce((s, r) => ({ today: s.today + (r.today?.turns ?? 0), month: s.month + (r.month?.turns ?? 0), usd: Math.round((s.usd + (r.month?.usd ?? 0)) * 100) / 100 }), { today: 0, month: 0, usd: 0 });
  return { list, total };
}

// Protocol of the links (src/core/link.mjs › PROTOCOL): an Orb that asks for more than this app speaks must be updated.
export const PROTOCOL = 3;
export const needsAppUpdate = (me) => Number(me?.min ?? 0) > PROTOCOL;

// The phone's lock: after this long in the background the PIN (or the fingerprint in the app) is asked again.
export const PHONE_LOCK_MS = 5 * 60_000;
export const phoneShouldLock = ({ hasPin, unlockedAt, hiddenAt, now = Date.now() }) => Boolean(hasPin) && (!unlockedAt || (hiddenAt != null && now - hiddenAt >= PHONE_LOCK_MS));
