// 3.7 (Orb Server, WS6): la bóveda de contraseñas. Contra un servidor Bitwarden falso en 127.0.0.1 (la cuenta grabada
// de test/fixtures/vault/account.json; sin red ni Docker): el proceso aparte de la bóveda, la coincidencia de direcciones
// (anti-phishing), el relleno en la página (con una página simulada que oculta lo que la bóveda marca, como WS5), la
// tarjeta de primer uso y los avisos, la bóveda caída, la API por persona, la herramienta vault_fill de los bots y el
// guardián. Los secretos de prueba (CANARY-…) nunca aparecen en registros, resultados, MCP, capturas ni errores.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { tempHome, until, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { ctx } from '../src/core/context.mjs';
import { createPerson, setCaps, mayUseVault } from '../src/core/persons.mjs';
import { principalOf } from '../src/core/authz.mjs';
import { decide } from '../src/core/guard.mjs';
import * as B from '../src/core/bots.mjs';
import { browserKey } from '../src/core/browser-key.mjs';
import { POLICY, PHONE_SET, SECRET_PARAMS } from '../src/core/policy.mjs';
import { uriScore, pickItem, baseDomain, siteIsPage, isPrivateIp } from '../src/server/vault/match.mjs';
import { vaultFill, createVaultFillHook, boardApprovals, boardNotices, FIND_FIELDS, grantVault } from '../src/server/vault/fill.mjs';
import { createVaultService, CACHE_TTL_MS } from '../src/server/vault/worker.mjs';
import * as C from '../src/server/vault/crypto.mjs';

const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'vault', 'account.json'), 'utf8'));
const CANARIES = [F.password, F.clientSecret, 'CANARY-'];
const clean = (what, value) => { const s = typeof value === 'string' ? value : JSON.stringify(value ?? null); for (const c of CANARIES) assert.ok(!s.includes(c), `${what}: no debe contener ${c.slice(0, 12)}…`); };

const t = tempHome();
after(() => t.cleanup());
const board = new Board();
const ana = board.ownerId();
const leo = createPerson(board, { name: 'Leo' }).id;

// ---- a Bitwarden-compatible server, on this machine only
const state = { down: false, revoked: false, tokens: 0, syncs: 0 };
const server = http.createServer((req, res) => {
  if (state.down) { res.destroy(); return; }
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method === 'POST' && req.url === '/identity/connect/token') {
      const f = new URLSearchParams(body);
      state.tokens++;
      if (state.revoked || f.get('client_id') !== F.clientId || f.get('client_secret') !== F.clientSecret || f.get('grant_type') !== 'client_credentials') return send(400, { error: 'invalid_client' });
      return send(200, F.token);
    }
    if (req.method === 'GET' && req.url.startsWith('/api/sync')) { state.syncs++; return req.headers.authorization === `Bearer ${F.token.access_token}` ? send(200, F.sync) : send(401, {}); }
    if (req.method === 'POST' && req.url === '/identity/accounts/prelogin') return send(200, { kdf: 0, kdfIterations: F.kdf.pbkdf2.iterations });
    send(404, {});
  });
});
let BASE = '';
before(async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); BASE = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-vault-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const sealKey = C.vaultSealKey(crypto.randomBytes(32));
const logs = [];
const vault = createVaultService({ dir, sealKey, log: (l) => logs.push(l) });
after(() => vault.close());
const cfg = (patch = {}) => ({ server: BASE, clientId: F.clientId, clientSecret: F.clientSecret, password: F.password, collection: 'Orb', ...patch });
const rejectsCode = (p, c) => assert.rejects(p, (e) => e?.code === c && !CANARIES.some((x) => String(e.message).includes(x)));

