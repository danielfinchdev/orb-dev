// Agents with no way to ask Orb before acting (Pi, Antigravity): they cannot honour «Preguntar antes», «Revisar y probar» or
// «Solo leer», and Orb's guard (src/domain/security/guard.mjs) never sees what they do. They only start in the levels that
// promise nothing they cannot keep. Even «editar» and «auto» promise rules (ask outside the project, the fixed refusals:
// Orb's core, credentials, sudo, adb) that need Orb to see each action, so only «total» (the password-protected
// «Acceso total», which promises none) is accepted. Anything else is refused before a process is started.
import { tr } from '../platform/context.mjs';

export const UNGUARDED_LEVELS = Object.freeze(['total']);
export function requireLevel(permission, name) {
  if (!UNGUARDED_LEVELS.includes(permission)) throw Object.assign(new Error(tr('sys.agents.noGuard', { name })), { userFacing: true });
}
