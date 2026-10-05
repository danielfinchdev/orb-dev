// Interface texts that repeat across views. Each value is translated when it is read (t() uses the language chosen in
// Ajustes), so STATUS.done[0], options(PERMISSION)… always come out in the current language.
import { t } from './i18n.js';

// Builds a map whose values are read through t(): a key → 'clave', or a key → ['clave', variant] tuple.
function translated(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    const get = v == null ? () => v : Array.isArray(v) ? () => [t(v[0]), v[1]] : () => t(v);
    Object.defineProperty(out, k, { get, enumerable: true, configurable: true });
  }
  return out;
}

export const STATUS = translated({
  queued: ['status.queued', 'info'], awaiting_approval: ['status.awaiting_approval', 'warning'], running: ['status.running', 'default'],
  done: ['status.done', 'success'], failed: ['status.failed', 'destructive'], blocked: ['status.blocked', 'warning'], cancelled: ['status.cancelled', 'secondary'],
  limited: ['status.limited', 'warning']
});
// State of a conversation (sessions.status).
export const SESSION_STATUS = translated({ running: ['sessionStatus.running', 'default'], idle: null, error: ['sessionStatus.error', 'destructive'], interrupted: ['sessionStatus.interrupted', 'warning'], limited: ['sessionStatus.limited', 'warning'] });
// Agent names stay as they are; only «any» and «usuario» are words. AGENT.orb is set to the assistant's name by the app.
export const AGENT = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen Code', copilot: 'Copilot', orb: 'Orb' };
Object.defineProperty(AGENT, 'any', { get: () => t('agent.any'), enumerable: true, configurable: true });
Object.defineProperty(AGENT, 'usuario', { get: () => t('agent.user'), enumerable: true, configurable: true });
export const PERMISSION = translated({ leer: 'permission.leer', editar: 'permission.editar', preguntar: 'permission.preguntar', total: 'permission.total' });
export const PERMISSION_HINT = translated({ leer: 'permissionHint.leer', editar: 'permissionHint.editar', preguntar: 'permissionHint.preguntar', total: 'permissionHint.total' });
// Agents that can be corrected while they work (the message reaches them at their next step).
export const CAN_STEER = { claude: true, codex: true };
export const DECISION = translated({ allowed: ['decision.allowed', 'success'], always: ['decision.always', 'success'], denied: ['decision.denied', 'destructive'], expired: ['decision.expired', 'secondary'] });
export const REASONING = translated({ low: 'reasoning.low', medium: 'reasoning.medium', high: 'reasoning.high' });
export const MODE = translated({ carpeta: 'mode.carpeta', aislada: 'mode.aislada' });
export const SENSITIVE = translated({
  external_write: 'sensitive.external_write', publish: 'sensitive.publish', financial: 'sensitive.financial', credential_access: 'sensitive.credential_access', destructive: 'sensitive.destructive',
  razonamiento_alto: 'sensitive.razonamiento_alto', creada_por_agente: 'sensitive.creada_por_agente', ruta_cambiada: 'sensitive.ruta_cambiada'
});
export const LOGIN = translated({ si: ['login.si', 'success'], no: ['login.no', 'destructive'], desconocido: ['login.desconocido', 'secondary'] });
export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
