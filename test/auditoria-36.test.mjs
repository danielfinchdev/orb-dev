// 3.6 «Personas», independent audit: Ana (the owner) and Leo (a user) must never see or touch each other's things.
// Unlike personas-superficies (one plain set of params per method), here every method of the policy is called with
// crafted params: the other person's ids in every slot, names instead of ids, @ mentions, searches, dependencies,
// members, paths into the other person's folders and climbing out of one's own. Then the places that do not go through
// the API: the agents' tool process (messages between agents, registering a folder), the assistant's own file reading,
// the export of a person, a forwarded call's request id and the guard's confinement of relative paths.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, startEngine, until, wait, ROOT } from './helpers.mjs';
import { POLICY } from '../src/core/policy.mjs';
import { Board } from '../src/core/board.mjs';
import { paths } from '../src/core/home.mjs';
import { createLink } from '../src/core/link.mjs';
import { agentToken } from '../src/engine/sessions.mjs';
import { once } from '../src/engine/forward.mjs';
import { confineFor, confineCheck, decide } from '../src/core/guard.mjs';
import { unzipFiles } from '../src/core/export.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
let A; let t; let board; let dir; let ana; let leo;
const R = { ana: {}, leo: {} };
const links = [];
const db = () => new DatabaseSync(paths(t.home).db);
const all = (q, ...args) => { const d = db(); try { return d.prepare(q).all(...args); } finally { d.close(); } };

// The window's own methods (the lock screen), what would undo the test (removing or renaming people, PINs) and what
// touches this PC (installs, Remote Desktop, the phone access, restoring a backup, moving the Orb).
const SKIP = new Set(['persons.switch', 'persons.lock', 'persons.unlock', 'app.lockState', 'persons.remove', 'persons.rename', 'persons.setPin', 'data.deletePerson',
  'templates.apply', 'installer.start', 'agents.install', 'net.remote', 'github.login', 'backup.restore', 'backup.now', 'data.moveExport', 'data.moveUndo', 'data.moveKeepBoth',
  'remote.enable', 'remote.configure', 'remote.revoke', 'config.save', 'control.pause', 'control.resume', 'link.revoke', 'link.qr', 'link.connect', 'opti.act',
  'agents.login', 'agents.loginCode', 'agents.loginCancel', 'agents.check', 'accounts.scan', 'backup.verify', 'backup.recovery',
  // creates that would make the caller's own things named with the other person's word (each one checked on its own below)
  'bots.create', 'bots.groups.create', 'persons.create', 'accounts.add', 'images.mark', 'actions.save', 'projects.create']);
// This PC's own tools (the owner's, no person's content): network, Android, GitHub, expert view, Opti Bot.
const PC_TOOL = /^(net|android|github|expert|opti)\./;
const methods = () => Object.keys(POLICY).filter((m) => !m.endsWith('.*') && !SKIP.has(m) && !PC_TOOL.test(m));
const word = (who) => (who === 'ana' ? 'qzana' : 'qzleo');
// What may not show up for the other person: the mark and their folders (as text and as JSON).
const marks = (who) => [word(who), R[who].projectPath, JSON.stringify(R[who].projectPath ?? '').slice(1, -1)].filter(Boolean);
// An error may repeat what the caller typed («no hay ningún bot llamado …»): that is not the other person's.
const typed = (params) => Object.values(params).flat().filter((v) => typeof v === 'string' && v.length > 3).sort((a, b) => b.length - a.length);
const unTyped = (message, params) => typed(params).reduce((m, v) => m.split(v).join('·'), String(message));
// A picture comes back as a data URL: its bytes count too.
const decoded = (s) => [...s.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) => Buffer.from(m[1], 'base64').toString('latin1')).join(' ');
const leaks = (value, who) => { let s = typeof value === 'string' ? value : JSON.stringify(value ?? null); s += decoded(s); return marks(who).filter((m) => s.includes(m)); };

