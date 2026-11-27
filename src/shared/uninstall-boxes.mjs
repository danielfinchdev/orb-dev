// The boxes of «Desinstalar» and «Restablecer» (Ajustes › Datos) and what one forces on another. Shared by the window (the
// checkboxes' live dependencies) and the engine (the plan it computes), so both agree. No imports: the window loads it too.
export const BOXES = Object.freeze(['chats', 'settings', 'journals', 'link', 'vault', 'backups', 'games', 'projects']);
// The three shortcuts: which boxes each one keeps.
export const SHORTCUTS = Object.freeze({
  all: BOXES,
  projects: ['projects'],
  nothing: []
});
export const MODES = Object.freeze(['uninstall', 'reset']);

// keep: { box: boolean }. facts.mcpKeys: a connector of the settings holds keys in the vault. facts.copyFirst: «Hacer una copia antes».
// Reset always keeps the projects. → { keep, forced: { box: 'link' | 'mcp' | 'copy' | 'mode' } } (what was switched on, and why).
export function normalizeKeep(keep = {}, { mode = 'uninstall', mcpKeys = false, copyFirst = false } = {}) {
  const out = Object.fromEntries(BOXES.map((b) => [b, keep?.[b] === true]));
  const forced = {};
  const force = (box, why) => { if (!out[box]) { out[box] = true; forced[box] = why; } };
  if (mode === 'reset') force('projects', 'mode');
  if (out.settings && mcpKeys) force('vault', 'mcp');
  if (out.link) force('vault', 'link');
  if (copyFirst) force('backups', 'copy');
  return { keep: out, forced };
}

// The PC's key stays whenever anything encrypted stays (the vault, the phones' link or the backups).
export const keepsKey = (keep) => keep.vault === true || keep.link === true || keep.backups === true;