// ======================================================================================================================
test('anti-phishing: subdominio, parecido, puerto, http, credenciales en la URL y tipos que nunca coinciden', () => {
  const tienda = { uri: 'https://tienda.example.com/login', match: null };
  const yes = ['https://tienda.example.com/login', 'https://tienda.example.com/otra?x=1', 'https://TIENDA.example.com/'];
  const no = ['https://evil.tienda.example.com/login', 'https://example.com/login', 'https://tienda.example.com.evil.net/login', 'https://tienda-example.com/login',
    'https://tіenda.example.com/login' /* Cyrillic і */, 'http://tienda.example.com/login', 'https://tienda.example.com:8443/login', 'https://ana:x@tienda.example.com/login', 'javascript:alert(1)'];
  for (const u of yes) assert.ok(uriScore(tienda, u) > 0, u);
  for (const u of no) assert.equal(uriScore(tienda, u), 0, u);
  // Base domain only when the item says so (match 0), with the public suffixes.
  const banco = { uri: 'banco.example.co.uk', match: 0 };
  assert.ok(uriScore(banco, 'https://www.banco.example.co.uk/') > 0);
  assert.ok(uriScore(banco, 'https://login.example.co.uk/') > 0, 'mismo dominio base example.co.uk');
  assert.equal(uriScore(banco, 'https://evil.co.uk/'), 0, 'co.uk no es un sitio');
  assert.equal(uriScore({ uri: 'ana.github.io', match: 0 }, 'https://eve.github.io/'), 0, 'github.io: cada subdominio es de otro');
  assert.equal(baseDomain('co.uk'), null);
  // Plain http only to the exact private IP and port an http:// item names.
  const router = { uri: 'http://192.168.1.1:8080', match: null };
  assert.ok(uriScore(router, 'http://192.168.1.1:8080/') > 0);
  for (const u of ['http://192.168.1.1/', 'http://192.168.1.2:8080/', 'http://8.8.8.8:8080/']) assert.equal(uriScore(router, u), 0, u);
  assert.equal(uriScore({ uri: 'http://foo.example', match: null }, 'http://foo.example/'), 0, 'http a una dirección pública: nunca');
  assert.ok(isPrivateIp('100.101.102.103') && isPrivateIp('fd00::1') && !isPrivateIp('8.8.8.8'));
  // Regular expressions and «never» never match; «exact» and «starts with» as Bitwarden.
  assert.equal(uriScore({ uri: '.*', match: 4 }, 'https://tienda.example.com/'), 0);
  assert.equal(uriScore({ uri: 'https://tienda.example.com', match: 5 }, 'https://tienda.example.com/'), 0);
  assert.equal(uriScore({ uri: 'https://tienda.example.com/a', match: 3 }, 'https://tienda.example.com/a/b'), 0);
  assert.ok(uriScore({ uri: 'https://tienda.example.com/a', match: 2 }, 'https://tienda.example.com/a/b') > 0);
  // The best item wins; the «site» the agent names must be the open page.
  const items = [{ uid: 'b', uris: [{ uri: 'example.com', match: 0 }] }, { uid: 'a', uris: [{ uri: 'https://www.example.com', match: null }] }];
  assert.equal(pickItem(items, 'https://www.example.com/').uid, 'a');
  assert.ok(siteIsPage('tienda.example.com', 'https://tienda.example.com/x'));
  assert.ok(!siteIsPage('otra.example.com', 'https://tienda.example.com/x'));
  assert.ok(!siteIsPage('example.com.evil.net', 'https://example.com/'));
});

