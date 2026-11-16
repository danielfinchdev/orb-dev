// Who may do what. One PC, one owner; three kinds of caller:
//   desktop  this PC's Orb window, and the engine itself: every method.
//   phone    a linked phone or browser (Magic Link, src/engine/transport/remote.mjs): only the methods marked 'remote' in
//   browser  METHODS. Settings, accounts, backups, Magic Link, this PC's tools and anything that deletes outside a
//            conversation stay on the PC.
//   agent    an agent's tools (src/mcp/server.mjs): no API method at all; its tools act only on its own signed
//            conversation or task (agentScope below). An agent Orb did not sign, or with a forged conversation, gets nothing.
// A principal is built only by the entry points (engine.mjs, remote.mjs, the MCP server), never from a call's
// parameters: { channel, device? } or, for an agent, { channel: 'agent', agent, task, conversation }.
// No engine imports: the MCP processes load this file too.
import { tr } from '../../platform/context.mjs';
import { isRef, touchesKeys } from './connector-secrets.mjs';
import { railValuesChange } from '../../shared/rails-registry.mjs';
export { railValuesChange };

export const CHANNELS = ['desktop', 'phone', 'browser', 'agent'];
const REMOTE = new Set(['phone', 'browser']);

// Every API method, and where it may be called from: 'pc' (this PC only) or 'remote' (also a linked phone or browser).
// A method that is not here is refused everywhere (test/permisos.test.mjs checks this table against the API).
export const METHODS = Object.freeze({
  // the app and its settings
  'app.state': 'remote', 'app.migrationState': 'pc', 'app.migrationRetry': 'pc', 'app.coreState': 'pc', 'app.coreRepair': 'pc', 'app.layoutPlan': 'pc', 'app.layoutApply': 'pc', 'config.save': 'pc', 'sidebar.complete': 'remote', 'control.pause': 'remote', 'control.resume': 'remote',
  // this PC's tools, in the engine (src/engine/api/app.mjs)
  'keys.get': 'pc', 'keys.save': 'pc', 'app.openTerminal': 'pc', 'app.editors': 'pc', 'app.openIn': 'pc', 'app.runAction': 'pc', 'app.feedbackSend': 'pc', 'app.moreApps': 'pc',
  // the Windows app's music (src/engine/host/music.mjs)
  'music.track': 'pc',
  'system.check': 'pc', 'installer.check': 'pc', 'installer.progress': 'pc', 'installer.start': 'pc',
  'activity.list': 'remote', 'activity.report': 'remote', 'usage.get': 'remote', 'usage.now': 'remote', 'usage.refresh': 'remote', 'usage.history': 'remote', 'models.guide': 'remote', 'models.catalog': 'remote',
  'mentions.options': 'remote', 'approvals.list': 'remote',
  // this PC's tools
  'android.status': 'pc', 'android.install': 'pc',
  // pairing a phone for the agents (Ajustes › Android, src/engine/host/android.mjs)
  'android.pairStart': 'pc', 'android.pairState': 'pc', 'android.pairCancel': 'pc', 'android.pairCode': 'pc', 'android.devices': 'pc', 'android.disconnect': 'pc', 'android.forget': 'pc',
  // an Android emulator already installed on this PC
  'android.emulators': 'pc', 'android.emulatorStart': 'pc', 'devtools.check': 'pc',
  'github.status': 'pc', 'github.contributions': 'pc', 'github.login': 'pc',
  'expert.tree': 'pc', 'projects.findFiles': 'pc', 'projects.searchText': 'pc', 'expert.read': 'pc', 'expert.status': 'pc', 'expert.diff': 'pc', 'expert.log': 'pc', 'expert.system': 'pc',
  'actions.list': 'pc', 'actions.save': 'pc', 'actions.remove': 'pc',
  'images.read': 'pc', 'images.mark': 'pc', 'images.save': 'pc', 'attachments.read': 'pc',
  // conversations with the assistant
  'conversations.list': 'remote', 'conversations.search': 'remote', 'conversations.update': 'remote', 'conversations.remove': 'pc', 'conversations.trash': 'remote', 'conversations.restore': 'remote',
  'chat.list': 'remote', 'chat.pin': 'remote', 'chat.pinned': 'remote', 'chat.notes': 'remote', 'chat.send': 'remote', 'chat.stop': 'remote', 'chat.compact': 'remote', 'chat.answer': 'remote', 'chat.accept': 'remote',
  'chat.settings': 'remote',
  // projects
  'projects.list': 'remote', 'projects.icons': 'remote', 'projects.create': 'remote', 'projects.import': 'pc', 'projects.clone': 'pc',
  'projects.remove': 'pc', 'projects.rename': 'pc', 'projects.setActive': 'remote', 'projects.setIcon': 'pc', 'projects.clearIcon': 'pc',
  'projects.branch': 'remote', 'projects.info': 'remote', 'projects.prs': 'remote', 'projects.pr': 'remote', 'projects.mergePr': 'remote', 'projects.prComment': 'remote', 'notes.markRead': 'remote', 'projects.commit': 'pc', 'projects.commitFiles': 'pc', 'projects.commitSuggest': 'pc', 'projects.prFix': 'pc', 'ciWatch.list': 'pc', 'ciWatch.set': 'pc', 'projects.merge': 'pc', 'projects.push': 'pc',
  'projects.createPr': 'pc', 'projects.createRepo': 'pc', 'projects.review': 'remote', 'projects.securityReview': 'remote',
  // finishing a project (its folder stays) also from the phone; deleting it (its folder too) only here.
  'projects.finish': 'remote', 'projects.finished': 'remote', 'projects.reopen': 'remote', 'projects.deleteCheck': 'pc', 'projects.delete': 'pc', 'projects.deleteAbort': 'pc',
  'whiteboard.load': 'remote', 'whiteboard.save': 'remote', 'whiteboard.note': 'remote', 'whiteboard.attach': 'pc', 'whiteboard.remove': 'pc', 'whiteboard.folder': 'pc',
  'logs.list': 'remote', 'logs.read': 'remote',
  // tasks
  'tasks.list': 'remote', 'tasks.live': 'remote', 'tasks.get': 'remote', 'tasks.create': 'remote', 'tasks.approve': 'remote',
  'tasks.retry': 'remote', 'tasks.cancel': 'remote', 'tasks.reassign': 'remote', 'tasks.followup': 'remote', 'tasks.undo': 'remote', 'tasks.diff': 'remote', 'sessions.turns': 'remote', 'sessions.turnDiff': 'remote',
  'tasks.launchAnyway': 'remote', 'tasks.search': 'remote', 'tasks.accept': 'remote', 'tasks.review': 'remote', 'tasks.discardBranch': 'pc',
  // direct conversations with an agent and the tasks' sessions
  'sessions.list': 'remote', 'sessions.create': 'remote', 'sessions.items': 'remote', 'sessions.send': 'remote', 'sessions.queue': 'remote',
  'sessions.editQueued': 'remote', 'sessions.approve': 'remote', 'sessions.resume': 'remote', 'sessions.fork': 'remote', 'sessions.handoff': 'remote', 'sessions.edit': 'remote', 'sessions.rewindInfo': 'remote', 'sessions.editRewind': 'pc', 'sessions.rewindUndo': 'pc', 'sessions.settle': 'remote',
  'sessions.stop': 'remote', 'sessions.modes': 'remote', 'sessions.goal': 'remote', 'sessions.compact': 'remote', 'sessions.update': 'remote', 'sessions.remove': 'pc', 'worktrees.branches': 'remote', 'worktrees.status': 'remote', 'worktrees.list': 'pc', 'worktrees.discard': 'pc', 'sessions.trash': 'remote', 'sessions.restore': 'remote', 'trash.list': 'remote',
  // «Auto» / «Preguntar» for everything (Ajustes › Agentes and the assistant's chat), also from the phone
  'permissions.setMode': 'remote',
  // «Acceso total al PC» and «Usar mi móvil Android» (src/engine/security/grants.mjs): given and taken back only here
  'sessions.grantTotal': 'pc', 'sessions.grantAndroid': 'pc', 'sessions.revokeGrant': 'pc',
  // scheduled tasks
  'schedules.list': 'remote', 'schedules.create': 'remote', 'schedules.update': 'remote', 'schedules.run': 'remote', 'schedules.remove': 'pc',
  // the chat list (pins, sections, read marks)
  'inbox.list': 'remote', 'inbox.digest': 'remote', 'inbox.digestSeen': 'remote','inbox.search': 'remote', 'inbox.pin': 'remote', 'inbox.unpin': 'remote', 'inbox.reorderPins': 'remote',
  'inbox.mute': 'remote', 'inbox.snooze': 'remote', 'inbox.markRead': 'remote', 'inbox.sections.list': 'remote', 'inbox.sections.create': 'remote',
  'inbox.sections.rename': 'remote', 'inbox.sections.delete': 'remote', 'inbox.sections.reorder': 'remote', 'inbox.sections.move': 'remote',
  // phone access and Magic Link
  'remote.status': 'pc', 'remote.enable': 'pc', 'remote.configure': 'pc', 'remote.pair': 'pc', 'remote.revoke': 'pc',
  'pc.screenshot': 'remote',
  'link.qr': 'pc', 'link.devices': 'pc', 'link.revoke': 'pc', 'link.rename': 'pc',
  // agents and their accounts
  'agents.status': 'remote', 'agents.check': 'pc', 'agents.login': 'pc', 'agents.loginCode': 'pc', 'agents.loginCancel': 'pc',
  'agents.loginState': 'pc', 'agents.install': 'pc', 'agents.installState': 'pc',
  'accounts.add': 'pc', 'accounts.scan': 'pc', 'accounts.update': 'pc', 'accounts.remove': 'pc', 'accounts.clearCooldown': 'pc',
  // backups
  'backup.status': 'pc', 'backup.list': 'pc', 'backup.now': 'pc', 'backup.verify': 'pc', 'backup.restore': 'pc', 'backup.recovery': 'pc', 'backup.previousKey': 'pc', 'legacy.status': 'pc', 'legacy.delete': 'pc',
  // the master password and the connectors' keys
  'master.state': 'pc', 'master.create': 'pc', 'master.unlock': 'pc', 'master.lock': 'pc', 'master.check': 'pc', 'master.change': 'pc', 'master.forgot': 'pc', 'master.reset': 'pc',
  'secrets.connector': 'pc', 'secrets.saveConnector': 'pc',
  // the agents' own API keys (Grok, Devin, Droid): the state says only which are saved, saving needs the unlock
  'agentKeys.state': 'pc', 'agentKeys.save': 'pc',
  // a secret an agent asked for, typed only on this PC's card (src/engine/security/agent-secrets.mjs)
  'secrets.pending': 'pc', 'secrets.answer': 'pc', 'secrets.decline': 'pc',
  // a merge an agent asked for, confirmed only on this PC's card (src/engine/host/pr-tools.mjs)
  'prConfirm.pending': 'pc', 'prConfirm.answer': 'pc', 'prConfirm.decline': 'pc',
  // the HTML pages of the chats: only this PC's window may list them, close them or give them internet (src/engine/host/html-pages.mjs)
  // agents outside Orb that create tasks through a loopback MCP server (src/engine/api/mcp-ext.mjs)
  'mcpExt.state': 'pc', 'mcpExt.setEnabled': 'pc', 'mcpExt.createToken': 'pc', 'mcpExt.setProjects': 'pc', 'mcpExt.revoke': 'pc', 'mcpExt.remove': 'pc',
  'htmlPages.list': 'pc', 'htmlPages.setInternet': 'pc', 'htmlPages.close': 'pc',
  // read-only, for the phone: returns the HTML as data (never executed on the host) to show it in a sandboxed frame
  'htmlPages.get': 'pc',
  // the user's terminal inside Orb (src/engine/host/user-terminal.mjs)
  'terminal.list': 'pc', 'terminal.open': 'pc', 'terminal.write': 'pc', 'terminal.close': 'pc',
  // Ajustes › Skills y MCP (src/engine/api/extensions.mjs): what agents run comes in and out of core only here
  // the chats and usage that Claude Code and Codex keep on this PC (src/engine/api/history.mjs, read-only)
  'history.list': 'pc', 'history.read': 'pc', 'history.usage': 'pc',
  'extensions.list': 'pc', 'extensions.toggle': 'pc', 'extensions.import': 'pc', 'extensions.remove': 'pc', 'extensions.approve': 'pc',
  'extensions.reject': 'pc', 'extensions.edit': 'pc', 'extensions.adopt': 'pc', 'extensions.applyCheck': 'pc', 'extensions.apply': 'pc',
  // the text rules and the rails (src/engine/api/rules.mjs): the phone may only read them, every change is made here
  'rules.list': 'remote', 'rules.read': 'remote', 'rails.list': 'remote',
  'rules.save': 'pc', 'rules.create': 'pc', 'rules.pause': 'pc', 'rules.resume': 'pc', 'rules.delete': 'pc', 'rules.restoreDefaults': 'pc', 'rails.set': 'pc', 'rails.restore': 'pc'
});
// What a linked phone or browser may call (the rest is this PC's).
export const REMOTE_METHODS = Object.freeze(new Set(Object.keys(METHODS).filter((m) => METHODS[m] === 'remote')));

