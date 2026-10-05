// Interface texts that repeat across views (Spanish, the default language).
export const STATUS = {
  queued: ['En cola', 'info'], awaiting_approval: ['Espera aprobación', 'warning'], running: ['Trabajando', 'default'],
  done: ['Hecha', 'success'], failed: ['Fallida', 'destructive'], blocked: ['Bloqueada', 'warning'], cancelled: ['Cancelada', 'secondary'],
  limited: ['Esperando cupo', 'warning']
};
// State of a conversation (sessions.status).
export const SESSION_STATUS = { running: ['Trabajando', 'default'], idle: null, error: ['Con error', 'destructive'], interrupted: ['A medias', 'warning'], limited: ['Esperando cupo', 'warning'] };
export const AGENT = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen Code', copilot: 'Copilot', any: 'Cualquiera', orb: 'Orb', usuario: 'Tú' };
export const PERMISSION = { leer: 'Solo leer', editar: 'Editar archivos', preguntar: 'Preguntar antes', total: 'Acceso total' };
export const PERMISSION_HINT = {
  leer: 'Puede leer el proyecto pero no cambia nada.',
  editar: 'Edita archivos y ejecuta comandos en el proyecto. Lo arriesgado (push, descargas, borrar carpetas…) te lo pregunta antes.',
  preguntar: 'Edita archivos, pero te pregunta antes de cada comando. Para vigilar de cerca.',
  total: 'Sin comprobaciones. Úsalo solo si sabes lo que haces.'
};
// Agents that can be corrected while they work (the message reaches them at their next step).
export const CAN_STEER = { claude: true, codex: true };
export const DECISION = { allowed: ['Permitido', 'success'], always: ['Permitido siempre', 'success'], denied: ['Denegado', 'destructive'], expired: ['Ya no está activo', 'secondary'] };
export const REASONING = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
export const MODE = { carpeta: 'En la carpeta del proyecto', aislada: 'Copia aislada (rama propia)' };
export const SENSITIVE = {
  external_write: 'escribe fuera', publish: 'publica', financial: 'pagos', credential_access: 'credenciales', destructive: 'borra datos',
  razonamiento_alto: 'razonamiento alto', creada_por_agente: 'creada por un agente', ruta_cambiada: 'la carpeta cambió'
};
export const LOGIN = { si: ['Sesión iniciada', 'success'], no: ['Sin sesión', 'destructive'], desconocido: ['Sin comprobar', 'secondary'] };
export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
