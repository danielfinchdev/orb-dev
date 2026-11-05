// 3.6 «Personas»: the one place that decides who may do what (docs/PERSONAS-INTERNALS.md).
//   authorize(board, principal, method, params)  every API call (the dispatcher of src/engine/api.mjs calls it first)
//   audienceOf(board, event, payload)            who receives each event, push and forwarded event
//   can / must / rightOn / ownerOf / scopeSql     what the methods and the agents' tools use inside
// A principal is built only by the entry points (principalOf), never from a call's parameters. Rows written by code that
// does not stamp a person yet (person_id NULL) are the owner's. No engine imports: the MCP processes use it too.
import { ctx, tr, keepsBots } from './context.mjs';
import { ownerId as findOwner } from './persons.mjs';
import { policyOf, ceilingFor, withinCeiling, eventRule } from './policy.mjs';
import { shapeGateway } from './shape.mjs';

export const RIGHTS = ['view', 'talk', 'edit'];
const RANK = { view: 1, talk: 2, edit: 3, own: 4 };
export const rank = (right) => RANK[right] ?? 0;
export const CHANNELS = ['desktop', 'phone', 'browser', 'terminal', 'orb', 'forward', 'control', 'agent', 'system'];
const SHAREABLE = new Set(['bot', 'group', 'project', 'integration']);
const DEVICE_CHANNEL = { phone: 'phone', browser: 'browser', terminal: 'terminal', orb: 'orb' };

// A refused call: 403, with a message the user may read (never what exists or whose it is).
const REASON_KEY = { noDev: 'msg.authz.noDev', ceiling: 'msg.remote.pcOnly', ownerOnly: 'msg.authz.ownerOnly', admin: 'msg.authz.ownerOnly', strong: 'msg.authz.needPin', desktop: 'msg.remote.pcOnly' };
export class AuthzError extends Error {
  constructor(reason = 'denied', { method = null, resource = null } = {}) {
    super(tr(REASON_KEY[reason] ?? 'msg.authz.denied'));
    this.name = 'AuthzError'; this.status = 403; this.userFacing = true; this.reason = reason; this.method = method; this.resource = resource;
  }
}

// ---- the owner (cached per board: there is one, and it never changes)
const owners = new WeakMap();
export function ownerOfBoard(board) {
  const cached = owners.get(board); if (cached) return cached;
  const id = findOwner(board) ?? ctx.owner ?? null;
  if (id) owners.set(board, id);
  return id;
}
const roleOf = (board, person) => {
  if (!person) return 'owner';
  if (person === ownerOfBoard(board)) return 'owner';
  try { return board.one('SELECT role FROM persons WHERE id = ? AND deleted_at IS NULL', person)?.role ?? null; } catch { return null; }
};

// ---- principals
// { person, role, channel, device?, rights: { approve, dev, admin }, strongUntil?, via?, remote?, confirmed?, ceiling? }
// desktop: this PC's window (person: who sits there; the owner by default). device: a row of devices (a linked phone,
// browser, terminal or Orb). forwarded: a call the centre passed to this workshop. control: Orb Server's socket.
// agentToken: an agent's tool process ({ agent, task, conversation, bot, person }). system: the engine itself.
// ceiling: a Set given by an entry point that already knows the device's (remote.mjs allowedFor).
export function principalOf(board, { device = null, desktop = false, person = null, forwarded = false, control = false, agentToken = null, system = false, ceiling = null, strongUntil = null, via = null } = {}) {
  const owner = ownerOfBoard(board);
  const alive = (pid) => (pid && roleOf(board, pid) ? pid : null);
  let p;
  if (system) p = { person: owner, channel: 'system', rights: { approve: true, dev: true, admin: true } };
  else if (desktop) p = { person: alive(person) ?? owner, channel: 'desktop', rights: { approve: true, dev: true, admin: true } };
  else if (control) p = { person: owner, channel: 'control', rights: { approve: true, dev: true, admin: true } };
  else if (device) {
    p = { person: alive(device.person_id) ?? owner, channel: forwarded ? 'forward' : DEVICE_CHANNEL[device.kind] ?? 'browser', device: String(device.id ?? ''), remote: true,
      confirmed: device.kind !== 'orb' || Number(device.kind_ok ?? 1) === 1,
      rights: { approve: Number(device.approve ?? 1) === 1, dev: Number(device.dev_ok ?? 0) === 1, admin: Boolean(Number(device.admin ?? 0)) } };
  } else if (forwarded) p = { person: alive(person) ?? owner, channel: 'forward', remote: true, rights: { approve: true, dev: false, admin: false } };
  else if (agentToken) p = { person: alive(agentToken.person) ?? owner, channel: 'agent', via: { agent: agentToken.agent ?? null, task: agentToken.task ?? null, conversation: agentToken.conversation ?? null, bot: agentToken.bot ?? null }, rights: { approve: false, dev: false, admin: false } };
  else throw new Error('principalOf: no entry point');
  const role = roleOf(board, p.person) ?? 'user';
  // Only the owner administers; a user's device never does, whatever its flag.
  if (role !== 'owner') p.rights = { ...p.rights, admin: false };
  if (role !== 'owner' && p.channel === 'desktop') p.rights = { ...p.rights, admin: false };
  return Object.freeze({ ...p, role, rights: Object.freeze(p.rights), ...(ceiling ? { ceiling } : {}), ...(strongUntil ? { strongUntil } : {}), ...(via && !p.via ? { via } : {}) });
}
export const isSystem = (principal) => principal?.channel === 'system';

