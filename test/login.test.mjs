// 3.5 «Solo Orb»: the agents' sign-in without a console (src/agents/login.mjs) and installing Claude Code and Codex from
// Ajustes › Agentes (installer.installAgent), with fake CLIs (test/fixtures/fake-login.mjs) that print what the real
// ones print. Nothing opens a window and no real account is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until, fake } from './helpers.mjs';
import { plainText, findUrl, findCode, failureOf, startLogin, waitLogin, sendCode, cancelLogin, loginInfo } from '../src/agents/login.mjs';
import { agentInstallCommand, installAgent, agentInstallState } from '../src/engine/installer.mjs';
import { centroAllows } from '../src/engine/api.mjs';

const t = tempHome();
process.on('exit', () => t.cleanup());
const exe = { cmd: process.execPath, pre: [fake('fake-login.mjs')] };
const folder = (name) => path.join(t.base, name);
const run = (agent, name, extra = {}) => {
  const dir = folder(name); const events = [];
  const env = agent === 'claude' ? { CLAUDE_CONFIG_DIR: dir } : { CODEX_HOME: dir };
  const marker = path.join(dir, agent === 'claude' ? '.credentials.json' : 'auth.json');
  const started = startLogin({ agent, account: `${agent}-${name}`, exe, env, emit: (e, p) => events.push([e, p]), verify: () => fs.existsSync(marker), ...extra });
  return { dir, events, marker, started };
};

test('lee el enlace y el código de lo que escriben los CLI (colores e hipervínculos fuera)', () => {
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=x';
  const raw = `\x1b[1mOpening browser to sign in…\x1b[0m\r\nIf the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\nPaste code here if prompted > `;
  assert.equal(plainText(raw).includes('\x1b'), false);
  assert.equal(findUrl(raw), url);
  // Only the hyperlink has the link (the visible text shortened).
  assert.equal(findUrl(`Sign in: \x1b]8;;${url}\x07aquí\x1b]8;;\x07`), url);
  assert.equal(findUrl('1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m'), 'https://auth.openai.com/codex/device');
  assert.equal(findCode('2. Enter this one-time code (expires in 15 minutes)\n   \x1b[94mWXYZ-12345\x1b[0m'), 'WXYZ-12345');
  assert.equal(findUrl('nada por aquí'), null);
  assert.equal(failureOf('Login failed: Request failed with status code 403\n'), 'Request failed with status code 403');
});

test('Claude: enlace, el navegador vuelve solo y la sesión queda guardada en su carpeta', async () => {
  const r = run('claude', 'cuenta-ok');
  const l = await r.started;
  assert.match(l.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize/);
  assert.equal(l.state, 'esperando');
  assert.equal(l.needsCode, true, 'siempre se puede pegar el código de la página');
  const end = await waitLogin(l.id);
  assert.equal(end.state, 'hecho');
  assert.equal(end.message, 'Sesión iniciada');
  assert.ok(fs.existsSync(r.marker));
  assert.deepEqual(r.events.map(([e, p]) => [e, p.state]).at(-1), ['agents:login', 'hecho']);
});

test('Claude: el código pegado de la página termina el inicio de sesión (y uno cortado se explica)', async () => {
  const r = run('claude', 'cuenta-pegar');
  const l = await r.started;
  assert.throws(() => sendCode(l.id, 'cortado'), /no está completo/);
  sendCode(l.id, 'abcdefghij#klmnopqrst');
  const end = await waitLogin(l.id);
  assert.equal(end.state, 'hecho');
  assert.throws(() => sendCode(l.id, 'abcdefghij#klmnopqrst'), /ya ha terminado/);
});

test('Claude: un rechazo y un fallo antes del enlace se dicen en palabras', async () => {
  const r = run('claude', 'cuenta-falla');
  const l = await r.started;
  const end = await waitLogin(l.id);
  assert.equal(end.state, 'error');
  assert.equal(end.message, 'No se pudo iniciar sesión: Request failed with status code 403');
  await assert.rejects(run('claude', 'cuenta-sinurl').started, /No se pudo iniciar sesión: Unable to reach the sign-in service/);
  await assert.rejects(startLogin({ agent: 'claude', account: 'x', exe: { cmd: path.join(t.base, 'no-existe.exe'), pre: [] } }), /no se encuentra el programa/);
});

test('Codex (app-server): enlace del navegador, código para el móvil, rechazo y cancelar', async () => {
  const web = run('codex', 'codex-ok');
  const l = await web.started;
  assert.match(l.url, /^https:\/\/auth\.openai\.com\/oauth\/authorize/);
  assert.equal(l.opened, false, 'Orb abre el enlace (Codex no abre el navegador)');
  assert.equal(l.code, null);
  assert.equal((await waitLogin(l.id)).state, 'hecho');
  assert.ok(fs.existsSync(web.marker));

  const dev = run('codex', 'codex-movil', { mode: 'device' });
  const d = await dev.started;
  assert.equal(d.url, 'https://auth.openai.com/codex/device');
  assert.equal(d.code, 'ABCD-EFGH');
  assert.equal(d.mode, 'device');
  assert.equal((await waitLogin(d.id)).state, 'hecho');

  const no = run('codex', 'codex-falla');
  const n = await no.started;
  const end = await waitLogin(n.id);
  assert.equal(end.state, 'error');
  assert.equal(end.message, 'No se pudo iniciar sesión: Sign-in was denied');
  assert.equal(fs.existsSync(no.marker), false);

  const slow = run('codex', 'codex-espera');
  const s = await slow.started;
  assert.equal(cancelLogin(s.id), true);
  assert.equal(loginInfo(s.id).state, 'cancelado');
});

