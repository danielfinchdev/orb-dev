// The list of rails (id, group, fixed, tuning keys) with no dependencies, so every layer, config included, can read it.
// Behaviour (is a rail on, what it blocks) stays in src/domain/rules/rails.mjs.
// keys: the orb.json settings (dotted) that tune the rail's values.
const rail = (id, group, keys = [], fixed = false) => Object.freeze({ id, group, keys: Object.freeze(keys), fixed });

export const RAILS = Object.freeze([
  // Core: no switch. They protect Orb's own data and the owner's credentials, and what the logs may show.
  rail('core', 'subagentes', [], true),
  rail('privilegios', 'subagentes', [], true),
  rail('credenciales', 'subagentes', [], true),
  rail('secretos-registros', 'orb', [], true),
  // Agents
  rail('rutas-protegidas', 'subagentes', ['protected']),
  rail('fuera-del-proyecto', 'subagentes'),
  rail('publicar', 'subagentes'),
  rail('borrar-carpetas', 'subagentes'),
  rail('reescribir-git', 'subagentes'),
  rail('borrado-masivo', 'subagentes'),
  rail('revisar-secretos', 'subagentes'),
  rail('permiso-sin-respuesta', 'subagentes', ['approvalWaitMinutes']),
  rail('formatear-disco', 'subagentes'),
  rail('usar-adb', 'subagentes'),
  // Orb
  rail('freno-uso', 'orb', ['budget.stopAt']),
  rail('freno-semanal', 'orb', ['budget.weeklyStopAt']),
  rail('rondas-correccion', 'orb', ['budget.maxFixRounds']),
  rail('tareas-a-la-vez', 'orb', ['maxParallel', 'perAgent', 'oneAtATime']),
  rail('tope-5h', 'orb', ['budget.agents']),
  rail('tiempo-maximo', 'orb', ['timeoutMinutes']),
]);

const BY_ID = new Map(RAILS.map((r) => [r.id, r]));
export const railById = (id) => BY_ID.get(id) ?? null;
// The ids that accept a switch in the config (the fixed ones and unknown ids never do).
export const switchableIds = () => RAILS.filter((r) => !r.fixed).map((r) => r.id);