// ---- a page as WS5's browser hands it to the hook: its SNAPSHOT leaves out what the vault marked (finding 6)
function fakePage({ url = 'https://tienda.example.com/login', fields = { user: 1, pass: 2, otp: null }, info = {}, navigateAfter = null } = {}) {
  const typed = new Map(); const marked = new Set(); const order = []; let focus = null; let keys = 0; let current = url;
  const infoOf = (ref) => ({ tag: 'input', type: ref === fields.pass ? 'password' : 'text', visible: true, origin: new URL(url).origin, top: true, ...(info[ref] ?? {}) });
  return {
    typed, marked, order,
    url: async () => current,
    snapshot: async () => [...typed].map(([ref, v]) => `[${ref}] campo${marked.has(ref) ? '' : ` value="${v}"`}`).join('\n'),
    fieldInfo: async (ref) => infoOf(ref),
    markFilled: async (ref) => { marked.add(ref); order.push(`mark:${ref}`); return true; },
    focusPage: async () => true,
    world: async (code) => {
      if (code === FIND_FIELDS) return fields;
      const m = /__orbRefs \|\| \[\]\)\[(\d+)\]/.exec(code); if (m) { focus = Number(m[1]) + 1; order.push(`focus:${focus}`); return true; }
      return null;
    },
    insertText: async (ch) => { typed.set(focus, (typed.get(focus) ?? '') + ch); if (!marked.has(focus)) order.push('typed-before-mark'); if (navigateAfter && ++keys === navigateAfter) current = 'https://evil.example.net/'; }
  };
}
const fakeVault = (over = {}) => {
  const calls = { secret: 0 };
  return { calls, match: async () => ({ uid: 'u-1', username: true, password: true, totp: true }), secret: async (_p, _u, _id, want) => { calls.secret++; return Object.fromEntries(want.map((w) => [w, w === 'totp' ? '123456' : `CANARY-${w}-x`])); }, ...over };
};
const yesApprovals = { has: () => true, ask: () => { throw new Error('no'); }, used: () => {} };

test('relleno: primera vez, una tarjeta y nada escrito; luego escribe solo en campos visibles y marcados, y devuelve solo ok', async () => {
  const asked = [];
  const ap = { has: () => false, ask: (x) => asked.push(x), used: () => {} };
  const v = fakeVault(); const page = fakePage();
  assert.deepEqual(await vaultFill({ page, person: ana, agent: 'bot:1', site: 'tienda.example.com', vault: v, approvals: ap, pace: () => 0 }), { ok: false, reason: 'needs_approval' });
  assert.deepEqual(asked, [{ person: ana, agent: 'bot:1', host: 'tienda.example.com', uid: 'u-1' }]);
  assert.equal(v.calls.secret, 0, 'sin aprobación no se pide ningún valor a la bóveda'); assert.equal(page.typed.size, 0);
  let used = 0;
  const r = await vaultFill({ page, person: ana, agent: 'bot:1', vault: v, approvals: { ...yesApprovals, used: () => { used++; } }, pace: () => 0 });
  assert.deepEqual(r, { ok: true });
  assert.equal(page.typed.get(1), 'CANARY-username-x'); assert.equal(page.typed.get(2), 'CANARY-password-x');
  assert.ok(!page.order.includes('typed-before-mark'), 'cada campo se marca antes de escribir en él');
  clean('la página leída después (snapshot)', await page.snapshot());
  assert.equal(used, 1, 'después de aprobar, un aviso');
});

test('relleno: iframe de otro origen, campos invisibles, http, otra web y una navegación a mitad se niegan', async () => {
  const run = (page, extra = {}) => vaultFill({ page, person: ana, vault: fakeVault(), approvals: yesApprovals, pace: () => 0, ...extra });
  assert.deepEqual(await run(fakePage({ info: { 1: { origin: 'https://evil.example.net' }, 2: { origin: 'https://evil.example.net' } } })), { ok: false, reason: 'no_fields' });
  assert.deepEqual(await run(fakePage({ info: { 1: { visible: false }, 2: { visible: false } } })), { ok: false, reason: 'no_fields' });
  assert.deepEqual(await run(fakePage({ fields: { user: null, pass: null, otp: null } })), { ok: false, reason: 'no_fields' });
  assert.deepEqual(await run(fakePage({ url: 'http://tienda.example.com/login' })), { ok: false, reason: 'insecure_page' });
  assert.deepEqual(await run(fakePage(), { site: 'banco.example.com' }), { ok: false, reason: 'other_site' });
  const moving = fakePage({ navigateAfter: 3 });
  assert.deepEqual(await run(moving), { ok: false, reason: 'page_changed' });
  assert.ok(!moving.typed.get(2), 'la contraseña no se escribe en la página nueva');
  // The one-time code field (the second step of a sign-in): only the code of now.
  const otp = fakePage({ fields: { user: null, pass: null, otp: 5 } });
  assert.deepEqual(await run(otp), { ok: true }); assert.equal(otp.typed.get(5), '123456');
  // The vault's own refusal (nothing matches this address) is the answer.
  assert.deepEqual(await run(fakePage(), { vault: fakeVault({ match: async () => { throw Object.assign(new Error('no_match'), { code: 'no_match' }); } }) }), { ok: false, reason: 'no_match' });
});

