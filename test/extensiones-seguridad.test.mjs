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
import { moveIntoCore } from '../src/core/core-folder.mjs';
import { cleanEnv } from '../src/platform/proc.mjs';

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

test('M2: la guardia sigue los cd de un comando compuesto (bash, cmd y PowerShell) y deniega la cuarentena y core\\datos|skills|mcp', { skip: process.platform !== 'win32' && 'órdenes y rutas de Windows (cmd, \\, unidades)' }, () => {
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

test('M3: más nombres de secretos (Gmail, AWS, WhatsApp, Playwright…) y lo que el .gitignore del servidor deja fuera nunca sale de core', () => {
  const root = scratch(); const core = path.join(root, 'core');
  const secret = X.secretTest(root);
  for (const name of ['gcp-oauth.keys.json', '.git-credentials', 'credentials', 'auth.json', 'oauth.json', 'api_key.txt', 'apikey', 'key.json', 'tokens.json.bak', 'token.json.old', 'cookies.txt', 'storage_state.json', 'session.json', 'messages.db', 'store.sqlite3', '.env.local', 'client_secret.json']) assert.equal(secret(name, name, false), true, name);
  for (const [name, rel] of [['.wwebjs_auth', '.wwebjs_auth'], ['auth_info_baileys', 'auth_info_baileys'], ['store', 'store'], ['store', 'whatsapp-bridge/store'], ['session', 'session'], ['tokens', 'tokens']]) assert.equal(secret(name, rel, true), true, rel);
  for (const name of ['api_key.js', 'cookies.ts', 'author.json', 'tokenizer.js', 'keyboard.json', 'index.js', 'package.json', 'README.md']) assert.equal(secret(name, `src/${name}`, false), false, name);
  for (const rel of ['src/store', 'src/auth', 'lib/session']) assert.equal(secret(rel.split('/').pop(), rel, true), false, `${rel}: código`);
  // A server whose keys are only under those names now holds keys (it asks before an agent improves it).
  const dir = path.join(core, 'mcp', 'gmail');
  put(path.join(dir, 'package.json'), pkg({})); put(path.join(dir, 'server.mjs'), '//'); put(path.join(dir, 'gcp-oauth.keys.json'), '{"k":1}');
  assert.equal(X.holdsKeys(core, {}, 'gmail'), true);
  fs.rmSync(path.join(dir, 'gcp-oauth.keys.json'));
  assert.equal(X.holdsKeys(core, {}, 'gmail'), false);
  // Its .gitignore: what it leaves out of git counts as private (a private log, the accounts), build output aside.
  put(path.join(dir, '.gitignore'), '# privado\nBITACORA.md\naccounts.json\n*.log\n/privado/\n!guardar.log\ndist/\n');
  put(path.join(dir, 'dist', 'index.js'), '// build');
  assert.equal(X.holdsKeys(core, {}, 'gmail'), false, 'la carpeta de compilación no cuenta');
  put(path.join(dir, 'BITACORA.md'), 'privada'); put(path.join(dir, 'accounts.json'), '{"ana":"a@x"}'); put(path.join(dir, 'privado', 'nota.txt'), 'p');
  put(path.join(dir, 'logs', 'run.log'), 'l'); put(path.join(dir, 'guardar.log'), 'g'); put(path.join(dir, 'src', 'sub', '.gitignore'), 'local.json\n'); put(path.join(dir, 'src', 'sub', 'local.json'), '{}');
  put(path.join(dir, 'src', 'sub', 'codigo.js'), '//');
  assert.equal(X.holdsKeys(core, {}, 'gmail'), true, 'lo ignorado cuenta');
  const r = X.allowDraft(core, X.draftExtension(core, { kind: 'mcp', name: 'gmail', description: 'Mejor', update: 'gmail', config: {} }));
  const project = X.editInProject(path.join(root, 'espacio'), core, 'gmail', 'windows');
  for (const at of [r.dir, project]) {
    for (const f of ['BITACORA.md', 'accounts.json', 'privado', path.join('logs', 'run.log'), path.join('src', 'sub', 'local.json')]) assert.ok(!fs.existsSync(path.join(at, f)), `${at}: ${f}`);
    for (const f of ['server.mjs', 'guardar.log', path.join('src', 'sub', 'codigo.js'), '.gitignore']) assert.ok(fs.existsSync(path.join(at, f)), `${at}: ${f}`);
  }
  // The new version keeps core's ignored files (where it has none) and its secrets.
  fs.writeFileSync(path.join(r.dir, 'server.mjs'), '// v2');
  const out = X.activateRequest(core, { mcpServers: [] }, X.requestActivation(core, r, { tr }), { tr, install: async () => false });
  return out.then((o) => {
    assert.equal(fs.readFileSync(path.join(o.to, 'server.mjs'), 'utf8'), '// v2');
    assert.equal(fs.readFileSync(path.join(o.to, 'accounts.json'), 'utf8'), '{"ana":"a@x"}');
    assert.ok(fs.existsSync(path.join(o.to, 'BITACORA.md')) && fs.existsSync(path.join(o.to, 'privado', 'nota.txt')));
  });
});

test('B1: «Editar en un proyecto» no copia credenciales de .git (remotos con token, cabeceras, FETCH_HEAD)', () => {
  const root = scratch(); const core = path.join(root, 'core');
  const dir = path.join(core, 'mcp', 'repo');
  put(path.join(dir, 'package.json'), pkg({})); put(path.join(dir, 'server.mjs'), '//');
  put(path.join(dir, '.git', 'config'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://ana:ghp_secreto123@github.com/ana/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic c2VjcmV0bw==\n[credential]\n\thelper = store\n[user]\n\tname = Ana\n');
  put(path.join(dir, '.git', 'FETCH_HEAD'), "abc branch 'main' of https://ana:ghp_secreto123@github.com/ana/repo\n");
  put(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const project = X.editInProject(path.join(root, 'espacio'), core, 'repo', 'windows');
  const config = fs.readFileSync(path.join(project, '.git', 'config'), 'utf8');
  assert.doesNotMatch(config, /ghp_secreto123|extraheader|c2VjcmV0bw|\[credential/);
  assert.match(config, /url = https:\/\/github\.com\/ana\/repo\.git/);
  assert.match(config, /name = Ana/);
  assert.ok(!fs.existsSync(path.join(project, '.git', 'FETCH_HEAD')));
  assert.ok(fs.existsSync(path.join(project, '.git', 'HEAD')));
});

test('B2: la versión de un agente no puede cambiar las claves de core (las suyas se quitan y quedan las de core)', async () => {
  const root = scratch(); const core = path.join(root, 'core');
  const dir = path.join(core, 'mcp', 'correo');
  put(path.join(dir, 'package.json'), pkg({})); put(path.join(dir, 'server.mjs'), '//'); put(path.join(dir, 'tokens', 'dani.json'), '{"cuenta":"dani"}');
  const r = X.allowDraft(core, X.draftExtension(core, { kind: 'mcp', name: 'correo', description: 'Mejor', update: 'correo', config: {} }));
  put(path.join(r.dir, 'tokens', 'dani.json'), '{"cuenta":"agente"}'); put(path.join(r.dir, 'credentials', 'client_secret.json'), '{"app":"agente"}');
  put(path.join(r.dir, 'gcp-oauth.keys.json'), '{"app":"agente"}');
  const asked = X.requestActivation(core, r, { tr });
  assert.ok(!asked.files.some((f) => /tokens|credentials|gcp-oauth/.test(f)), 'no van en lo que se aprueba');
  assert.deepEqual(asked.kept, ['credentials', 'gcp-oauth.keys.json', 'tokens']);
  assert.deepEqual(X.listExtensions(core, {}, { requests: [asked] }).pending[0].kept, asked.kept, 'el diálogo lo dice');
  const out = await X.activateRequest(core, { mcpServers: [] }, asked, { tr, install: async () => false });
  assert.equal(fs.readFileSync(path.join(out.to, 'tokens', 'dani.json'), 'utf8'), '{"cuenta":"dani"}');
  assert.ok(!fs.existsSync(path.join(out.to, 'credentials')) && !fs.existsSync(path.join(out.to, 'gcp-oauth.keys.json')));
  // «Aplicar cambios» from a project: the same.
  const project = path.join(root, 'proyecto'); put(path.join(project, 'package.json'), pkg({})); put(path.join(project, 'server.mjs'), '// v3'); put(path.join(project, 'tokens', 'dani.json'), '{"cuenta":"otra"}');
  const done = await X.applyEdit(core, {}, 'correo', X.prepareApply(core, 'correo', project, { tr }), { tr, install: async () => false });
  assert.equal(fs.readFileSync(path.join(done.to, 'tokens', 'dani.json'), 'utf8'), '{"cuenta":"dani"}');
});

test('B4: los flujos alternativos de NTFS no se copian (solo el contenido que se ve y entra en la huella)', { skip: process.platform !== 'win32' && 'solo NTFS' }, () => {
  const root = scratch(); const core = path.join(root, 'core');
  const r = X.draftExtension(core, { kind: 'skill', name: 'flujos', description: 'Prueba.' });
  fs.writeFileSync(`${path.join(r.dir, 'SKILL.md')}:oculto`, 'contenido invisible');
  assert.equal(fs.readFileSync(`${path.join(r.dir, 'SKILL.md')}:oculto`, 'utf8'), 'contenido invisible');
  const asked = X.requestActivation(core, r, { tr });
  assert.ok(!fs.existsSync(`${path.join(asked.quarantine, 'SKILL.md')}:oculto`), 'el flujo no llega a la cuarentena');
  assert.equal(fs.readFileSync(path.join(asked.quarantine, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(r.dir, 'SKILL.md'), 'utf8'));
});

test('M4: «Mover a core» rechaza un proyecto con un enlace o una unión que sale de él (también en node_modules)', () => {
  const root = scratch(); const home = path.join(root, 'Orb');
  fs.mkdirSync(path.join(home, 'core', 'mcp'), { recursive: true });
  const proj = path.join(home, 'windows', 'correo-mcp'); put(path.join(proj, 'package.json'), pkg({})); put(path.join(proj, 'server.mjs'), '//');
  const other = path.join(home, 'windows', 'otro'); put(path.join(other, 'lib.js'), '//');
  junction(other, path.join(proj, 'node_modules', 'lib'));
  assert.throws(() => moveIntoCore(home, proj), /enlace a otra carpeta \(node_modules\/lib\)/);
  fs.unlinkSync(path.join(proj, 'node_modules', 'lib'));
  junction(other, path.join(proj, 'src'));
  assert.throws(() => moveIntoCore(home, proj), /enlace a otra carpeta \(src\)/);
  assert.ok(fs.existsSync(path.join(proj, 'server.mjs')) && !fs.existsSync(path.join(home, 'core', 'mcp', 'correo-mcp')), 'no se ha movido nada');
  fs.unlinkSync(path.join(proj, 'src'));
});
