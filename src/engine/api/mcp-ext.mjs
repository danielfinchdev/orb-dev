// Ajustes › Herramientas › «MCP para agentes de fuera»: the switch (off by default), the tokens and the projects each one may
// use. The server itself is src/engine/host/mcp-external.mjs. This PC's window only (permissions.mjs): a phone or an agent
// never reaches these methods. Making a token, choosing its projects and switching the server on ask for the master
// password (UNLOCK_METHODS); revoking or removing one, and switching the server off, need nothing.
import { ctx } from '../../platform/context.mjs';
import { AGENTS } from '../../domain/tasks/board-common.mjs';
import { listTokens, createToken, revokeToken, removeToken, setTokenProjects, DEFAULT_DAYS, MAX_DAYS } from '../../domain/security/mcp-ext-tokens.mjs';
import { createMcpExternal, DEFAULT_PORT } from '../host/mcp-external.mjs';
import { fail, str } from './common.mjs';

const KEY = 'mcpext_enabled';
const PORT_KEY = 'mcpext_port';

export function mcpExtMethods({ board, log = () => {}, version = '0', emit = () => {}, now = Date.now }) {
  const master = () => ctx.master;
  const createTask = ({ project, title, description, agent, actor }) => board.createTask({ project, title, description, agent, mode: 'aislada', launch: 'auto', external: true }, actor);
  const server = createMcpExternal({ board, master, createTask, agents: AGENTS, log, version, now });
  // ORB_MCPEXT_PORT: tests (0 = any free port); the app never sets it.
  const portOf = () => {
    if (/^\d{1,5}$/.test(process.env.ORB_MCPEXT_PORT ?? '')) return Number(process.env.ORB_MCPEXT_PORT);
    const p = Number(board.setting(PORT_KEY));
    return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : DEFAULT_PORT;
  };
  const enabled = () => board.setting(KEY) === '1';
  const wrap = (fn) => { try { return fn(); } catch (error) { if (error?.name === 'TokenError') fail(error.message); throw error; } };
  const projectNames = () => board.projects().map((p) => p.name);
  const checkProjects = (list) => {
    if (!Array.isArray(list)) fail('projects: lista');
    const known = new Set(projectNames());
    const bad = list.find((p) => typeof p !== 'string' || !known.has(p));
    if (bad !== undefined) fail(`proyecto desconocido: ${String(bad).slice(0, 80)}`);
    return list;
  };
  const state = () => ({ enabled: enabled(), ...server.status(), configuredPort: portOf(), defaultDays: DEFAULT_DAYS, maxDays: MAX_DAYS, vaultOpen: Boolean(master()?.unlocked?.()), tokens: listTokens(master(), now()), projects: projectNames(), agents: AGENTS });
  const changed = () => { try { emit('mcpext:changed', {}); } catch { /* nobody listens */ } };
  // the server follows the switch; it only starts when asked (never by default)
  const apply = async () => {
    if (enabled()) await server.start(portOf()); else await server.stop();
  };
  const startup = async () => { if (enabled()) { try { await server.start(portOf()); log('mcp-externo: servidor en 127.0.0.1'); } catch (error) { log(`mcp-externo: no arrancó: ${error.message}`); } } };
  return {
    startup, stop: () => server.stop(), server,
    methods: {
      'mcpExt.state': () => state(),
      'mcpExt.setEnabled': async ({ enabled: on }) => {
        if (typeof on !== 'boolean') fail('enabled: true o false');
        board.setting(KEY, on ? '1' : '0');
        try { await apply(); } catch (error) { board.setting(KEY, '0'); fail(`No se pudo abrir el puerto ${portOf()}: ${error.message}`); }
        log(`mcp-externo: ${on ? 'activado' : 'apagado'}`); changed();
        return state();
      },
      'mcpExt.createToken': ({ name, projects, days }) => {
        const out = wrap(() => createToken(master(), { name: str(name, 'nombre', 100), projects: checkProjects(projects), days: days ?? DEFAULT_DAYS, now: now() }));
        log(`mcp-externo: token «${out.name}» (${out.id}) creado para ${out.projects.length} proyecto(s)`); changed();
        return { ...out, url: server.status().url ?? `http://127.0.0.1:${portOf()}/mcp` };
      },
      'mcpExt.setProjects': ({ id, projects }) => {
        const out = wrap(() => setTokenProjects(master(), str(id, 'token', 40), checkProjects(projects), now()));
        log(`mcp-externo: proyectos del token ${out.id} cambiados`); changed(); return out;
      },
      'mcpExt.revoke': ({ id }) => { const out = wrap(() => revokeToken(master(), str(id, 'token', 40), now())); log(`mcp-externo: token ${out.id} revocado`); changed(); return out; },
      'mcpExt.remove': ({ id }) => { wrap(() => removeToken(master(), str(id, 'token', 40))); log(`mcp-externo: token ${id} borrado`); changed(); return true; }
    }
  };
}