test('aprobaciones y avisos en la base: tarjeta del bot una sola vez, aviso después, bóveda caída avisa una vez al día', () => {
  const bot = B.createBot(board, { name: 'Compras', tools: ['navegador'] });
  const ap = boardApprovals(board, { addRequest: B.addRequest });
  ap.ask({ person: ana, agent: `bot:${bot.id}`, host: 'tienda.example.com', uid: 'u-1' });
  ap.ask({ person: ana, agent: `bot:${bot.id}`, host: 'tienda.example.com', uid: 'u-1' });
  assert.equal(board.all("SELECT * FROM bot_requests WHERE kind = 'vault'").length, 1, 'una tarjeta pendiente basta');
  assert.ok(!ap.has(ana, 'u-1', 'tienda.example.com'));
  grantVault(board, ana, 'u-1', 'tienda.example.com');
  assert.ok(ap.has(ana, 'u-1', 'tienda.example.com')); assert.ok(!ap.has(leo, 'u-1', 'tienda.example.com'), 'por persona');
  assert.ok(!ap.has(ana, 'u-1', 'evil.example.com'), 'por web');
  const notices = () => board.all("SELECT body FROM chat WHERE role = 'notice'").map((r) => r.body);
  const n0 = notices().length;
  ap.used(ana, 'u-1', 'tienda.example.com'); ap.used(ana, 'u-1', 'tienda.example.com');
  assert.equal(notices().length, n0 + 1); assert.match(notices().at(-1), /tienda\.example\.com/);
  const nt = boardNotices(board);
  nt.down(ana, 'vault_unavailable'); nt.down(ana, 'vault_unavailable'); nt.down(ana, 'vault_unavailable');
  assert.equal(notices().length, n0 + 2, 'un aviso al día');
  ap.forget(ana);
  assert.ok(!ap.has(ana, 'u-1', 'tienda.example.com'));
  assert.throws(() => grantVault(board, ana, 'u-1', 'a b'), /sin datos válidos/);
});

// ======================================================================================================================
test('el proceso de la bóveda: una contraseña maestra mala no guarda nada; la buena se prueba, se sella y abre solo lo compartido', async () => {
  await rejectsCode(vault.setup(ana, cfg({ password: 'mala' })), 'wrong_password');
  assert.ok(!vault.configured(ana), 'nada guardado');
  await rejectsCode(vault.setup(ana, cfg({ clientSecret: 'otra' })), 'bad_api_key');
  await rejectsCode(vault.setup(ana, cfg({ collection: 'Nadie' })), 'no_collection');
  await rejectsCode(vault.setup(ana, cfg({ server: 'http://vault.example.com' })), 'insecure_server');
  const st = await vault.setup(ana, cfg());
  assert.equal(st.configured, true); assert.equal(st.items, 4); assert.equal(st.collection, 'Orb');
  clean('el estado', st);
  for (const f of fs.readdirSync(dir)) clean(`el archivo ${f}`, fs.readFileSync(path.join(dir, f), 'utf8'));
  assert.ok(fs.existsSync(path.join(dir, `vault-${ana}.json`)) && fs.existsSync(path.join(dir, `vault-${ana}.cache`)));
  // The cache, opened with the key: still Bitwarden-encrypted, and without the card.
  const cache = C.open(sealKey, JSON.parse(fs.readFileSync(path.join(dir, `vault-${ana}.cache`), 'utf8')), `vault:cache:${ana}`);
  clean('la caché', cache);
  assert.ok(!JSON.stringify(cache).includes('0000c3'), 'la tarjeta no se guarda');
  // Fill time: the uid of the item, then its values for exactly that page.
  const m = await vault.match(ana, 'https://tienda.example.com/login');
  assert.deepEqual(Object.keys(m).sort(), ['password', 'totp', 'uid', 'username']); clean('la coincidencia', m);
  const s = await vault.secret(ana, 'https://tienda.example.com/login', m.uid, ['username', 'password', 'totp']);
  assert.equal(s.password, 'CANARY-PW-tienda-91c2'); assert.match(s.totp, /^\d{6}$/);
  await rejectsCode(vault.secret(ana, 'https://evil.tienda.example.com/login', m.uid, ['password']), 'no_match');
  await rejectsCode(vault.match(ana, 'https://evil.tienda.example.com/login'), 'no_match');
  await rejectsCode(vault.match(ana, 'http://tienda.example.com/login'), 'insecure_page');
  assert.equal((await vault.match(ana, 'http://192.168.1.1:8080/')).username, true, 'el router de casa por http, solo en su IP');
  await rejectsCode(vault.match(leo, 'https://tienda.example.com/login'), 'not_configured');
  clean('los registros', logs);
});

