// 3.7 (WS1): an install from before 3.7 (data in ~/orb, program in ~/orb-nucleo) moves in place to ~/orb-server, in the
// server's layout, keeping the secret, the links and the devices (phones stay linked) and the bots; after a backup;
// with ~/orb and ~/orb-nucleo left as links for one minor version. Then Orb Server's engine starts on it.
import { until } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHome, paths, isServerLayout, forgetLayout, readKey } from '../src/core/home.mjs';
import { useHome } from '../src/core/context.mjs';
import { Board } from '../src/core/board.mjs';
import { createBackup, backupDir, archiveName, homePath } from '../src/core/backup.mjs';
import { migrateLegacy, migrationState, linkDir } from '../src/server/migrate.mjs';
import { createHost } from '../src/server/host.mjs';

function legacyFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-migrar-'));
  const oldHome = path.join(base, 'orb'); fs.mkdirSync(oldHome);
  createHome(oldHome, { userName: 'Dani' });
  const cfg = JSON.parse(fs.readFileSync(path.join(oldHome, 'orb.json'), 'utf8'));
  cfg.role = 'centro'; cfg.mobile = { ...cfg.mobile, enabled: false };
  fs.writeFileSync(path.join(oldHome, 'orb.json'), JSON.stringify(cfg));
  useHome(oldHome);
  const board = new Board();
  board.run("INSERT INTO devices (id, name, token_hash, created_at, kind, kind_ok, public_key) VALUES ('movil-1', 'Móvil de Dani', 'hash-1', ?, 'phone', 1, 'clave-publica')", new Date().toISOString());
  board.run("INSERT INTO bots (name, agent, created_at, updated_at) VALUES ('Casa', 'claude', ?, ?)", new Date().toISOString(), new Date().toISOString());
  board.db.close();
  const p = paths(oldHome);
  fs.writeFileSync(path.join(p.data, 'enlaces.json'), '{"sellado":"x"}');
  fs.mkdirSync(path.join(oldHome, 'bots', '1'), { recursive: true }); fs.writeFileSync(path.join(oldHome, 'bots', '1', 'memoria.md'), 'Riega las plantas.');
  fs.mkdirSync(p.runs, { recursive: true }); fs.writeFileSync(path.join(p.runs, 'nucleo.log'), 'antes\n');
  const oldApp = path.join(base, 'orb-nucleo');
  fs.mkdirSync(path.join(oldApp, '3.6.0'), { recursive: true }); fs.writeFileSync(path.join(oldApp, '3.6.0', 'VERSION'), '3.6.0');
  linkDir(path.join(oldApp, '3.6.0'), path.join(oldApp, 'current'));
  fs.mkdirSync(path.join(oldApp, 'copias')); fs.writeFileSync(path.join(oldApp, 'copias', 'datos-antes.tar.gz'), 'copia');
  fs.mkdirSync(path.join(oldApp, 'paquetes')); fs.writeFileSync(path.join(oldApp, 'paquetes', 'p.tar.gz'), 'p');
  return { base, oldHome, oldApp, home: path.join(base, 'orb-server'), key: fs.readFileSync(p.key) };
}