test('Codex sin inicio de sesión por app-server: usa «codex login --device-auth» y lee enlace y código', async () => {
  const r = run('codex', 'codex-viejo');
  const l = await r.started;
  assert.equal(l.url, 'https://auth.openai.com/codex/device');
  assert.equal(l.code, 'WXYZ-12345');
  assert.equal((await waitLogin(l.id)).state, 'hecho');
  assert.ok(fs.existsSync(r.marker));
});

test('se acaba el tiempo: se dice y el programa se cierra', async () => {
  const r = run('codex', 'codex-espera-2', { timeoutMs: 1500 });
  const l = await r.started;
  const end = await waitLogin(l.id);
  assert.equal(end.state, 'error');
  assert.match(end.message, /pasaron 15 minutos/);
});

test('motor: agents.login de una cuenta nueva da el enlace, avisa al terminar y la cuenta queda con sesión', async () => {
  const h = tempHome();
  const e = await startEngine(h.home);
  try {
    const acc = await e.call('accounts.add', { agent: 'claude', label: 'Claude 2' });
    const r = await e.call('agents.login', { account: acc.id });
    assert.match(r.url, /^https:\/\//);
    assert.equal(r.account, acc.id);
    await until(() => e.events.some((m) => m.event === 'agents:login' && m.payload.id === r.id && m.payload.state === 'hecho'), 'fin del inicio de sesión');
    const st = await e.call('agents.status', {});
    assert.equal(st.find((a) => a.id === 'claude').accounts.find((a) => a.id === acc.id).login, 'si');
    assert.equal((await e.call('agents.loginState', { id: r.id })).state, 'hecho');
    // Codex in device mode (the server's way), through the engine.
    const c = await e.call('agents.login', { account: 'codex', mode: 'device' });
    assert.equal(c.code, 'ABCD-EFGH');
    await assert.rejects(e.call('agents.loginCode', { id: r.id, code: 'abcdefghij#klmnopqrst' }), /ya ha terminado/);
  } finally { await e.stop(); h.cleanup(); }
  // The server signs in too now (no console needed); the console itself stays off there.
  assert.equal(centroAllows('agents.login'), true);
  assert.equal(centroAllows('installer.start'), false);
});

test('instalar agentes: órdenes oficiales para este usuario, progreso, versión y fallos en palabras', async () => {
  const win = agentInstallCommand('claude', { platform: 'win32' });
  assert.match(win.cmd, /powershell\.exe$/i);
  assert.ok(win.args.includes('-NonInteractive'));
  assert.match(win.args.at(-1), /irm https:\/\/claude\.ai\/install\.ps1 \| iex/);
  assert.deepEqual(agentInstallCommand('claude', { platform: 'linux' }), { cmd: 'bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] });
  assert.match(agentInstallCommand('codex', { platform: 'win32' }).args.at(-1), /npm install -g @openai\/codex@latest/);
  const lin = agentInstallCommand('codex', { platform: 'linux', npm: '/usr/bin/npm' });
  assert.deepEqual(lin.args.slice(0, 3), ['install', '-g', '--prefix']);
  assert.ok(lin.args[3].endsWith(`${path.sep}.local`), 'sin administrador: en la carpeta del usuario');
  assert.throws(() => installAgent('cursor', () => {}), /no se puede instalar/);

  const events = [];
  const ok = { cmd: process.execPath, args: ['-e', "console.log('Descargando…'); setTimeout(() => console.log('Claude Code instalado'), 100)"] };
  const first = installAgent('claude', (e, p) => events.push([e, p]), { command: ok, version: async () => '9.9.9 (Claude Code)' });
  assert.equal(first.state, 'instalando');
  assert.throws(() => installAgent('claude', () => {}, { command: ok }), /ya hay una instalación/);
  await until(() => agentInstallState('claude').state !== 'instalando', 'instalación');
  assert.equal(agentInstallState('claude').state, 'hecho');
  assert.equal(agentInstallState('claude').version, '9.9.9 (Claude Code)');
  assert.ok(events.some(([e, p]) => e === 'agents:install' && p.line === 'Descargando…'));

  const bad = { cmd: process.execPath, args: ['-e', "console.error('npm ERR! network unreachable'); process.exit(1)"] };
  installAgent('codex', () => {}, { command: bad });
  await until(() => agentInstallState('codex').state !== 'instalando', 'instalación fallida');
  assert.equal(agentInstallState('codex').message, 'No se pudo instalar: npm ERR! network unreachable');
});
