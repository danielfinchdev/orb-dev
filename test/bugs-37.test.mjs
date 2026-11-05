// 3.7 bug wave before release: a shared bot browses with the TALKER's profile; Chromium of the Server under no_new_privs;
// the vault's seal needs a key file outside the data folder (and reads, once, what an earlier build sealed); the owner's
// overview counts «today» in each person's own day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, until } from './helpers.mjs';

test('bot compartido: navega con el perfil de quien habla y solo su dueño tiene «Contraseñas»', async () => {
  const { botBrowserAccess } = await import('../src/engine/bots.mjs');
  const board = { isOwnerPerson: (p) => !p || p === 'admin' };
  // The Admin's bot, the Admin talking: the default profile, with the vault.
  assert.deepEqual(botBrowserAccess(board, { owner: 'admin', talker: 'admin' }), { profile: null, vault: true });
  // The Admin's bot shared with María: María's own profile, never the Admin's cookies, and no vault_fill.
  assert.deepEqual(botBrowserAccess(board, { owner: 'admin', talker: 'maria' }), { profile: 'maria', vault: false });
  // María's own bot: her profile and her vault; the Admin talking to it uses the Admin's profile, without María's vault.
  assert.deepEqual(botBrowserAccess(board, { owner: 'maria', talker: 'maria' }), { profile: 'maria', vault: true });
  assert.deepEqual(botBrowserAccess(board, { owner: 'maria', talker: 'admin' }), { profile: null, vault: false });
});

