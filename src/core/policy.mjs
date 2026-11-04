// 3.6 «Personas»: who may call what (docs/PERSONAS-INTERNALS.md). Deny by default: every API method needs an entry in
// POLICY (test/authz.test.mjs checks none is missing) and every emitted event a rule in EVENTS. authz.mjs reads both.
// No engine imports: the MCP processes load it too.
//
// A POLICY entry (all fields optional, but an entry must exist):
//   public: true            anyone who reaches the method (after the channel's ceiling); no resource is checked
//   ownerOnly: true         only the owner (role «owner»)
//   admin: true             from a linked device, only one with «Puede administrar» (rights.admin)
//   desktop: true           only from this PC's own window
//   res: (params) => r      the resource(s) the call acts on: { type, id, right? } or a list of them; id null or ''
//                           means none (a create, or a bad parameter the method itself refuses)
//   right: 'view' | 'talk' | 'edit' | 'own'   what the caller needs on res (a resource's own `right` wins)
//   create: '<type>'        the call makes a resource of that type, stamped with the caller's person
//   list: '<type>'          a list: the method filters it with authz.scopeSql (WS3/WS4 wire it)
//   strong: (params) => bool   the call needs a strong ticket (a PIN typed in the last minutes) when the caller has a PIN
//   check: (board, principal, params) => true | 'reason'   anything else
// Resource types: person, conversation, chat (a line), bot, group, project, task, session, schedule, reminder, request,
// device, account, integration ('ha' | 'srv'), log (a project's or 'general'), owner (only the owner passes).
//
// Each workstream appends ITS OWN section below (WS2 … WS6) and adds it to POLICY / EVENTS at the bottom: one section per
// workstream, so merges do not conflict. A later section may replace an entry of an earlier one on purpose.

// ---- ceilings: what each channel may call at most (the person's rights on the resource decide inside that).
// What a phone (and a browser, a terminal, a forwarded call) may call. Everything that changes settings, accounts,
// connectors, installs software or publishes stays on the PC. (3.5's ALLOWED of remote.mjs, moved here unchanged.)
export const PHONE_SET = new Set(['app.state', 'chat.list', 'chat.send', 'conversations.list', 'conversations.update', 'conversations.search', 'projects.securityReview', 'chat.stop', 'chat.accept', 'chat.answer', 'chat.settings', 'whiteboard.load', 'whiteboard.save', 'whiteboard.note',
  'tasks.list', 'tasks.live', 'tasks.get', 'tasks.create', 'tasks.approve', 'tasks.retry', 'tasks.cancel', 'tasks.reassign', 'tasks.followup', 'tasks.undo', 'tasks.launchAnyway', 'tasks.accept',
  'sessions.list', 'sessions.create', 'sessions.items', 'sessions.send', 'sessions.stop', 'sessions.update',
  'projects.list', 'projects.icons', 'projects.branch', 'projects.info', 'projects.setActive', 'projects.create', 'logs.list', 'logs.read', 'activity.list', 'usage.get', 'usage.now', 'agents.status', 'models.catalog', 'models.guide',
  'control.pause', 'control.resume', 'sidebar.complete',
  // 2.3: answer permission requests, the queue, continue, fork, settle, Task Review, scheduled tasks and @ (all of it
  // is work the PC already allowed; nothing here changes settings or gives total access).
  'sessions.queue', 'sessions.editQueued', 'sessions.approve', 'sessions.resume', 'sessions.fork', 'sessions.settle', 'approvals.list',
  'tasks.review', 'projects.review', 'schedules.list', 'schedules.create', 'schedules.update', 'schedules.remove', 'schedules.run', 'mentions.options',
  // 3.5: talking to the bots, answering their cards and questions, pausing one and its reminders. Creating, changing or
  // deleting bots, their memories, the golden rules, what nobody touches and Home Assistant's token are set on the PC.
  'bots.list', 'bots.get', 'bots.chat', 'bots.send', 'bots.stop', 'bots.decide', 'bots.answer', 'bots.pause', 'bots.groups.list', 'bots.groups.chat', 'bots.groups.send',
  'bots.memory.get', 'bots.rules.get', 'bots.protected.get', 'bots.reminders.list', 'bots.reminders.create', 'bots.reminders.cancel', 'bots.ha.states', 'bots.srv.status',
  // 3.6 (WS4): the cards waiting for one's answer, and the memory changes a bot wanted (see, approve, undo).
  'bots.cards', 'bots.memory.pending', 'bots.memory.approve', 'bots.memory.history', 'bots.memory.undo', 'bots.ha.allow.get']);
// 3.5: what the bots' owner manages from afar (a confirmed Orb of theirs, or a device with «Puede administrar»).
export const BOTS_OWNER = ['bots.create', 'bots.update', 'bots.delete', 'bots.groups.create', 'bots.groups.update', 'bots.groups.delete', 'bots.memory.set', 'bots.rules.set', 'bots.protected.set', 'bots.ha.get', 'bots.ha.set',
  // 3.6 (WS4): what Home Assistant does without a card, and a bot's conversation brought by «Llevar mis bots».
  'bots.ha.allow.set', 'bots.history.import'];
