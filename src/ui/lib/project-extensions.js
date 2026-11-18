// What the project page shows of Skills y MCP, from extensions.list: what only this project receives (a scope that
// includes it), how many from every project it gets besides, and what could still be added to it. The engine applies
// the same rule when it hands things to an agent (domain/extensions/catalog.mjs › reaches); this one only draws it.
// The engine says whether a row is limited to projects (`scoped`, the same rule that hands things to an agent: a limit it
// does not understand reaches nobody) and which ones it names (`projects`).
const scopeOf = (row) => (Array.isArray(row?.projects) ? row.projects : []);
const scoped = (row) => row?.scoped === true;
const reachesProject = (row, project) => !scoped(row) || scopeOf(row).includes(project);

// Every installed skill and connector as one list, one entry per thing an agent can receive.
export function extensionRows(data) {
  const skills = (data?.skills ?? []).map((r) => ({ ...r, kind: 'skill', usable: r.valid === true && !r.linked }));
  // a server of core with no connector yet, or that needs its packages, is turned on in Ajustes first (extensions.scope adds only an existing, ready entry)
  const mcp = (data?.mcp ?? []).map((r) => ({ ...r, kind: 'mcp', usable: !r.linked && !r.needsInstall && Boolean(r.connector), blocked: !r.linked && (r.needsInstall || !r.connector) && r.startable !== false && !r.enabled }));
  const connectors = (data?.connectors ?? []).map((r) => ({ ...r, kind: 'connector', usable: true }));
  return [...skills, ...mcp, ...connectors];
}

export function projectExtensions(data, project) {
  const rows = extensionRows(data);
  const mine = rows.filter((r) => r.enabled && scoped(r) && scopeOf(r).includes(project));
  const sharedCount = rows.filter((r) => r.enabled && !scoped(r)).length;
  const candidates = rows.filter((r) => r.usable && !(r.enabled && reachesProject(r, project)));
  const blocked = rows.filter((r) => r.blocked);
  return { mine, sharedCount, candidates, blocked };
}

// «MCP · name» / «Skill · name»
export const extensionLabel = (t, row) => t(row.kind === 'skill' ? 'projects.ext.skill' : 'projects.ext.mcp', { name: row.name });
