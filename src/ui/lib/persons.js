// 3.6 «Personas»: what the screens decide about people, kept pure (no React, no bridge) so test/personas-ui.test.mjs
// checks it. The server decides who may see what; these only pick what to draw. With one person nothing of this shows.

export const ROLES = ['owner', 'user'];
export const RIGHTS = ['view', 'talk', 'edit'];
export const CAPS = ['dev'];
// 3.8: «all» (before, the bots' messages too) shows the same as «chat»: it is offered no more and reads as «chat».
export const PREVIEWS = ['chat', 'none'];
export const previewOf = (v) => (v === 'none' ? 'none' : 'chat');
export const SHARE_TYPES = ['project'];

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

// Share dialog: who it can go to (everyone but oneself and the resource's person), with the right each one has now.
export function shareRows(persons = [], shares = [], { me = null, owner = null } = {}) {
  const has = new Map((shares ?? []).map((s) => [s.person, s.right]));
  return persons.filter((p) => p.id !== me && p.id !== owner).map((p) => ({ id: p.id, name: p.name, right: has.get(p.id) ?? null }));
}
// «Compartido conmigo» (shares.list().withMe), grouped by kind and matched with the lists the store already has.
export function sharedWithMe(withMe = [], { projects = [] } = {}) {
  const find = (type, id) => (type === 'project' ? projects.find((p) => p.name?.toLowerCase() === String(id).toLowerCase()) : null);
  return withMe.filter((s) => SHARE_TYPES.includes(s.type)).map((s) => { const x = find(s.type, s.id); return { ...s, name: x?.name ?? String(s.id), icon: x?.icon ?? null, found: Boolean(x), item: x ?? null }; });
}
// The badge «Compartido por Ana» on a resource the caller does not own (its person field, the shares of the caller).
export function sharedBy(withMe = [], type, id) {
  const s = withMe.find((x) => x.type === type && String(x.id).toLowerCase() === String(id).toLowerCase());
  return s ? { by: s.by, right: s.right } : null;
}

// Protocol of the links (src/core/link-payload.mjs › PROTOCOL): an Orb that asks for more than this app speaks must be updated.
export const PROTOCOL = 3;
export const needsAppUpdate = (me) => Number(me?.min ?? 0) > PROTOCOL;

// The phone's lock: after this long in the background the PIN (or the fingerprint in the app) is asked again.
export const PHONE_LOCK_MS = 5 * 60_000;
export const phoneShouldLock = ({ hasPin, unlockedAt, hiddenAt, now = Date.now() }) => Boolean(hasPin) && (!unlockedAt || (hiddenAt != null && now - hiddenAt >= PHONE_LOCK_MS));
