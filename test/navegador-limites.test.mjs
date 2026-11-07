// 3.7 (WS5): the bots' browser limits: the human pace per site and the warning before mass actions (also through the
// MCP server of a bot), and the page as text read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, ROOT } from './helpers.mjs';
import { createPace, createMassGuard, memoryStore, siteRules, isDestructive, actionKind, isLocalHost } from '../src/core/browser-limits.mjs';
import { parseSnapshot, formatSnapshot } from '../src/core/browser-protocol.mjs';

test('ritmo humano por web: pausa de 2–5 s, 300 acciones por hora, reglas por sitio y nada en las páginas locales', () => {
  let t = 1_000_000; const store = memoryStore();
  const pace = createPace({ store, now: () => t, random: () => 0.5 });
  assert.deepEqual(pace.take('tienda.example'), { wait: 0 }, 'la primera, ya');
  assert.equal(pace.take('tienda.example').wait, 3500, 'la siguiente espera su pausa (2–5 s)');
  t += 10_000;
  assert.equal(pace.take('tienda.example').wait, 0);
  assert.equal(pace.take('otra.example').wait, 0, 'cada web lleva su cuenta');
  assert.equal(pace.take('localhost').wait, 0); assert.equal(pace.take('192.168.1.20').wait, 0); assert.ok(isLocalHost('127.0.0.1'));
  // The hour's budget: a burst, then one every 12 s (300 an hour); far ahead, refused with when to come back.
  const fast = createPace({ store: memoryStore(), now: () => t, random: () => 0, sites: () => ({ default: { minMs: 0, maxMs: 0, burst: 3, perHour: 300 } }) });
  for (let i = 0; i < 3; i++) assert.equal(fast.take('red.example').wait, 0);
  assert.equal(fast.take('red.example').wait, 12_000, 'sin fichas: espera la siguiente');
  const r = fast.take('red.example');
  assert.equal(r.refuse, true); assert.ok(r.retryMs > 20_000);
  // A site's own rule wins (and covers its subdomains).
  assert.deepEqual(siteRules({ default: { minMs: 1000 }, 'banco.example': { minMs: 8000, maxMs: 9000, perHour: 20 } }, 'www2.banco.example'), { minMs: 8000, maxMs: 9000, perHour: 20, burst: 30 });
  assert.deepEqual(siteRules({}, 'x.example'), { minMs: 2000, maxMs: 5000, perHour: 300, burst: 30 });
});

test('acciones masivas: tras 50 iguales y destructivas, una tarjeta; luego espera, sí o no', () => {
  let t = 0; const store = memoryStore(); const status = new Map();
  const g = createMassGuard({ store, who: 'bot:1', now: () => t, approval: { get: (id) => status.get(id) ?? null } });
  const del = (n) => `[${n}] button "Eliminar publicación ${n}"`;
  assert.ok(isDestructive(del(1)) && !isDestructive('[1] button "Comprar"') && !isDestructive('[2] a "Ver perfil"'));
  assert.equal(actionKind(del(3)), actionKind(del(48)), 'la misma acción aunque cambie el número');
  for (let i = 0; i < 50; i++) { assert.equal(g.check('social.example', del(i)).ok, true); g.done('social.example', del(i)); t += 1000; }
  assert.equal(g.check('social.example', '[9] button "Me gusta"').ok, true, 'lo que no destruye no cuenta');
  assert.equal(g.check('otra.example', del(1)).ok, true, 'otra web, otra cuenta');
  const need = g.check('social.example', del(51));
  assert.equal(need.needsOk, true); assert.equal(need.count, 50);
  g.asked('social.example', del(51), 77); status.set(77, 'waiting');
  assert.equal(g.check('social.example', del(52)).waiting, true);
  status.set(77, 'done');
  assert.equal(g.check('social.example', del(52)).ok, true, 'con el sí, sigue');
  status.set(77, 'denied');
  assert.equal(g.check('social.example', del(53)).denied, true);
  t += 2 * 60 * 60_000;
  assert.equal(g.check('social.example', del(54)).ok, true, 'pasada la hora, cuenta de nuevo');
});

