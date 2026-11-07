// Who may do what. One PC, one owner; three kinds of caller:
//   desktop  this PC's Orb window, and the engine itself: every method.
//   phone    a linked phone or browser (Magic Link, src/engine/remote.mjs): only the methods marked 'remote' in
//   browser  METHODS. Settings, accounts, backups, Magic Link, this PC's tools and anything that deletes outside a
//            conversation stay on the PC.
//   agent    an agent's tools (src/mcp/server.mjs): no API method at all; its tools act only on its own signed
//            conversation or task (agentScope below). An agent Orb did not sign, or with a forged conversation, gets nothing.
// A principal is built only by the entry points (engine.mjs, remote.mjs, the MCP server), never from a call's
// parameters: { channel, device? } or, for an agent, { channel: 'agent', agent, task, conversation }.
// No engine imports: the MCP processes load this file too.
import { tr } from './context.mjs';

export const CHANNELS = ['desktop', 'phone', 'browser', 'agent'];
const REMOTE = new Set(['phone', 'browser']);

// Every API method, and where it may be called from: 'pc' (this PC only) or 'remote' (also a linked phone or browser).
// A method that is not here is refused everywhere (test/permisos.test.mjs checks this table against the API).
export const METHODS = Object.freeze({
  // the app and its settings
  'app.state': 'remote', 'app.migrationState': 'pc', 'app.migrationRetry': 'pc', 'config.save': 'pc', 'sidebar.complete': 'remote', 'control.pause': 'remote', 'control.resume': 'remote',
  'system.check': 'pc', 'installer.check': 'pc', 'installer.progress': 'pc', 'installer.start': 'pc', 'mcp.folder': 'pc',
  'activity.list': 'remote', 'usage.get': 'remote', 'usage.now': 'remote', 'models.guide': 'remote', 'models.catalog': 'remote',
  'mentions.options': 'remote', 'approvals.list': 'remote',
  // this PC's tools
  'android.status': 'pc', 'android.install': 'pc', 'github.status': 'pc', 'github.contributions': 'pc', 'github.login': 'pc',
  'expert.tree': 'pc', 'expert.read': 'pc', 'expert.status': 'pc', 'expert.diff': 'pc', 'expert.log': 'pc', 'expert.system': 'pc',
  'actions.list': 'pc', 'actions.save': 'pc', 'actions.remove': 'pc',
  'images.read': 'pc', 'images.mark': 'pc', 'images.save': 'pc',
  // conversations with the assistant
  'conversations.list': 'remote', 'conversations.search': 'remote', 'conversations.update': 'remote', 'conversations.remove': 'pc',
  'chat.list': 'remote', 'chat.send': 'remote', 'chat.stop': 'remote', 'chat.compact': 'remote', 'chat.answer': 'remote', 'chat.accept': 'remote',
  'chat.settings': 'remote',
  // projects
  'projects.list': 'remote', 'projects.icons': 'remote', 'projects.create': 'remote', 'projects.import': 'pc', 'projects.clone': 'pc',
  'projects.remove': 'pc', 'projects.rename': 'pc', 'projects.setActive': 'remote', 'projects.setIcon': 'pc', 'projects.clearIcon': 'pc',
  'projects.branch': 'remote', 'projects.info': 'remote', 'projects.commit': 'pc', 'projects.merge': 'pc', 'projects.push': 'pc',
  'projects.createPr': 'pc', 'projects.createRepo': 'pc', 'projects.review': 'remote', 'projects.securityReview': 'remote',
  'whiteboard.load': 'remote', 'whiteboard.save': 'remote', 'whiteboard.note': 'remote', 'whiteboard.attach': 'pc', 'whiteboard.remove': 'pc', 'whiteboard.folder': 'pc',
  'logs.list': 'remote', 'logs.read': 'remote',
  // tasks
  'tasks.list': 'remote', 'tasks.live': 'remote', 'tasks.get': 'remote', 'tasks.create': 'remote', 'tasks.approve': 'remote',
  'tasks.retry': 'remote', 'tasks.cancel': 'remote', 'tasks.reassign': 'remote', 'tasks.followup': 'remote', 'tasks.undo': 'remote',
  'tasks.launchAnyway': 'remote', 'tasks.accept': 'remote', 'tasks.review': 'remote', 'tasks.discardBranch': 'pc',
  // direct conversations with an agent and the tasks' sessions
  'sessions.list': 'remote', 'sessions.create': 'remote', 'sessions.items': 'remote', 'sessions.send': 'remote', 'sessions.queue': 'remote',
  'sessions.editQueued': 'remote', 'sessions.approve': 'remote', 'sessions.resume': 'remote', 'sessions.fork': 'remote', 'sessions.settle': 'remote',
  'sessions.stop': 'remote', 'sessions.compact': 'remote', 'sessions.update': 'remote', 'sessions.remove': 'pc',
  // scheduled tasks
  'schedules.list': 'remote', 'schedules.create': 'remote', 'schedules.update': 'remote', 'schedules.run': 'remote', 'schedules.remove': 'pc',
  // the chat list (pins, sections, read marks)
  'inbox.list': 'remote', 'inbox.search': 'remote', 'inbox.pin': 'remote', 'inbox.unpin': 'remote', 'inbox.reorderPins': 'remote',
  'inbox.mute': 'remote', 'inbox.markRead': 'remote', 'inbox.sections.list': 'remote', 'inbox.sections.create': 'remote',
  'inbox.sections.rename': 'remote', 'inbox.sections.delete': 'remote', 'inbox.sections.reorder': 'remote', 'inbox.sections.move': 'remote',
  // phone access and Magic Link
  'remote.status': 'pc', 'remote.enable': 'pc', 'remote.configure': 'pc', 'remote.pair': 'pc', 'remote.revoke': 'pc',
  'link.qr': 'pc', 'link.devices': 'pc', 'link.revoke': 'pc', 'link.rename': 'pc',
  // agents and their accounts
  'agents.status': 'remote', 'agents.check': 'pc', 'agents.login': 'pc', 'agents.loginCode': 'pc', 'agents.loginCancel': 'pc',
  'agents.loginState': 'pc', 'agents.install': 'pc', 'agents.installState': 'pc',
  'accounts.add': 'pc', 'accounts.scan': 'pc', 'accounts.update': 'pc', 'accounts.remove': 'pc', 'accounts.clearCooldown': 'pc',
  // backups
  'backup.status': 'pc', 'backup.list': 'pc', 'backup.now': 'pc', 'backup.verify': 'pc', 'backup.restore': 'pc', 'backup.recovery': 'pc', 'legacy.status': 'pc', 'legacy.delete': 'pc'
});
// What a linked phone or browser may call (the rest is this PC's).
export const REMOTE_METHODS = Object.freeze(new Set(Object.keys(METHODS).filter((m) => METHODS[m] === 'remote')));

