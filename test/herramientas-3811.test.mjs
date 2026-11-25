// 3.8.11, «Herramientas» of the Agents page: what Orb may install (a fixed list), that nothing installs by itself,
// that only this PC's window can ask, that each install is written to Activity, and the version / suggestion logic.
// Nothing here installs anything: the PowerShell that would run is a fake.
import { tempHome } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WINGET_IDS, wingetId, wingetInstall, wingetUpgrade, EXTRA_ITEMS, parseUpgrades, suggestionsFor } from '../src/engine/host/tool-catalog.mjs';
import { METHODS, REMOTE_METHODS, allowed, principalOf } from '../src/domain/security/permissions.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

tempHome();
const installer = await import('../src/engine/host/installer.mjs');
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const EXPECTED = {
  uv: 'astral-sh.uv', rg: 'BurntSushi.ripgrep.MSVC', pwsh: 'Microsoft.PowerShell', jq: 'jqlang.jq', gitLfs: 'GitHub.GitLFS',
  java: 'Microsoft.OpenJDK.21', androidSdk: 'Google.AndroidStudio', rustup: 'Rustlang.Rustup', go: 'GoLang.Go', dotnet: 'Microsoft.DotNet.SDK.8',
  bun: 'Oven-sh.Bun', docker: 'Docker.DockerDesktop', buildTools: 'Microsoft.VisualStudio.2022.BuildTools'
};

test('the winget ids are a fixed list, and a key or id outside it is refused', () => {
  for (const [k, id] of Object.entries(EXPECTED)) assert.equal(WINGET_IDS[k], id);
  assert.throws(() => wingetInstall('evil'), /not an installable tool/);
  assert.throws(() => wingetInstall('Git.Git; calc'), /not an installable tool/);
  assert.throws(() => wingetId('__proto__'), /not an installable tool/);
  assert.throws(() => wingetUpgrade('constructor'), /not an installable tool/);
});