test('bóveda caída: sigue con la caché sellada menos de 24 h; después, o con la clave revocada, falla', async () => {
  state.down = true;
  try {
    assert.equal((await vault.test(ana)).items, 4, 'en memoria (menos de 24 h)');
    // A new process (a restart): only the sealed cache. Made 25 h old: not used any more.
    const fresh = createVaultService({ dir, sealKey, log: (l) => logs.push(l) });
    try {
      assert.ok((await fresh.match(ana, 'https://tienda.example.com/login')).uid, 'la caché de menos de 24 h vale');
      fresh.close();
      const f = path.join(dir, `vault-${ana}.cache`);
      const c = C.open(sealKey, JSON.parse(fs.readFileSync(f, 'utf8')), `vault:cache:${ana}`);
      fs.writeFileSync(f, JSON.stringify(C.seal(sealKey, { ...c, at: Date.now() - CACHE_TTL_MS - 3600_000 }, `vault:cache:${ana}`)));
      const again = createVaultService({ dir, sealKey });
      try { await rejectsCode(again.match(ana, 'https://tienda.example.com/login'), 'vault_unavailable'); } finally { again.close(); }
    } finally { fresh.close(); }
  } finally { state.down = false; }
  // The API key rotated in the vault: nothing more is used, the cache goes.
  state.revoked = true;
  try {
    await rejectsCode(vault.test(ana), 'vault_revoked');
    assert.ok(!fs.existsSync(path.join(dir, `vault-${ana}.cache`)));
  } finally { state.revoked = false; }
  assert.equal((await vault.test(ana)).items, 4, 'con la clave buena, vuelve');
});

test('el gancho del navegador con la bóveda caída: failed y un solo aviso al día para la persona', async () => {
  const hook = createVaultFillHook({ vault, board, addRequest: B.addRequest, allowed: (p) => mayUseVault(board, p), pace: () => 0 });
  grantVault(board, ana, (await vault.match(ana, 'https://tienda.example.com/login')).uid, 'tienda.example.com');
  const page = fakePage();
  assert.deepEqual(await hook({ person: ana, agent: 'bot:1' }, { site: '' }, page), { ok: true });
  assert.equal(page.typed.get(2), 'CANARY-PW-tienda-91c2', 'escrito en la página (y solo ahí)');
  clean('la página leída después', await page.snapshot());
  board.run("DELETE FROM settings WHERE key LIKE 'vault_down:%'");
  const before = board.all("SELECT id FROM chat WHERE role = 'notice'").length;
  state.down = true; const other = createVaultService({ dir, sealKey });
  try {
    fs.rmSync(path.join(dir, `vault-${ana}.cache`), { force: true });
    const h2 = createVaultFillHook({ vault: other, board, allowed: () => true, pace: () => 0 });
    assert.deepEqual(await h2({ person: ana, agent: 'bot:1' }, {}, fakePage()), { ok: false, reason: 'vault_unavailable' });
    assert.deepEqual(await h2({ person: ana, agent: 'bot:1' }, {}, fakePage()), { ok: false, reason: 'vault_unavailable' });
    assert.equal(board.all("SELECT id FROM chat WHERE role = 'notice'").length, before + 1, 'un aviso, no dos');
    // Without the «vault» capability: nothing.
    assert.deepEqual(await hook({ person: leo, agent: 'bot:1' }, {}, fakePage()), { ok: false, reason: 'vault_off' });
  } finally { other.close(); state.down = false; }
  await vault.test(ana);
});

