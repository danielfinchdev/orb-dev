// 3.8.8 paso 11b (G1), motor: el ámbito por proyecto de los conectores MCP y las skills. Sin ámbito vale para todos como
// hoy; con ámbito solo llega a los chats y tareas de esos proyectos; quitar nunca amplía; renombrar lo sigue; y nadie
// salvo la ventana del PC puede cambiarlo.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../src/platform/context.mjs';
import { saveConfig } from '../src/platform/config.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions, mcpServersFor } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { liveSkills } from '../src/engine/api/extensions.mjs';
import { renameProject } from '../src/domain/projects/projects.mjs';
import { DESKTOP, principalOf, METHODS, REMOTE_METHODS, needsUnlock } from '../src/domain/security/permissions.mjs';
import { reaches, isScoped, scopeOnly, scopeChange } from '../src/domain/extensions/extensions.mjs';

const PHONE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const keysOf = (project, agent = 'claude') => Object.keys(mcpServersFor(agent, { session: `g1-${Math.random()}`, project }));
const entry = (name) => ctx.config.mcpServers.find((s) => s.name === name);
const skill = (name) => ctx.config.skills.find((s) => s.name === name);
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  for (const name of ['tienda', 'blog']) {
    const dir = path.join(t.home, 'web', name); fs.mkdirSync(dir, { recursive: true });
    board.addProject({ name, path: dir }, 'usuario', { fromUser: true });
  }
  for (const name of ['revisar-checkout', 'tono-blog']) put(path.join(ctx.paths.skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Instrucciones de ${name}.\n---\n\n# ${name}\n`);
  saveConfig({ mcpServers: [
    { name: 'todos', command: 'npx', args: ['-y', 'uno'], agents: [], enabled: true, source: 'usuario' },
    { name: 'playwright', command: 'npx', args: ['-y', 'pw'], agents: [], enabled: false, source: 'usuario', env: { TOKEN: 'ref:vault:x' } }
  ] });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('sin ámbito: todos los proyectos y los chats sin proyecto reciben lo mismo que hoy', () => {
  assert.deepEqual(keysOf(null), ['orb', 'todos']);
  assert.deepEqual(keysOf('tienda'), ['orb', 'todos']);
  assert.deepEqual(keysOf('blog'), ['orb', 'todos']);
  assert.equal(reaches({ name: 'x', projects: [] }, null), true);
  assert.equal(reaches({ name: 'x' }, 'tienda'), true);
  assert.equal(liveSkills('tienda').plugin, liveSkills(null).plugin);
  assert.equal(liveSkills('tienda'), liveSkills(null));
});

test('añadir a un proyecto un conector desactivado lo activa solo para él; el filtro está en el motor al lanzar', async () => {
  await call('extensions.scope', { kind: 'connector', name: 'playwright', project: 'tienda', add: true });
  assert.deepEqual({ enabled: entry('playwright').enabled, projects: entry('playwright').projects }, { enabled: true, projects: ['tienda'] });
  assert.deepEqual(entry('playwright').env, { TOKEN: 'ref:vault:x' }, 'las claves no se tocan');
  assert.deepEqual(keysOf('tienda'), ['orb', 'todos', 'playwright']);
  assert.deepEqual(keysOf('blog'), ['orb', 'todos']);
  assert.deepEqual(keysOf(null), ['orb', 'todos']);
  // el asistente no recibe conectores del usuario, como hoy
  assert.deepEqual(Object.keys(mcpServersFor('claude', { orchestrator: true, browser: false, session: 'asistente-g1', project: 'tienda' })), ['orb']);
});

test('un segundo proyecto se suma; quitar uno deja el otro; quitar el último lo desactiva y nunca lo amplía', async () => {
  await call('extensions.scope', { kind: 'connector', name: 'playwright', project: 'blog', add: true });
  assert.deepEqual(entry('playwright').projects, ['tienda', 'blog']);
  await call('extensions.scope', { kind: 'connector', name: 'playwright', project: 'tienda', add: false });
  assert.deepEqual(entry('playwright').projects, ['blog']);
  assert.deepEqual(keysOf('tienda'), ['orb', 'todos']);
  await call('extensions.scope', { kind: 'connector', name: 'playwright', project: 'blog', add: false });
  assert.equal(entry('playwright').enabled, false);
  assert.equal(entry('playwright').projects, undefined);
  for (const p of [null, 'tienda', 'blog']) assert.deepEqual(keysOf(p), ['orb', 'todos'], `${p}`);
  // quitar de un proyecto que no lo tiene no cambia nada
  const before = JSON.stringify(ctx.config.mcpServers);
  await call('extensions.scope', { kind: 'connector', name: 'playwright', project: 'blog', add: false });
  assert.equal(JSON.stringify(ctx.config.mcpServers), before);
});

test('lo que ya vale para todos no se toca al añadirlo; poner ámbito a un conector activo lo restringe', async () => {
  const before = JSON.stringify(ctx.config.mcpServers);
  await call('extensions.scope', { kind: 'connector', name: 'todos', project: 'tienda', add: true });
  assert.equal(JSON.stringify(ctx.config.mcpServers), before, 'ya lo recibe: nada que añadir');
  // restringir: lo hace la función pura (la interfaz nunca ofrece esto: lo activo para todos no es candidato)
  const patch = scopeChange({ mcpServers: [{ name: 'a', command: 'x', enabled: true, projects: ['tienda'] }] }, { kind: 'mcp', name: 'a', project: 'blog', add: true });
  assert.deepEqual(patch.mcpServers[0].projects, ['tienda', 'blog']);
});

test('un proyecto que ya no existe en el ámbito se ignora, y un ámbito sin proyectos vivos no llega a nadie', async () => {
  saveConfig({ mcpServers: [...ctx.config.mcpServers, { name: 'huerfano', command: 'npx', args: [], agents: [], enabled: true, source: 'usuario', projects: ['borrado'] }] });
  for (const p of [null, 'tienda', 'blog']) assert.ok(!keysOf(p).includes('huerfano'), `${p}`);
  await assert.rejects(call('extensions.scope', { kind: 'connector', name: 'todos', project: 'no-existe', add: true }));
  await assert.rejects(call('extensions.scope', { kind: 'connector', name: 'nada', project: 'tienda', add: true }));
  saveConfig({ mcpServers: ctx.config.mcpServers.filter((s) => s.name !== 'huerfano') });
});

test('skills: cada proyecto recibe su conjunto; la carpeta de los demás no lleva la skill ajena', async () => {
  for (const name of ['revisar-checkout', 'tono-blog']) await call('extensions.toggle', { kind: 'skill', name, enabled: true });
  const common = liveSkills(null);
  assert.deepEqual(common.list.map((s) => s.name), ['revisar-checkout', 'tono-blog']);
  // restringir una activa a un proyecto lo hace la configuración; la interfaz solo añade lo que el proyecto no recibe
  saveConfig({ skills: ctx.config.skills.map((s) => (s.name === 'revisar-checkout' ? { ...s, projects: ['tienda'] } : s)) });
  assert.deepEqual(liveSkills('tienda').list.map((s) => s.name), ['revisar-checkout', 'tono-blog']);
  assert.deepEqual(liveSkills('blog').list.map((s) => s.name), ['tono-blog']);
  assert.deepEqual(liveSkills(null).list.map((s) => s.name), ['tono-blog']);
  assert.notEqual(liveSkills('tienda').plugin, liveSkills('blog').plugin);
  assert.equal(liveSkills('blog').plugin, liveSkills(null).plugin);
  assert.equal(fs.existsSync(path.join(liveSkills(null).root, 'revisar-checkout')), false, 'la carpeta común no la lleva');
  assert.equal(fs.existsSync(path.join(liveSkills('tienda').root, 'revisar-checkout', 'SKILL.md')), true);
});

test('skills por la API: añadir activa solo para el proyecto, quitar el último la desactiva', async () => {
  await call('extensions.toggle', { kind: 'skill', name: 'tono-blog', enabled: false });
  await call('extensions.scope', { kind: 'skill', name: 'tono-blog', project: 'blog', add: true });
  assert.deepEqual({ enabled: skill('tono-blog').enabled, projects: skill('tono-blog').projects }, { enabled: true, projects: ['blog'] });
  assert.deepEqual(liveSkills('blog').list.map((s) => s.name), ['tono-blog']);
  assert.deepEqual(liveSkills('tienda').list.map((s) => s.name), ['revisar-checkout']);
  await call('extensions.scope', { kind: 'skill', name: 'tono-blog', project: 'blog', add: false });
  assert.equal(skill('tono-blog').enabled, false);
  assert.deepEqual(liveSkills('blog').list.map((s) => s.name), []);
  await assert.rejects(call('extensions.scope', { kind: 'skill', name: 'no-esta', project: 'blog', add: true }));
});

test('renombrar un proyecto lleva sus ámbitos al nombre nuevo', async () => {
  saveConfig({ mcpServers: ctx.config.mcpServers.map((s) => (s.name === 'todos' ? { ...s, projects: ['blog', 'tienda'] } : s)) });
  renameProject(board, { name: 'blog', to: 'diario' }, 'usuario');
  assert.deepEqual(entry('todos').projects, ['diario', 'tienda']);
  assert.deepEqual(keysOf('diario'), ['orb', 'todos']);
  assert.deepEqual(keysOf('blog'), ['orb']);
  assert.deepEqual(skill('revisar-checkout').projects, ['tienda'], 'lo que no lo nombra no cambia');
});

test('quién puede cambiarlo: solo la ventana del PC; el móvil enlazado y los agentes no, y no pide más desbloqueo que activarlo en Ajustes', async () => {
  assert.equal(METHODS['extensions.scope'], 'pc');
  assert.equal(REMOTE_METHODS.has('extensions.scope'), false);
  await assert.rejects(call('extensions.scope', { kind: 'connector', name: 'todos', project: 'tienda', add: false }, PHONE), /PC|permit|allow/i);
  assert.equal(needsUnlock('extensions.scope', {}), needsUnlock('extensions.toggle', {}));
  // ninguna herramienta orb_* de los agentes llega a este método
  const tools = fs.readdirSync(path.join(import.meta.dirname, '..', 'src', 'mcp')).map((f) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'mcp', f), 'utf8')).join('\n');
  assert.equal(tools.includes('extensions.scope'), false);
  // y un agente no puede dar permiso por config.save desde el móvil
  await assert.rejects(call('config.save', { patch: { skills: [] } }, PHONE));
});

