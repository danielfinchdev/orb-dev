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
  rail('tope-5h', 'orb', ['budget.agents', 'budget.windowHours']),
  rail('tiempo-maximo', 'orb', ['timeoutMinutes']),
]);

const BY_ID = new Map(RAILS.map((r) => [r.id, r]));
export const railById = (id) => BY_ID.get(id) ?? null;
// The ids that accept a switch in the config (the fixed ones and unknown ids never do).
export const switchableIds = () => RAILS.filter((r) => !r.fixed).map((r) => r.id);

const RAIL_KEYS = Object.freeze([...new Set(RAILS.flatMap((r) => r.keys))]);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
};
// Same rule as config-file.mjs › merge: objects merge, arrays and scalars replace.
const overlay = (base, over) => (isObj(base) && isObj(over) ? { ...base, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, overlay(base[k], v)])) } : over);
const pickPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
// Shared with the window, which asks the password before sending such a patch.
// Whether a config.save patch would change the value of any rail key, comparing what the settings would hold after the merge with
// what they hold now. A resent identical value (Ajustes sends whole objects) is no change.
export function railValuesChange(patch, current) {
  if (!isObj(patch)) return false;
  const now = current ?? {};
  return RAIL_KEYS.some((key) => {
    const top = key.split('.')[0];
    if (!Object.hasOwn(patch, top)) return false;
    const after = { [top]: overlay(now[top], patch[top]) };
    return !deepEqual(pickPath(after, key), pickPath(now, key));
  });
}