export const ORB_SET = new Set([...PHONE_SET, ...BOTS_OWNER]);
export const CONSOLE_SET = new Set([...ORB_SET, 'link.qr', 'link.devices', 'link.rename', 'link.revoke', 'link.setAdmin', 'link.setApprove', 'link.confirm', 'link.peers', 'link.connect', 'link.disconnect']);
// 3.5 «Solo Orb»: on a server without a window a linked device signs its agents in.
export const CENTRO_PHONE = new Set(['agents.login', 'agents.loginCode', 'agents.loginCancel', 'agents.loginState']);
// What the centre may forward to its workshop (the same work a phone may do there).
export const FORWARD_SET = PHONE_SET;
// Orb Núcleo's control socket (src/server/control.mjs).
export const CONTROL_SET = new Set(['link.qr', 'link.devices', 'link.status', 'link.revoke', 'app.state',
  // WS5: orb-nucleo copia … / mover exportar (src/server/control.mjs › CONTROL_METHODS)
  'backup.status', 'backup.list', 'backup.now', 'backup.verify', 'backup.restore', 'backup.recovery', 'data.moveExport', 'data.moveStatus', 'data.moveUndo', 'data.moveKeepBoth']);
// '*': no ceiling; null: nothing (an agent's tool process uses authz.can / scopeSql directly, never the API).
export const CEILING = { desktop: '*', system: '*', phone: PHONE_SET, browser: PHONE_SET, terminal: PHONE_SET, orb: ORB_SET, forward: FORWARD_SET, control: CONTROL_SET, agent: null };
// The ceiling of one principal: a device with «Puede administrar» gets the console's; an Orb of the owner the bots'
// owner's only when confirmed and this Orb keeps bots (remote.mjs allowedFor, the same rule).
export function ceilingFor(principal, { keepsBots = true } = {}) {
  if (principal?.ceiling) return principal.ceiling;
  const ch = principal?.channel;
  if (!Object.hasOwn(CEILING, ch)) return null;
  if (['phone', 'browser', 'terminal', 'orb'].includes(ch) && principal.rights?.admin) return CONSOLE_SET;
  if (ch === 'orb') return principal.confirmed !== false && keepsBots ? ORB_SET : PHONE_SET;
  return CEILING[ch];
}
export const withinCeiling = (set, method) => {
  if (set === '*') return true;
  if (!set) return false;
  const prefix = /^(taller|centro)\./.exec(String(method))?.[1];
  // 3.6 (WS3): signing in one's own account works from any channel (the method checks it is the caller's own account).
  return set.has(method) || Boolean(prefix && set.has(`${prefix}.*`)) || CENTRO_PHONE.has(method);
};

// ---- small helpers for the rules
const id = (v) => (v == null || v === '' ? null : v);
const conv = (v) => ({ type: 'conversation', id: id(v) });
const proj = (v) => ({ type: 'project', id: id(v) });
const task = (v) => ({ type: 'task', id: id(v) });
const sess = (v) => ({ type: 'session', id: id(v) });
const bot = (v) => ({ type: 'bot', id: id(v) });
const group = (v) => ({ type: 'group', id: id(v) });
const line = (v) => ({ type: 'chat', id: id(v) });
const OWNER = { type: 'owner', id: 'owner' };
// The person acting on themselves, or the owner acting on someone else.
const selfOrOwner = (board, principal, params) => (params.id == null || params.id === principal.person || principal.role === 'owner' ? true : 'notYours');
const selfOnly = (board, principal, params) => (params.id == null || params.id === principal.person ? true : 'notYours');
// sidebar.complete's key: «c<id>» a conversation, «s<id>» a direct session, «t<id>» a task.
const sidebarRes = (p) => { const k = String(p.key ?? ''); return k[0] === 'c' ? conv(k.slice(1)) : k[0] === 's' ? { ...sess(k.slice(1)), right: 'edit' } : k[0] === 't' ? { ...task(k.slice(1)), right: 'view' } : null; };