// ---- resources
const one = (board, sql, ...args) => { try { return board.one(sql, ...args); } catch { return undefined; } };
// The row behind a resource and where its rights also come from: { owner, parents } (owner null: no such resource).
function resolve(board, res) {
  const owner = ownerOfBoard(board);
  const who = (row) => (row ? row.person_id ?? owner : null);
  const t = res?.type; const id = res?.id;
  switch (t) {
    case 'owner': return { owner, parents: [] };
    case 'person': { const r = one(board, 'SELECT id FROM persons WHERE id = ? AND deleted_at IS NULL', String(id)); return { owner: r ? r.id : null, parents: [] }; }
    // 3.6 (WS2): a row without a person that belongs to a parent (a group's conversation, a task's session) is the
    // parent's person's, not the owner's: children inherit (plan §1), also when they were made before anyone stamped them.
    case 'conversation': { const r = one(board, 'SELECT person_id, group_id FROM conversations WHERE id = ?', Number(id)); return { owner: r && r.person_id == null && r.group_id ? resolve(board, { type: 'group', id: r.group_id }).owner ?? owner : who(r), parents: r?.group_id ? [{ type: 'group', id: r.group_id }] : [] }; }
    case 'chat': {
      const r = one(board, 'SELECT person_id, conversation_id FROM chat WHERE id = ?', Number(id));
      if (!r) return { owner: null, parents: [] };
      if (r.conversation_id != null) return { ...resolve(board, { type: 'conversation', id: r.conversation_id }), via: { type: 'conversation', id: r.conversation_id } };
      return { owner: who(r), parents: [] };
    }
    case 'bot': { const r = one(board, 'SELECT id, person_id FROM bots WHERE id = ?', Number(id)) ?? one(board, 'SELECT id, person_id FROM bots WHERE name = ? COLLATE NOCASE', String(id)); return { owner: who(r), parents: [], key: r ? String(r.id) : null }; }
    case 'group': { const r = one(board, 'SELECT id, person_id FROM bot_groups WHERE id = ?', Number(id)); return { owner: who(r), parents: [], key: r ? String(r.id) : null }; }
    case 'project': { const r = one(board, 'SELECT name, person_id FROM projects WHERE name = ? COLLATE NOCASE', String(id)); return { owner: who(r), parents: [], key: r?.name ?? null }; }
    case 'task': { const r = one(board, 'SELECT person_id, project FROM tasks WHERE id = ?', Number(id)); return { owner: who(r), parents: r ? [{ type: 'project', id: r.project }] : [] }; }
    case 'session': { const r = one(board, 'SELECT person_id, kind, task_id FROM sessions WHERE id = ?', String(id)); const task = r?.kind === 'task' && r.task_id; return { owner: r && r.person_id == null && task ? resolve(board, { type: 'task', id: r.task_id }).owner ?? owner : who(r), parents: task ? [{ type: 'task', id: r.task_id }] : [] }; }
    case 'schedule': { const r = one(board, 'SELECT person_id, project FROM schedules WHERE id = ?', Number(id)); return { owner: who(r), parents: r ? [{ type: 'project', id: r.project }] : [] }; }
    case 'reminder': { const r = one(board, 'SELECT person_id, bot_id FROM bot_reminders WHERE id = ?', Number(id)); return { owner: who(r), parents: r ? [{ type: 'bot', id: r.bot_id }] : [] }; }
    case 'request': { const r = one(board, 'SELECT person_id, bot_id FROM bot_requests WHERE id = ?', Number(id)); return { owner: who(r), parents: r ? [{ type: 'bot', id: r.bot_id }] : [] }; }
    case 'device': { const r = one(board, 'SELECT person_id FROM devices WHERE id = ?', String(id)); return { owner: who(r), parents: [] }; }
    case 'account': { const a = (ctx.config?.accounts ?? []).find((x) => x.id === String(id)); return { owner: a ? a.person ?? owner : null, parents: [] }; }
    case 'integration': return { owner: ['ha', 'pc', 'srv'].includes(String(id)) ? owner : null, parents: [], key: String(id) };
    case 'log': return String(id) === 'general' ? { owner, parents: [] } : { ...resolve(board, { type: 'project', id }), via: { type: 'project', id } };
    default: return { owner: null, parents: [] };
  }
}
// Whose a resource is (a person id), or null when there is no such resource.
export const ownerOf = (board, res) => resolve(board, res).owner;
const shareRight = (board, type, key, person) => (key == null ? null : one(board, 'SELECT right FROM shares WHERE resource_type = ? AND resource_id = ? AND person_id = ?', type, String(key), person)?.right ?? null);
// The best right a person has on a resource: 'own' | 'edit' | 'talk' | 'view' | null. Through a share of the resource
// itself, or of its parent (a task's project, a group's conversation…; owning the parent gives «edit» on the child).
export function rightOn(board, person, res, depth = 0) {
  if (!person || depth > 4) return null;
  const r = resolve(board, res);
  if (r.owner == null) return null;
  if (r.owner === person) return 'own';
  let best = null;
  const take = (right) => { if (rank(right) > rank(best)) best = right; };
  const type = r.via?.type ?? res.type;
  if (SHAREABLE.has(type)) take(shareRight(board, type, r.key ?? res.id, person));
  for (const parent of r.parents) { const pr = rightOn(board, person, parent, depth + 1); take(pr === 'own' ? 'edit' : pr); }
  return best;
}
export function can(board, principal, right, res) {
  if (isSystem(principal)) return true;
  return rank(rightOn(board, principal?.person, res)) >= rank(right === 'approve' ? 'talk' : right);
}
export function must(board, principal, right, res, { method = null } = {}) {
  if (can(board, principal, right, res)) return true;
  audit(board, principal, method, res, 'deny', 'right');
  throw new AuthzError('right', { method, resource: res });
}

