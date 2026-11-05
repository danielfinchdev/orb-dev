// 3.7 integration: the pieces of Orb Server wired together in src/server/engine-server.mjs (the bots' homes and copies,
// the link's capabilities and person mapping, Open Control Edge, the vault and its one sign-in tool in the browser), and
// the release step that writes the real install.sh sum the app's install command checks (never the placeholder).
import { tempHome, ROOT } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHost, prepareHome } from '../src/server/host.mjs';
import { closure, releaseModuleSource, writeServerRelease, serverPackage, NODE_MAJOR } from '../scripts/dist-servidor.mjs';
import { checkServerRelease } from '../scripts/release.mjs';
import { PROGRAMMING_MODULES } from '../src/server/server-product.mjs';
import { capsFor } from '../src/core/link.mjs';
import { serverInstallCommand, PLACEHOLDER_SHA256 } from '../src/core/server-install.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('el motor del Server arranca la copia de bots, Open Control Edge, la bóveda y su navegador con el gancho de vault_fill', async () => {
  const t = tempHome();
  const home = prepareHome(path.join(t.base, 'orb-server'));
  const before = process.env.ORB_SERVER_BROWSER;
  process.env.ORB_SERVER_BROWSER = '1'; // the browser's pipe (Chromium only when a bot needs it) also on Windows
  const host = createHost({ home, version: '3.7.0', env: { ORB_REMOTE_BIND: '127.0.0.1' }, mode: 'inproc' });
  try {
    await host.start();
    const { ctx } = await import('../src/core/context.mjs');
    // WS3: the replica service is the real one (not the empty answer of an engine without it).
    const st = await host.call('replica.status');
    assert.equal(st.product, 'server'); assert.ok(st.self, 'sabe quién es (su orbId)');
    assert.deepEqual(st.peers, []);
    // WS6 + WS5: the vault's hook and the browser that takes it; the link then says browser.live.v1 and vault.v1.
    assert.equal(typeof ctx.vaultFill, 'function');
    assert.ok(ctx.vault && ctx.serverBrowser && ctx.browserLive);
    assert.deepEqual(capsFor({ server: true, browserLive: Boolean(ctx.browserLive), vault: Boolean(ctx.vault) }).filter((c) => !['persons'].includes(c)),
      ['bots.home.v1', 'replica.v1', 'oce.v1', 'server', 'browser.live.v1', 'vault.v1']);
  } finally {
    const r = await host.stop();
    if (before === undefined) delete process.env.ORB_SERVER_BROWSER; else process.env.ORB_SERVER_BROWSER = before;
    assert.equal(r.clean, true);
    t.cleanup();
  }
  // The same link hooks as the app's engine: capabilities, mapped persons, bot events with their uids, home/oce calls.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'server', 'engine-server.mjs'), 'utf8');
  for (const re of [/features: caps, mapped: \(p\) => hub\.mapped\(p\)/, /botRelay\(board, event, payload\)/, /createReplica\(/, /createOce\(/, /if \(isHomeCall\(method\)\) return homeCall/, /remote\.onMirror =/, /createRemote\(\{[^}]*features: caps/])
    assert.match(src, re);
  // …without loading any programming module (the OCE reading and the bot relay live apart from bridge.mjs/engine.mjs).
  const loaded = closure(ROOT, ['src/server/engine-server.mjs']);
  for (const m of ['src/engine/replica.mjs', 'src/engine/oce.mjs', 'src/engine/hub.mjs', 'src/engine/bot-relay.mjs', 'src/server/vault/fill.mjs']) assert.ok(loaded.includes(m), m);
  for (const m of PROGRAMMING_MODULES) assert.ok(!loaded.includes(m), `${m} no debe cargarse en el Server`);
});

test('vault_fill del navegador del Server pasa por ctx.vaultFill; sin bóveda, failed: vault_off', async () => {
  const t = tempHome();
  const { Board } = await import('../src/core/board.mjs');
  const { ctx } = await import('../src/core/context.mjs');
  const { startServerBrowser } = await import('../src/server/browser.mjs');
  const { browserKey } = await import('../src/core/browser-key.mjs');
  const board = new Board();
  const mkPage = () => { const p = { url: () => 'https://tienda.example/entrar', isClosed: () => false, close: async () => {}, title: async () => '', goto: async () => {}, on() {}, once() {}, off() {} }; return p; };
  const launchContext = async () => ({ pages: () => [mkPage()], newPage: async () => mkPage(), on() {}, close: async () => {},
    newCDPSession: async () => ({ send: async (m) => (m === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'f' } } } : m === 'Page.createIsolatedWorld' ? { executionContextId: 1 } : m === 'Runtime.evaluate' ? { result: { value: { title: 'x', url: 'https://tienda.example/entrar', text: '', cut: false, elements: [], scroll: { y: 0, height: 0, view: 0 } } } } : {}), on() {}, off() {} }) });
  const saved = { vaultFill: ctx.vaultFill, browser: ctx.browser, serverBrowser: ctx.serverBrowser, browserLive: ctx.browserLive };
  const seen = [];
  const sb = await startServerBrowser({ board, emit: () => {}, testing: { root: path.join(t.base, 'b'), display: 'headless', executable: 'chrome', scope: false, readMeminfo: () => 'MemAvailable: 8000000 kB', launchContext, config: () => ({ sites: { default: { minMs: 0, maxMs: 0, burst: 100, perHour: 1000 } } }) } });
  try {
    const who = { agent: 'bot:1', session: 'v', task: '' };
    const s = net.connect(sb.pipe); s.setEncoding('utf8'); const got = [];
    s.on('data', (c) => got.push(...c.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    await new Promise((r) => s.on('connect', r));
    s.write(`${JSON.stringify({ hello: browserKey(sb.token, who), ...who })}\n`);
    const ask = async (id, action, args) => { s.write(`${JSON.stringify({ id, action, args })}\n`); const end = Date.now() + 15000; while (!got.some((m) => m.id === id) && Date.now() < end) await sleep(20); return got.find((m) => m.id === id); };
    assert.equal((await ask(1, 'open', { url: 'https://tienda.example/entrar' })).ok, true);
    ctx.vaultFill = null;
    assert.equal((await ask(2, 'vault_fill', { site: 'tienda.example' })).result, 'failed: vault_off', 'sin bóveda');
    ctx.vaultFill = async (tab, args) => { seen.push({ person: tab?.person ?? null, site: args.site }); return { ok: true, secret: 'nunca sale' }; };
    const ok = await ask(3, 'vault_fill', { site: 'tienda.example' });
    assert.equal(ok.result, 'ok', 'solo ok, nada más');
    assert.deepEqual(seen, [{ person: seen[0].person, site: 'tienda.example' }]);
    s.end();
  } finally {
    await sb.shutdown();
    Object.assign(ctx, saved);
    board.db.close(); t.cleanup();
  }
});