// ---- revisión de seguridad: nada amplía lo que recibe un proyecto

const scoped = (list) => saveConfig({ mcpServers: [...ctx.config.mcpServers.filter((s) => !list.some((x) => x.name === s.name)), ...list] });
const mkProject = (name) => { const dir = path.join(t.home, 'web', name); fs.mkdirSync(dir, { recursive: true }); return board.addProject({ name, path: dir }, 'usuario', { fromUser: true }); };
const conn = (name, projects, enabled = true) => ({ name, command: 'npx', args: [], agents: [], enabled, source: 'usuario', ...(projects ? { projects } : {}) });

test('un proyecto que sale de Orb (quitado, terminado, borrado) sale de todos los ámbitos y uno nuevo con su nombre no hereda nada', async () => {
  mkProject('efimero');
  scoped([conn('solo-ef', ['efimero']), conn('dos-ef', ['efimero', 'tienda'])]);
  saveConfig({ skills: [...ctx.config.skills.filter((s) => s.name !== 'tono-blog'), { name: 'tono-blog', enabled: true, source: 'usuario', projects: ['efimero'] }] });
  board.removeProject('efimero', 'usuario');
  assert.deepEqual({ enabled: entry('solo-ef').enabled, projects: entry('solo-ef').projects, off: entry('solo-ef').scopeOff }, { enabled: false, projects: undefined, off: true });
  assert.deepEqual(entry('dos-ef').projects, ['tienda']);
  assert.deepEqual({ enabled: skill('tono-blog').enabled, projects: skill('tono-blog').projects }, { enabled: false, projects: undefined });
  mkProject('efimero');
  assert.ok(!keysOf('efimero').includes('solo-ef') && !keysOf('efimero').includes('dos-ef'));
  // «web (2)» → «web» (el arreglo de nombres de syncProjects) no junta ámbitos que ya nombraban «web»
  mkProject('web2');
  scoped([conn('viejo', ['web'])]);
  renameProject(board, { name: 'web2', to: 'web' }, 'orb');
  assert.ok(!keysOf('web').includes('viejo'), 'un ámbito que ya nombraba «web» no es de este registro');
  mkProject('otro');
  scoped([conn('del-otro', ['otro'])]);
  renameProject(board, { name: 'otro', to: 'otro-nombre' }, 'usuario');
  assert.deepEqual(entry('del-otro').projects, ['otro-nombre'], 'el mismo registro sí lo arrastra');
});