// what this PC's window may only do right after the master password (a token of 5 minutes, src/engine/api/master.mjs):
// restoring a backup, checking one or making a new recovery code (the code opens the backups, and a check would try codes),
// deleting the data of Orb 3.7, unlinking a phone, seeing or changing a connector's keys, opening core (the app asks
// master.check) and, in config.save, choosing where the backups go, writing a connector's keys in clear, changing a
// connector that has keys (its command, its arguments, its name, removing it or one of its keys) and taking a path off
// «Cosas que nadie toca», deleting a project (its folder; every time, see FRESH_UNLOCK) and removing a skill or an MCP server from core (or a
// connector). current: the settings now (the engine's), to compare
// with. Changing the password asks for the current one instead.
// pairing a phone or starting an emulator (the agents may then reach it), and giving a chat «Acceso total al PC» or the
// phone (the usual 5-minute unlock, not the password every time: see below).
export const UNLOCK_METHODS = Object.freeze(new Set(['backup.restore', 'backup.verify', 'backup.recovery', 'backup.previousKey', 'legacy.delete', 'link.revoke', 'remote.revoke', 'master.check', 'secrets.connector', 'secrets.saveConnector', 'agentKeys.save', 'projects.deleteCheck', 'extensions.remove',
  'android.pairStart', 'android.pairCode', 'android.emulatorStart', 'sessions.grantTotal', 'sessions.grantAndroid', 'mcpExt.createToken', 'mcpExt.setProjects',
  // rules: your own are edited with the usual unlock; pausing or deleting a shipped one (rules.pause / rules.delete,
  // see freshPurpose) and everything about the rails asks for the password every time
  'rules.save', 'rules.create', 'rules.resume', 'rules.pause', 'rules.delete', 'rules.restoreDefaults', 'rails.set', 'rails.restore']));
