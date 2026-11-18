// 3.8.8 paso 11b (tanda 9), motor de Agentes y Uso: herramientas de desarrollo con su versión, cerrar sesión de una cuenta
// de Orb (con sus protecciones), aviso de uso, cambiar de cuenta como ajuste, tokens de caché por día y agente, y la consulta
// de versiones nuevas (con la red falsa).
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, principalOf, METHODS } from '../src/domain/security/permissions.mjs';
import { ctx } from '../src/platform/context.mjs';
import { devToolsReport, toolVersion } from '../src/platform/dev-tools.mjs';
import { logoutKind, closeAccountSession, usableAccounts, loginState } from '../src/domain/usage/accounts.mjs';
import { recordRate, recordSpend, usageHistory, rankAccounts, pickAccount } from '../src/domain/usage/budget.mjs';
import { net, checkUpdates, updateInfo, updateCommand, compareVersions, PACKAGES } from '../src/engine/usage/versions.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions; let orch;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const win = process.platform === 'win32';
const touch = (file, text = '') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit }); orch = orchestrator;
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

// ---- 1. Flutter, Android SDK and Java in «Prepara tu equipo»
test('herramientas: Flutter, SDK de Android y Java con su versión, leída de sus archivos y sin ejecutar nada de Flutter', async () => {
  const root = path.join(t.base, 'tools');
  const flutter = path.join(root, 'flutter');
  touch(path.join(flutter, 'bin', win ? 'flutter.bat' : 'flutter'));
  touch(path.join(flutter, 'version'), '3.27.1\n');
  const sdk = path.join(root, 'sdk');
  fs.mkdirSync(path.join(sdk, 'platform-tools'), { recursive: true });
  fs.mkdirSync(path.join(sdk, 'build-tools', '34.0.0'), { recursive: true });
  fs.mkdirSync(path.join(sdk, 'build-tools', '35.0.1'), { recursive: true });
  const jdk = path.join(root, 'jdk');
  touch(path.join(jdk, 'bin', win ? 'java.exe' : 'java'));
  touch(path.join(jdk, 'release'), 'JAVA_VERSION="21.0.5"\nIMPLEMENTOR="x"\n');
  const env = { PATH: '', USERPROFILE: path.join(root, 'nohome'), HOME: path.join(root, 'nohome'), FLUTTER_ROOT: flutter, ANDROID_HOME: sdk, JAVA_HOME: jdk, LOCALAPPDATA: '', ProgramFiles: '' };
  const got = await devToolsReport({ env, core: null, run: () => assert.fail('nothing is run when the files say the version') });
  assert.deepEqual(got.map((x) => [x.id, x.installed, x.version, x.optional]), [['flutter', true, '3.27.1', true], ['androidSdk', true, '35.0.1', true], ['java', true, '21.0.5', true]]);
  assert.ok(got.every((x) => x.url.startsWith('https://')), 'each one carries its official page');
  assert.ok(got.every((x) => !JSON.stringify(x).includes(root)), 'no folder of this PC is sent to the window');
  // not installed: said as it is
  const none = await devToolsReport({ env: { PATH: '', USERPROFILE: path.join(root, 'x'), HOME: path.join(root, 'x'), LOCALAPPDATA: '', ProgramFiles: '' }, core: null });
  assert.deepEqual(none.map((x) => [x.installed, x.version]).slice(0, 2), [[false, null], [false, null]]);
  // Java without a `release` file asks `java --version`, and only that
  const bare = path.join(root, 'bare');
  touch(path.join(bare, 'bin', win ? 'java.exe' : 'java'));
  let asked = null;
  assert.equal(toolVersion('java', path.join(bare, 'bin'), { run: (file, args) => { asked = args; return 'openjdk 17.0.9 2023-10-17'; } }), '17.0.9');
  assert.deepEqual(asked, ['--version']);
});

test('installer.devTools: solo desde este PC', async () => {
  assert.equal(METHODS['installer.devTools'], 'pc');
  const list = await call('installer.devTools');
  assert.deepEqual(list.map((x) => x.id), ['flutter', 'androidSdk', 'java']);
  await assert.rejects(call('installer.devTools', {}, REMOTE));
});

