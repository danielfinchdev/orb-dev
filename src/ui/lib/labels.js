// Interface texts that repeat across views (Spanish, the default language).
export const STATUS = {
  queued: ['En cola', 'info'], awaiting_approval: ['Espera aprobación', 'warning'], running: ['Trabajando', 'default'],
  done: ['Hecha', 'success'], failed: ['Fallida', 'destructive'], blocked: ['Bloqueada', 'warning'], cancelled: ['Cancelada', 'secondary']
};
export const AGENT = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', any: 'Cualquiera', orb: 'Orb', usuario: 'Tú' };
export const PERMISSION = { leer: 'Solo leer', editar: 'Editar archivos', total: 'Acceso total' };
export const PERMISSION_HINT = {
  leer: 'Puede leer el proyecto pero no cambia nada.',
  editar: 'Edita archivos y ejecuta comandos dentro del proyecto. Sin push, curl ni borrados masivos.',
  total: 'Sin comprobaciones. Úsalo solo si sabes lo que haces.'
};
export const REASONING = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
export const MODE = { carpeta: 'En la carpeta del proyecto', aislada: 'Copia aislada (rama propia)' };
export const SENSITIVE = {
  external_write: 'escribe fuera', publish: 'publica', financial: 'pagos', credential_access: 'credenciales', destructive: 'borra datos',
  razonamiento_alto: 'razonamiento alto', creada_por_agente: 'creada por un agente', ruta_cambiada: 'la carpeta cambió'
};
export const LOGIN = { si: ['Sesión iniciada', 'success'], no: ['Sin sesión', 'destructive'], desconocido: ['Sin comprobar', 'secondary'] };
export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