// the actions that ask for the master password EVERY time, even right after another unlock (the owner: deleting a
// project «requiere master pass»): method → the purpose its token must carry (src/domain/security/master.mjs › issue(purpose)).
// projects.delete and projects.deleteAbort need no token: they take the one-off ticket projects.deleteCheck returned
// (project-close.mjs), so a token that expires while the Recycle Bin works never leaves a delete half-way.
// «Acceso total al PC» and «Usar mi móvil Android», given to a chat:
// they take the usual 5-minute unlock (UNLOCK_METHODS), not
// the password every time; they still go when Orb locks (src/engine/security/grants.mjs).
// rails: any change to the limits (rails.set, rails.restore, or `rails` inside config.save); ruleSeed: putting the shipped
// rules back, and pausing or deleting one of them (those two only for a shipped rule: see freshPurpose).
export const FRESH_UNLOCK = Object.freeze({ 'projects.deleteCheck': 'deleteProject', 'rails.set': 'rails', 'rails.restore': 'rails', 'rules.restoreDefaults': 'ruleSeed' });
export const RULE_PURPOSE = 'ruleSeed';
export const RAILS_PURPOSE = 'rails';
// a secret an agent asked for, saved in the vault or taken from it, asks every time too (its
// token is for that one action); the purpose depends on what the card does.
export const SECRET_PURPOSES = Object.freeze({ save: 'secretSave', saved: 'secretSaved' });
export const FRESH_PURPOSES = Object.freeze([...new Set([...Object.values(FRESH_UNLOCK), ...Object.values(SECRET_PURPOSES)])]);
// Calls whose purpose depends on the rule they name: the caller (master.mjs) reads the rule and says if it is a shipped one.
export const RULE_TARGET_METHODS = Object.freeze(new Set(['rules.pause', 'rules.delete', 'rules.save']));
// The purpose a guarded call's token must carry (an action that asks every time), or null (the usual 5-minute token).
// facts.seedRule: the rule a rules.pause / rules.delete names is a shipped one (this file reads no files itself).
// facts.current: the settings now (config.save is compared against them; this file reads no ctx itself).
// config.save with `rails`, or with a rail's value that would change, is the same door as rails.set, so it asks the same way.
export function freshPurpose(method, params, facts = {}) {
  if (method === 'secrets.answer') return params?.saved === true ? SECRET_PURPOSES.saved : params?.save === true ? SECRET_PURPOSES.save : null;
  if (method === 'config.save') return params?.patch?.rails !== undefined || railValuesChange(params?.patch, facts.current) ? RAILS_PURPOSE : null;
  if (RULE_TARGET_METHODS.has(method)) return facts.seedRule === true ? RULE_PURPOSE : null;
  return FRESH_UNLOCK[method] ?? null;
}
export function needsUnlock(method, params, current = {}) {
  if (UNLOCK_METHODS.has(method)) return true;
  // a secret for an agent saved in the vault, or taken from it.
  if (method === 'secrets.answer') return params?.save === true || params?.saved === true;
  // switching the MCP server for outside agents on asks; switching it off (taking access back) needs nothing
  if (method === 'mcpExt.setEnabled') return params?.enabled === true;
  if (method !== 'config.save') return false;
  const patch = params?.patch ?? {};
  if (patch.rails !== undefined) return true;
  if (railValuesChange(patch, current)) return true;
  if (patch.backup && typeof patch.backup === 'object' && Object.hasOwn(patch.backup, 'folder')) return true;
  if (Array.isArray(patch.protected) && (current?.protected ?? []).some((x) => !patch.protected.includes(x))) return true;
  if (!Array.isArray(patch.mcpServers)) return false;
  if (patch.mcpServers.some((s) => s?.env && typeof s.env === 'object' && Object.values(s.env).some((v) => !isRef(v)))) return true;
  return touchesKeys(current?.mcpServers ?? [], patch.mcpServers);
}

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
