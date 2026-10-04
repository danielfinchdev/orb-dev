// Agent adapters: the command each CLI gets (permissions, resume, MCP) and how their JSON events become items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as claude from '../src/agents/claude.mjs';
import * as codex from '../src/agents/codex.mjs';
import * as cursor from '../src/agents/cursor.mjs';
import { cleanEnv } from '../src/agents/common.mjs';

const exe = { cmd: '/bin/agente', pre: [] };
const after = (args, flag) => args[args.indexOf(flag) + 1];

test('Claude: permisos de solo lectura, edición (con lista de bloqueos) y total', () => {
  const read = claude.buildTurn({ exe, prompt: 'x', permission: 'leer' }).args;
  assert.ok(read.includes('--disallowedTools') && read.includes('Edit') && read.includes('Bash'));
  const edit = claude.buildTurn({ exe, prompt: 'x', permission: 'editar' }).args;
  assert.equal(after(edit, '--permission-mode'), 'acceptEdits');
  assert.ok(edit.includes('Bash(git push:*)') && edit.includes('Bash(curl:*)'));
  assert.equal(after(claude.buildTurn({ exe, prompt: 'x', permission: 'total' }).args, '--permission-mode'), 'bypassPermissions');
});

test('Claude: conversación nueva con id propio y continuación con --resume; nunca carga la configuración del usuario', () => {
  const first = claude.buildTurn({ exe, prompt: 'hola', session: { id: 'abc', resume: false }, model: 'sonnet' });
  assert.equal(after(first.args, '--session-id'), 'abc'); assert.equal(first.stdin, 'hola');
  assert.ok(first.args.includes('--strict-mcp-config') && first.args.includes('stream-json'));
  assert.equal(after(claude.buildTurn({ exe, prompt: 'x', session: { id: 'abc', resume: true } }).args, '--resume'), 'abc');
});

test('Claude: el asistente usa sus propias herramientas y su modo de permisos', () => {
  const args = claude.buildTurn({ exe, prompt: 'x', tools: { permissionMode: 'acceptEdits', allowed: ['mcp__orb', 'Read'], disallowed: ['Bash(git push:*)'], systemPrompt: 'Eres Orb', addDirs: ['/p'] } }).args;
  assert.equal(after(args, '--permission-mode'), 'acceptEdits');
  assert.equal(after(args, '--append-system-prompt'), 'Eres Orb');
  assert.equal(after(args, '--add-dir'), '/p');
});

test('Codex: sandbox según el permiso, conector MCP por -c y continuación con exec resume', () => {
  const servers = { orb: { command: 'C:\\Program Files\\Orb\\Orb.exe', args: ['C:\\x\\server.mjs'], env: { ORB_HOME: 'C:\\Users\\Ana\\Orb' } } };
  const first = codex.buildTurn({ exe, cwd: '/proyecto', prompt: 'hola', permission: 'leer', mcpServers: servers });
  assert.deepEqual(first.args.slice(0, 2), ['exec', '--json']);
  assert.ok(first.args.includes('sandbox_mode="read-only"'));
  assert.equal(after(first.args, '-C'), '/proyecto');
  assert.ok(first.args.includes('mcp_servers.orb.command="C:\\\\Program Files\\\\Orb\\\\Orb.exe"'), 'rutas de Windows escapadas para TOML');
  assert.ok(first.args.some((a) => a.startsWith('mcp_servers.orb.env={ORB_HOME=')));
  const next = codex.buildTurn({ exe, cwd: '/proyecto', prompt: 'sigue', session: { id: 'th-1', resume: true } });
  assert.deepEqual(next.args.slice(0, 2), ['exec', 'resume']);
  assert.equal(next.args.at(-2), 'th-1'); assert.ok(!next.args.includes('-C'));
  assert.ok(codex.buildTurn({ exe, cwd: '/p', prompt: 'x', permission: 'editar' }).args.includes('sandbox_mode="workspace-write"'));
});

test('Cursor: sin --force en solo lectura y prompt largo por archivo', () => {
  const ro = cursor.buildTurn({ exe, cwd: '/p', prompt: 'hola', permission: 'leer' }).args;
  assert.ok(!ro.includes('--force'));
  const long = cursor.buildTurn({ exe, cwd: '/p', prompt: 'x'.repeat(30000), promptFile: '/runs/p.md' }).args;
  assert.match(long.at(-1), /\/runs\/p\.md/);
  assert.equal(after(cursor.buildTurn({ exe, cwd: '/p', prompt: 'x', session: { id: 'c1', resume: true } }).args, '--resume'), 'c1');
});

test('los eventos de cada agente se convierten en mensajes, herramientas, archivos y consumo', () => {
  const c = claude.createParser();
  c.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'sonnet' }));
  const tool = c.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'mcp__orb__orb_board', input: {} }, { type: 'text', text: 'Hola' }] } }));
  assert.deepEqual(tool.map((i) => i.kind), ['tool', 'text']);
  assert.equal(tool[0].body.name, 'orb:orb_board');
  c.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'Hola', total_cost_usd: 0.02 }));
  assert.equal(c.state.cliSession, 's1'); assert.equal(c.state.final, 'Hola'); assert.equal(c.state.isError, false);

  const x = codex.createParser();
  x.push(JSON.stringify({ type: 'thread.started', thread_id: 'th' }));
  const items = x.push(JSON.stringify({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a', kind: 'add' }, { path: 'b', kind: 'update' }] } }));
  assert.equal(items.length, 2); assert.equal(x.state.cliSession, 'th');
  x.push(JSON.stringify({ type: 'turn.failed', error: { message: 'usage limit' } }));
  assert.equal(x.state.isError, true);

  const u = cursor.createParser();
  const started = u.push(JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'k', tool_call: { readToolCall: { args: { path: 'x.js' } } } }));
  assert.equal(started[0].body.name, 'read'); assert.equal(started[0].body.input, 'x.js');
  assert.deepEqual(u.push('esto no es json'), []);
});

test('el entorno de los agentes no lleva secretos del proceso', () => {
  process.env.GITHUB_TOKEN = 'ghp_secreto'; process.env.ANTHROPIC_API_KEY = 'sk-x'; process.env.ORB_ORCH_KEY = 'clave';
  const env = cleanEnv({ ORB_AGENT: 'codex' });
  assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.ORB_ORCH_KEY, undefined);
  assert.equal(env.ORB_AGENT, 'codex'); assert.ok(env.PATH);
  delete process.env.GITHUB_TOKEN; delete process.env.ANTHROPIC_API_KEY; delete process.env.ORB_ORCH_KEY;
});
