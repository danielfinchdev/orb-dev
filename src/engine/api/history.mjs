// Ajustes › «Historial» and the local usage in the usage page: the chats that Claude Code and Codex left on this PC
// (read-only) and what they spent by model, project and hour. The work, and the rules about which folders may be read,
// are in src/engine/history/local-history.mjs. This PC's window only (src/domain/security/permissions.mjs).
import { ctx } from '../../platform/context.mjs';
import { ownerTz } from '../../shared/tz.mjs';
import { oneOf, str } from './common.mjs';
import { AGENTS, listChats, readChat, usageOf } from '../history/local-history.mjs';

export function historyMethods() {
  return {
    'history.list': async ({ agent, q, limit } = {}) => listChats({ agent: oneOf(agent, AGENTS, 'agente', undefined), q: str(q, 'búsqueda', 200, { optional: true }), limit }),
    'history.read': async ({ id }) => readChat(str(id, 'conversación', 60)),
    'history.usage': async ({ days } = {}) => usageOf({ days: oneOf(days, [7, 30, 90], 'días', 30), tz: ownerTz(ctx.config) })
  };
}