// What a list may show: the caller's own rows and the ones shared with them. → { where, args } for a WHERE clause on
// that table's alias (the owner's own include the rows without a person).
export function scopeSql(principal, type, alias = 't') {
  if (isSystem(principal)) return { where: '1=1', args: [] };
  const a = alias; const pid = String(principal?.person ?? '');
  const own = principal?.role === 'owner' ? `(${a}.person_id = ? OR ${a}.person_id IS NULL)` : `${a}.person_id = ?`;
  const shared = (rtype, col) => `EXISTS (SELECT 1 FROM shares s WHERE s.resource_type = '${rtype}' AND s.resource_id = ${col} AND s.person_id = ?)`;
  const extra = {
    bot: shared('bot', `CAST(${a}.id AS TEXT)`),
    group: shared('group', `CAST(${a}.id AS TEXT)`),
    project: shared('project', `${a}.name COLLATE NOCASE`),
    task: shared('project', `${a}.project COLLATE NOCASE`),
    schedule: shared('project', `${a}.project COLLATE NOCASE`),
    conversation: `(${a}.group_id IS NOT NULL AND ${shared('group', `CAST(${a}.group_id AS TEXT)`)})`
  }[type];
  return extra ? { where: `(${own} OR ${extra})`, args: [pid, pid] } : { where: own, args: [pid] };
}

// ---- the audit (ids and names only, never content)
export function audit(board, principal, method, res, decision, reason) {
  try {
    board.run('INSERT INTO audit (at, person_id, device_id, channel, method, resource, decision, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', new Date().toISOString(),
      principal?.person ?? null, principal?.device ?? null, principal?.channel ?? null, method ? String(method).slice(0, 80) : null, res ? `${res.type}:${String(res.id ?? '').slice(0, 80)}` : null, decision, reason ?? null);
  } catch { /* a database without the table (never fatal) */ }
}