test('Chromium del Server: con el ayudante de administración arranca con no_new_privs (y dentro de su scope)', async () => {
  const { scopeWrapper, chromiumConfine } = await import('../src/server/browser.mjs');
  assert.equal(chromiumConfine({ platform: 'win32' }), null);
  assert.equal(chromiumConfine({ platform: 'linux', helper: false }), null);
  assert.deepEqual(chromiumConfine({ platform: 'linux', helper: true, setpriv: '/usr/bin/setpriv' }), { setpriv: '/usr/bin/setpriv' });
  assert.throws(() => chromiumConfine({ platform: 'linux', helper: true, setpriv: null }), /no_new_privs/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-nnp-'));
  try {
    const both = fs.readFileSync(scopeWrapper('/opt/c/chrome', dir, { confine: { setpriv: '/usr/bin/setpriv' } }), 'utf8');
    assert.match(both, /exec '\/usr\/bin\/setpriv' --no-new-privs -- systemd-run --user --scope --quiet --collect -p MemoryMax=\S+ -- '\/opt\/c\/chrome' "\$@"/);
    const only = fs.readFileSync(scopeWrapper('/opt/c/chrome', dir, { scope: false, confine: { setpriv: '/usr/bin/setpriv' } }), 'utf8');
    assert.match(only, /exec '\/usr\/bin\/setpriv' --no-new-privs -- '\/opt\/c\/chrome' "\$@"/);
    assert.doesNotMatch(only, /systemd-run/);
    const plain = fs.readFileSync(scopeWrapper('/opt/c/chrome', dir), 'utf8');
    assert.doesNotMatch(plain, /setpriv/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // The launch goes through the wrapper when only no_new_privs applies (no systemd scope).
  const { createServerBrowser } = await import('../src/server/browser.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-nnp-b-'));
  const seen = [];
  const sb = createServerBrowser({ root, display: 'headless', executable: '/opt/c/chrome', scope: false, confine: { setpriv: '/usr/bin/setpriv' }, readMeminfo: () => 'MemAvailable: 8000000 kB',
    launchContext: async (d, o) => { seen.push(o.executablePath); throw new Error('sin Chromium en la prueba'); } });
  try {
    const { browserKey } = await import('../src/core/browser-key.mjs');
    const net = await import('node:net');
    await sb.ready;
    const who = { agent: 'bot:1', session: 's', task: '' };
    const s = net.connect(sb.pipe); s.setEncoding('utf8'); const got = [];
    s.on('data', (c) => got.push(...c.split('\n').filter(Boolean)));
    await new Promise((r) => s.on('connect', r));
    s.write(`${JSON.stringify({ hello: browserKey(sb.token, who), ...who })}\n`);
    s.write(`${JSON.stringify({ id: 1, action: 'open', args: { url: 'https://uno.example' } })}\n`);
    await until(() => seen.length > 0 || got.some((l) => /"id":1/.test(l)), 'el intento de abrir Chromium', 10_000);
    s.end();
    assert.ok(seen.length > 0, 'se intentó abrir');
    assert.match(seen[0], /chromium-en-su-scope\.sh$/);
    assert.match(fs.readFileSync(seen[0], 'utf8'), /--no-new-privs/);
  } finally { await sb.shutdown(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('bóveda: el sello necesita la clave aparte (fuera de data/) y lo sellado antes se lee una vez y se vuelve a sellar', async () => {
  const { vaultKeyFile, vaultKeyDir, loadVaultFileKey } = await import('../src/server/vault/keyfile.mjs');
  const C = await import('../src/server/vault/crypto.mjs');
  const { createVaultService } = await import('../src/server/vault/worker.mjs');
  const t = tempHome();
  try {
    const keys = path.join(t.base, 'claves');
    const file = vaultKeyFile(t.home, { ORB_VAULT_KEY_DIR: keys });
    assert.equal(path.dirname(file), keys);
    assert.ok(!file.startsWith(path.resolve(t.home) + path.sep), 'la clave no está dentro de la carpeta de Orb');
    assert.notEqual(vaultKeyFile(t.home, {}), vaultKeyFile(path.join(t.home, 'otro'), {}), 'una por carpeta');
    assert.equal(vaultKeyDir({ XDG_CONFIG_HOME: path.join(t.base, 'xdg') }), path.join(t.base, 'xdg', 'orb-server'));
    const k1 = loadVaultFileKey(file); const k2 = loadVaultFileKey(file);
    assert.equal(k1.length, 32); assert.ok(k1.equals(k2), 'la misma cada vez');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const bad = path.join(keys, 'mala.key'); fs.writeFileSync(bad, 'corta');
    assert.throws(() => loadVaultFileKey(bad), /dañada/);
    assert.equal(fs.readFileSync(bad, 'utf8'), 'corta', 'una clave dañada nunca se cambia sola');

    const secret = crypto.randomBytes(32);
    const v1 = C.vaultSealKey(secret); const v2 = C.vaultSealKeyV2(secret, k1);
    assert.ok(!v1.equals(v2)); assert.ok(!v2.equals(C.vaultSealKeyV2(secret, crypto.randomBytes(32))), 'sin el archivo no sale la clave');
    // A sign-in sealed by an earlier 3.7 build (server key alone).
    const dir = path.join(t.base, 'vault'); fs.mkdirSync(dir, { recursive: true });
    const cfg = { server: 'https://vault.example', clientId: 'user.x', clientSecret: 's', password: 'p', collection: 'Orb', deviceId: 'd' };
    fs.writeFileSync(path.join(dir, 'vault-p1.json'), JSON.stringify(C.seal(v1, cfg, 'vault:json:p1')));
    const svc = createVaultService({ dir, sealKey: v2, legacyKey: v1 });
    try { assert.equal((await svc.status('p1')).configured, true); } finally { svc.close(); }
    // Sealed again with both keys: v1 alone no longer opens it, v2 does.
    const box = JSON.parse(fs.readFileSync(path.join(dir, 'vault-p1.json'), 'utf8'));
    assert.throws(() => C.open(v1, box, 'vault:json:p1'));
    assert.equal(C.open(v2, box, 'vault:json:p1').server, 'https://vault.example');
    const plain = createVaultService({ dir, sealKey: v2 });
    try { assert.equal((await plain.status('p1')).configured, true); } finally { plain.close(); }
    const stranger = createVaultService({ dir, sealKey: C.vaultSealKeyV2(secret, crypto.randomBytes(32)), legacyKey: v1 });
    try { assert.equal((await stranger.status('p1')).configured, false, 'con solo la carpeta de datos no se abre'); } finally { stranger.close(); }
    // Bots never read the key folder.
    const { botSecretDirs } = await import('../src/core/guard.mjs');
    assert.ok(botSecretDirs().includes(path.resolve(os.homedir(), '.config', 'orb-server')));
  } finally { t.cleanup(); }
});

test('resumen de personas: «hoy» es el día de cada persona, como el que apunta el gasto', async () => {
  const t = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const P = await import('../src/core/persons.mjs');
    const { recordSpend } = await import('../src/core/budget.mjs');
    const board = new Board();
    const owner = board.ownerId();
    // A zone where it is almost always another day than in UTC at some hour: whatever the time, the two must agree.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Madrid']) {
      board.run('UPDATE persons SET tz = ? WHERE id = ?', tz, owner);
      board.run('DELETE FROM usage_ledger');
      recordSpend(board, { person: owner, account: 'claude', usage: { input_tokens: 7, output_tokens: 3 } });
      assert.equal(P.overview(board).find((p) => p.id === owner).today.tokens, 10, tz);
    }
  } finally { t.cleanup(); }
});

test('la bóveda nunca enseña una clave de texto en bruto, y un bot no arranca adb si el usuario no ha usado Android', async () => {
  const t = tempHome();
  try {
    const { knownCode, reasonText } = await import('../src/server/api-vault.mjs');
    assert.equal(knownCode('not_ready'), 'error');
    assert.equal(knownCode('vault_unavailable'), 'vault_unavailable');
    assert.equal(knownCode('x y'), 'error');
    assert.doesNotMatch(reasonText('not_ready'), /^msg\./);
  } finally { t.cleanup(); }
  // pc_android (the «Equipo» tools) only runs adb after the user listed devices in Orb (connections.adb).
  const src = fs.readFileSync(new URL('../src/mcp/bot.mjs', import.meta.url), 'utf8');
  const i = src.indexOf("name: 'pc_android'");
  const body = src.slice(i, src.indexOf("name: 'pc_orb_check'"));
  assert.ok(body.indexOf("settingJson('connections.adb')") > 0 && body.indexOf("settingJson('connections.adb')") < body.indexOf('N.adbDevices('), 'mira antes de arrancar adb');
});