// ======== WS1 · core (3.6): every method of 3.5.1, mapped to what it did then (one person: the owner owns every row).
const CORE = {
  // app and settings
  'app.state': { public: true }, // WS2: shaped per person (shapeFor)
  'config.save': { ownerOnly: true },
  'sidebar.complete': { res: sidebarRes, right: 'own' },
  'control.pause': { ownerOnly: true },
  'control.resume': { ownerOnly: true },
  'system.check': { public: true },
  'installer.check': { public: true },
  'installer.progress': { public: true },
  'installer.start': { ownerOnly: true },
  'mcp.folder': { ownerOnly: true },
  'activity.list': { ownerOnly: true, list: 'event' },
  'usage.get': { public: true }, // WS3: own usage + loans
  'usage.now': { public: true },
  'models.guide': { public: true },
  'models.catalog': { public: true },
  'mentions.options': { list: 'project' },
  'approvals.list': { list: 'session' },
  // this PC's tools (PC only by the ceiling; the owner's)
  'android.status': { ownerOnly: true }, 'android.install': { ownerOnly: true }, 'android.devices': { ownerOnly: true }, 'android.pair': { ownerOnly: true }, 'android.connect': { ownerOnly: true }, 'android.info': { ownerOnly: true },
  'net.wifi': { ownerOnly: true }, 'net.nearby': { ownerOnly: true }, 'net.devices': { ownerOnly: true }, 'net.rename': { ownerOnly: true }, 'net.remote': { ownerOnly: true },
  'github.status': { ownerOnly: true }, 'github.contributions': { ownerOnly: true }, 'github.login': { ownerOnly: true },
  'opti.session': { ownerOnly: true }, 'opti.stats': { ownerOnly: true }, 'opti.act': { ownerOnly: true },
  'expert.tree': { ownerOnly: true }, 'expert.read': { ownerOnly: true }, 'expert.status': { ownerOnly: true }, 'expert.diff': { ownerOnly: true }, 'expert.log': { ownerOnly: true }, 'expert.system': { ownerOnly: true },
  'actions.list': { ownerOnly: true }, 'actions.save': { ownerOnly: true }, 'actions.remove': { ownerOnly: true },
  'images.read': { public: true }, // WS3: only pictures of the caller's projects and accounts
  'images.mark': { public: true },
  'images.save': { res: (p) => proj(p.project), right: 'edit' },
  // conversations with the assistant (always private)
  'conversations.list': { list: 'conversation' },
  'conversations.search': { list: 'conversation' },
  'conversations.update': { res: (p) => [conv(p.id), ...(p.project ? [{ ...proj(p.project), right: 'talk' }] : [])], right: 'own' },
  'conversations.remove': { res: (p) => conv(p.id), right: 'own' },
  'chat.list': { res: (p) => (p.conversation == null ? OWNER : conv(p.conversation)), right: 'view' },
  'chat.send': { res: (p) => [conv(p.conversation), ...(p.project ? [{ ...proj(p.project), right: 'talk' }] : [])], right: 'talk', create: 'conversation' },
  'chat.stop': { res: (p) => conv(p.conversation), right: 'talk' },
  'chat.answer': { res: (p) => line(p.id), right: 'talk' },
  'chat.accept': { res: (p) => line(p.id), right: 'talk' },
  'chat.settings': { res: (p) => (p.conversation == null ? OWNER : conv(p.conversation)), right: 'own' }, // WS3: the default brain per person
  // projects (owned, shareable)
  'projects.list': { list: 'project' },
  'projects.icons': { list: 'project' },
  'projects.create': { create: 'project' },
  'projects.import': { create: 'project', ownerOnly: true }, // any folder of this PC
  'projects.clone': { create: 'project', ownerOnly: true },
  'projects.remove': { res: (p) => proj(p.name), right: 'own' },
  'projects.rename': { res: (p) => proj(p.name), right: 'own' },
  'projects.setActive': { res: (p) => proj(p.name), right: 'view' },
  'projects.setIcon': { res: (p) => proj(p.name), right: 'edit' },
  'projects.clearIcon': { res: (p) => proj(p.name), right: 'edit' },
  'projects.branch': { res: (p) => proj(p.name), right: 'view' },
  'projects.info': { res: (p) => proj(p.name), right: 'view' },
  'projects.commit': { res: (p) => proj(p.name), right: 'edit' },
  'projects.merge': { res: (p) => proj(p.name), right: 'edit' },
  'projects.push': { res: (p) => proj(p.name), right: 'edit' },
  'projects.createPr': { res: (p) => proj(p.name), right: 'edit' },
  'projects.createRepo': { res: (p) => proj(p.name), right: 'own' },
  'projects.review': { res: (p) => proj(p.name), right: 'talk' },
  'projects.securityReview': { res: (p) => proj(p.name), right: 'talk' },
  'whiteboard.load': { res: (p) => proj(p.project), right: 'view' },
  'whiteboard.save': { res: (p) => proj(p.project), right: 'edit' },
  'whiteboard.attach': { res: (p) => proj(p.project), right: 'edit' },
  'whiteboard.note': { res: (p) => proj(p.project), right: 'edit' },
  'whiteboard.remove': { res: (p) => proj(p.project), right: 'edit' },
  'whiteboard.folder': { res: (p) => proj(p.project), right: 'view' },
  'logs.list': { list: 'log' },
  'logs.read': { res: (p) => ({ type: 'log', id: id(p.project) }), right: 'view' },
  // tasks (follow their project)
  'tasks.list': { list: 'task' },
  'tasks.live': { list: 'task' },
  'tasks.get': { res: (p) => task(p.id), right: 'view' },
  'tasks.create': { res: (p) => ({ ...proj(p.project), right: 'talk' }), create: 'task' },
  'tasks.approve': { res: (p) => task(p.id), right: 'edit' },
  'tasks.retry': { res: (p) => task(p.id), right: 'edit' },
  'tasks.cancel': { res: (p) => task(p.id), right: 'edit' },
  'tasks.reassign': { res: (p) => task(p.id), right: 'edit' },
  'tasks.followup': { res: (p) => task(p.id), right: 'talk' },
  'tasks.undo': { res: (p) => task(p.id), right: 'edit' },
  'tasks.launchAnyway': { res: (p) => task(p.id), right: 'edit' },
  'tasks.accept': { res: (p) => task(p.id), right: 'talk' },
  'tasks.discardBranch': { res: (p) => task(p.id), right: 'edit' },
  'tasks.review': { res: (p) => task(p.id), right: 'talk' },
  // direct conversations with an agent and task sessions
  'sessions.list': { list: 'session' },
  'sessions.create': { res: (p) => (p.project ? { ...proj(p.project), right: 'talk' } : null), create: 'session' },
  'sessions.items': { res: (p) => sess(p.id), right: 'view' },
  'sessions.send': { res: (p) => sess(p.id), right: 'talk' },
  'sessions.queue': { res: (p) => sess(p.id), right: 'view' },
  'sessions.editQueued': { res: (p) => sess(p.id), right: 'talk' },
  'sessions.approve': { res: (p) => sess(p.id), right: 'talk' },
  'sessions.resume': { res: (p) => sess(p.id), right: 'talk' },
  'sessions.fork': { res: (p) => sess(p.id), right: 'talk', create: 'session' },
  'sessions.settle': { res: (p) => sess(p.id), right: 'edit' },
  'sessions.stop': { res: (p) => sess(p.id), right: 'talk' },
  'sessions.update': { res: (p) => sess(p.id), right: 'edit' },
  'sessions.remove': { res: (p) => sess(p.id), right: 'own' },
  // scheduled tasks (follow their project)
  'schedules.list': { list: 'schedule' },
  'schedules.create': { res: (p) => ({ ...proj(p.project), right: 'talk' }), create: 'schedule' },
  'schedules.update': { res: (p) => ({ type: 'schedule', id: id(p.id) }), right: 'edit' },
  'schedules.remove': { res: (p) => ({ type: 'schedule', id: id(p.id) }), right: 'edit' },
  'schedules.run': { res: (p) => ({ type: 'schedule', id: id(p.id) }), right: 'talk' },
  // bots (owned, shareable; WS4 refines conversations, memories and cards per person)
  'bots.list': { list: 'bot' },
  'bots.get': { res: (p) => bot(p.id), right: 'view' },
  'bots.create': { create: 'bot' },
  'bots.update': { res: (p) => bot(p.id), right: 'edit' },
  'bots.delete': { res: (p) => bot(p.id), right: 'own' },
  'bots.pause': { res: (p) => bot(p.id), right: 'edit' },
  'bots.chat': { res: (p) => bot(p.id), right: 'talk' },
  'bots.send': { res: (p) => bot(p.id), right: 'talk' },
  'bots.stop': { res: (p) => bot(p.id), right: 'talk' },
  'bots.decide': { res: (p) => line(p.item), right: 'talk' }, // WS4: the card's approvers; the device's «Puede aprobar» is checked by engine/bots.mjs
  'bots.answer': { res: (p) => line(p.item), right: 'talk' },
  'bots.groups.list': { list: 'group' },
  'bots.groups.create': { create: 'group' },
  'bots.groups.update': { res: (p) => group(p.id), right: 'edit' },
  'bots.groups.delete': { res: (p) => group(p.id), right: 'own' },
  'bots.groups.chat': { res: (p) => group(p.id), right: 'view' },
  'bots.groups.send': { res: (p) => group(p.id), right: 'talk' },
  'bots.memory.get': { res: (p) => (p.id === 'global' ? null : bot(p.id)), right: 'view' }, // 'global': the caller's own
  'bots.memory.set': { res: (p) => (p.id === 'global' ? null : bot(p.id)), right: 'edit' },
  'bots.rules.get': { public: true },
  'bots.rules.set': { ownerOnly: true }, // the house's golden rules (WS4: personal ones per person)
  'bots.protected.get': { public: true },
  'bots.protected.set': { ownerOnly: true },
  'bots.reminders.list': { res: (p) => (p.id ? bot(p.id) : null), right: 'view', list: 'reminder' },
  'bots.reminders.create': { res: (p) => bot(p.id), right: 'talk', create: 'reminder' },
  'bots.reminders.cancel': { res: (p) => ({ type: 'reminder', id: id(p.id) }), right: 'edit' },
  'bots.ha.get': { ownerOnly: true },
  'bots.ha.set': { ownerOnly: true },
  'bots.ha.states': { res: () => ({ type: 'integration', id: 'ha' }), right: 'view' },
  'bots.srv.status': { res: () => ({ type: 'integration', id: 'srv' }), right: 'view' },
  'bots.where': { public: true }, // WS4: bots.location per person
  'bots.moveTo': { ownerOnly: true },
  // phone access and Magic Link (the console's: «Puede administrar» from afar)
  'remote.status': { ownerOnly: true, admin: true },
  'remote.enable': { ownerOnly: true, admin: true },
  'remote.configure': { ownerOnly: true, admin: true },
  'remote.pair': { ownerOnly: true, admin: true },
  'remote.revoke': { ownerOnly: true, admin: true },
  'link.qr': { ownerOnly: true, admin: true }, // WS2: a QR for oneself; for others owner only
  'link.setApprove': { ownerOnly: true, admin: true },
  'link.confirm': { ownerOnly: true, admin: true },
  'link.setAdmin': { ownerOnly: true, admin: true },
  'link.devices': { ownerOnly: true, admin: true }, // WS2: own devices for everyone
  'link.revoke': { ownerOnly: true, admin: true },
  'link.rename': { ownerOnly: true, admin: true },
  'link.status': { public: true },
  'link.connect': { ownerOnly: true, admin: true },
  'link.peers': { ownerOnly: true, admin: true },
  'link.disconnect': { ownerOnly: true, admin: true },
  'taller.*': { public: true }, // WS2: forwarding rules (A13)
  'centro.*': { public: true }, // WS2
  // agents and accounts (WS3: own accounts for everyone, loans)
  'agents.status': { public: true },
  'agents.check': { ownerOnly: true },
  'agents.login': { ownerOnly: true },
  'agents.loginCode': { ownerOnly: true },
  'agents.loginCancel': { ownerOnly: true },
  'agents.loginState': { ownerOnly: true },
  'agents.install': { ownerOnly: true },
  'agents.installState': { ownerOnly: true },
  'accounts.add': { ownerOnly: true },
  'accounts.scan': { ownerOnly: true },
  'accounts.update': { ownerOnly: true },
  'accounts.remove': { ownerOnly: true },
  'accounts.clearCooldown': { ownerOnly: true },
  // people (api-persons.mjs)
  'persons.list': { public: true },
  'persons.me': { public: true },
  'persons.create': { ownerOnly: true, create: 'person' },
  'persons.rename': { check: selfOrOwner },
  'persons.remove': { check: selfOrOwner },
  'persons.setPin': { check: selfOrOwner, strong: (p) => p.current == null }, // with the PIN in use typed again, no ticket needed
  'persons.verifyPin': { check: selfOnly },
  'persons.switch': { desktop: true },
  'persons.overview': { ownerOnly: true }
};