// ---- the decision on one call: ceiling of the channel → the method's rule → the right on its resources → strong auth.
// Returns the rule; throws AuthzError (and writes an audit row) when refused.
export function authorize(board, principal, method, params = {}) {
  const deny = (reason, res = null) => { audit(board, principal, method, res, 'deny', reason); throw new AuthzError(reason, { method, resource: res }); };
  if (!principal || typeof principal !== 'object') deny('noPrincipal');
  if (!withinCeiling(ceilingFor(principal, { keepsBots: keepsBots() }), method)) deny('ceiling');
  const rule = policyOf(method);
  if (!rule) deny('noPolicy');
  if (isSystem(principal)) return rule;
  if (rule.desktop && principal.channel !== 'desktop') deny('desktop');
  if (rule.ownerOnly && principal.role !== 'owner') deny('ownerOnly');
  if (rule.admin && principal.remote && !principal.rights?.admin) deny('admin');
  if (typeof rule.check === 'function') { const ok = rule.check(board, principal, params ?? {}); if (ok !== true) deny(typeof ok === 'string' ? ok : 'check'); }
  if (typeof rule.res === 'function') {
    let list; try { list = rule.res(params ?? {}); } catch { list = null; }
    for (const res of [list].flat().filter((r) => r && r.id != null && r.id !== '')) {
      const need = res.right ?? rule.right ?? 'view';
      if (ownerOf(board, res) == null) {
        // No such thing: the method says so itself (as before 3.6) to the owner; anyone else learns nothing.
        if (principal.role === 'owner') continue;
        deny('notFound', res);
      }
      if (!can(board, principal, need, res)) deny('right', res);
    }
  }
  if (typeof rule.strong === 'function' && rule.strong(params ?? {}, board)) {
    const hasPin = Boolean(one(board, 'SELECT pin_hash FROM persons WHERE id = ?', principal.person)?.pin_hash);
    if (hasPin && !(Number(principal.strongUntil) > Date.now())) deny('strong');
  }
  return rule;
}

// ---- events: who receives one → { persons: Set } | { all: true } | { owner: true } (no rule: the owner).
export function audienceOf(board, event, payload) {
  const rule = eventRule(event);
  if (rule === undefined || rule === 'owner') return { owner: true };
  if (rule === 'all') return { all: true };
  let out; try { out = typeof rule === 'function' ? rule(payload) : null; } catch { out = null; }
  if (out === 'all') return { all: true };
  if (!out || out === 'owner') return { owner: true };
  if (out.person) return { persons: new Set([String(out.person)]) };
  if (out.id == null || out.id === '') return { owner: true };
  const persons = peopleWith(board, out);
  return persons.size ? { persons } : { owner: true };
}
export const hasAudienceRule = (event) => eventRule(event) !== undefined;
// Everyone with at least «view» on a resource: its person and the people it (or its parent) is shared with.
export function peopleWith(board, res, depth = 0) {
  const out = new Set(); if (depth > 4) return out;
  const r = resolve(board, res);
  if (r.owner == null) return out;
  out.add(r.owner);
  const type = r.via?.type ?? res.type;
  if (SHAREABLE.has(type)) { try { for (const s of board.all('SELECT person_id FROM shares WHERE resource_type = ? AND resource_id = ?', type, String(r.key ?? res.id))) out.add(s.person_id); } catch { /* no table */ } }
  for (const parent of r.parents) for (const p of peopleWith(board, parent, depth + 1)) out.add(p);
  return out;
}
// Whether an audience includes a person (the sinks of WS2 use it).
export const reaches = (board, audience, person) => Boolean(audience?.all || (audience?.owner && person === ownerOfBoard(board)) || audience?.persons?.has(person));

// ---- what a caller gets back: never secrets, never another person's PIN data. (WS2 adds the per-channel shaping of
// app.state and the other people's metadata.)
const SECRET_KEYS = new Set(['pin_hash', 'pin_salt', 'token_hash']);
// 3.6 (WS2): with the board, also what each person may see of the result (src/core/shape.mjs; every channel, this PC's
// window too, once there is more than one person).
export function shapeFor(principal, method, result, board = null) {
  if (isSystem(principal) || result == null || typeof result !== 'object') return result;
  if (board) result = shapeGateway(board, principal, method, result);
  if (principal?.channel === 'desktop') return result;
  if (!String(method).startsWith('persons.')) return result;
  const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, x]) => [k, strip(x)])) : v);
  return strip(result);
}
