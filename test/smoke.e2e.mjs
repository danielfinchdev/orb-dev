// Smoke test of the BUILT Orb (Tauri: Orb.exe with its bundled node\ and app\ next to it, as the installer leaves them).
//   npm run tauri:build:e2e && node test/smoke.e2e.mjs                         the test build, window hidden, over CDP
//   node test/smoke.e2e.mjs --exe src-tauri/target/release/Orb.exe --visible   a release build (no DevTools port: its
//                                                                            window shows; only in CI or with --visible)
// Test build: it starts with an assistant called «Nova» (its folder is still Orb), the engine answers with this version,
// the interface size and a switch of Ajustes work and the chat list is there. Both: the engine started from the bundled
// node (core\ejecuciones\motor.log) and the MCP server the agents use starts from inside the package with that node.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/domain/workspace/home.mjs';
import { loadConfig, merge } from '../src/platform/config-file.mjs';
import { writeJson } from '../src/platform/paths.mjs';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';
import { launchOrb, E2E_EXE, isTestBuild } from './fixtures/launch-orb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.resolve(E2E_EXE);
if (!fs.existsSync(exe)) { console.error(`no existe ${exe} (npm run tauri:build:e2e, o --exe <Orb.exe>)`); process.exit(2); }
const testBuild = isTestBuild(exe);
if (!testBuild && !process.env.CI && !process.argv.includes('--visible')) { console.error(`${exe} es una build normal: su ventana se vería. Solo en CI o con --visible.`); process.exit(2); }
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-humo-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { assistantName: 'Nova', userName: 'Ana' });
writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } })); // 2.6: no guided tour in the tests
assert.equal(path.basename(home), 'Orb', 'la carpeta es siempre Orb, se llame como se llame el asistente');
const userData = path.join(tmp, 'datos-app'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const until = async (fn, what, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };
const env = { ...sandboxEnv(tmp), ORB_NO_UPDATE: '1' };

let orb = null; let plain = null;
try {
  if (testBuild) {
    orb = await launchOrb({ exe, userData, env });
    const page = orb.page;
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    // 3.8: a folder made before the first start has no master password yet: «Crea tu contraseña maestra» once.
    await throughStart(page, { ready: '[data-testid=chat-greeting]' });
    await page.waitForSelector('[data-testid=chat-greeting] >> text=Nova', { timeout: 30000 });
    const { call } = orb;
    assert.ok((await call('master.state')).exists, 'contraseña maestra creada');
    const state = await call('app.state');
    assert.equal(state.config.assistantName, 'Nova');
    assert.equal(path.resolve(state.home), path.resolve(home));
    assert.equal(state.version, VERSION);
    assert.ok(Array.isArray(await call('agents.status')), 'el motor responde');
    // Interface size
    assert.equal(await page.evaluate(() => window.orb.zoom()), 1);
    assert.equal(await page.evaluate(() => window.orb.zoom(1.15)), 1.15);
    await page.evaluate(() => window.orb.zoom(1));
    // The chat list (3.6: one group per project, «+» for a new chat or project) and a switch of Ajustes (applied at once,
    // also clicking its text)
    await page.waitForSelector('[data-testid=orb-inbox] [data-testid=chats-new]');
    await page.click('[data-testid=nav-settings]');
    await page.click('[data-testid=settings-nav-agentes]');
    await page.click('text=Iniciar las tareas automáticamente');
    await until(async () => (await call('app.state')).config.autoRun === false, 'interruptor aplicado');
    await page.screenshot({ path: path.join(OUT, 'humo-empaquetada.png') });
    assert.deepEqual(errors, [], `errores de la página: ${errors.join(' | ')}`);
  } else {
    // A release build has no DevTools port: what it did is read from the engine's log.
    plain = spawn(exe, [], { env: { ...process.env, ...env, ORB_USER_DATA: userData }, stdio: 'ignore' });
  }
  const log = path.join(home, 'core', 'ejecuciones', 'motor.log');
  await until(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes(`motor arrancado (versión ${VERSION})`), `motor arrancado (versión ${VERSION})`, 90000);

  // The MCP server the agents load, started like they do: the bundled node with the bundled code.
  const node = path.join(path.dirname(exe), 'node', 'node.exe');
  const script = path.join(path.dirname(exe), 'app', 'src', 'mcp', 'server.mjs');
  for (const f of [node, script]) assert.ok(fs.existsSync(f), `falta ${f}`);
  const mcp = spawn(node, [script], { env: { ...process.env, ORB_HOME: home, ORB_AGENT: 'claude' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; mcp.stdout.on('data', (c) => { out += c; });
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  try { await until(() => out.includes('\n'), 'respuesta del servidor MCP', 20000); } finally { mcp.kill(); }
  assert.equal(JSON.parse(out.split('\n')[0]).result.serverInfo.name, 'orb');
  console.log(`✔ Orb compilado (${testBuild ? 'build de pruebas, oculta' : 'build normal'}): arranca, ${testBuild ? 'asistente «Nova» en Orb, motor, tamaño, ajustes, lista de chats, ' : ''}motor ${VERSION} con su node y servidor MCP`);
} catch (error) {
  console.error(`✖ prueba de humo: ${error.stack ?? error}`);
  process.exitCode = 1;
} finally {
  await orb?.close().catch(() => {});
  if (plain && plain.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(plain.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows may hold files a moment */ } process.exit(); }, 1500);
}
