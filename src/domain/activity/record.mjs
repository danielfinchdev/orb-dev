// Which calls of the window (or a linked phone) are the user's own actions, and how each is written to usuario.log.
// The dispatcher calls `before` ahead of the method and `record` after it succeeded: a failed call changed nothing.
// Both swallow every error: the log must never change what an action does.
import { ctx } from '../../platform/context.mjs';
import { railList } from '../rules/rails.mjs';
import { logUserAction, settingsDiff } from './user-log.mjs';

const via = (principal) => (principal?.channel && principal.channel !== 'desktop' ? 'movil' : null);
const tag = (principal, text) => (via(principal) ? `[movil] ${text}` : text);
const rule = (r) => (r ? { id: r.id, titulo: r.titulo, para: r.para, estado: r.estado, texto: String(r.texto ?? '').slice(0, 300) } : r);
const pair = (out) => ({ before: Array.isArray(out?.before) ? out.before.map(rule) : rule(out?.before), after: Array.isArray(out?.after) ? out.after.map(rule) : rule(out?.after) });
// a rail without its protected paths: those are places on this PC and only «changed» is written
const railView = (r) => (r ? { activo: r.activo, valores: Object.fromEntries(Object.entries(r.valores ?? {}).map(([k, v]) => [k, /protected/i.test(k) ? 'changed' : v])) } : null);

// State that only exists before the call.
export function snapshotBefore(method) {
  try {
    if (method === 'config.save') return { config: structuredClone(ctx.config ?? {}) };
    if (method === 'rails.set' || method === 'rails.restore') return { rails: railList() };
  } catch { /* no before */ }
  return null;
}

export function recordUserCall({ board, method, params, out, principal, snap }) {
  try {
    const p = params ?? {};
    switch (method) {
      case 'chat.send':
        logUserAction({ kind: 'chat.message', text: tag(principal, String(p.text ?? '').slice(0, 200)), project: p.project || null }); break;
      case 'expert.createFile':
        logUserAction({ kind: 'file.create', text: tag(principal, `created ${String(out?.path ?? '').slice(0, 300)}`), project: p.project || null }); break;
      case 'tasks.approve': {
        const t = board.task?.(Number(p.id));
        logUserAction({ kind: 'approval.decision', text: tag(principal, `task #${p.id} ${p.decision === 'approved' ? 'approved' : 'rejected'}`), project: t?.project ?? null }); break;
      }
      case 'sessions.approve':
        logUserAction({ kind: 'approval.decision', text: tag(principal, `session ${p.id} request ${String(p.request).slice(0, 60)}: ${p.decision}`) }); break;
      case 'tasks.undo': {
        const t = board.task?.(Number(p.id));
        logUserAction({ kind: 'undo.task', text: tag(principal, `task #${p.id} undone`), project: t?.project ?? null }); break;
      }
      case 'conversations.restore': case 'sessions.restore':
        logUserAction({ kind: 'trash.restore', text: tag(principal, `${method.split('.')[0]} ${p.id} restored`) }); break;
      case 'config.save': {
        const { before, after } = settingsDiff(p.patch, snap?.config);
        logUserAction({ kind: 'settings.change', text: tag(principal, `settings: ${Object.keys(after).join(', ').slice(0, 300) || '-'}`), before, after }); break;
      }
      case 'rules.save': case 'rules.create': case 'rules.pause': case 'rules.resume': case 'rules.delete': case 'rules.restoreDefaults': {
        const { before, after } = pair(out);
        logUserAction({ kind: method, text: tag(principal, `${method}${p.id ? ` ${p.id}` : ''}${(out?.after?.titulo ?? out?.before?.titulo) ? `: ${out?.after?.titulo ?? out.before.titulo}` : ''}`), before, after }); break;
      }
      case 'rails.set': case 'rails.restore': {
        const find = (list, id) => (Array.isArray(list) ? list.find((r) => r.id === id) : null);
        if (method === 'rails.set') logUserAction({ kind: 'rails.set', text: tag(principal, `rail ${p.id}`), before: railView(find(snap?.rails, p.id)), after: railView(find(railList(), p.id)) });
        else logUserAction({ kind: 'rails.restore', text: tag(principal, 'all rails restored to defaults'), before: (snap?.rails ?? []).map((r) => ({ id: r.id, ...railView(r) })), after: railList().map((r) => ({ id: r.id, ...railView(r) })) });
        break;
      }
      default:
    }
  } catch { /* the action already happened */ }
}
