// Agents with no way to ask Orb before acting (Pi, Antigravity): they cannot honour «Preguntar antes», «Revisar y probar» or
// «Solo leer», and Orb's guard (src/domain/security/guard.mjs) never sees what they do. They only start in the levels that
// promise nothing they cannot keep: «editar» (work in the project), «auto» and «total». Anything stricter is refused
// before a process is started, instead of running with fewer limits than the chat says.
import { tr } from '../platform/context.mjs';

export const UNGUARDED_LEVELS = Object.freeze(['editar', 'auto', 'total']);
export function requireLevel(permission, name) {
  if (!UNGUARDED_LEVELS.includes(permission ?? 'editar')) throw Object.assign(new Error(tr('sys.agents.noGuard', { name })), { userFacing: true });
}