// ======== WS2 · gateway (remote, link, terminal): append entries here.
// Devices and links are each person's: a person manages their own (api-link.mjs filters and checks the device), the owner
// everyone's. A QR for someone else, a new person or «Puede administrar»: the owner only.
const qrRule = (board, principal, params) => (principal.role === 'owner' || ((params.person == null || params.person === '' || params.person === principal.person) && !params.newPerson && !params.admin) ? true : 'notYours');
const GATEWAY = {
  'link.qr': { admin: true, check: qrRule },
  'link.devices': { public: true }, // own devices; the owner's: everyone's
  'link.revoke': { public: true }, // a device of one's own (api-link.mjs › mineDevice); the owner: any
  'link.rename': { public: true },
  'link.status': { public: true }, // shaped per person (remote.mjs › linkStatus)
  'link.connect': { public: true }, // the link is of whoever makes it
  'link.peers': { public: true }, // own links only
  'link.disconnect': { public: true }, // own links only
  'taller.*': { public: true }, // forwarding (A13): only to the person's own workshop (remote.mjs › mayForward), audited
  'centro.*': { public: true }, // the centre link of the person (api-bots.mjs › centroPeer)
  // this PC's window: the lock screen (engine-enforced, engine.mjs) and who may unlock it
  'persons.lock': { desktop: true },
  'persons.unlock': { desktop: true },
  'app.lockState': { desktop: true }
};
// What a phone, a browser, a terminal or another Orb may also call: who it is for (persons.me, the names to share with)
// and the PIN check that gives a strong ticket for sensitive cards (bound to that device).
for (const set of [PHONE_SET, ORB_SET, CONSOLE_SET]) for (const m of ['persons.me', 'persons.list', 'persons.verifyPin']) set.add(m);
// Orb Núcleo's local socket: the people of the server and their PINs (orb-nucleo personas, persona nueva, pin-reset,
// enlazar --persona).
for (const m of ['persons.list', 'persons.create', 'persons.setPin', 'persons.overview']) CONTROL_SET.add(m);
// ======== WS3 · Orb mode + accounts: append entries here.
// 3.6 (A9): Orb mode (tasks, direct conversations with an agent, schedules and new projects) needs «dev» among the
// person's caps, or a project shared with them to «talk» or more (then in that project only). The owner always may.
const dbOne = (board, sql, ...args) => { try { return board.one(sql, ...args); } catch { return undefined; } };
const hasDevCap = (board, person) => { try { return JSON.parse(dbOne(board, 'SELECT caps FROM persons WHERE id = ?', String(person))?.caps || '{}')?.dev === true; } catch { return false; } };
export function mayDev(board, principal, project = null) {
  if (!principal || principal.channel === 'system' || principal.role === 'owner') return true;
  if (project) {
    const row = dbOne(board, 'SELECT name, person_id FROM projects WHERE name = ? COLLATE NOCASE', String(project));
    if (!row) return true; // no such project: the method says so (and authorize refuses what is not theirs)
    const shared = dbOne(board, "SELECT right FROM shares WHERE resource_type = 'project' AND resource_id = ? COLLATE NOCASE AND person_id = ?", row.name, String(principal.person))?.right;
    if (shared === 'talk' || shared === 'edit') return true;
    // not theirs and not shared to talk: the right on the project refuses it (with its own reason)
    if (row.person_id !== principal.person) return true;
    return hasDevCap(board, principal.person);
  }
  return hasDevCap(board, principal.person);
}
const devCheck = (pick) => (board, principal, params) => (mayDev(board, principal, pick(params)) ? true : 'noDev');
const account = (v) => ({ type: 'account', id: id(v) });
// sessions.fork makes a session of the same project.
const sessionProject = (board, sid) => dbOne(board, 'SELECT project FROM sessions WHERE id = ?', String(sid ?? ''))?.project ?? null;
const ORBMODE = {
  // the lines of no conversation (tasks made by hand or by a schedule): each person their own (the method filters)
  'chat.list': { res: (p) => (p.conversation == null ? null : conv(p.conversation)), right: 'view' },
  // the brain new conversations start with is each person's own
  'chat.settings': { res: (p) => (p.conversation == null ? null : conv(p.conversation)), right: 'own' },
  'tasks.create': { res: (p) => ({ ...proj(p.project), right: 'talk' }), create: 'task', check: devCheck((p) => p.project ?? null) },
  'sessions.create': { res: (p) => (p.project ? { ...proj(p.project), right: 'talk' } : null), create: 'session', check: devCheck((p) => p.project ?? null) },
  'sessions.fork': { res: (p) => sess(p.id), right: 'talk', create: 'session', check: (board, principal, p) => (mayDev(board, principal, sessionProject(board, p.id)) ? true : 'noDev') },
  'schedules.create': { res: (p) => ({ ...proj(p.project), right: 'talk' }), create: 'schedule', check: devCheck((p) => p.project ?? null) },
  'projects.create': { create: 'project', check: devCheck(() => null) },
  'projects.review': { res: (p) => proj(p.name), right: 'talk', check: devCheck((p) => p.name ?? null) },
  'projects.securityReview': { res: (p) => proj(p.name), right: 'talk', check: devCheck((p) => p.name ?? null) },
  'tasks.review': { res: (p) => task(p.id), right: 'talk' },
  // a person's own general log ('general') or a project's
  'logs.read': { res: (p) => (String(p.project ?? '').toLowerCase() === 'general' ? null : { type: 'log', id: id(p.project) }), right: 'view' },
  // pictures: only from the caller's projects, own accounts and own marked copies (the method checks)
  'images.read': { public: true },
  'mentions.options': { public: true, list: 'project' },
  // accounts: each person their own; the agents' sign-in for one's own account from any channel (the console only on
  // this PC, for the owner: the method checks)
  'accounts.add': { create: 'account' },
  'accounts.update': { res: (p) => account(p.id), right: 'own' },
  'accounts.remove': { res: (p) => account(p.id), right: 'own' },
  'accounts.clearCooldown': { res: (p) => account(p.account), right: 'own' },
  'accounts.lend': { res: (p) => account(p.id), right: 'own' },
  'accounts.unlend': { res: (p) => account(p.id), right: 'own' },
  'accounts.loans': { public: true },
  'agents.login': { res: (p) => account(p.account ?? p.agent), right: 'own' },
  'agents.loginCode': { public: true }, // the method checks the sign-in is of the caller's own account
  'agents.loginCancel': { public: true },
  'agents.loginState': { public: true },
  'usage.byPerson': { ownerOnly: true },
  // sharing (the method checks: the resource's person, or «edit» to share it to view or talk; never to oneself)
  'shares.list': { public: true },
  'shares.set': { public: true },
  'shares.remove': { public: true }
};
// ======== WS4 · bots: append entries here.
// 3.6 (WS4): a memory of a bot: the bot-wide one (which 'bot', the default) is read with «view» and written with «edit»;
// the caller's own file of that bot (which 'mine') needs «talk»; 'global' is always the caller's own.
const memRes = (p, wide) => (p.id == null || p.id === '' || p.id === 'global' ? null : { ...bot(p.id), right: p.which === 'mine' ? 'talk' : wide });
// A card (a chat line of a bot's conversation): its meta, to see who may answer it and whether it is sensitive.
const cardMeta = (board, item) => { try { return JSON.parse(dbOne(board, 'SELECT meta FROM chat WHERE id = ?', Number(item))?.meta || 'null'); } catch { return null; } };
export const SENSITIVE_CARDS = new Set(['ha', 'srv', 'admin', 'confirm']);
const sensitiveCard = (m) => Boolean(m && m.kind === 'bot_card' && SENSITIVE_CARDS.has(m.card) && !(m.card === 'admin' && m.payload?.action === 'pause'));
// Saying yes: only the card's approvers. Saying no: also anyone who may talk in that conversation. A card without
// approvers (made before 3.6) is answered by the conversation's person.
const cardAnswer = (board, principal, p) => {
  const m = cardMeta(board, p.item);
  // No such card: the owner hears it from the method (as before 3.6), anyone else learns nothing.
  if (!m || m.kind !== 'bot_card') return principal.role === 'owner' ? true : 'notFound';
  const approvers = Array.isArray(m.approvers) ? m.approvers : null;
  if (approvers?.includes(principal.person)) return true;
  const talksThere = (() => { const r = dbOne(board, 'SELECT conversation_id FROM chat WHERE id = ?', Number(p.item)); const c = r?.conversation_id != null ? dbOne(board, 'SELECT person_id FROM conversations WHERE id = ?', r.conversation_id) : null; return c ? (c.person_id ?? dbOne(board, "SELECT id FROM persons WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1")?.id) === principal.person : false; })();
  if (!approvers && talksThere) return true;
  if (p.decision !== 'allow' && talksThere) return true;
  return 'notApprover';
};
const questionOf = (board, principal, p) => { const m = cardMeta(board, p.item); if (m?.kind !== 'bot_question') return principal.role === 'owner' ? true : 'notFound'; return m.talker == null || m.talker === principal.person ? true : 'notApprover'; };
const BOTSP = {
  'bots.memory.get': { res: (p) => memRes(p, 'view') },
  'bots.memory.set': { res: (p) => memRes(p, 'edit') },
  'bots.memory.history': { res: (p) => memRes(p, 'view') },
  'bots.memory.pending': { public: true }, // the caller's own pending changes (and their bots' bot-wide ones)
  'bots.memory.approve': { public: true }, // the method checks the change is of a memory the caller keeps
  'bots.memory.undo': { public: true },
  // a card: its approvers (not the line's conversation: a card of someone else's turn may be the caller's to answer)
  'bots.decide': { check: cardAnswer, strong: (p, board) => p.decision === 'allow' && sensitiveCard(cardMeta(board, p.item)) },
  'bots.answer': { check: questionOf },
  'bots.cards': { public: true }, // the cards waiting for the caller
  'bots.reminders.cancel': { res: (p) => ({ type: 'reminder', id: id(p.id) }), right: 'own' },
  'bots.ha.allow.get': { public: true },
  'bots.ha.allow.set': { res: () => ({ type: 'integration', id: 'ha' }), right: 'talk' },
  'bots.history.import': { res: (p) => bot(p.id), right: 'talk' },
  'bots.where': { public: true } // each person's own place
};
// ======== WS5 · data + time (backup, export, templates): append entries here.
const DATA = {
  // Backups hold everyone's data: only the owner makes, lists, checks or restores them.
  'backup.status': { ownerOnly: true }, 'backup.list': { ownerOnly: true }, 'backup.now': { ownerOnly: true }, 'backup.verify': { ownerOnly: true },
  'backup.restore': { ownerOnly: true, admin: true }, 'backup.recovery': { ownerOnly: true, admin: true },
  // Templates: anyone applies one for themselves; for someone else, only the owner.
  'templates.list': { public: true },
  'templates.apply': { check: (board, principal, params) => (params.person == null || params.person === principal.person || principal.role === 'owner' ? true : 'notYours') },
  // Moving the whole Orb is the owner's.
  'data.moveExport': { ownerOnly: true, admin: true }, 'data.moveStatus': { ownerOnly: true }, 'data.moveUndo': { ownerOnly: true }, 'data.moveKeepBoth': { ownerOnly: true },
  // A person's export: only their own (the owner gets someone's only through deleting them).
  'data.exportPerson': { check: selfOnly },
  'data.deletePerson': { check: selfOrOwner }
};
// ======== WS6 · interface: append entries here.
const UI = {
  'persons.update': { check: selfOrOwner },
  'persons.setCaps': { ownerOnly: true },
  'persons.prefs.get': { public: true },
  'persons.prefs.set': { public: true },
  'persons.pauseBots': { ownerOnly: true }
};
// A phone, a browser or a terminal sets its own person's language, time zone and notification preview too.
for (const set of [PHONE_SET, CONSOLE_SET]) for (const m of ['persons.update', 'persons.prefs.get', 'persons.prefs.set', 'persons.setPin', 'shares.list']) set.add(m);