// ======================================================================================================================
test('la API: cada persona la suya; sin permiso del dueño, nada; nunca devuelve un secreto', async () => {
  const { buildServerApi } = await import('../src/server/api-server.mjs');
  const api = buildServerApi({ board, emit: () => {}, log: (l) => logs.push(l), version: 'test', vault });
  const asAna = principalOf(board, { desktop: true });
  const asLeo = principalOf(board, { desktop: true, person: leo });
  for (const m of ['vault.status', 'vault.setup', 'vault.test', 'vault.forget']) { assert.ok(POLICY[m], m); assert.ok(PHONE_SET.has(m), `${m} desde el móvil`); }
  assert.ok(SECRET_PARAMS.has('vault.setup'));
  const st = await api.call('vault.status', {}, asAna);
  assert.equal(st.configured, true); assert.equal(st.items, 4); clean('vault.status', st);
  assert.equal((await api.call('vault.status', {}, asLeo)).allowed, false);
  await assert.rejects(api.call('vault.setup', cfg(), asLeo), /no ha activado/);
  setCaps(board, leo, { vault: true });
  assert.equal((await api.call('vault.status', {}, asLeo)).configured, false, 'la de Ana no es de Leo');
  let error = null;
  try { await api.call('vault.setup', cfg({ password: 'mala' }), asLeo); } catch (e) { error = e; }
  assert.match(error.message, /contraseña maestra no es correcta/); clean('el error', error.message);
  const out = await api.call('vault.setup', cfg(), asLeo);
  assert.equal(out.items, 4); clean('vault.setup', out);
  clean('vault.test', await api.call('vault.test', {}, asLeo));
  assert.deepEqual(await api.call('vault.forget', {}, asLeo), { configured: false });
  assert.equal(vault.configured(leo), false); assert.equal(vault.configured(ana), true, 'olvidar la de Leo no toca la de Ana');
  setCaps(board, leo, { vault: false });
  // Nothing of it in the database's records (events, audit) nor in the log.
  clean('la base', board.all('SELECT * FROM events'));
  clean('la auditoría', board.all('SELECT * FROM audit'));
  clean('los registros', logs);
});

test('el guardián: ningún agente toca los contenedores ni las carpetas de la bóveda (tampoco con permiso total)', () => {
  const deny = (command, why) => assert.equal(decide({ permission: 'total', tool: 'Bash', command }).decision, 'deny', why ?? command);
  deny('docker exec vaultwarden sqlite3 /data/db.sqlite3 .dump');
  deny('docker cp bitwarden:/etc/bitwarden .');
  deny('tar czf copia.tgz /opt/vw-data');
  deny('ls ~/bwdata/env');
  deny('cat ~/orb-server/data/vault/vault-p-1.json');
  deny('cp ~/orb-server/data/vault-old.cache /tmp/');
  assert.equal(decide({ permission: 'total', tool: 'Read', paths: ['/home/ana/orb-server/data/vault/vault-x.cache'] }).decision, 'deny');
  const keep = ctx.config.protected;
  try {
    ctx.config.protected = [];
    deny('cat /home/ana/orb-server/data/vault/vault-x.json', 'la carpeta de la bóveda de Orb Server, siempre');
  } finally { ctx.config.protected = keep; }
});