// ---- 3. Cerrar sesión
test('cerrar sesión: solo una cuenta que Orb creó, con su nombre escrito, y solo borra su archivo de inicio de sesión', async () => {
  const acc = await call('accounts.add', { agent: 'codex', label: 'Trabajo' });
  assert.ok(acc.home.startsWith(path.join(ctx.paths.internal, 'cuentas')));
  assert.equal(METHODS['accounts.logout'], 'pc');
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Trabajo' }, REMOTE));
  // the status says what can be done with each account
  const status = await call('agents.status');
  const accs = status.find((a) => a.id === 'codex').accounts;
  assert.equal(accs.find((a) => a.id === acc.id).logout, 'orb');
  assert.equal(accs.find((a) => a.id === 'codex').logout, 'tool', 'the CLI\'s own login is left to the CLI');
  assert.equal(status.find((a) => a.id === 'cursor').accounts.every((x) => x.logout === undefined), true, 'an agent without a session to close offers nothing');
  const auth = touch(path.join(acc.home, 'auth.json'), '{"token":"x"}');
  const settings = touch(path.join(acc.home, 'config.toml'), 'x = 1');
  // the name must be typed exactly
  await assert.rejects(call('accounts.logout', { id: acc.id }), /nombre de la cuenta/);
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'otra' }), /nombre de la cuenta/);
  assert.ok(fs.existsSync(auth));
  // not while it is working
  const s = await call('sessions.create', { agent: 'codex', account: acc.id, permission: 'leer', title: 'x' });
  board.run("UPDATE sessions SET status = 'running' WHERE id = ?", s.id);
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Trabajo' }), /conversación en curso/);
  board.run("UPDATE sessions SET status = 'idle' WHERE id = ?", s.id);
  assert.ok(fs.existsSync(auth), 'refused: nothing was deleted');
  // done: only the login file goes
  assert.equal(await call('accounts.logout', { id: acc.id, confirm: 'Trabajo' }), true);
  assert.equal(fs.existsSync(auth), false);
  assert.ok(fs.existsSync(settings), 'the account\'s own settings stay');
  assert.ok((await call('agents.status')).find((a) => a.id === 'codex').accounts.some((a) => a.id === acc.id), 'the account stays in the list');
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Trabajo' }), /ninguna sesión/);
  // signed out: it takes no more work and shows «sin sesión»; signing in again brings it back by itself
  const accObj = ctx.config.accounts.find((a) => a.id === acc.id);
  assert.equal(loginState(accObj), 'no');
  assert.ok(!usableAccounts('codex').some((a) => a.id === acc.id));
  assert.ok(!rankAccounts(board, usableAccounts('codex'), null).some((r) => r.account === acc.id));
  assert.notEqual(pickAccount(board, { agent: 'codex', preferred: acc.id })?.id, acc.id);
  touch(path.join(acc.home, 'auth.json'), '{"token":"y"}');
  assert.ok(usableAccounts('codex').some((a) => a.id === acc.id));
  assert.equal(pickAccount(board, { agent: 'codex', preferred: acc.id }).id, acc.id);
  fs.rmSync(path.join(acc.home, 'auth.json'));
  // the main account (the CLI's own ~/.codex) is never touched
  await assert.rejects(call('accounts.logout', { id: 'codex', confirm: 'Codex' }), /solo cierra la sesión de las cuentas que ha creado/);
  await call('accounts.remove', { id: acc.id });
});

test('cerrar sesión: una carpeta de fuera de las cuentas de Orb, o un enlace que sale de ella, no se toca', () => {
  const outside = path.join(t.base, 'otra-carpeta');
  const keep = touch(path.join(outside, 'auth.json'), 'keep');
  assert.equal(logoutKind({ id: 'codex-7', agent: 'codex', home: outside }), 'tool');
  assert.equal(closeAccountSession({ id: 'codex-7', agent: 'codex', home: outside }), false);
  // a link inside «cuentas» that points out of it
  const root = path.join(ctx.paths.internal, 'cuentas'); fs.mkdirSync(root, { recursive: true });
  const link = path.join(root, 'codex-8');
  fs.symlinkSync(outside, link, win ? 'junction' : 'dir');
  assert.equal(logoutKind({ id: 'codex-8', agent: 'codex', home: link }), 'tool');
  assert.equal(closeAccountSession({ id: 'codex-8', agent: 'codex', home: link }), false);
  // the login file itself a link: not followed
  const own = path.join(root, 'codex-9'); fs.mkdirSync(own, { recursive: true });
  try { fs.symlinkSync(keep, path.join(own, 'auth.json'), 'file'); assert.equal(closeAccountSession({ id: 'codex-9', agent: 'codex', home: own }), false); } catch { /* links of files need a privilege on Windows */ }
  assert.ok(fs.existsSync(keep), 'the file outside is still there');
  // an agent with no login file Orb knows
  assert.equal(logoutKind({ id: 'cursor', agent: 'cursor', home: '' }), null);
  fs.rmSync(link, { recursive: true, force: true }); fs.rmSync(own, { recursive: true, force: true });
});