test('«Añadir» no crea ni sustituye entradas: argumento = carpeta del servidor, y entrada npx con claves', async () => {
  const dir = path.join(ctx.paths.mcp, 'srv-exacto');
  put(path.join(dir, 'package.json'), JSON.stringify({ name: 'srv-exacto', main: 'i.js' })); put(path.join(dir, 'i.js'), '//');
  const keyed = { name: 'npx-claves', command: 'npx', args: ['-y', 'pkg'], env: { K: 'ref:vault:k' }, agents: ['claude'], enabled: false, source: 'importado' };
  scoped([{ name: 'srv-exacto', command: 'node', args: [dir], agents: [], enabled: false, source: 'usuario' }, keyed]);
  const before = structuredClone(ctx.config.mcpServers);
  await call('extensions.scope', { kind: 'mcp', name: 'srv-exacto', project: 'tienda', add: true });
  assert.equal(ctx.config.mcpServers.length, before.length, 'ninguna entrada nueva');
  assert.deepEqual({ enabled: entry('srv-exacto').enabled, projects: entry('srv-exacto').projects, command: entry('srv-exacto').command, args: entry('srv-exacto').args }, { enabled: true, projects: ['tienda'], command: 'node', args: [dir] });
  await call('extensions.scope', { kind: 'connector', name: 'npx-claves', project: 'tienda', add: true });
  assert.deepEqual({ ...entry('npx-claves'), enabled: false, projects: undefined }, { ...keyed, projects: undefined }, 'comando, args, env, agents y source intactos');
  assert.deepEqual(entry('npx-claves').projects, ['tienda']);
  for (const n of ctx.config.mcpServers) if (!['srv-exacto', 'npx-claves'].includes(n.name)) assert.deepEqual(n, before.find((b) => b.name === n.name));
  // un servidor de core sin conector todavía: se activa antes en Ajustes
  put(path.join(ctx.paths.mcp, 'sin-conector', 'package.json'), JSON.stringify({ name: 'sin-conector', main: 'i.js' })); put(path.join(ctx.paths.mcp, 'sin-conector', 'i.js'), '//');
  const snapshot = JSON.stringify(ctx.config.mcpServers);
  await assert.rejects(call('extensions.scope', { kind: 'mcp', name: 'sin-conector', project: 'tienda', add: true }), /antes en Ajustes|first in Settings/);
  assert.equal(JSON.stringify(ctx.config.mcpServers), snapshot);
  assert.equal(scopeOnly([{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }], [{ name: 'a', command: 'x' }, { name: 'b', command: 'z' }], 'a'), false);
  assert.equal(scopeOnly([{ name: 'a', command: 'x' }], [{ name: 'a', command: 'x' }, { name: 'n', command: 'x' }], 'a'), false);
  assert.equal(scopeOnly([{ name: 'a', command: 'x', env: { K: '1' } }], [{ name: 'a', command: 'x', env: { K: '2' }, enabled: true }], 'a'), false);
  assert.equal(scopeOnly([{ name: 'a', command: 'x' }], [{ name: 'a', command: 'x', enabled: true, projects: ['p'] }], 'a'), true);
});

