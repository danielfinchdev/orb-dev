// orb_html_show as an agent sees it: the tool is listed only for a signed chat (not for the coordinator, a task or a process
// that only claims an identity), and arguments the tool does not declare are refused. Started like the engine starts it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, ROOT } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { mcpServersFor } from '../src/engine/sessions.mjs';
import { agentAuth } from '../src/domain/security/agent-auth.mjs';

let t; let board; const open = [];
before(() => { t = tempHome(); board = new Board(); createProject(board, { name: 'web' }, 'usuario'); });
after(() => { for (const c of open) c.close(); t.cleanup(); });

const signed = (agent, opts = {}) => mcpServersFor(agent, opts).orb;
const claims = (env = {}) => ({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp', 'server.mjs'), '--ticket-env=ORB_TICKET_orb'], env: { ...env, ORB_AUTH_PIPE: agentAuth.address, ORB_TICKET_orb: '' } });
function client(server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ORB_HOME: t.home, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const c = { tools: async () => (await rpc('tools/list', {})).result.tools, call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).result, close: () => child.stdin.end() };
  open.push(c); return c;
}

test('orb_html_show is listed for a signed chat, with title and html both required, and for nobody else', async () => {
  const tool = (await client(signed('claude', { session: 'chat-directo' })).tools()).find((x) => x.name === 'orb_html_show');
  assert.ok(tool, 'a signed chat gets it');
  assert.deepEqual([...tool.inputSchema.required].sort(), ['html', 'title']);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['html', 'title']);
  const conv = board.createConversation({ title: 'Coordinador', project: 'web' }).id;
  const names = async (server) => (await client(server).tools()).map((x) => x.name);
  assert.ok(!(await names(signed('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv }))).includes('orb_html_show'), 'the coordinator');
  assert.ok(!(await names(claims({ ORB_AGENT: 'claude', ORB_SESSION: 'chat-directo' }))).includes('orb_html_show'), 'a process that only claims a chat');
});

test('orb_html_show refuses an argument it does not declare', async () => {
  const r = await client(signed('claude', { session: 'chat-extra' })).call('orb_html_show', { title: 'x', html: '<p>hi</p>', internet: true });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /internet/);
});