test('cerrar sesión: un proceso vivo de la cuenta lo impide (en reposo se cierra, en turno se niega) y también el del asistente', async () => {
  const acc = await call('accounts.add', { agent: 'codex', label: 'Viva' });
  const auth = touch(path.join(acc.home, 'auth.json'), '{"token":"x"}');
  let closed = 0;
  const fake = { close() { closed++; }, isClosed: () => false };
  // a chat at rest keeps its process open: it is closed and the sign-out goes on
  sessions.lives.set('chat-1', { account: acc.id, live: fake, key: 'k', lastUsed: Date.now() });
  // a turn in progress refuses and closes nothing
  sessions.running.set('chat-1', {});
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Viva' }), /chat abierto/);
  assert.equal(closed, 0);
  assert.ok(fs.existsSync(auth));
  sessions.running.delete('chat-1');
  // a side chat answering refuses too
  const side = { id: 's1', parent: 'chat-1', live: fake, status: 'running', account: acc.id };
  sessions.side.map.set('s1', side);
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Viva' }), /chat abierto/);
  side.status = 'done';
  // the assistant's live process on this account, working: refuses
  // the assistant's own live process on this account: working refuses, at rest it is closed
  const lane = orch.lane(1); lane.live = fake; lane.liveAccount = acc.id; lane.busy = true;
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Viva' }), /chat abierto/);
  assert.equal(closed, 0);
  lane.busy = false;
  assert.equal(await call('accounts.logout', { id: acc.id, confirm: 'Viva' }), true);
  assert.equal(lane.live, null);
  assert.equal(closed, 3, 'the assistant, the resting chat and the side chat processes were closed');
  assert.equal(sessions.lives.has('chat-1'), false);
  assert.equal(side.live, null);
  sessions.side.map.delete('s1');
  // the assistant: the account it would be given counts even with no process open
  const keep = ctx.config.orchestrator.account;
  touch(path.join(acc.home, 'auth.json'), '{"token":"z"}');
  ctx.config.orchestrator.account = acc.id;
  await assert.rejects(call('accounts.logout', { id: acc.id, confirm: 'Viva' }), /asistente/);
  ctx.config.orchestrator.account = keep;
  await call('accounts.remove', { id: acc.id });
});

// ---- 4. «Avisarme al llegar al (%)»
const notices = () => board.all("SELECT body FROM chat WHERE role = 'notice' ORDER BY id").map((r) => r.body);
test('aviso de uso: un aviso por ventana y cuenta, solo avisa y no cambia los frenos', async () => {
  const before = notices().length;
  const reset = Date.now() + 3 * 3_600_000;
  recordRate(board, 'claude', { utilization: 0.9, window: 'five_hour', resetAt: reset, status: 'allowed' });
  assert.equal(notices().length, before, 'with no level set (the default) nothing is said');
  await call('config.save', { patch: { budget: { warnAt: 0.85 } } });
  assert.equal(ctx.config.budget.stopAt, 0.92, 'the brake did not move');
  recordRate(board, 'claude', { utilization: 0.8, window: 'five_hour', resetAt: reset, status: 'allowed' });
  assert.equal(notices().length, before, 'below the level: nothing');
  recordRate(board, 'claude', { utilization: 0.86, window: 'five_hour', resetAt: reset, status: 'allowed' });
  assert.equal(notices().length, before + 1);
  assert.match(notices().at(-1), /86 %/);
  recordRate(board, 'claude', { utilization: 0.88, window: 'five_hour', resetAt: reset, status: 'allowed' });
  assert.equal(notices().length, before + 1, 'once per window');
  // the next window warns again
  recordRate(board, 'claude', { utilization: 0.87, window: 'five_hour', resetAt: reset + 5 * 3_600_000, status: 'allowed' });
  assert.equal(notices().length, before + 2);
  // a reading without a reset time inside the window already marked keeps the dated mark: no second notice
  recordRate(board, 'claude', { utilization: 0.9, window: 'five_hour', status: 'allowed' });
  assert.equal(notices().length, before + 2, 'the mark with a date stays');
  recordRate(board, 'claude', { utilization: 0.9, window: 'five_hour', resetAt: reset + 5 * 3_600_000, status: 'allowed' });
  assert.equal(notices().length, before + 2);
  // another account has its own
  recordRate(board, 'codex', { utilization: 0.9, window: '300min', resetAt: reset, status: 'allowed' });
  assert.equal(notices().length, before + 3);
  // past the brake the brake speaks, not the warning; a window of one model is none of its business
  recordRate(board, 'codex', { utilization: 0.95, window: '300min', resetAt: reset + 9, status: 'allowed' });
  recordRate(board, 'claude', { utilization: 0.99, window: 'seven_day_opus', resetAt: reset, status: 'allowed' });
  assert.equal(notices().length, before + 3);
  // it is not a rail value: changed alone it asks for no password, and it is validated
  const { needsUnlock } = await import('../src/domain/security/permissions.mjs');
  assert.equal(needsUnlock('config.save', { patch: { budget: { warnAt: 0.8 } } }, ctx.config), false);
  assert.equal(needsUnlock('config.save', { patch: { budget: { stopAt: 0.99 } } }, ctx.config), true, 'the brakes still ask');
  for (const bad of [0.3, 1.5, 'x']) await assert.rejects(call('config.save', { patch: { budget: { warnAt: bad } } }));
  await call('config.save', { patch: { budget: { warnAt: 0 } } });
  assert.equal(ctx.config.budget.warnAt, 0);
});