test('la instalación de antes de 3.7 se muda a ~/orb-server con sus datos, enlaces y dispositivos', async () => {
  const f = legacyFixture();
  try {
    // the installer may have unpacked the new program in ~/orb-server/app already
    fs.mkdirSync(path.join(f.home, 'app', '3.7.0'), { recursive: true });
    assert.equal(migrationState(f), 'migrate');
    let backedUp = null;
    const r = await migrateLegacy({ ...f, backup: async (old) => { const b = await createBackup({ home: old, secret: readKey(old), kind: 'preupdate', folder: backupDir(old) }); backedUp = b.file; return b.file; } });
    assert.equal(r.state, 'migrated');
    forgetLayout();
    assert.ok(backedUp && fs.existsSync(path.join(paths(f.home).internal, 'copias-seguridad', path.basename(backedUp))), 'la copia de antes de migrar viaja con los datos');
    assert.ok(isServerLayout(f.home));
    const p = paths(f.home);
    assert.equal(p.layout, 'server');
    assert.deepEqual(fs.readFileSync(p.key), f.key, 'el mismo secreto: los enlaces siguen sellados igual');
    assert.equal(fs.readFileSync(path.join(p.data, 'enlaces.json'), 'utf8'), '{"sellado":"x"}');
    assert.ok(fs.existsSync(p.db));
    assert.equal(fs.readFileSync(path.join(f.home, 'bots', '1', 'memoria.md'), 'utf8'), 'Riega las plantas.');
    assert.match(fs.readFileSync(path.join(f.home, 'logs', 'nucleo.log'), 'utf8'), /antes/);
    assert.ok(fs.existsSync(path.join(f.home, 'logs', 'bitacora', 'GENERAL.md')));
    for (const d of ['app', 'bots', 'browser', 'data', 'engines', 'logs']) assert.ok(fs.existsSync(path.join(f.home, d)), d);
    assert.ok(!fs.existsSync(path.join(f.home, '.orb')) && !fs.existsSync(path.join(f.home, 'web')), 'ni .orb ni categorías vacías');
    // the old program: its versions in app/, its copies in data/copias/anteriores; the old names are links
    assert.equal(fs.readFileSync(path.join(f.home, 'app', '3.6.0', 'VERSION'), 'utf8'), '3.6.0');
    assert.ok(fs.existsSync(path.join(f.home, 'app', '3.7.0')));
    assert.equal(fs.readFileSync(path.join(p.internal, 'copias', 'anteriores', 'datos-antes.tar.gz'), 'utf8'), 'copia');
    assert.ok(fs.lstatSync(f.oldHome).isSymbolicLink() && fs.realpathSync(f.oldHome) === fs.realpathSync(f.home), '~/orb → ~/orb-server');
    assert.ok(fs.lstatSync(f.oldApp).isSymbolicLink() && fs.existsSync(path.join(f.oldApp, '3.6.0', 'VERSION')), '~/orb-nucleo → app');
    // a second time: nothing to do
    assert.equal(migrationState(f), 'done');
    assert.equal((await migrateLegacy(f)).state, 'done');
    // backups name the PC's paths inside, whatever the layout
    assert.equal(archiveName(f.home, path.join(p.data, 'orb.db')), '.orb/datos/orb.db');
    assert.equal(archiveName(f.home, path.join(p.logs, 'GENERAL.md')), 'bitacora/GENERAL.md');
    assert.equal(homePath(f.home, '.orb/datos/enlaces.json'), path.join(p.data, 'enlaces.json'));
    assert.equal(homePath(f.home, 'bots/1/memoria.md'), path.join(f.home, 'bots', '1', 'memoria.md'));

    // Orb Server's engine on the migrated folder: the bot and the linked phone are there.
    const host = createHost({ home: f.home, version: '3.7.0', mode: 'fork', env: { ORB_REMOTE_BIND: '127.0.0.1' } });
    try {
      await host.start();
      const s = await host.call('app.state');
      assert.equal(s.layout, 'server'); assert.equal(s.role, 'centro');
      assert.ok((await host.call('bots.list')).bots.some((b) => b.name === 'Casa'));
      await until(async () => (await host.call('link.devices', {}, { as: 'control' })).some((d) => d.id === 'movil-1'), 'el móvil sigue enlazado');
    } finally { await host.stop(); }
  } finally { try { fs.rmSync(f.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } }
});

test('no mezcla dos carpetas con datos ni una ~/orb-server con cosas ajenas', async () => {
  const f = legacyFixture();
  try {
    fs.mkdirSync(f.home); fs.writeFileSync(path.join(f.home, 'mio.txt'), 'x');
    await assert.rejects(migrateLegacy(f), /otras cosas/);
    assert.ok(fs.existsSync(path.join(f.oldHome, 'orb.json')), 'nada se movió');
    fs.rmSync(path.join(f.home, 'mio.txt'));
    createHome(f.home, { layout: 'server' });
    assert.equal(migrationState(f), 'conflict');
    await assert.rejects(migrateLegacy(f), /no se mezclan/);
  } finally { try { fs.rmSync(f.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } }
});

test('una migración que se cortó a medias (corte de luz) sigue sola la próxima vez, sin perder nada', async () => {
  const { MIGRATING } = await import('../src/server/migrate.mjs');
  // Cut in the middle of moving ~/orb into an ~/orb-server that already had app/: part moved, part still in ~/orb.
  const f = legacyFixture();
  try {
    fs.mkdirSync(path.join(f.home, 'app', '3.7.0'), { recursive: true });
    for (const d of [f.oldHome, f.home]) fs.writeFileSync(path.join(d, MIGRATING), 'x');
    fs.renameSync(path.join(f.oldHome, '.orb'), path.join(f.home, '.orb'));
    fs.renameSync(path.join(f.oldHome, 'bots'), path.join(f.home, 'bots'));
    assert.equal(migrationState(f), 'migrate');
    let backups = 0;
    const r = await migrateLegacy({ ...f, backup: async () => { backups++; return null; } });
    assert.equal(r.state, 'migrated'); assert.equal(backups, 0, 'sin otra copia a medias');
    forgetLayout();
    const p = paths(f.home);
    assert.ok(isServerLayout(f.home));
    assert.deepEqual(fs.readFileSync(p.key), f.key);
    assert.ok(fs.existsSync(p.db));
    assert.equal(fs.readFileSync(path.join(f.home, 'bots', '1', 'memoria.md'), 'utf8'), 'Riega las plantas.');
    assert.ok(!fs.existsSync(path.join(f.home, MIGRATING)), 'la marca se quita al acabar');
    assert.ok(fs.lstatSync(f.oldHome).isSymbolicLink());
    assert.equal(migrationState(f), 'done');
  } finally { try { fs.rmSync(f.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } }
  // Cut after ~/orb had moved whole but before the server's layout: it is finished, not run in the old layout.
  const g = legacyFixture();
  try {
    fs.writeFileSync(path.join(g.oldHome, MIGRATING), 'x');
    fs.renameSync(g.oldHome, g.home);
    assert.equal(migrationState(g), 'migrate');
    assert.equal((await migrateLegacy(g)).state, 'migrated');
    forgetLayout();
    assert.ok(isServerLayout(g.home));
    assert.ok(fs.existsSync(paths(g.home).db));
  } finally { try { fs.rmSync(g.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ } }
});