test('la suma real de install.sh se escribe al empaquetar y la de relleno nunca se publica', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-rel-'));
  try {
    // The module as it is in the repository (development): no real sum, so the check refuses it.
    await assert.rejects(checkServerRelease({ file: path.join(ROOT, 'src', 'core', 'server-release.mjs'), version: '0.0.0-nunca' }), /suma real|versión/);
    const plain = path.join(dir, 'server-release.mjs');
    fs.writeFileSync(plain, 'export const SERVER_RELEASE = { version: null, url: null, sha256: null };\n');
    await assert.rejects(checkServerRelease({ file: plain }), /no tiene la suma real/);
    fs.writeFileSync(plain, `export const SERVER_RELEASE = ${JSON.stringify({ version: '3.7.0', url: null, sha256: PLACEHOLDER_SHA256 })};\n`);
    await assert.rejects(checkServerRelease({ file: plain }), /no tiene la suma real/, 'los ceros de relleno tampoco');
    assert.throws(() => releaseModuleSource({ version: '3.7.0', sha256: PLACEHOLDER_SHA256 }), /no es válida/);
    // What dist:server writes: this install.sh's sum, read back by the app's command.
    const install = path.join(dir, 'install.sh'); fs.writeFileSync(install, '#!/bin/sh\necho orb\n');
    const sum = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(install)).digest('hex');
    const file = writeServerRelease({ file: path.join(dir, 'gen.mjs'), version: '3.7.0', sha256: sum });
    const r = await checkServerRelease({ file, version: '3.7.0', install });
    assert.equal(r.sha256, sum); assert.match(r.url, /\/releases\/download\/v3\.7\.0\/install\.sh$/);
    const { SERVER_RELEASE } = await import(`${(await import('node:url')).pathToFileURL(file).href}?x=1`);
    assert.deepEqual(SERVER_RELEASE, { version: '3.7.0', url: r.url, sha256: sum });
    // A different install.sh (rebuilt without writing the module again) or another version: refused.
    fs.appendFileSync(install, '# otro\n');
    await assert.rejects(checkServerRelease({ file, version: '3.7.0', install }), /no coincide/);
    await assert.rejects(checkServerRelease({ file, version: '3.7.1' }), /versión 3\.7\.0/);
    // Without a real sum the app's command carries the placeholder (sha256sum refuses it) and says it is not ready.
    const cmd = serverInstallCommand({ env: {} });
    if (!cmd.ready) assert.match(cmd.command, new RegExp(PLACEHOLDER_SHA256));
    // The release workflow checks it before building the app.
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    assert.equal((wf.match(/release\.mjs check-server-release/g) ?? []).length, 1, 'Windows');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('el paquete del Server lleva Node 24 (crypto.argon2) y playwright-core como módulo de producción', () => {
  assert.equal(NODE_MAJOR, 24);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['playwright-core'], '1.63.0'); assert.ok(!pkg.devDependencies['playwright-core']);
  const sp = serverPackage(pkg);
  assert.equal(sp.engines.node, '>=24'); assert.equal(sp.dependencies['playwright-core'], '1.63.0');
  assert.ok(!sp.dependencies['electron-updater']);
  // The desktop app does not carry it (its browser is Electron's own).
  assert.ok(pkg.build.files.includes('!node_modules/playwright-core/**'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.ok(!lock.packages['node_modules/playwright-core'].dev, 'en el lock, de producción');
  assert.equal(lock.packages[''].dependencies['playwright-core'], '1.63.0');
});
