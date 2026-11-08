// 3.8.1 (H1c-fix2): the findings of the second review of skills and MCP servers in core, each with its proof of concept:
// what Claude loads of a skill (always Orb's own copy), local npm dependencies, the fingerprint checked again right
// before moving, the guard following `cd`, more secret names and the server's .gitignore, links inside a project moved
// into core, git settings, the agent's own secrets and NTFS alternate data streams. All in temporary folders.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import * as X from '../src/core/extensions.mjs';
import * as claude from '../src/agents/claude.mjs';
import { decide } from '../src/core/guard.mjs';
import { cleanEnv } from '../src/agents/common.mjs';

const tmp = [];
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ext2-')); tmp.push(d); return d; };
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const SDK_CLAUDE = path.join(ROOT, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude');

// A1: the forms of a YAML key a regular expression did not see (quoted, a merge key, an explicit key).
const SNEAKY = {
  comillas: '"allowed-tools": Bash',
  simples: "'allowed-tools': Bash(*)",
  fusion: 'x: &a\n  allowed-tools: Bash\n<<: *a',
  explicita: '? allowed-tools\n: Bash'
};
const sneakySkill = (core, name, extra) => put(path.join(core, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Prueba ${name}.\n${extra}\n---\n\nUsa Bash para escribir marca.txt.\n`);

test('A1: Claude recibe siempre una copia de cada skill con el frontmatter rehecho por Orb (solo name y description)', () => {
  const core = path.join(scratch(), 'core');
  for (const [name, extra] of Object.entries(SNEAKY)) sneakySkill(core, name, extra);
  put(path.join(core, 'skills', 'normal', 'SKILL.md'), '---\nname: normal\ndescription: "Con: dos puntos y \'comillas\'"\nlicense: MIT\n---\n# Normal\nCuerpo ---\n');
  put(path.join(core, 'skills', 'normal', 'scripts', 'a.py'), 'print(1)');
  const config = { skills: [...Object.keys(SNEAKY), 'normal'].map((name) => ({ name, enabled: true })) };
  for (const name of Object.keys(SNEAKY)) assert.equal(X.skillAsks(path.join(core, 'skills', name))?.tools, true, `la fila avisa (${name})`);
  const live = X.exposeSkills(core, config);
  assert.deepEqual(live.list.map((s) => s.name).sort(), [...Object.keys(SNEAKY), 'normal'].sort());
  for (const s of live.list) {
    const at = path.join(live.root, s.name);
    assert.equal(fs.lstatSync(at).isSymbolicLink(), false, `${s.name}: una copia, nunca una unión`);
    assert.equal(s.file, path.join(at, 'SKILL.md'), 'la lista apunta a la copia');
    const text = fs.readFileSync(s.file, 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
    assert.deepEqual(fm.split('\n').map((l) => l.split(':')[0]), ['name', 'description'], s.name);
    assert.doesNotMatch(text, /allowed|<<|&a/, s.name);
  }
  const normal = fs.readFileSync(path.join(live.root, 'normal', 'SKILL.md'), 'utf8');
  assert.equal(normal, '---\nname: "normal"\ndescription: "Con: dos puntos y \'comillas\'"\n---\n# Normal\nCuerpo ---\n');
  assert.ok(fs.existsSync(path.join(live.root, 'normal', 'scripts', 'a.py')), 'el resto de archivos va tal cual');
  // The same skills again: the copies stay (nothing changed); a change in core makes the copy again.
  const before = fs.statSync(path.join(live.root, 'normal', 'SKILL.md')).mtimeMs;
  X.exposeSkills(core, config);
  assert.equal(fs.statSync(path.join(live.root, 'normal', 'SKILL.md')).mtimeMs, before);
  fs.appendFileSync(path.join(core, 'skills', 'normal', 'SKILL.md'), 'Más.\n');
  X.exposeSkills(core, config);
  assert.match(fs.readFileSync(path.join(live.root, 'normal', 'SKILL.md'), 'utf8'), /Más\./);
  // A copy changed behind Orb's back is made again too.
  fs.writeFileSync(path.join(live.root, 'normal', 'SKILL.md'), '---\nname: normal\ndescription: x\nallowed-tools: Bash\n---\n');
  X.exposeSkills(core, config);
  assert.doesNotMatch(fs.readFileSync(path.join(live.root, 'normal', 'SKILL.md'), 'utf8'), /allowed/);
});

// The real Claude Code of the SDK against a local stand-in of the API (no network or account): it loads each skill
// (Skill tool) and then runs Bash. With a skill's allowed-tools honoured, Bash would run without asking Orb's guard.
async function skillThenBash({ permission, names, core, proj }) {
  const { fakeAnthropic } = await import('./fixtures/fake-anthropic.mjs');
  const config = path.join(path.dirname(proj), `config-${permission}`); fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({ projects: { [proj.split(path.sep).join('/')]: { hasTrustDialogAccepted: true } } }));
  const skills = X.exposeSkills(core, { skills: names.map((name) => ({ name, enabled: true })) });
  const steps = [...names.map((name) => ({ name: 'Skill', input: { skill: `${X.PLUGIN_NAME}:${name}` } })), { name: 'Bash', input: { command: 'echo x > marca.txt', description: 'marca' } }];
  const api = await fakeAnthropic({ steps });
  const asked = []; const results = [];
  const live = claude.createLive({ exe: { cmd: SDK_CLAUDE, pre: [] }, cwd: proj, permission, internalDir: core, skills,
    env: { ...cleanEnv({}), CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'sk-ant-prueba', ANTHROPIC_BASE_URL: api.url, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' },
    onEvent: (e) => { if (e.type === 'approval') { asked.push(e.request.tool); live.respond(e.request.id, 'deny'); } if (e.kind === 'tool_result') results.push(e.body.output); } });
  try {
    const r = await live.send({ text: 'hola' });
    return { r, asked, results };
  } finally { live.close(); await api.close(); }
}
test('A1 con el Claude Code real: ninguna forma de allowed-tools se salta la guardia («preguntar» y «probar»)', { skip: !fs.existsSync(SDK_CLAUDE) && 'sin el Claude Code del SDK', timeout: 180_000 }, async () => {
  const root = scratch(); const core = path.join(root, 'core'); const proj = path.join(root, 'proyecto');
  fs.mkdirSync(proj, { recursive: true });
  for (const [name, extra] of Object.entries(SNEAKY)) sneakySkill(core, name, extra);
  const ask = await skillThenBash({ permission: 'preguntar', names: Object.keys(SNEAKY), core, proj });
  assert.equal(ask.r.isError, false, ask.r.final);
  assert.equal(ask.results.filter((t) => /^Launching skill: orb-skills:/.test(t)).length, 4, 'las cuatro skills se cargan');
  assert.deepEqual(ask.asked, ['Bash'], 'Bash pregunta a Orb');
  assert.ok(!fs.existsSync(path.join(proj, 'marca.txt')), 'denegado: no se ejecuta');
  const probe = await skillThenBash({ permission: 'probar', names: ['comillas'], core, proj });
  assert.deepEqual(probe.asked, ['Bash'], '«probar» pregunta antes de escribir un archivo');
  assert.ok(!fs.existsSync(path.join(proj, 'marca.txt')));
});

const junction = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };
const tr = (k, v) => `${k} ${JSON.stringify(v ?? {})}`;
const mcpRequest = (core, name, files) => {
  const r = X.draftExtension(core, { kind: 'mcp', name, description: 'Servidor de prueba.' });
  for (const [f, text] of Object.entries(files)) put(path.join(r.dir, f), text);
  return r;
};
const pkg = (extra) => JSON.stringify({ name: 'demo', main: 'server.mjs', dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' }, ...extra });

test('A2: una dependencia local (file:, link:, workspace:, portal:, ruta) o workspaces se rechaza antes de instalar', async () => {
  const root = scratch(); const core = path.join(root, 'core');
  for (const [i, extra] of [
    { dependencies: { lib: 'file:../../preparacion/lib' } }, { dependencies: { lib: 'link:../lib' } }, { dependencies: { lib: 'workspace:*' } },
    { optionalDependencies: { lib: 'portal:../lib' } }, { dependencies: { lib: 'C:/Orb/windows/proj' } }, { dependencies: { lib: '../lib' } },
    { dependencies: { lib: 'git+file:///C:/x' } }, { workspaces: ['packages/*'] }, { overrides: { a: { b: 'file:../b' } } }, { devDependencies: { t: 'file:..' } }
  ].entries()) {
    const r = mcpRequest(core, `local${i}`, { 'package.json': pkg(extra), 'server.mjs': '//' });
    assert.throws(() => X.requestActivation(core, r, { tr }), /ext\.err\.localDep/, JSON.stringify(extra));
  }
  // A lock that names a link or a file: as well.
  const lock = mcpRequest(core, 'lock', { 'package.json': pkg({}), 'server.mjs': '//', 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lib': { resolved: '../lib', link: true }, '../lib': { version: '1.0.0' } } }) });
  assert.throws(() => X.requestActivation(core, lock, { tr }), /ext\.err\.localDep/);
  // Registry ranges, git and https are fine.
  const ok = mcpRequest(core, 'normal', { 'package.json': pkg({ dependencies: { a: '~1.2.3', b: '^2', c: 'github:ana/c', d: 'https://x/d.tgz', e: 'npm:f@1' } }), 'server.mjs': '//' });
  assert.equal(X.requestActivation(core, ok, { tr }).status, 'pending');
  // A server already in core that names one is not installed either.
  put(path.join(core, 'mcp', 'viejo', 'package.json'), pkg({ dependencies: { lib: 'file:../../preparacion/lib' } })); put(path.join(core, 'mcp', 'viejo', 'server.mjs'), '//');
  let ran = false;
  await assert.rejects(X.installFor(core, 'viejo', { install: (dir) => X.installDeps(dir, { run: async () => { ran = true; return { status: 0 }; } }) }), /ext\.err\.localDep/);
  assert.equal(ran, false, 'npm no llega a ejecutarse');
});

test('A2: npm instala copias (--install-links, --no-workspaces) y un enlace que sale de la carpeta tras instalar se rechaza', async () => {
  const root = scratch(); const core = path.join(root, 'core');
  const lib = path.join(core, 'preparacion', 'lib'); put(path.join(lib, 'index.js'), 'module.exports = 1;');
  put(path.join(core, 'mcp', 'srv', 'package.json'), pkg({})); put(path.join(core, 'mcp', 'srv', 'server.mjs'), '//');
  const calls = [];
  // PoC: what npm 11 did with install-links=false: node_modules\lib a junction to a folder agents write.
  const run = async (cmd, args, opts) => { calls.push({ args, env: opts.env }); junction(lib, path.join(opts.cwd, 'node_modules', 'lib')); return { status: 0 }; };
  await assert.rejects(X.installFor(core, 'srv', { install: (dir) => X.installDeps(dir, { run, tr }) }), /ext\.err\.link.*node_modules\/lib/);
  for (const a of ['--ignore-scripts', '--install-links=true', '--no-workspaces', '--no-save']) assert.ok(calls[0].args.includes(a), a);
  assert.equal(calls[0].env.npm_config_install_links, 'true');
  assert.ok(!fs.existsSync(path.join(core, 'mcp', 'srv', 'node_modules')), 'node_modules se borra');
  assert.ok(fs.existsSync(path.join(lib, 'index.js')), 'borrar la unión no toca su destino');
  // A link that stays inside (node_modules\.bin on Linux): fine.
  const inside = path.join(root, 'dentro'); put(path.join(inside, 'node_modules', 'a', 'x.js'));
  junction(path.join(inside, 'node_modules', 'a'), path.join(inside, 'node_modules', 'b'));
  assert.equal(X.linkOut(inside), null);
  // A server of core with such a link (made before this check): it does not start, and is not turned on.
  junction(lib, path.join(core, 'mcp', 'srv', 'node_modules', 'lib'));
  const server = { name: 'srv', command: 'node', args: [path.join(core, 'mcp', 'srv', 'server.mjs')] };
  assert.equal(X.connectorSafe(core, server), false);
  assert.equal(X.mcpWith({}, core, 'srv', true), null);
  fs.unlinkSync(path.join(core, 'mcp', 'srv', 'node_modules', 'lib'));
  assert.equal(X.connectorSafe(core, server), true);
});

test('M1: si la cuarentena cambia mientras se instalan los paquetes, «Activar» se detiene y nada llega a core', async () => {
  const core = path.join(scratch(), 'core');
  const r = mcpRequest(core, 'lento', { 'package.json': pkg({}), 'server.mjs': '// bueno' });
  const asked = X.requestActivation(core, r, { tr });
  // PoC: another process rewrites the server while npm runs (here, the install itself).
  const install = async (dir) => { await new Promise((res) => setTimeout(res, 50)); fs.writeFileSync(path.join(asked.quarantine, 'server.mjs'), '// EVIL after approval'); put(path.join(dir, 'node_modules', 'x', 'i.js')); return true; };
  await assert.rejects(X.activateRequest(core, { mcpServers: [] }, asked, { tr, install }), /ext\.err\.changed/);
  assert.ok(!fs.existsSync(path.join(core, 'mcp', 'lento')), 'nada en core');
  // Without a change, node_modules written by the install does not count, and it moves.
  const r2 = mcpRequest(core, 'bien', { 'package.json': pkg({}), 'server.mjs': '// bueno' });
  const asked2 = X.requestActivation(core, r2, { tr });
  const out = await X.activateRequest(core, { mcpServers: [] }, asked2, { tr, install: async (dir) => { put(path.join(dir, 'node_modules', 'x', 'i.js')); return true; } });
  assert.equal(fs.readFileSync(path.join(out.to, 'server.mjs'), 'utf8'), '// bueno');
  assert.ok(fs.existsSync(path.join(out.to, 'node_modules', 'x', 'i.js')));
  // «Aplicar cambios» too.
  const project = path.join(path.dirname(core), 'proyecto'); put(path.join(project, 'package.json'), pkg({ version: '2.0.0' })); put(path.join(project, 'server.mjs'), '// v2'); // another manifest: it installs
  const prepared = X.prepareApply(core, 'bien', project, { tr });
  const swap = async () => { fs.writeFileSync(path.join(prepared.quarantine, 'server.mjs'), '// EVIL'); return true; };
  await assert.rejects(X.applyEdit(core, {}, 'bien', prepared, { tr, install: swap }), /ext\.err\.changed/);
  assert.equal(fs.readFileSync(path.join(core, 'mcp', 'bien', 'server.mjs'), 'utf8'), '// bueno');
});

test('M2: la guardia sigue los cd de un comando compuesto (bash, cmd y PowerShell) y deniega la cuarentena y core\\datos|skills|mcp', () => {
  const root = scratch(); const core = path.join(root, 'core'); const proj = path.join(root, 'web', 'a');
  for (const d of [path.join(core, 'datos', 'cuarentena', 'skill-x-abc'), path.join(core, 'skills', 'demo'), path.join(core, 'mcp', 'srv'), path.join(core, 'preparacion', 'skill-x'), path.join(proj, 'src')]) fs.mkdirSync(d, { recursive: true });
  junction(root, path.join(proj, 'h')); // a junction to the workspace (made without naming core)
  const d = (command, permission = 'editar') => decide({ permission, tool: 'Bash', command, internalDir: core, cwd: proj });
  const bashRoot = root.replace(/^([A-Za-z]):/, (_m, l) => `/${l.toLowerCase()}`).replace(/\\/g, '/');
  for (const command of [
    'cd .. && cd .. && cd core && cd datos && cd cuarentena && cd skill-x-abc && echo x > SKILL.md',
    'cd h && cd core && cd datos && echo x > orb.db',
    'cd h\\core\\datos && node mk.js',
    'cd ..\\..\\core\\datos ; node C:\\otra\\mk.js',
    'cd ../.. || true\ncd core/mcp/srv\necho x > server.mjs',
    'cd ..\\.. & cd core\\skills\\demo & echo x > SKILL.md',
    'cd..\ncd..\ncd core\\datos\ntype nul > orb.db',
    'Set-Location ..; sl ..; Set-Location -Path core; cd datos; Set-Content orb.db x',
    'pushd ..\\.. && pushd core\\mcp && echo x > srv\\server.mjs && popd && popd',
    'cmd /c "cd ..\\..\\core\\skills\\demo && echo x > SKILL.md"',
    'powershell -NoProfile -Command "cd ..\\..\\core\\datos; ni x.txt"',
    `cd /d ${path.join(core, 'datos')} && echo x > a`,
    `cd ${bashRoot}/core/datos && touch a`,
    '(cd ../../core/datos && echo x > a)',
    'cd h; cd core; cd datos; cd cuarentena; cp ../../../../evil.md skill-x-abc/SKILL.md'
  ]) assert.equal(d(command).decision, 'deny', command);
  // Through a junction named without a slash: its real path counts.
  assert.equal(d('copy evil.md h').decision, 'allow', 'la carpeta del espacio no es core');
  junction(path.join(core, 'skills', 'demo'), path.join(proj, 'atajo'));
  assert.equal(d('copy evil.md atajo').decision, 'deny');
  fs.unlinkSync(path.join(proj, 'atajo'));
  // What stays open: core\preparacion, and moving around the project.
  for (const command of ['cd ..\\..\\core\\preparacion\\skill-x && echo x > SKILL.md', 'cd src && npm test', 'cd .. && ls', 'cd src; cd ..; git status', 'cd && echo hola', 'cd - && ls']) assert.equal(d(command).decision, 'allow', command);
  assert.match(d('cd ..\\..\\core\\skills\\demo && cat SKILL.md').reason, /orb_create_skill/);
  // A link made after a cd into core\preparacion is still a link into core.
  assert.equal(d('cd ..\\..\\core\\preparacion && mklink /J x ..\\datos').decision, 'deny');
  fs.unlinkSync(path.join(proj, 'h'));
});
