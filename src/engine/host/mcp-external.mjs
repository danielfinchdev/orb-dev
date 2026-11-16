// MCP server for agents OUTSIDE Orb (Claude Code in a terminal, Claude Desktop): they create tasks in Orb and read how
// they go. Off by default (Ajustes › Herramientas). Streamable HTTP (one JSON reply per POST, no streaming) on 127.0.0.1 ONLY:
// the bind is checked after listen() and the server closes if the address is anything else, a peer that is not loopback is
// dropped, and a Host that is not 127.0.0.1/localhost:<port> or any Origin header is refused (DNS rebinding: a web page
// cannot reach it; a browser always sends Origin on a cross-site POST). It is NOT the assistant's stdio server
// (src/mcp/server.mjs) but speaks the same protocol through src/mcp/protocol.mjs.
// Every call needs a live token (src/domain/security/mcp-ext-tokens.mjs). The client can never choose its permission: its tasks
// are always isolated (a worktree), at «Preguntar» and waiting for the user's approval in Orb; arguments outside the schema
// (permission, mode, autonomy, parent_id…) are refused. Size and rate limits apply, and every refusal and creation is logged
// to motor.log (Ajustes › Actividad) and the task's own events.
import http from 'node:http';
import { rpcHandler } from '../../mcp/protocol.mjs';
import { checkToken, clientLabel } from '../../domain/security/mcp-ext-tokens.mjs';
import { oneLine } from '../../shared/text.mjs';

export const DEFAULT_PORT = 47653;
export const MAX_BODY = 64 * 1024;
export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 12000;
export const CALLS_PER_MINUTE = 60;
export const CREATES_PER_10_MIN = 10;
export const MAX_WAITING = 20; // tasks of one client still waiting for the user
export const BAD_PER_MINUTE = 20; // wrong tokens in a minute, then 429 for everyone
const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const userError = (message) => Object.assign(new Error(message), { userFacing: true });

const INSTRUCTIONS = "Orb is the user's desktop app that runs coding agents. Use orb_create_task to hand it a task in one of the projects this token may use. The task is made in an isolated copy and waits for the user to approve it in Orb with the permission «Preguntar»; you cannot change that. Use orb_task_status to see how it goes.";