test('every install and upgrade text is made of the list: exact, from winget, with the hash check left on', () => {
  for (const key of Object.keys(WINGET_IDS)) {
    for (const text of [wingetInstall(key), wingetUpgrade(key)]) {
      assert.match(text, new RegExp(`^winget (install|upgrade) --id ${WINGET_IDS[key].replace(/\./g, '\\.')} -e --source winget `));
      assert.match(text, /--accept-package-agreements --accept-source-agreements/);
      assert.doesNotMatch(text, /ignore-security-hash|--force|[;&|`$]/);
    }
  }
  const src = read('src/engine/host/installer.mjs') + read('src/engine/host/tool-catalog.mjs');
  assert.doesNotMatch(src, /ignore-security-hash/);
  assert.doesNotMatch(src, /shell:\s*true/);
});

test('the catalog is the only source of install text: ids typed elsewhere in the engine do not exist', () => {
  const plan = installer.plan(['uv', 'rg', 'x; calc', '$(evil)', 'Git.Git']).map((i) => i.id);
  assert.deepEqual(plan, ['uv', 'rg']);
  const script = installer.buildScript(['uv', 'rg', 'pnpm', 'x; calc'], 'C:\\t\\log.txt');
  assert.match(script, /winget install --id astral-sh\.uv /);
  assert.match(script, /winget install --id BurntSushi\.ripgrep\.MSVC /);
  assert.match(script, /corepack enable pnpm --install-directory/);
  assert.doesNotMatch(script, /calc/);
  // pnpm needs Node: its step comes with a check for Node first
  assert.ok(script.indexOf("Step 'node'") < script.indexOf("Step 'pnpm'"));
  assert.match(installer.buildScript(['playwright'], 'C:\\t\\log.txt'), /npx --yes playwright install/);
  assert.match(installer.buildScript(['buildTools'], 'C:\\t\\log.txt'), /--override '--quiet --wait --norestart --add Microsoft\.VisualStudio\.Workload\.VCTools --includeRecommended'/);
});

test('update mode builds winget upgrade for winget tools only', () => {
  const script = installer.buildScript(['git', 'pnpm', 'claude'], 'C:\\t\\log.txt', { update: true });
  assert.match(script, /winget upgrade --id Git\.Git /);
  assert.doesNotMatch(script, /corepack|irm |winget install/);
});

test('each tool of the list is told with a line of what it is for, in es and en', () => {
  for (const x of EXTRA_ITEMS) {
    for (const l of [es, en]) assert.ok(l[`agents.tool.${x.id}`], `agents.tool.${x.id}`);
    for (const l of [es, en]) assert.ok(l[`msg.installer.why.${x.id}`], `why ${x.id}`);
  }
  for (const k of ['agents.tools.installRec', 'agents.suggest.text']) for (const l of [es, en]) assert.ok(l[k], k);
});

// ---- nothing installs without the button, and only from this PC's window
test('installer.start, updates and suggest are for this PC only: not a phone, not the web, not an agent', () => {
  for (const m of ['installer.start', 'installer.updates', 'installer.suggest', 'installer.check', 'installer.progress']) {
    assert.equal(METHODS[m], 'pc', m);
    assert.ok(!REMOTE_METHODS.has(m), m);
    assert.equal(allowed(principalOf({ device: { kind: 'phone', id: 'p1' } }), m), false);
    assert.equal(allowed(principalOf({ device: { kind: 'web', id: 'w1' } }), m), false);
    assert.equal(allowed({ channel: 'agent', agent: 'claude', task: 1, conversation: 'x' }, m), false);
    assert.equal(allowed(principalOf(), m), true);
  }
});

test('the window asks for an install only from a button: no effect starts one on its own', () => {
  const ui = read('src/ui/views/agents-tools.jsx');
  const page = read('src/ui/views/agents.jsx');
  assert.equal([...(ui + page).matchAll(/installer\.start/g)].length, 2, 'one in the page (button handler) and one in the project suggestion button');
  // the page's only call sits inside the install(...) the buttons call
  assert.match(page, /install: async \(ids, opts\) => \{ const p = await act\(call\('installer\.start'/);
  // the newer-version check runs when the block is opened by the user, never at load
  assert.match(ui, /const askedUpgrades = userOpen === true;/);
  assert.doesNotMatch(page, /checkUpgrades\(/);
  const mount = ui.slice(ui.indexOf('export function ToolSuggestions'));
  assert.doesNotMatch(mount.slice(0, mount.indexOf('const install = ')), /installer\.start/, 'suggestions only look; the button installs');
});

// ---- running: the fake PowerShell
function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
    calls.push({ cmd, args, opts, child });
    return child;
  };
  fn.calls = calls;
  return fn;
}
const logOf = (call) => /\$log = '([^']+)'/.exec(Buffer.from(call.args.at(-1), 'base64').toString('utf16le'))[1];

test('an install runs hidden, without a shell, with the script as its encoded argument, and writes each step to Activity', async () => {
  const spawnFn = fakeSpawn();
  const events = [];
  const emitted = [];
  const run = installer.start(['uv'], (e, p) => emitted.push([e, p]), { spawnFn, onEvent: (e) => events.push(e) });
  assert.deepEqual(run.steps.map((s) => [s.id, s.state]), [['uv', 'pendiente']]);
  const [call] = spawnFn.calls;
  assert.match(call.cmd, /powershell\.exe$/i);
  assert.deepEqual(call.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  assert.ok(!call.opts.shell, 'no shell');
  assert.equal(call.opts.windowsHide, true);
  const script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /winget install --id astral-sh\.uv /);
  // the script reports its progress in the log: the engine tells Activity at the start and at the end
  const log = logOf(call);
  fs.appendFileSync(log, 'INICIO uv\n');
  await new Promise((r) => setTimeout(r, 1700));
  fs.appendFileSync(log, 'OK uv\nFIN\n');
  call.child.emit('exit', 0);
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepEqual(events.map((e) => [e.id, e.state]), [['uv', 'instalando'], ['uv', 'hecho']]);
  assert.ok(emitted.some(([e]) => e === 'installer:progress'));
});

test('a failure and a step cut short are written as errors', async () => {
  const spawnFn = fakeSpawn();
  const events = [];
  installer.start(['jq'], () => {}, { spawnFn, onEvent: (e) => events.push(e) });
  const [call] = spawnFn.calls;
  fs.appendFileSync(logOf(call), 'ERROR jq código de salida 1\nFIN\n');
  call.child.emit('exit', 1);
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepEqual(events.map((e) => e.state), ['instalando', 'error']);
  assert.match(events[1].detail, /salida 1/);
  // the PowerShell closed with a step started and never finished
  const second = fakeSpawn();
  const more = [];
  installer.start(['go'], () => {}, { spawnFn: second, onEvent: (e) => more.push(e) });
  fs.appendFileSync(logOf(second.calls[0]), 'INICIO go\n');
  second.calls[0].child.emit('exit', 1);
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepEqual(more.map((e) => e.state), ['instalando', 'error']);
});

test('what is already installed is never installed again, and an update asks for winget tools only', () => {
  const spawnFn = fakeSpawn();
  assert.throws(() => installer.start(['uv', 'git'], () => {}, { spawnFn, have: new Set(['uv', 'git']) }), /elige al menos|choose/i);
  assert.equal(spawnFn.calls.length, 0, 'nothing started');
  assert.throws(() => installer.start(['pnpm', 'claude'], () => {}, { spawnFn, update: true }), /elige al menos|choose/i);
  assert.equal(spawnFn.calls.length, 0);
});

// ---- versions, newer versions and suggestions
test('check() lists the new tools with their group and without touching the first run', async () => {
  const list = await installer.check();
  for (const id of Object.keys(EXPECTED)) assert.ok(list.some((i) => i.id === id), id);
  const uv = list.find((i) => i.id === 'uv');
  assert.equal(uv.group, 'rec'); assert.equal(uv.extra, true); assert.equal(uv.optional, true); assert.equal(uv.canUpdate, true);
  assert.equal(list.find((i) => i.id === 'rustup').group, 'lang');
  assert.equal(list.find((i) => i.id === 'java').group, 'mobile');
  assert.equal(list.find((i) => i.id === 'pnpm').canUpdate, undefined, 'pnpm has no winget update');
  assert.equal(list.find((i) => i.id === 'git').extra, undefined, 'the necessary tools stay as they were');
  assert.match(read('src/ui/components/installer.jsx'), /filter\(\(i\) => !i\.extra\)/);
});

test('winget upgrade output is read for the listed tools only', () => {
  const table = [
    'Nombre             Id                     Versión   Disponible  Origen',
    '-------------------------------------------------------------------',
    'jq                 jqlang.jq              1.7.1     1.8.2       winget',
    'Algo               Vendor.Other           1.0       2.0         winget',
    'Git                Git.Git                2.43.0    2.50.1      winget'
  ].join('\n');
  assert.deepEqual(parseUpgrades(table), { jq: { current: '1.7.1', latest: '1.8.2' }, git: { current: '2.43.0', latest: '2.50.1' } });
  assert.deepEqual(parseUpgrades('No se encontraron actualizaciones'), {});
});

test('newer versions are asked once and kept; «Comprobar» asks again; no winget answer changes nothing', async () => {
  installer.forgetUpgrades();
  let n = 0;
  const run = async (cmd, args) => { n++; assert.equal(cmd, 'winget'); assert.deepEqual(args.slice(0, 2), ['upgrade', '--source']); return { ok: true, out: 'jq   jqlang.jq   1.7.1   1.8.2   winget' }; };
  const first = await installer.checkUpgrades({ run });
  assert.equal(first.found.jq.latest, '1.8.2');
  await installer.checkUpgrades({ run });
  assert.equal(n, 1, 'cached');
  await installer.checkUpgrades({ run, force: true });
  assert.equal(n, 2);
  const none = await installer.checkUpgrades({ run: async () => ({ ok: false, out: '' }), force: true });
  assert.equal(none.available, false);
  assert.equal(installer.cachedUpgrades().jq.latest, '1.8.2', 'the last good answer stays');
  installer.forgetUpgrades();
  assert.equal(installer.cachedUpgrades(), null);
});

test('a project file asks for its tool: pyproject, Cargo, go.mod, csproj, Dockerfile, pubspec', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-sugg-'));
  try {
    assert.deepEqual(suggestionsFor(dir), []);
    for (const f of ['pyproject.toml', 'Cargo.toml', 'go.mod', 'App.csproj', 'Dockerfile', 'pubspec.yaml', 'README.md']) fs.writeFileSync(path.join(dir, f), '');
    assert.deepEqual(suggestionsFor(dir).map((x) => [x.tool, x.file]), [['uv', 'pyproject.toml'], ['rustup', 'Cargo.toml'], ['go', 'go.mod'], ['dotnet', 'App.csproj'], ['docker', 'Dockerfile'], ['flutter', 'pubspec.yaml']]);
    assert.deepEqual(suggestionsFor(path.join(dir, 'missing')), []);
    // Flutter has no installer: only the way to install it
    const onlyFlutter = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-sugg-'));
    fs.writeFileSync(path.join(onlyFlutter, 'pubspec.yaml'), '');
    assert.deepEqual(await installer.suggest(onlyFlutter), [{ tool: 'flutter', file: 'pubspec.yaml', label: 'Flutter', installable: false }]);
    fs.rmSync(onlyFlutter, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // the project is looked up by name in the engine: the window sends no path
  assert.match(read('src/engine/api/index.mjs'), /'installer\.suggest': async \(\{ project: name \}\) => \{ const p = project\(name\);/);
});

test('the engine writes the install to Activity with labelled kinds', () => {
  const api = read('src/engine/api/index.mjs');
  assert.match(api, /board\.event\(null, 'usuario', state === 'instalando' \? 'tools\.install_start' : state === 'hecho' \? 'tools\.install_done' : 'tools\.install_error'/);
  for (const k of ['start', 'done', 'error']) for (const l of [es, en]) assert.ok(l[`activity.kind.tools_install_${k}`] && l[`activity.say.tools_install_${k}`] && l[`activity.say.tools_install_${k}.you`], k);
});