test('las copias de skills por ámbito están junto a .activas, y desactivar o quitar la skill las borra en el momento', async () => {
  for (const name of ['sk-uno', 'sk-dos']) put(path.join(ctx.paths.skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Instrucciones de ${name}.\n---\n\n# ${name}\n`);
  saveConfig({ skills: [] });
  for (const name of ['sk-uno', 'sk-dos']) await call('extensions.toggle', { kind: 'skill', name, enabled: true });
  saveConfig({ skills: ctx.config.skills.map((s) => (s.name === 'sk-uno' ? { ...s, projects: ['tienda'] } : s)) });
  const mine = liveSkills('tienda');
  assert.equal(path.dirname(mine.plugin), path.join(ctx.paths.skills, '.ambitos'));
  assert.ok(fs.existsSync(path.join(mine.root, 'sk-uno', 'SKILL.md')));
  assert.deepEqual(fs.readdirSync(path.join(ctx.paths.skills, '.activas')).sort(), ['.claude-plugin', '.copias.json', 'skills'], 'el plugin común no lleva otros plugins dentro');
  await call('extensions.toggle', { kind: 'skill', name: 'sk-uno', enabled: false });
  assert.equal(fs.existsSync(path.join(mine.root, 'sk-uno')), false, 'desactivada: fuera de la carpeta de ámbito');
  assert.equal(fs.existsSync(mine.plugin), false, 'y la carpeta de un conjunto que nadie usa se va');
  await call('extensions.toggle', { kind: 'skill', name: 'sk-uno', enabled: true });
  saveConfig({ skills: ctx.config.skills.map((s) => (s.name === 'sk-uno' ? { ...s, projects: ['tienda'] } : s)) });
  const again = liveSkills('tienda');
  assert.ok(fs.existsSync(path.join(again.root, 'sk-uno', 'SKILL.md')));
  const { removeExtension } = await import('../src/domain/extensions/extensions.mjs');
  saveConfig(removeExtension(ctx.paths.core, ctx.config, 'skill', 'sk-uno'));
  assert.equal(fs.existsSync(path.join(again.root, 'sk-uno')), false, 'quitada de core: fuera de las carpetas de ámbito');
});

test('un projects raro escrito a mano no llega a nadie, y al guardar se normaliza o se rechaza', async () => {
  for (const projects of ['web', {}, 7, [5], null]) assert.equal(reaches({ name: 'x', projects }, 'web'), false, JSON.stringify(projects));
  assert.equal(reaches({ name: 'x', projects: [] }, 'web'), true);
  assert.equal(reaches({ name: 'x', projects: [] }, null), true);
  assert.equal(isScoped({ projects: 'web' }), true);
  ctx.config = { ...ctx.config, mcpServers: [...ctx.config.mcpServers, { ...conn('raro'), projects: 'tienda' }] };
  assert.ok(!keysOf('tienda').includes('raro') && !keysOf(null).includes('raro'));
  saveConfig({ language: ctx.config.language });
  assert.deepEqual({ enabled: entry('raro').enabled, projects: entry('raro').projects }, { enabled: false, projects: undefined }, 'apagado: no llega a nadie');
  assert.throws(() => saveConfig({ mcpServers: [...ctx.config.mcpServers, { ...conn('raro2'), projects: 'web' }] }));
  assert.throws(() => saveConfig({ skills: [{ name: 'sk-x', enabled: true, projects: [5] }] }));
  saveConfig({ mcpServers: ctx.config.mcpServers.filter((s) => s.name !== 'raro') });
});

test('añadir algo desactivado que tenía ámbito lo deja solo para este proyecto (y el diálogo avisa)', async () => {
  scoped([conn('reservado', ['q', 'r'], false)]);
  await call('extensions.scope', { kind: 'connector', name: 'reservado', project: 'tienda', add: true });
  assert.deepEqual({ enabled: entry('reservado').enabled, projects: entry('reservado').projects }, { enabled: true, projects: ['tienda'] });
  const ui = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'ui', 'components', 'project-extensions.jsx'), 'utf8');
  assert.match(ui, /projects\.ext\.reserved/);
});