// ---- 7. cambiar a otra cuenta al llegar al límite
test('cambiar de cuenta: encendido por defecto; apagado, cada agente solo cuenta con su primera cuenta', async () => {
  const second = await call('accounts.add', { agent: 'codex', label: 'Segunda' });
  touch(path.join(second.home, 'auth.json'), '{"token":"x"}');
  const list = usableAccounts('codex');
  assert.equal(list.length, 2);
  assert.equal(ctx.config.continuity.switchAccount, true);
  assert.equal(rankAccounts(board, list, null).length, 2, 'on: both are candidates, as before');
  await call('config.save', { patch: { continuity: { switchAccount: false } } });
  const normal = rankAccounts(board, list, null).map((r) => r.account);
  assert.equal(normal.length, 2, 'off: the normal least-used split still sees every account while none is at its limit');
  // the account that would take the work is at its limit: it waits there instead of passing to the other one
  const given = normal[0];
  board.setting(`cooldown:${given}`, String(Date.now() + 3_600_000));
  assert.deepEqual(rankAccounts(board, list, null).map((r) => r.account), [given], 'off: the task waits for the account it was given');
  await call('config.save', { patch: { continuity: { switchAccount: true } } });
  assert.equal(rankAccounts(board, list, null).length, 2, 'on: the next account takes it, as always');
  await call('config.save', { patch: { continuity: { switchAccount: false } } });
  board.setting(`cooldown:${given}`, '');
  assert.equal(rankAccounts(board, [list[1]], null).length, 1, 'a task pinned to an account still goes there');
  await assert.rejects(call('config.save', { patch: { continuity: { switchAccount: 'no' } } }));
  await call('config.save', { patch: { continuity: { switchAccount: true } } });
  assert.equal(rankAccounts(board, list, null).length, 2);
  await call('accounts.remove', { id: second.id });
});

// ---- 6. tokens de caché y barras por agente y día
test('usage.history: tokens leídos de la caché y cada día por agente, sin cambiar lo que había', async () => {
  const claude = await call('sessions.create', { agent: 'claude', model: 'claude-opus-5-5', permission: 'leer', title: 'A' });
  const codex = await call('sessions.create', { agent: 'codex', model: 'gpt-6', permission: 'leer', title: 'B' });
  recordSpend(board, { account: claude.account, session: claude.id, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 700, costUsd: 0.1 } });
  recordSpend(board, { account: codex.account, session: codex.id, usage: { inputTokens: 300, outputTokens: 5, cacheReadTokens: 50 } });
  recordSpend(board, { account: codex.account, session: codex.id, usage: { inputTokens: 10, outputTokens: 1 } });
  const out = usageHistory(board, { days: 7 });
  assert.equal(out.tokensCache, 750);
  const today = out.byDay.at(-1);
  assert.equal(today.day, out.to);
  assert.equal(today.tokensCache, 750);
  assert.deepEqual(today.agents.claude, { tokensIn: 100, tokensOut: 20, tokensCache: 700, usd: 0.1, turns: 1 });
  assert.deepEqual(today.agents.codex, { tokensIn: 310, tokensOut: 6, tokensCache: 50, usd: 0, turns: 2 });
  assert.equal(out.byDay.length, 7);
  // the shapes the linked phone reads are untouched: the cache is not mixed into them
  assert.equal(out.total.tokensIn, 410);
  assert.deepEqual(Object.keys(out.days.at(-1)).sort(), ['day', 'tokensIn', 'tokensOut', 'turns', 'usd']);
  // through the API, also for the phone (a read)
  const api1 = await call('usage.history', { days: 1 }, REMOTE);
  assert.equal(api1.tokensCache, 750);
  assert.equal(api1.agents.find((a) => a.agent === 'claude').usd, 0.1, 'today\'s cost of an agent that gives it');
  assert.equal(api1.agents.find((a) => a.agent === 'codex').usd, 0, 'an agent that does not give a cost has none made up');
});

