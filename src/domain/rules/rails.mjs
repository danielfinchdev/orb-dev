// The rails: the limits Orb puts on the agents and on itself, listed in one place. Some can be paused one by one
// (orb.json rails.<id>.enabled = false); the core ones (fixed) cannot, whatever the file says.
// Pausing a rail lifts only its own block: the chat's permission level (Auto / Preguntar) still decides the rest.
// Nothing here does I/O: callers ask on every decision, so it only reads the loaded config.
import { ctx } from '../../platform/context.mjs';
import { translate } from '../../shared/i18n.mjs';

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

// A fixed or unknown rail is always on, even when the file says otherwise (written by hand): the check is the
// registry's, never the config's.
export function isRailOn(id) {
  const r = BY_ID.get(id);
  if (!r || r.fixed) return true;
  return ctx.config?.rails?.[id]?.enabled !== false;
}

const pick = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function railList(lang = ctx.config?.language ?? 'es') {
  return RAILS.map((r) => ({
    id: r.id, grupo: r.group, fijo: r.fixed, activo: isRailOn(r.id),
    titulo: translate(lang, `rails.${r.id}.title`), descripcion: translate(lang, `rails.${r.id}.desc`),
    valores: Object.fromEntries(r.keys.map((k) => [k, pick(ctx.config, k)])),
  }));
}

// guard categories that belong to a switchable rail (the other risks have none and always apply).
export const RISK_RAIL = Object.freeze({ publish: 'publicar', deleteFolders: 'borrar-carpetas', gitRewrite: 'reescribir-git', diskWipe: 'formatear-disco' });
export const riskRailOn = (category) => !RISK_RAIL[category] || isRailOn(RISK_RAIL[category]);

// Minutes a task's permission waits for an answer (0 = for ever, which is what a paused rail means).
export const approvalWaitMinutes = () => (isRailOn('permiso-sin-respuesta') ? Number(ctx.config?.approvalWaitMinutes ?? 10) : 0);
// Minutes of working time before a task is stopped (0 = no limit).
export const taskTimeoutMinutes = () => (isRailOn('tiempo-maximo') ? Number(ctx.config?.timeoutMinutes ?? 60) : 0);
// The scheduler's limits; a paused rail removes them (Infinity / false).
export function parallelLimits() {
  const on = isRailOn('tareas-a-la-vez');
  return { oneAtATime: on && Boolean(ctx.config?.oneAtATime), maxParallel: on ? ctx.config.maxParallel : Infinity, perAgent: on ? ctx.config.perAgent : Infinity };
}