// The crafted params aimed at someone's things.
function variants(r, person) {
  const mention = `@tarea:${r.task} @conversacion:${r.session} @bitacora:${r.project} @bitacora:general`;
  const common = { conversation: r.conv, project: r.project, name: r.project, item: r.botLine, person, bot: r.bot, q: word(r.who), text: `hola ${mention}`, title: 'x', description: `x ${mention}`, every: 'daily', key: `c${r.conv}`, which: 'mine', type: 'project', right: 'view' };
  return [
    { ...common, id: r.task, depends_on: [r.task], members: [r.bot], paths: [r.file], path: r.file, images: [r.image] },
    { ...common, id: r.session, key: `s${r.session}` },
    { ...common, id: r.bot, key: `t${r.task}` },
    { ...common, id: r.botName, name: r.botName },
    { ...common, id: r.group },
    { ...common, id: r.reminder },
    { ...common, id: r.schedule },
    { ...common, id: r.conv, account: 'claude' },
    { ...common, id: person, project: 'general' },
    { ...common, id: r.line, item: r.line, to: r.project }
  ];
}
async function sweep(call, other, label) {
  const bad = [];
  for (const m of methods()) {
    for (const params of variants(R[other], other === 'ana' ? ana.id : leo.id)) {
      let out; let err = null;
      try { out = await call(m, params); } catch (e) { err = e; }
      const l = leaks(err ? unTyped(err.message, params) : out, other);
      if (l.length) { const s = err ? err.message : JSON.stringify(out); const i = s.indexOf(l[0]); bad.push(`${m}(${JSON.stringify(params.id)}): ${err ? 'error' : 'devuelve'} «${s.slice(Math.max(0, i - 160), i + 60)}»`); }
    }
  }
  assert.deepEqual(bad, [], `${label}: ${bad.slice(0, 12).join(' · ')}`);
}

const device = () => { const l = createLink({ file: path.join(dir, `${crypto.randomUUID()}.json`), secret: crypto.randomBytes(32), identity: () => ({ name: 'Móvil de Leo', kind: 'phone' }) }); links.push(l); return l; };
async function phoneFor(person) {
  const l = device();
  const peer = await l.connect({ qr: (await A.call('link.qr', { person, device: 'phone' })).url });
  await until(() => l.peers().find((p) => p.id === peer.id)?.online, 'móvil en directo');
  return (m, p = {}) => l.call(peer.id, m, p);
}
function mcp(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp', 'server.mjs')], { env: { ...process.env, ORB_HOME: t.home, ...env }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    tools: async () => (await rpc('tools/list', {})).result.tools,
    call: async (name, args = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; },
    close: () => child.stdin.end()
  };
}
const orbLines = async (conv) => (await A.call('chat.list', { conversation: conv })).filter((l) => l.role === 'orb');