// ---- 5. versiones nuevas
test('versiones: compara bien, pregunta solo el nombre público del paquete y guarda lo que encuentra', async () => {
  assert.equal(compareVersions('2.4.10', '2.4.3'), 1);
  assert.equal(compareVersions('2.4', '2.4.0'), 0);
  assert.equal(compareVersions('0.98.1', '1.0.0'), -1);
  const asked = [];
  const saved = net.fetch;
  net.fetch = async (url, options) => {
    asked.push({ url, options });
    if (url.includes('opencode-ai')) throw new Error('offline');
    const version = url.includes('claude-code') ? '2.4.3' : url.includes('codex') ? '0.98.0' : '1.0.0';
    return { ok: true, json: async () => ({ version }) };
  };
  try {
    assert.equal(METHODS['agents.checkUpdates'], 'pc');
    await assert.rejects(call('agents.checkUpdates', {}, REMOTE));
    const r = await checkUpdates(board, { agents: ['claude', 'codex', 'opencode', 'cursor'] });
    assert.deepEqual(r.failed, ['opencode'], 'one that does not answer is not an error for the rest; cursor has no package');
    assert.equal(asked.length, 3, 'one request per package');
    for (const a of asked) {
      assert.match(a.url, /^https:\/\/registry\.npmjs\.org\/(@[a-z-]+%2F)?[a-z-]+\/latest$/);
      assert.deepEqual(Object.keys(a.options.headers), ['accept'], 'no identifier, no account, nothing of this PC');
    }
    assert.deepEqual(updateInfo(board, 'claude', '2.4.1 (Claude Code)'), { latest: '2.4.3', available: true, command: updateCommand('claude'), exact: false, checkedAt: updateInfo(board, 'claude', '2.4.1').checkedAt });
    assert.equal(updateInfo(board, 'codex', '0.98').available, false, 'up to date');
    assert.equal(updateInfo(board, 'codex', null).available, null, 'installed version unknown: not «up to date»');
    assert.equal(updateInfo(board, 'codex', '0.98').exact, true);
    assert.equal(updateCommand('claude', 'darwin'), 'curl -fsSL https://claude.ai/install.sh | bash');
    assert.match(updateCommand('claude', 'win32'), /install.ps1/);
    assert.equal(updateCommand('claude', 'freebsd'), null, 'no command for the platform: none is shown');
    assert.equal(updateInfo(board, 'opencode', '1.0.4'), null, 'nothing known: nothing shown');
    // the saved answer reaches the window with the agent's state, no request involved
    asked.length = 0;
    const status = await call('agents.status');
    assert.equal(asked.length, 0, 'asking for the state never goes out to the internet');
    assert.ok(PACKAGES.claude);
  } finally { net.fetch = saved; }
});

test('versiones: una respuesta enorme del registro no se lee', async () => {
  const saved = net.fetch;
  net.fetch = async () => ({ ok: true, headers: { get: () => '9999999' }, json: async () => ({ version: '9.9.9' }) });
  try { const r = await checkUpdates(board, { agents: ['qwen'] }); assert.deepEqual(r.failed, ['qwen']); } finally { net.fetch = saved; }
  net.fetch = async () => ({ ok: true, body: new Response('x'.repeat(100_000)).body, json: async () => ({ version: '9.9.9' }) });
  try { const r = await checkUpdates(board, { agents: ['qwen'] }); assert.deepEqual(r.failed, ['qwen']); } finally { net.fetch = saved; }
});

test('versiones: con los agentes falsos de las pruebas la red no sale', async () => {
  process.env.ORB_FAKE_AGENTS = '1';
  try { await assert.rejects(net.fetch('https://registry.npmjs.org/x/latest'), /offline/); } finally { delete process.env.ORB_FAKE_AGENTS; }
});

test('los avisos y el cambio de cuenta no están entre los valores de los frenos', async () => {
  const { RAILS } = await import('../src/shared/rails-registry.mjs');
  const keys = RAILS.flatMap((r) => r.keys);
  assert.ok(!keys.includes('budget.warnAt') && !keys.includes('continuity.switchAccount'));
});