// A bot's MCP server against a stand-in browser that answers with the page as text.
function stubPipe(page) {
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\orb-navegador-limites-${process.pid}-${Math.random().toString(16).slice(2)}` : path.join(os.tmpdir(), `orb-nav-lim-${process.pid}-${Date.now()}.sock`);
  const seen = [];
  const server = net.createServer((s) => {
    let buf = '';
    s.on('data', (c) => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (!m.hello) seen.push(m); s.write(`${JSON.stringify(m.hello ? { ok: true } : { id: m.id, ok: true, result: page() })}\n`); } });
  });
  return { pipe, seen, ready: new Promise((r) => server.listen(pipe, r)), close: () => server.close() };
}
// The MCP child with a time limit on every call: a child that dies (or never answers) fails the test at once instead of
// leaving it waiting forever; close() kills it if it does not exit by itself.
function mcp(home, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp', 'server.mjs')], { env: { ...process.env, ORB_HOME: home, ...env }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const replies = new Map(); let n = 0; let gone = null;
  const exited = new Promise((r) => child.once('exit', (code) => { gone = code ?? 'killed'; for (const [, fn] of replies) fn(null); replies.clear(); r(); }));
  readline.createInterface({ input: child.stdout }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } const fn = replies.get(m.id); if (fn) { replies.delete(m.id); fn(m); } });
  const rpc = (method, params, ms = 30_000) => new Promise((resolve, reject) => {
    if (gone != null) return reject(new Error(`el servidor MCP terminó (${gone})`));
    const id = ++n;
    const timer = setTimeout(() => { replies.delete(id); reject(new Error(`${method}: sin respuesta en ${ms} ms`)); }, ms);
    replies.set(id, (m) => { clearTimeout(timer); return m ? resolve(m) : reject(new Error(`el servidor MCP terminó (${gone}) durante ${method}`)); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}
`);
  });
  return {
    rpc,
    call: async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; },
    close: async () => {
      if (gone == null) { child.stdin.end(); const t = setTimeout(() => child.kill(), 5000); await exited; clearTimeout(t); }
    }
  };
}

test('MCP de un bot: el clic de riesgo por número se reconoce, y la tarjeta de acciones masivas sale a la 51', async () => {
  const h = tempHome({ browser: { sites: { default: { minMs: 0, maxMs: 0, burst: 500, perHour: 5000 } } } });
  const { Board } = await import('../src/core/board.mjs');
  const B = await import('../src/core/bots.mjs');
  const { agentToken } = await import('../src/engine/sessions.mjs');
  const board = new Board();
  const bot = B.createBot(board, { name: 'Limpieza', role_text: 'ordena mis redes', tools: ['navegador'] });
  const page = () => formatSnapshot({ title: 'Mis publicaciones', url: 'https://social.example/yo', text: 'publicaciones', cut: false, scroll: { y: 0, height: 800, view: 800 },
    elements: ['[1] button "Eliminar publicación"', '[2] button "Comprar ahora"', '[3] a "Inicio" -> https://social.example/'] });
  const stub = stubPipe(page); await stub.ready;
  const who = `bot:${bot.id}`;
  const c = mcp(h.home, { ORB_AGENT: who, ORB_AGENT_TOKEN: agentToken(board, who), ORB_BROWSER_ONLY: '1', ORB_BROWSER_PIPE: stub.pipe, ORB_BROWSER_TOKEN: 'a'.repeat(64), ORB_SESSION: `bot-${bot.id}` });
  try {
    await c.rpc('initialize', {});
    assert.equal((await c.call('orb_browser_open', { url: 'https://social.example/yo' })).error, false);
    // «Comprar ahora» by its number needs the person's OK (before 3.7 the label was never read from the text).
    const buy = await c.call('orb_browser_click', { ref: 2 });
    assert.equal(buy.error, true); assert.match(buy.text, /bot_confirm/);
    for (let i = 0; i < 50; i++) assert.equal((await c.call('orb_browser_click', { ref: 1 })).error, false, `clic ${i + 1}`);
    const card = await c.call('orb_browser_click', { ref: 1 });
    assert.equal(card.error, true); assert.match(card.text, /Llevas 50 veces/);
    const req = board.all("SELECT id, kind, payload, status FROM bot_requests WHERE bot_id = ? AND kind = 'confirm'", bot.id).at(-1);
    assert.ok(req, 'la tarjeta pedida');
    const p = JSON.parse(req.payload);
    assert.match(p.detail, /condiciones de uso/); assert.match(p.detail, /no es asesoramiento legal/); assert.equal(p.url, 'https://social.example');
    assert.match((await c.call('orb_browser_click', { ref: 1 })).text, /Sigue pendiente/);
    board.run("UPDATE bot_requests SET status = 'done' WHERE id = ?", req.id);
    assert.equal((await c.call('orb_browser_click', { ref: 1 })).error, false, 'con el sí, sigue');
    assert.equal(stub.seen.filter((m) => m.action === 'click').length, 51, 'el navegador solo recibió los permitidos');
  } finally { await c.close(); stub.close(); h.cleanup(); }
});

// 3.7: one sign-in tool only, vault_fill of the bots' «Contraseñas» group (src/mcp/bot.mjs; test/boveda.test.mjs): the
// general MCP server never offers a second one, whatever the environment says.
test('la página como texto se lee de vuelta (dirección y elementos)', () => {
  const s = parseSnapshot(formatSnapshot({ title: 'T', url: 'https://a.example/x', text: 'hola', cut: false, scroll: { y: 0, height: 1, view: 1 }, elements: ['[1] button "Pagar"', '[2] a "Más"'] }, { notes: ['AVISO'] }));
  assert.deepEqual(s, { url: 'https://a.example/x', elements: ['[1] button "Pagar"', '[2] a "Más"'] });
  assert.equal(parseSnapshot('Navegador cerrado.'), null);
});

// ---- the live view against a stand-in CDP session: Chromium makes a picture each time the last one was acknowledged.