async function seed(who) {
  const w = word(who); const r = R[who]; r.who = who;
  r.project = `${w}-proyecto`;
  if (who === 'leo') assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try {
    const p = await A.call('projects.create', { name: r.project });
    r.projectPath = p.path;
    r.file = path.join(p.path, 'secreto.txt'); fs.writeFileSync(r.file, `${w} secreto\n`);
    r.image = path.join(p.path, 'foto.png'); fs.writeFileSync(r.image, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(` ${w} foto`)]));
    const c = await A.call('chat.send', { text: `${w} hola Orbe` });
    r.conv = c.conversation;
    await until(async () => (await orbLines(r.conv)).length, `Orbe (${who})`);
    r.line = (await orbLines(r.conv))[0].id;
    r.task = (await A.call('tasks.create', { project: r.project, title: `${w} tarea`, description: `${w} hacer algo` })).id;
    r.schedule = (await A.call('schedules.create', { project: r.project, title: `${w} programada`, description: `${w} cada día`, every: 'daily' })).id;
    r.session = (await A.call('sessions.create', { agent: 'claude', project: r.project, title: `${w} sesión` })).id;
    const bot = await A.call('bots.create', { name: `${w}bot`, role_text: `${w} ayuda` });
    r.bot = bot.id; r.botName = bot.name;
    r.group = (await A.call('bots.groups.create', { name: `${w} grupo`, members: [bot.id] })).id;
    r.reminder = (await A.call('bots.reminders.create', { id: bot.id, text: `${w} recordatorio`, when: new Date(Date.now() + 86_400_000).toISOString() })).id;
    await A.call('bots.memory.set', { id: bot.id, text: `${w} memoria del bot` });
    await A.call('bots.memory.set', { id: 'global', text: `${w} memoria global` });
    r.botLine = (await A.call('bots.chat', { id: bot.id })).conversation;
  } finally { if (who === 'leo') assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  // The task's result (as if it had run), only in the database: what a dependency or a mention would hand on.
  const d = db(); try { d.prepare("UPDATE tasks SET status = 'done', result = ? WHERE id = ?").run(`${w} resultado privado`, r.task); } finally { d.close(); }
}

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-auditoria-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ role: 'todo', mobile: { enabled: true, port, name: 'Casa', preview: 'all' } });
  A = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_PUSH_LOG: path.join(dir, 'avisos.jsonl') } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  await A.call('control.pause');
  leo = await A.call('persons.create', { name: 'Leo', caps: { dev: true } });
  ana = (await A.call('persons.list')).find((p) => p.role === 'owner');
  await A.call('accounts.lend', { id: 'claude', person: leo.id, daily_turns: 500, dev: true });
  await seed('ana');
  // Leo's numbers far from Ana's: a call with one of his ids never lands on another thing of hers by chance.
  { const d = db(); try { for (const tb of ['tasks', 'schedules', 'bots', 'bot_groups', 'bot_reminders', 'conversations', 'chat']) { d.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(tb); d.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, 5000)').run(tb); } } finally { d.close(); } }
  await seed('leo');
  board = new Board();
});
after(async () => {
  for (const l of links) l.stop();
  try { board?.close?.(); } catch { /* closed */ }
  await A?.stop(); t?.cleanup();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('Leo, desde la ventana y desde su móvil, con parámetros armados: nada de Ana', async () => {
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try { await sweep(A.call, 'ana', 'ventana (Leo)'); } finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  await sweep(await phoneFor(leo.id), 'ana', 'móvil de Leo');
});

test('Ana (la dueña), con parámetros armados: nada de Leo', async () => {
  await sweep(A.call, 'leo', 'ventana (Ana)');
});

test('una tarea no depende de la de otra persona, ni un proyecto entra en su carpeta o su grupo', async () => {
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try {
    await assert.rejects(A.call('tasks.create', { project: R.leo.project, title: 'x', description: 'x', depends_on: [R.ana.task] }), (e) => !leaks(e.message, 'ana').length);
    // The name of someone else's project: not available, without saying whose or where.
    for (const call of [() => A.call('projects.create', { name: R.ana.project }), () => A.call('projects.rename', { name: R.leo.project, to: R.ana.project })])
      await assert.rejects(call(), (e) => !leaks(e.message, 'ana').length && /no está disponible/.test(e.message));
  } finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  // Ana's multiplatform group: Leo does not join it with a platform of his.
  await A.call('projects.create', { name: 'qzanagrupo', categories: ['web', 'android'] });
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try { await assert.rejects(A.call('projects.create', { name: 'qzanagrupo', categories: ['ios', 'windows'] }), (e) => !leaks(e.message, 'ana').length); }
  finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  // The owner does not depend on Leo's task either.
  await assert.rejects(A.call('tasks.create', { project: R.ana.project, title: 'x', description: 'x', depends_on: [R.leo.task] }), (e) => !leaks(e.message, 'leo').length);
});

test('archivos de la otra persona: ni imágenes, ni adjuntos de la pizarra, ni el icono de un proyecto', async () => {
  const tries = (r, other) => [
    ['images.read', { path: other.image }], ['images.save', { path: other.image, project: r.project }],
    ['whiteboard.attach', { project: r.project, paths: [other.file] }], ['projects.setIcon', { name: r.project, path: other.image }],
    ['sessions.send', { id: r.session, text: 'mira', images: [other.image] }]
  ];
  for (const [m, p] of tries(R.ana, R.leo)) await assert.rejects(A.call(m, p), (e) => !leaks(e.message, 'leo').length, `Ana: ${m}`);
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try { for (const [m, p] of tries(R.leo, R.ana)) await assert.rejects(A.call(m, p), (e) => !leaks(e.message, 'ana').length, `Leo: ${m}`); }
  finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  // Their own, they do reach.
  assert.ok((await A.call('images.read', { path: R.ana.image })).dataUrl);
});

test('las herramientas del agente de Leo: ni mensajes, ni carpetas, ni cuentas de Ana', async () => {
  const leoAgent = mcp({ ORB_AGENT: 'claude', ORB_AGENT_TOKEN: agentToken(board, 'claude', '', leo.id) });
  const anaAgent = mcp({ ORB_AGENT: 'codex', ORB_AGENT_TOKEN: agentToken(board, 'codex', '', ana.id) });
  try {
    // Ana's agent writes to every agent and to the user; Leo's reads nothing of it (and the other way round).
    assert.equal((await anaAgent.call('orb_send_message', { to: 'all', body: 'qzana para todos' })).error, false);
    assert.equal((await anaAgent.call('orb_send_message', { to: 'claude', body: 'qzana para claude' })).error, false);
    const leoInbox = await leoAgent.call('orb_read_messages');
    assert.deepEqual(leaks(leoInbox.text, 'ana'), [], leoInbox.text);
    assert.equal((await leoAgent.call('orb_send_message', { to: 'all', body: 'qzleo para todos' })).error, false);
    assert.equal((await leoAgent.call('orb_send_message', { to: 'usuario', body: 'qzleo para el usuario' })).error, false);
    const anaInbox = await anaAgent.call('orb_read_messages');
    assert.deepEqual(leaks(anaInbox.text, 'leo'), [], anaInbox.text);
    // Leo's agent's line «to the user» is Leo's, not the owner's.
    const line = all("SELECT person_id FROM chat WHERE body LIKE '%qzleo para el usuario%'");
    assert.deepEqual(line.map((x) => x.person_id), [leo.id]);
    // Registering a folder inside Ana's project (or Ana's own folder under another name): refused.
    const sub = path.join(R.ana.projectPath, 'src'); fs.mkdirSync(sub, { recursive: true });
    for (const p of [sub, R.ana.projectPath]) {
      const r = await leoAgent.call('orb_add_project', { name: `qzleo-${crypto.randomUUID().slice(0, 6)}`, path: p });
      assert.equal(r.error, true, r.text); assert.deepEqual(leaks(r.text, 'ana').filter((m) => m !== R.ana.projectPath), []);
    }
    assert.equal(all('SELECT COUNT(*) AS n FROM projects WHERE person_id = ? AND path LIKE ?', leo.id, `${R.ana.projectPath}%`)[0].n, 0);
    // The board, the task list and Ana's task.
    for (const [tool, args] of [['orb_board', {}], ['orb_list_tasks', {}], ['orb_get_task', { id: R.ana.task }]]) {
      const r = await leoAgent.call(tool, args);
      const l = leaks(r.text, 'ana'); const i = r.text.indexOf(l[0]);
      assert.deepEqual(l, [], `${tool}: ${r.text.slice(Math.max(0, i - 300), i + 100)}`);
    }
  } finally { leoAgent.close(); anaAgent.close(); }
});

test('la exportación de Leo no lleva lo de Ana (ni sus recordatorios en un bot de Leo)', async () => {
  // Leo shares his bot with Ana to talk; Ana sets a reminder of her own on it.
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try { await A.call('shares.set', { type: 'bot', id: String(R.leo.bot), person: ana.id, right: 'talk' }); } finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  await A.call('bots.reminders.create', { id: R.leo.bot, text: 'qzana en el bot de Leo', when: new Date(Date.now() + 86_400_000).toISOString() });
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  let out;
  try { out = await A.call('data.exportPerson', {}); } finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  const files = unzipFiles(fs.readFileSync(out.path));
  const bad = files.filter((f) => leaks(f.data.toString('utf8'), 'ana').length).map((f) => f.name);
  assert.deepEqual(bad, []);
  assert.ok(files.some((f) => f.data.toString('utf8').includes('qzleo')), 'lo de Leo sí está');
});

test('el asistente de Leo no lee archivos de Ana; el de Ana tampoco los de Leo', async () => {
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  let conv;
  try { conv = (await A.call('chat.send', { text: `mira esto\nLEE ${R.ana.file}\nLEE ${R.leo.file}\nLEE ${path.join(t.home, '.orb', 'ejecuciones', 'x.txt')}`, project: R.leo.project })).conversation; }
  finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  const reply = await until(async () => all("SELECT body FROM chat WHERE conversation_id = ? AND role = 'orb'", conv).find((l) => /LEE/.test(l.body)), 'respuesta de Orbe con LEE');
  assert.match(reply.body, /LEE deny \| LEE allow \| LEE deny/, reply.body);
  const anaConv = (await A.call('chat.send', { text: `mira esto\nLEE ${R.leo.file}\nLEE ${R.ana.file}` })).conversation;
  const anaReply = await until(async () => (await orbLines(anaConv)).find((l) => /LEE/.test(l.body)), 'respuesta de Orbe (Ana)');
  assert.match(anaReply.body, /LEE deny \| LEE allow/, anaReply.body);
});

test('el uso por persona son números; Leo no lo ve', async () => {
  const rows = await A.call('usage.byPerson');
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['month', 'name', 'person', 'today']);
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try { await assert.rejects(A.call('usage.byPerson'), (e) => /dueñ|owner|No tienes/i.test(e.message)); } finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
});

test('la respuesta guardada de una llamada reenviada es de su enlace', async () => {
  const b = new Board();
  try {
    let runs = 0;
    const fn = async () => ({ value: ++runs });
    assert.deepEqual(await once(b, 'req-1', 'enlace-ana', fn), { value: 1 });
    assert.deepEqual(await once(b, 'req-1', 'enlace-ana', fn), { value: 1 }); // the same link: once
    assert.deepEqual(await once(b, 'req-1', 'enlace-leo', fn), { value: 2 }); // another link: never the stored answer
  } finally { b.close?.(); }
});

test('el guardia: una ruta relativa que sale de la carpeta, y la exclusión del asistente de la dueña', () => {
  const root = fs.mkdtempSync(path.join(dir, 'raiz-')); const otherDir = fs.mkdtempSync(path.join(dir, 'otro-'));
  const c = confineFor({ roots: [root] });
  for (const cmd of [`type ..${path.sep}${path.basename(otherDir)}${path.sep}a.txt`, `cat sub${path.sep}..${path.sep}..${path.sep}x`, 'dir ..'])
    assert.equal(confineCheck({ command: cmd, confine: c })?.decision, 'deny', cmd);
  for (const cmd of ['git log a..b', `cat sub${path.sep}..${path.sep}a.txt`, 'npm test']) assert.equal(confineCheck({ command: cmd, confine: c }), null, cmd);
  const ex = { exclude: [otherDir], cwd: root };
  assert.equal(decide({ permission: 'leer', tool: 'Read', paths: [path.join(otherDir, 'a.txt')], confine: ex }).decision, 'deny');
  assert.equal(decide({ permission: 'leer', tool: 'Read', paths: [path.join(root, 'a.txt')], confine: ex }).decision, 'allow');
  assert.equal(decide({ permission: 'leer', tool: 'Bash', command: `type "${path.join(otherDir, 'a.txt')}"`, confine: ex }).decision, 'deny');
});

test('los avisos del agente de Leo no llegan a la ventana de Ana', async () => {
  const from = A.events.length;
  const leoAgent = mcp({ ORB_AGENT: 'claude', ORB_AGENT_TOKEN: agentToken(board, 'claude', '', leo.id) });
  try { await leoAgent.call('orb_send_message', { to: 'usuario', body: 'qzleo aviso para mí' }); } finally { leoAgent.close(); }
  await wait(2500);
  const seen = A.events.slice(from).filter((e) => leaks(e, 'leo').length);
  assert.deepEqual(seen.map((e) => e.event), []);
});