export function createMcpExternal({ board, master, createTask, agents = [], log = () => {}, now = Date.now, version = '0' }) {
  let server = null; let port = 0; let starting = null;
  const calls = new Map(); const creates = new Map(); let bad = [];
  const hits = (map, key, limit, windowMs) => {
    const t = now(); const list = (map.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= limit) { map.set(key, list); return false; }
    list.push(t); map.set(key, list); return true;
  };

  const toolsFor = (client) => [
    { name: 'orb_projects', readOnly: true, description: 'Projects of Orb this token may create tasks in.', inputSchema: { type: 'object', properties: {} },
      run: () => client.projects.filter((p) => board.project(p)).map((name) => ({ name })) },
    { name: 'orb_create_task', description: 'Creates a task in an Orb project. It runs in an isolated copy (a worktree) with the permission «Preguntar», and only after the user approves it in Orb.',
      inputSchema: { type: 'object', required: ['project', 'title', 'description'], properties: {
        project: { type: 'string', description: 'A project from orb_projects' }, title: { type: 'string', description: `Short title (max ${MAX_TITLE} characters)` },
        description: { type: 'string', description: `What to do, with the context the agent needs (max ${MAX_DESCRIPTION} characters)` },
        agent: { type: 'string', description: `Which agent should do it (${agents.join(', ') || 'any'}); default any` } } },
      run: (a) => {
        if (typeof a.project !== 'string' || typeof a.title !== 'string' || typeof a.description !== 'string') throw userError('project, title and description are text');
        if (!client.projects.includes(a.project)) { log(`mcp-externo: ${client.name} (${client.id}) pidió el proyecto «${oneLine(a.project, 80)}», que su token no permite`); throw userError('this token may not use that project'); }
        if (!board.project(a.project)) throw userError('that project no longer exists');
        const title = oneLine(a.title, MAX_TITLE);
        if (!title || !a.description.trim()) throw userError('title and description cannot be empty');
        if (a.description.length > MAX_DESCRIPTION) throw userError(`description over ${MAX_DESCRIPTION} characters`);
        const agent = a.agent === undefined ? 'any' : a.agent;
        if (agent !== 'any' && !agents.includes(agent)) throw userError(`agent must be one of: any, ${agents.join(', ')}`);
        const who = clientLabel(client.id);
        const open = board.one(`SELECT COUNT(*) AS n FROM tasks WHERE created_by = ? AND status = 'awaiting_approval'`, who)?.n ?? 0;
        if (open >= MAX_WAITING) throw userError('too many tasks of this client are waiting for approval');
        if (!hits(creates, client.id, CREATES_PER_10_MIN, 600_000)) throw userError('too many tasks created in a short time');
        const task = createTask({ project: a.project, title, description: a.description, agent, actor: who });
        board.event(task.id, who, 'note', `Creada por el cliente MCP «${client.name}» (${client.id}); espera tu aprobación.`);
        log(`mcp-externo: ${client.name} (${client.id}) creó la tarea #${task.id} en «${a.project}»`);
        return { id: task.id, status: task.status, project: task.project, note: 'Waiting for the user to approve it in Orb.' };
      } },
    { name: 'orb_task_status', readOnly: true, description: 'Status of a task this token created.',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      run: (a) => {
        const t = Number.isInteger(a.id) ? board.task(a.id) : null;
        // another client's task (or one of the user's) looks the same as one that does not exist
        if (!t || t.created_by !== clientLabel(client.id)) throw userError('unknown task');
        return { id: t.id, project: t.project, title: t.title, status: t.status };
      } }
  ];

  function send(res, status, body, headers = {}) {
    const data = body === null ? '' : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers, 'content-length': Buffer.byteLength(data) });
    res.end(data);
  }
  const hostOk = (h) => { const m = /^(127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(String(h ?? '')); return Boolean(m) && Number(m[2]) === port; };

  async function handle(req, res) {
    try {
      const peer = req.socket.remoteAddress;
      if (!LOOPBACK.has(peer) || !hostOk(req.headers.host) || req.headers.origin !== undefined) { log(`mcp-externo: rechazada una petición (host «${oneLine(req.headers.host ?? '', 60)}», origen «${oneLine(req.headers.origin ?? '', 60)}»)`); return send(res, 403, { error: 'forbidden' }); }
      if (req.url !== '/mcp') return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, { allow: 'POST' });
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return send(res, 415, { error: 'application/json only' });
      const t = now(); bad = bad.filter((x) => t - x < 60_000);
      if (bad.length >= BAD_PER_MINUTE) return send(res, 429, { error: 'too many wrong tokens' }, { 'retry-after': '60' });
      const client = checkToken(master(), req.headers.authorization, t);
      if (!client) { bad.push(t); log('mcp-externo: token rechazado (falso, caducado o revocado)'); return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' }); }
      if (!hits(calls, client.id, CALLS_PER_MINUTE, 60_000)) return send(res, 429, { error: 'rate limit' }, { 'retry-after': '60' });
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_BODY) return send(res, 413, { error: 'too large' }, { connection: 'close' });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BODY) { send(res, 413, { error: 'too large' }, { connection: 'close' }); req.destroy(); return undefined; } chunks.push(c); }
      let msg; try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
      const out = await rpcHandler({ serverInfo: { name: 'orb', version }, instructions: INSTRUCTIONS, tools: toolsFor(client) })(msg);
      return out ? send(res, 200, out) : send(res, 202, null);
    } catch (error) {
      log(`mcp-externo: ${error.message}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      return undefined;
    }
  }

  async function start(wanted = DEFAULT_PORT) {
    if (server) return status();
    return (starting ??= new Promise((resolve, reject) => {
      const srv = http.createServer(handle);
      srv.requestTimeout = 15_000; srv.headersTimeout = 10_000; srv.keepAliveTimeout = 5_000; srv.maxConnections = 16; srv.maxHeadersCount = 40;
      srv.on('error', reject);
      srv.listen(wanted, '127.0.0.1', () => {
        const a = srv.address();
        // never anything but loopback: the address is checked, not assumed
        if (!a || typeof a === 'string' || a.address !== '127.0.0.1') { srv.close(); reject(new Error('the MCP server did not bind to 127.0.0.1')); return; }
        srv.removeListener('error', reject); srv.on('error', (e) => log(`mcp-externo: ${e.message}`));
        server = srv; port = a.port; resolve(status());
      });
    })).finally(() => { starting = null; });
  }
  async function stop() {
    const srv = server; server = null; port = 0;
    if (srv) await new Promise((r) => { srv.close(() => r()); srv.closeAllConnections?.(); });
    calls.clear(); creates.clear(); bad = [];
  }
  const status = () => ({ running: Boolean(server), port, url: server ? `http://127.0.0.1:${port}/mcp` : null });
  return { start, stop, status, handle };
}