// A refused call: 403, with a message the user may read.
export class PermissionError extends Error {
  constructor(method = null) {
    super(tr(Object.hasOwn(METHODS, String(method)) ? 'msg.remote.pcOnly' : 'msg.authz.denied'));
    this.name = 'PermissionError'; this.status = 403; this.userFacing = true; this.method = method;
  }
}

// The caller, built by its entry point. device: a row of devices (a linked phone or browser). Anything else is this PC.
export function principalOf({ device = null } = {}) {
  if (device) return Object.freeze({ channel: device.kind === 'phone' ? 'phone' : 'browser', device: String(device.id ?? '') });
  return Object.freeze({ channel: 'desktop' });
}
export const DESKTOP = principalOf();

// Whether a caller may call a method at all (the method checks its own parameters).
export function allowed(principal, method) {
  const where = Object.hasOwn(METHODS, String(method)) ? METHODS[method] : null;
  if (!where) return false;
  if (principal?.channel === 'desktop') return true;
  return REMOTE.has(principal?.channel) && where === 'remote';
}
export function authorize(principal, method) {
  if (!allowed(principal, method)) throw new PermissionError(method);
}

// ---- agents. An agent's MCP process works for what Orb signed it for (src/mcp/server.mjs builds `who`):
//   { signed: false }                                   nobody: every tool refused
//   { signed: true, boss: true, conversation }          the coordinator of one conversation: that conversation's tasks
//                                                       (a coordinator without a conversation: nothing)
//   { signed: true, task }                              a worker: its task and the subtasks it delegated
//   { signed: true, agent, session }                    a direct conversation with an agent (no task): only the manual
//                                                       task it claimed itself (running, claimed by that conversation)
// ownsTask: whether it may read the detail of a task, change it or wait for it. Its dependencies' results come inside
// its own task's detail.
export function ownsTask(board, who, id) {
  if (!who?.signed) return false;
  if (who.boss && !who.conversation) return false;
  const one = (tid) => { try { return board.one('SELECT id, conversation_id, parent_id, assigned_to, status, launch, claimed_session FROM tasks WHERE id = ?', Number(tid)); } catch { return null; } };
  let t = one(id);
  if (!t) return false;
  if (!who.boss && !who.task) return Boolean(who.session) && t.assigned_to === who.agent && t.status === 'running' && t.launch === 'manual' && t.claimed_session === String(who.session);
  // up the chain of subtasks (a delegated task hangs from the one that delegated it)
  for (let depth = 0; t && depth < 20; depth++, t = t.parent_id ? one(t.parent_id) : null) {
    if (who.task && t.id === Number(who.task)) return true;
    if (who.boss && t.conversation_id === Number(who.conversation)) return true;
  }
  return false;
}
export function mustOwnTask(board, who, id) {
  if (!ownsTask(board, who, id)) throw Object.assign(new Error(tr('msg.authz.notYourTask', { id })), { userFacing: true });
  return true;
}