test('una mejora aprobada conserva enabled y projects; sin ámbito se activa como siempre', async () => {
  const X = await import('../src/domain/extensions/extensions.mjs');
  const { translate } = await import('../src/shared/i18n.mjs');
  const tr = (k, v) => translate('es', k, v);
  const core = ctx.paths.core;
  put(path.join(ctx.paths.skills, 'mejorable', 'SKILL.md'), '---\nname: mejorable\ndescription: Una skill.\n---\n');
  const approve = async (config) => {
    const r = X.draftExtension(core, { kind: 'skill', name: 'mejorable', description: 'Mejor.', update: 'mejorable' });
    let asked = X.requestActivation(core, r, { tr });
    if (asked.status === 'asking') asked = X.requestActivation(core, X.allowDraft(core, asked, { tr }), { tr });
    return X.activateRequest(core, config, asked, { tr });
  };
  const plain = await approve({ skills: [{ name: 'mejorable', enabled: false, source: 'usuario' }] });
  assert.deepEqual({ on: plain.patch.skills[0].enabled, off: plain.keptOff }, { on: true, off: false }, 'sin ámbito: como hoy');
  const scopedOn = await approve({ skills: [{ name: 'mejorable', enabled: true, source: 'usuario', projects: ['tienda'] }] });
  assert.deepEqual({ on: scopedOn.patch.skills[0].enabled, p: scopedOn.patch.skills[0].projects }, { on: true, p: ['tienda'] });
  const removed = await approve({ skills: [{ name: 'mejorable', enabled: false, source: 'usuario', scopeOff: true }] });
  assert.deepEqual({ on: removed.patch.skills[0].enabled, off: removed.keptOff }, { on: false, off: true });
});