export const POLICY = Object.freeze({ ...CORE, ...GATEWAY, ...ORBMODE, ...BOTSP, ...DATA, ...UI });
export const policyOf = (method) => {
  const m = String(method);
  if (Object.hasOwn(POLICY, m)) return POLICY[m];
  const prefix = /^(taller|centro)\./.exec(m)?.[1];
  return prefix ? POLICY[`${prefix}.*`] : null;
};

// ---- events: who receives each one (authz.audienceOf). A rule is 'all' (no content in it), 'owner', or
// (payload) => { type, id } (everyone with «view» on that resource) | { person } (that person) | 'all' | 'owner'.
// An event without a rule goes to the owner only. Prefix rules end with '*'.
const EVENTS_CORE = {
  'board:changed': 'all', // a list of what changed, no content; each client asks again with its own rights
  'config:changed': 'all', // WS2: sent without the settings to non-owners
  'chat:new': (p) => conv(p?.conversation),
  'chat:state': (p) => conv(p?.conversation),
  'notice': (p) => (p?.person ? { person: p.person } : 'owner'),
  'session:item': (p) => sess(p?.session_id),
  'session:update': (p) => sess(p?.id),
  'session:delta': (p) => sess(p?.id),
  'session:queue': (p) => sess(p?.id),
  'session:removed': (p) => (p?.person ? { person: p.person } : sess(p?.id)),
  'approval:changed': (p) => (p?.session ? sess(p.session) : p?.task ? task(p.task) : 'owner'),
  'bot.updated': (p) => (p?.id ? bot(p.id) : 'all'),
  'bot.message': (p) => conv(p?.conversation),
  'bot.state': (p) => (p?.conversation ? conv(p.conversation) : bot(p?.bot)),
  'link:peers': 'owner',
  'link:status': 'owner',
  'link:devices': 'owner',
  'link:queue': (p) => (p?.person ? { person: p.person } : 'owner'),
  'agents:login': 'owner',
  'agents:install': 'owner',
  'installer:progress': 'owner',
  'agentBrowser:closeTask': (p) => task(p?.task),
  'persons:switched': (p) => (p?.person ? { person: p.person } : 'owner'),
  'centro:*': 'owner', // WS2: per person
  'taller:*': 'owner' // WS2: per person
};
// WS2 … WS6 append their event rules in their own objects, like POLICY.
const EVENTS_GATEWAY = {
  // chat:new of a line without conversation: EVENTS_ORBMODE (WS3).
  'persons:locked': 'all', // only this PC's window gets it (no phone listens to it)
  'persons:unlocked': 'all',
  // A workshop's events and the centre's bots: the router gives them the person of their link (engine.mjs, remote.mjs).
  'taller:*': 'owner',
  'centro:*': 'owner'
};
const EVENTS_ORBMODE = {
  // a sign-in: to the person of that account
  'agents:login': (p) => (p?.account ? { type: 'account', id: p.account } : 'owner'),
  // a line of no conversation (a task made by hand or by a schedule): its task's person
  'chat:new': (p) => (p?.conversation != null ? conv(p.conversation) : p?.person ? { person: p.person } : 'owner')
};
// 3.6 (WS4): a bot's live state is of one person's lane (its partial text): that person only. A bot's or a group's line:
// whoever sees that conversation (a bot's is always private).
const EVENTS_BOTSP = {
  'bot.state': (p) => (p?.person ? { person: p.person } : p?.conversation ? conv(p.conversation) : 'owner'),
  'bot.message': (p) => conv(p?.conversation),
  'bot.updated': (p) => (p?.id ? bot(p.id) : 'all')
};
const EVENTS_DATA = { 'backup:done': 'owner', 'backup:restoreReady': 'owner', 'data:moved': 'owner', 'data:personExported': (p) => (p?.person ? { person: p.person } : 'owner') };
const EVENTS_UI = {};
export const EVENTS = Object.freeze({ ...EVENTS_CORE, ...EVENTS_GATEWAY, ...EVENTS_ORBMODE, ...EVENTS_BOTSP, ...EVENTS_DATA, ...EVENTS_UI });
export function eventRule(event) {
  const e = String(event);
  if (Object.hasOwn(EVENTS, e)) return EVENTS[e];
  const prefix = Object.keys(EVENTS).find((k) => k.endsWith('*') && e.startsWith(k.slice(0, -1)));
  return prefix ? EVENTS[prefix] : undefined;
}
