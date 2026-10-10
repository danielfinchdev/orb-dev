// Smoke test of the PACKAGED app (what people download): ORB_E2E_EXE=dist/win-unpacked/Orb.exe node test/smoke.e2e.mjs
// The packaged app does not accept --inspect (a security fuse), so it is driven like a browser through the window's
// DevTools port: it starts with an assistant called «Nova» (its folder is still Orb), the engine answers, the interface size and a switch of
// Ajustes work, the folders menu is there, and the MCP server the agents use starts from inside the package.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.ORB_E2E_EXE;
if (!exe || !fs.existsSync(exe)) { console.error('ORB_E2E_EXE debe apuntar a la app empaquetada (p. ej. dist/win-unpacked/Orb.exe)'); process.exit(2); }
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-humo-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { assistantName: 'Nova', userName: 'Ana' });
assert.equal(path.basename(home), 'Orb', 'la carpeta es siempre Orb, se llame como se llame el asistente');
const userData = path.join(tmp, 'datos-app'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));

const port = 9300 + Math.floor(Math.random() * 500);
const app = spawn(exe, [`--remote-debugging-port=${port}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, ORB_USER_DATA: userData }, stdio: 'ignore' });
const stop = () => { try { if (process.platform === 'win32') spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); else app.kill(); } catch { /* gone */ } };
const until = async (fn, what, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };

let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana de la app');
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('index.html')), 'la página principal');
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('text=Soy Nova', { timeout: 30000 });
  const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
  const state = await call('app.state');
  assert.equal(state.config.assistantName, 'Nova');
  assert.equal(path.resolve(state.home), path.resolve(home));
  assert.equal(state.version, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  assert.ok(Array.isArray(await call('agents.status')), 'el motor responde');
  // Interface size
  assert.equal(await page.evaluate(() => window.orb.zoom()), 1);
  assert.equal(await page.evaluate(() => window.orb.zoom(1.15)), 1.15);
  await page.evaluate(() => window.orb.zoom(1));
  // Folders menu and a switch of Ajustes (applied at once, also clicking its text)
  await page.waitForSelector('text=Carpetas');
  await page.click('[data-testid=nav-settings]');
  await page.click('[data-testid=settings-nav-tareas]');
  await page.click('text=Iniciar las tareas automáticamente');
  await until(async () => (await call('app.state')).config.autoRun === false, 'interruptor aplicado');
  await page.screenshot({ path: path.join(OUT, 'humo-empaquetada.png') });
  assert.deepEqual(errors, [], `errores de la página: ${errors.join(' | ')}`);

  // The MCP server the agents load, started like they do: the app's own executable in "run as node" mode.
  const resources = process.platform === 'darwin' ? path.join(path.dirname(exe), '..', 'Resources') : path.join(path.dirname(exe), 'resources');
  const script = path.join(resources, 'app.asar.unpacked', 'src', 'mcp', 'server.mjs');
  assert.ok(fs.existsSync(script), `falta ${script}`);
  const mcp = spawn(exe, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ORB_HOME: home, ORB_AGENT: 'claude' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; mcp.stdout.on('data', (c) => { out += c; });
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  await until(() => out.includes('\n'), 'respuesta del servidor MCP', 20000);
  mcp.kill();
  assert.equal(JSON.parse(out.split('\n')[0]).result.serverInfo.name, 'orb');
  console.log('✔ app empaquetada: arranca, asistente «Nova» en Orb, motor, tamaño, ajustes, menú de carpetas y servidor MCP');
} catch (error) {
  console.error(`✖ prueba de humo: ${error.stack ?? error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stop();
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold files a moment */ } process.exit(); }, 1500);
}