// ======================================================================================================================
// The bots' «Contraseñas» tool, end to end: fake agent → src/mcp/bot.mjs vault_fill → the browser's pipe → the hook
// (fill.mjs) with a page and a vault of the test → card → approval → ok → notice. The model only ever sees ok/failed.
test('vault_fill de un bot: tarjeta la primera vez, luego ok y un aviso; el modelo solo ve ok o failed', async () => {
  const { Bots } = await import('../src/engine/bots.mjs');
  const token = crypto.randomBytes(16).toString('hex');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\orb-test-vault-${process.pid}` : path.join(os.tmpdir(), `orb-test-vault-${process.pid}.sock`);
  const pages = new Map();
  const hook = createVaultFillHook({ vault: fakeVault({ match: async (_p, url) => { if (!url.startsWith('https://tienda.example.com/')) throw Object.assign(new Error('no_match'), { code: 'no_match' }); return { uid: 'u-9', username: true, password: true, totp: false }; } }),
    board, addRequest: B.addRequest, allowed: (p) => mayUseVault(board, p), pace: () => 0 });
  const seen = [];
  const pipeServer = net.createServer((socket) => {
    let buf = ''; let who = null; socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        if (!who) {
          const want = browserKey(token, { agent: msg.agent, session: msg.session, task: msg.task, person: msg.person ?? '' });
          if (msg.hello !== want) { socket.destroy(); return; }
          who = { agent: msg.agent, person: msg.person || board.ownerId(), key: `${msg.agent}:${msg.session}` };
          socket.write(`${JSON.stringify({ ok: true })}\n`); continue;
        }
        seen.push(msg);
        if (!pages.has(who.key)) pages.set(who.key, fakePage());
        const r = await hook({ person: who.person, agent: who.agent }, msg.args, pages.get(who.key));
        socket.write(`${JSON.stringify({ id: msg.id, ok: true, result: r.ok ? 'ok' : `failed: ${r.reason}` })}\n`);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => pipeServer.listen(pipe, r));
  const keepBrowser = ctx.browser; ctx.browser = { pipe, token };
  const bots = new Bots(board, { emit: () => {}, push: () => {} }).start();
  try {
    const bot = B.createBot(board, { name: 'Tendero', tools: ['navegador', 'contrasenas'] });
    assert.deepEqual(B.effectiveTools(board, bot).sort(), ['contrasenas', 'navegador']);
    const conv = () => board.chat(B.botConversation(board, B.getBot(board, bot.id)), 200);
    const replies = () => conv().filter((l) => l.role === 'bot' && l.meta?.name === 'Tendero');
    bots.send(bot.id, 'Entra\nBOT_CALL vault_fill {"site":"tienda.example.com"}');
    await until(() => replies().some((l) => /vault_fill: failed: needs_approval/.test(l.body)), 'primera vez: hace falta el OK', 30000);
    const card = await until(() => conv().find((l) => l.meta?.kind === 'bot_card' && l.meta.card === 'vault'), 'la tarjeta', 30000);
    assert.match(card.body, /Tendero.*tienda\.example\.com/); clean('la tarjeta', card);
    assert.equal((await bots.decide(card.id, 'allow')).status, 'done');
    bots.send(bot.id, 'Otra vez\nBOT_CALL vault_fill {"site":"tienda.example.com"}');
    await until(() => replies().some((l) => /vault_fill: ok/.test(l.body)), 'ahora sí', 30000);
    assert.ok(board.all("SELECT body FROM chat WHERE role = 'notice'").some((r) => /Orb Server ha iniciado sesión en tienda\.example\.com/.test(r.body)), 'un aviso');
    // Another site: no item matches → failed, nothing typed there.
    bots.send(bot.id, 'Y aquí\nBOT_CALL vault_fill {"site":"evil.example.net"}');
    await until(() => replies().some((l) => /vault_fill: failed: other_site/.test(l.body)), 'otra web', 30000);
    assert.ok(seen.every((m) => m.action === 'vault_fill' && Object.keys(m.args).join() === 'site'));
    // What the model saw, the cards, the requests and the notices: never a value of the vault.
    clean('la conversación', conv()); clean('las peticiones', board.all('SELECT * FROM bot_requests')); clean('los avisos', board.all("SELECT * FROM chat WHERE role = 'notice'"));
    // A bot without the browser does not get the tool at all.
    const sin = B.createBot(board, { name: 'Sin', tools: ['contrasenas'] });
    bots.send(sin.id, 'Prueba\nBOT_CALL vault_fill {}');
    await until(() => board.chat(B.botConversation(board, B.getBot(board, sin.id)), 50).some((l) => l.role === 'bot' && /desconocida/.test(l.body)), 'sin navegador no hay vault_fill', 30000);
  } finally { bots.shutdown(); ctx.browser = keepBrowser; pipeServer.close(); }
});
