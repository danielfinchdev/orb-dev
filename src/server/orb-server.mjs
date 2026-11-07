#!/usr/bin/env node
// 3.5, Orb Server: the command the server runs (by hand or from systemd, orb-nucleo.service).
//   orb-server [--home <carpeta>] [--papel centro|todo|taller]   start the engine and keep it running
//   orb-server estado [--home <carpeta>]                    start, print app.state in short and stop (a quick check)
//   orb-server entrar <claude|codex|cuenta> [--home …]      sign an agent's account in from this terminal (link + code)
//   orb-server enlazar [--home <carpeta>] [--no-esperar]    a Magic Link QR (drawn in the terminal), short code and address,
//         [--tipo movil|navegador|orb]                      so a phone or another Orb can link to a server
//         [--admin] [--taller]                              without a screen; waits until one links (or the code expires).
//                                                           3.5.1: --tipo: what it is for (default a phone or a browser);
//                                                           --admin: it may administer this server even if
//                                                           another device does (a lost phone); --taller: the Orb may
//                                                           program for this one
//   orb-server dispositivos [--home …]                      3.5.1: the linked devices (id, kind, administers, last seen)
//   orb-server quitar <id|nombre> [--home …]                3.5.1: close a device's link (a lost or stolen phone)
//   orb-server copia ahora|lista|clave [--clave <código>]  3.6: a backup now, the list, a new recovery code (or yours)
//   orb-server copia restaurar <archivo> [--clave <código>] check and restore a backup (the service applies it when it
//                                                           starts again; stopped, it is applied at once)
//   orb-server mover exportar --clave <código>              a copy to move this Orb to another machine (this one stops)
//   orb-server mover importar <archivo> --clave <código> [--home <carpeta nueva>]  the moved Orb, on the new machine
//   orb-server migrar [--home …]                            3.7: an install from before 3.7 (~/orb, ~/orb-nucleo) moves to
//                                                           ~/orb-server (with the service stopped; the installer runs it)
//   orb-server emparejar <código>@<dirección>#<huella>      3.7: pairs this server with the Orb app that gave the command
//   orb-server motores [instalar claude|codex]               3.7: the agent engines (downloaded on demand)
//   orb-server actualizar [--comprobar]                      3.7: a newer 3.7.x, signed (it updates by itself once a day)
//   orb-server --version
// The Orb folder: --home, else ORB_HOME, else ~/orb-server (3.7). Its log: logs/nucleo.log (and the console).
// While it runs, the same user's commands reach it through a local socket (src/server/control.mjs).
import readline from 'node:readline';
import { createHost, prepareHome, defaultHome, packageVersion } from './host.mjs';
import { serveControl, controlCall, pickDevice } from './control.mjs';
import path from 'node:path';
import { qrTerminal } from '../core/qr.mjs';
import { readKey } from '../core/home.mjs';
import { stageRestore, applyPendingRestore } from '../core/backup.mjs';
import { moveImport } from '../core/export.mjs';
import { translator, painter } from './console-text.mjs';
import { startWatchdog } from './watchdog.mjs';

// 3.7: what Orb Server writes (its database, settings, logs, the vault) is for this user only, whatever the umask of the
// shell or of systemd is (another user of the machine reads nothing).
if (process.platform !== 'win32') process.umask(0o077);

function parse(argv) {
  const o = { command: 'run', home: null, profile: null, account: null, wait: true, admin: false, kind: null, taller: false, target: null, sub: null, file: null, code: process.env.ORB_BACKUP_CODE || null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--home') o.home = argv[++i];
    else if (a.startsWith('--home=')) o.home = a.slice(7);
    else if (a === '--papel' || a === '--profile') o.profile = argv[++i];
    else if (a === '--version' || a === '-v') o.command = 'version';
    else if (a === '--help' || a === '-h') o.command = 'help';
    else if (a === '--no-esperar' || a === '--no-wait') o.wait = false;
    else if (a === 'estado' || a === 'status') o.command = 'status';
    else if (a === 'enlazar' || a === 'link' || a === 'pair') o.command = 'link';
    else if (a === '--admin') o.admin = true;
    else if (a === '--taller' || a === '--workshop') o.taller = true;
    else if (a === '--tipo' || a === '--kind') { o.kind = KIND_WORDS[String(argv[++i] ?? '').toLowerCase()]; if (!o.kind) throw new Error('tipo: movil, navegador u orb'); }
    else if (a === 'dispositivos' || a === 'devices') o.command = 'devices';
    // 3.6 «Personas»: the people of this server, a new one, a PIN taken away, a QR for someone.
    else if (a === 'usuarios' || a === 'users' || a === 'personas' || a === 'persons') o.command = 'persons'; // «personas»: hidden alias (3.6 betas)
    else if (a === 'usuario' || a === 'user' || a === 'persona' || a === 'person') { const sub = String(argv[++i] ?? '').toLowerCase(); if (!['nuevo', 'nueva', 'new'].includes(sub)) throw new Error('orb-server usuario nuevo <nombre>'); o.command = 'personNew'; o.target = argv.slice(i + 1).join(' ').trim(); i = argv.length; if (!o.target) throw new Error('falta el nombre: orb-server usuario nuevo <nombre>'); }
    else if (a === 'pin-reset') { o.command = 'pinReset'; o.target = argv[++i]; if (!o.target) throw new Error('falta el usuario: orb-server pin-reset <usuario>'); }
    else if (a === '--usuario' || a === '--user' || a === '--persona' || a === '--person') { o.person = argv[++i]; if (!o.person) throw new Error('falta el usuario: --usuario <nombre>'); }
    // 3.6: backups and moving the Orb.
    else if (a === 'copia' || a === 'backup') {
      o.command = 'backup'; o.sub = { ahora: 'now', now: 'now', lista: 'list', list: 'list', restaurar: 'restore', restore: 'restore', clave: 'code', code: 'code' }[String(argv[++i] ?? '').toLowerCase()];
      if (!o.sub) throw new Error('orb-server copia ahora|lista|restaurar <archivo>|clave');
      if (o.sub === 'restore') { o.file = argv[++i]; if (!o.file) throw new Error('falta el archivo: orb-server copia restaurar <archivo>'); }
    }
    else if (a === 'mover' || a === 'move') {
      o.command = 'move'; o.sub = { exportar: 'export', export: 'export', importar: 'import', import: 'import' }[String(argv[++i] ?? '').toLowerCase()];
      if (!o.sub) throw new Error('orb-server mover exportar|importar <archivo>');
      if (o.sub === 'import') { o.file = argv[++i]; if (!o.file) throw new Error('falta el archivo: orb-server mover importar <archivo>'); }
    }
    else if (a === '--clave' || a === '--code') o.code = argv[++i] ?? null;
    else if (a === 'quitar' || a === 'revoke' || a === 'remove') { o.command = 'revoke'; o.target = argv[++i]; if (!o.target) throw new Error('falta el dispositivo: orb-server quitar <id>'); }
    // 3.5 «Solo Orb»: the sign-in without a screen: the link and the code are printed, Claude's code is pasted here.
    else if (a === 'entrar' || a === 'login') { o.command = 'login'; o.account = argv[++i]; if (!o.account) throw new Error('falta la cuenta: orb-server entrar claude'); }
    // 3.7 (WS1)
    else if (a === 'migrar' || a === 'migrate') o.command = 'migrate';
    else if (a === 'emparejar' || a === 'pair-app') { o.command = 'pair'; o.target = argv[++i]; if (!o.target) throw new Error('orb-server emparejar <código>@<dirección>#<huella>'); }
    else if (a === '--pair') { o.command = 'pair'; o.target = argv[++i]; if (!o.target) throw new Error('orb-server --pair <código>@<dirección>#<huella>'); }
    else if (a === 'motores' || a === 'engines') { o.command = 'engines'; if (['instalar', 'install'].includes(String(argv[i + 1] ?? '').toLowerCase())) { i++; o.target = argv[++i]; if (!o.target) throw new Error('orb-server motores instalar claude|codex'); } }
    else if (a === 'actualizar' || a === 'update') o.command = 'update';
    else if (a === '--comprobar' || a === '--check') o.checkOnly = true;
    else throw new Error(`no entiendo «${a}» (prueba --help)`);
  }
  return o;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KIND_WORDS = { movil: 'phone', 'móvil': 'phone', phone: 'phone', navegador: 'browser', browser: 'browser', orb: 'orb' };

// The running service (through its local socket) or, when it is not running, the engine just for this command.
async function withEngine(home, version, fn) {
  const t = translator(); const p = painter();
  let own = null; let call;
  try { await controlCall(home, 'app.state', {}, { timeoutMs: 5000 }); call = (m, params) => controlCall(home, m, params); }
  catch {
    console.log(p.dim(t('term.server.ownEngine')));
    own = createHost({ home, version, echo: false });
    await own.start();
    call = (m, params) => own.call(m, params, { as: 'control' });
  }
  try { return await fn(call); } finally { if (own) await own.stop(); }
}
// 3.6 «Personas»: who uses this server (names and numbers only), a new person, and a PIN taken away (a forgotten PIN: the
// person chooses a new one).
const personByName = (list, name) => { const q = String(name ?? '').trim().toLowerCase(); return list.find((x) => x.id === name || x.name.toLowerCase() === q) ?? null; };
async function personsCommand(home, version) {
  const t = translator(); const p = painter();
  return withEngine(home, version, async (call) => {
    const list = await call('persons.overview');
    for (const x of list) {
      const marks = [x.role === 'owner' ? t('term.server.isOwner') : null, x.hasPin ? t('term.server.hasPin') : null].filter(Boolean).join(', ');
      console.log(`${p.bold(x.name)}  ${p.dim(t('term.server.personDevices', { n: x.devices }))}${marks ? `  ${p.yellow(marks)}` : ''}`);
    }
    console.log(p.dim(t('term.server.personsHint', { cmd: 'orb-server enlazar --usuario <nombre>' })));
    return 0;
  });
}
async function personNewCommand(home, version, name) {
  const t = translator(); const p = painter();
  return withEngine(home, version, async (call) => {
    const x = await call('persons.create', { name });
    console.log(p.green(t('term.server.personCreated', { name: x.name })));
    console.log(p.dim(t('term.server.personsHint', { cmd: `orb-server enlazar --usuario "${x.name}"` })));
    return 0;
  });
}
async function pinResetCommand(home, version, name) {
  const t = translator(); const p = painter();
  return withEngine(home, version, async (call) => {
    const x = personByName(await call('persons.list'), name);
    if (!x) { console.error(t('term.server.noPerson', { name })); return 1; }
    await call('persons.setPin', { id: x.id, pin: null });
    console.log(p.green(t('term.server.pinReset', { name: x.name })));
    return 0;
  });
}
// 3.5.1: the linked devices, and closing one's link, from the server itself.
async function devicesCommand(home, version) {
  const t = translator(); const p = painter();
  return withEngine(home, version, async (call) => {
    const list = await call('link.devices');
    if (!list.length) { console.log(t('term.server.noDevices')); return 0; }
    for (const d of list) {
      const when = d.online ? t('term.server.onNow') : d.lastSeen ? d.lastSeen.slice(0, 16).replace('T', ' ') : '-';
      const marks = [d.admin ? t('term.server.isAdmin') : null, d.kind === 'orb' && !d.confirmed ? t('term.server.unconfirmed') : null].filter(Boolean).join(', ');
      console.log(`${p.bold(d.id.slice(0, 8))}  ${d.name}  ${p.dim(`${d.kind}${d.role ? `/${d.role}` : ''}`)}  ${when}${marks ? `  ${p.yellow(marks)}` : ''}`);
    }
    console.log(p.dim(t('term.server.revokeHint', { cmd: 'orb-server quitar <id>' })));
    return 0;
  });
}
async function revokeCommand(home, version, target) {
  const t = translator(); const p = painter();
  return withEngine(home, version, async (call) => {
    const pick = pickDevice(await call('link.devices'), target);
    if (pick.error) { console.error(t(pick.error === 'many' ? 'term.server.ambiguous' : 'term.server.noSuch', { name: target })); return 1; }
    await call('link.revoke', { id: pick.device.id });
    console.log(p.green(t('term.server.removed', { name: pick.device.name })));
    return 0;
  });
}

// 3.6: backups from the server itself. With the service running they go through its local socket.
const serviceRunning = async (home) => { try { await controlCall(home, 'app.state', {}, { timeoutMs: 5000 }); return true; } catch { return false; } };
async function backupCommand(home, version, o) {
  const t = translator(); const p = painter();
  if (o.sub === 'restore') {
    const file = path.resolve(o.file);
    if (await serviceRunning(home)) {
      const r = await controlCall(home, 'backup.restore', { file, passphrase: o.code ?? undefined }, { timeoutMs: 30 * 60_000 });
      console.log(p.green(t('data.server.restoreReady', { files: r.files })));
      console.log(t('data.server.restartService'));
      return 0;
    }
    const r = await stageRestore(home, file, { secret: readKey(home), passphrase: o.code });
    const applied = applyPendingRestore(home);
    console.log(p.green(t('data.server.restoreReady', { files: r.files })));
    console.log(t('data.server.restoreDone', { aside: applied?.aside ?? '-' }));
    return 0;
  }
  return withEngine(home, version, async (call) => {
    if (o.sub === 'now') { const r = await call('backup.now', {}); console.log(p.green(t('data.server.backupDone', { file: r.path, files: r.files }))); return 0; }
    if (o.sub === 'code') {
      const r = await call('backup.recovery', { code: o.code ?? '' });
      if (r.code) { console.log(t('data.server.recoveryCode')); console.log(`\n  ${p.bold(r.code)}\n`); } else console.log(p.green(t('data.server.recoverySet')));
      return 0;
    }
    const st = await call('backup.status', {});
    const list = await call('backup.list', {});
    console.log(p.dim(t('data.server.backupsIn', { folder: st.folder })));
    if (!list.length) { console.log(t('data.server.noBackups')); return 0; }
    for (const b of list) console.log(`${String(b.created ?? '?').slice(0, 16).replace('T', ' ')}  ${String(b.kind).padEnd(12)} ${String(Math.round(b.size / 1024)).padStart(8)} KB  ${b.name}${b.damaged ? `  ${p.yellow('!')}` : ''}`);
    return 0;
  });
}
async function moveCommand(home, version, o, target = null) {
  const t = translator(); const p = painter();
  if (!o.code) { console.error(t('data.server.needCode')); return 1; }
  if (o.sub === 'export') {
    return withEngine(home, version, async (call) => { const r = await call('data.moveExport', { passphrase: o.code }); console.log(p.green(t('data.server.moveDone', { file: r.path }))); return 0; });
  }
  await moveImport({ target, file: path.resolve(o.file), passphrase: o.code });
  console.log(p.green(t('data.server.moveImported', { home: target })));
  return 0;
}

// The QR, the short code and the address of this server, and the wait for a device to use them. With the service
// running, through its local socket; otherwise the engine is started just for this (and the wait is needed).
async function linkDevice(home, o, version) {
  const t = translator(); const p = painter();
  let call; let own = null;
  try { await controlCall(home, 'app.state', {}, { timeoutMs: 5000 }); call = (m, params) => controlCall(home, m, params); }
  catch {
    console.log(p.dim(t('term.server.ownEngine')));
    own = createHost({ home, version, echo: false });
    await own.start();
    call = (m, params) => own.call(m, params, { as: 'control' });
  }
  let code = 0;
  const stop = async () => { if (own) { const h = own; own = null; await h.stop(); } };
  const onSignal = () => { stop().finally(() => process.exit(130)); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const known = new Set((await call('link.devices')).map((d) => d.id));
    // 3.5.1: what it is for is chosen here; «Puede administrar» goes to the first device, or to this one with --admin
    // (whoever runs this on the server is its owner: a lost phone is replaced so).
    // 3.6: --persona: whom the device is for (default the owner); «Puede administrar» only for the owner's.
    let forPerson = null;
    if (o.person) { forPerson = personByName(await call('persons.list'), o.person); if (!forPerson) { console.error(t('term.server.noPerson', { name: o.person })); return 1; } }
    const ownerDevice = !forPerson || forPerson.role === 'owner';
    const q = await call('link.qr', { admin: ownerDevice ? (o.admin ? true : 'first') : false, ...(forPerson ? { person: forPerson.id } : {}), ...(o.kind ? { device: o.kind } : {}), ...(o.taller ? { dev: true } : {}) });
    if (forPerson) console.log(p.dim(t('term.server.forPerson', { name: forPerson.name })));
    console.log(`\n${p.bold(t('term.server.title', { name: q.name }))}\n`);
    console.log(qrTerminal(q.url, { color: p.on }));
    console.log(`\n${t('term.server.scan')}`);
    console.log(`  ${p.bold(t('term.server.code', { code: q.code }))}`);
    console.log(`  ${t('term.server.address', { address: q.address })}`);
    console.log(`  ${p.dim(q.url)}`);
    console.log(`  ${t('term.server.fp', { fp: q.pc })}`);
    if (q.admin) console.log(`  ${p.yellow(t('term.server.givesAdmin'))}`);
    console.log(p.dim(t('term.server.expires', { min: Math.max(1, Math.round((q.expiresAt - Date.now()) / 60_000)) })));
    if (!o.wait && !own) return 0;
    console.log(p.dim(t('term.server.waiting')));
    for (;;) {
      await wait(1000);
      const fresh = (await call('link.devices')).find((d) => !known.has(d.id));
      if (fresh) { console.log(p.green(t('term.server.linked', { name: fresh.name }))); break; }
      if (Date.now() > q.expiresAt) { console.log(p.yellow(t('term.server.expired'))); code = 1; break; }
    }
  } finally {
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    await stop();
  }
  return code;
}

// 3.7: «código@dirección#huella», what the app's «Añadir Orb Server» puts in the install command (the fingerprint of the
// app's key: the link is made only with that app).
export function parsePair(text) {
  const m = /^([A-Za-z0-9-]{4,40})@([^#\s]{3,300})#([A-Za-z0-9:_-]{6,128})$/.exec(String(text ?? '').trim());
  if (!m) throw new Error('el emparejado va así: <código>@<dirección>#<huella>');
  return { code: m[1], address: m[2], fp: m[3] };
}
async function pairCommand(home, version, target) {
  const t = translator(); const p = painter();
  const pair = parsePair(target);
  return withEngine(home, version, async (call) => {
    try { await call('link.connect', pair); }
    catch (error) {
      // The app could not be reached from here: a short code the app can use instead (link.connect on its side).
      console.error(p.yellow(t('term.server.pairFailed', { error: error.message })));
      const q = await call('link.qr', { admin: 'first', device: 'orb' });
      console.log(t('term.server.pairFallback'));
      console.log(`  ${p.bold(t('term.server.code', { code: q.code }))}`);
      console.log(`  ${t('term.server.address', { address: q.address })}`);
      return 1;
    }
    console.log(p.green(t('term.server.paired')));
    return 0;
  });
}
async function migrateCommand(home) {
  const { migrateLegacy, legacyPaths } = await import('./migrate.mjs');
  const { createBackup, backupDir, pruneBackups } = await import('../core/backup.mjs');
  const { loadConfig } = await import('../core/home.mjs');
  const where = { ...legacyPaths(), ...(home ? { home } : {}) };
  if (await serviceRunning(where.oldHome).catch(() => false)) { console.error('Orb Server está en marcha: páralo antes (systemctl --user stop orb-nucleo orb-server)'); return 1; }
  const r = await migrateLegacy({ ...where, log: () => {},
    backup: async (old) => { const config = loadConfig(old); const b = await createBackup({ home: old, secret: readKey(old), kind: 'preupdate', folder: backupDir(old, config) }); await pruneBackups(backupDir(old, config)).catch(() => {}); return b.file; } });
  for (const line of r.steps) console.log(`- ${line}`);
  console.log(r.state === 'migrated' ? `Migrado: tus datos están en ${where.home}` : r.state === 'done' ? `Nada que migrar: ${where.home} ya es de Orb Server` : 'Nada que migrar');
  return 0;
}
async function enginesCommand(home, version, target) {
  return withEngine(home, version, async (call) => {
    if (target) { const r = await call('server.engines.install', { id: target }); console.log(`${target} ${r.version}`); return 0; }
    for (const e of await call('server.engines')) console.log(`${e.label.padEnd(8)} ${e.installed ? e.version : '-'}`);
    return 0;
  });
}
async function updateCommand(home, version, checkOnly) {
  return withEngine(home, version, async (call) => {
    const c = await call('server.update.check', {});
    if (!c.available) { console.log(`Orb Server ${version}: no hay una versión nueva`); return 0; }
    console.log(`Hay una versión nueva: ${c.available.version}`);
    if (checkOnly) return 0;
    const r = await call('server.update.apply', {});
    console.log(r.updated ? `Actualizado a ${r.version}: el servicio arranca de nuevo` : 'Sin cambios');
    return 0;
  });
}

async function main() {
  const o = parse(process.argv.slice(2));
  const version = packageVersion();
  if (o.command === 'version') { console.log(version); return; }
  if (o.command === 'help') { console.log('orb-server [--home <carpeta>] [--papel centro|todo|taller] | estado | migrar | emparejar <código>@<dirección>#<huella> | motores [instalar claude|codex] | actualizar [--comprobar] | entrar <claude|codex|cuenta> | enlazar [--tipo movil|navegador|orb] [--admin] [--taller] [--no-esperar] | dispositivos | quitar <id> | usuarios | usuario nuevo <nombre> | pin-reset <usuario> | enlazar --usuario <nombre> | copia ahora|lista|restaurar <archivo>|clave [--clave <código>] | mover exportar|importar <archivo> --clave <código> | --version'); return; }
  // 3.6: importing a moved Orb goes into a folder that is not an Orb yet (nothing is prepared there first).
  if (o.command === 'move' && o.sub === 'import') { process.exit(await moveCommand(null, version, o, path.resolve(o.home ? o.home : defaultHome()))); }
  if (o.command === 'migrate') { process.exit(await migrateCommand(o.home ? path.resolve(o.home) : null)); }
  // 3.7: a migration from before 3.7 that was cut in the middle (power cut, kill) is finished before anything starts on
  // a half-moved folder (src/server/migrate.mjs › MIGRATING).
  {
    const { legacyPaths, MIGRATING } = await import('./migrate.mjs');
    const { existsSync } = await import('node:fs');
    const where = { ...legacyPaths(), ...(o.home ? { home: path.resolve(o.home) } : {}) };
    if (existsSync(path.join(where.home, MIGRATING)) || existsSync(path.join(where.oldHome, MIGRATING))) {
      const code = await migrateCommand(o.home ? path.resolve(o.home) : null);
      if (code) process.exit(code);
    }
  }
  const home = prepareHome(o.home ? o.home : defaultHome(), { profile: o.profile });
  if (o.command === 'backup') { process.exit(await backupCommand(home, version, o)); }
  if (o.command === 'move') { process.exit(await moveCommand(home, version, o)); }
  if (o.command === 'link') { process.exit(await linkDevice(home, o, version)); }
  if (o.command === 'devices') { process.exit(await devicesCommand(home, version)); }
  if (o.command === 'persons') { process.exit(await personsCommand(home, version)); }
  if (o.command === 'personNew') { process.exit(await personNewCommand(home, version, o.target)); }
  if (o.command === 'pinReset') { process.exit(await pinResetCommand(home, version, o.target)); }
  if (o.command === 'revoke') { process.exit(await revokeCommand(home, version, o.target)); }
  if (o.command === 'pair') { process.exit(await pairCommand(home, version, o.target)); }
  if (o.command === 'engines') { process.exit(await enginesCommand(home, version, o.target)); }
  if (o.command === 'update') { process.exit(await updateCommand(home, version, o.checkOnly)); }
  let onLogin = () => {};
  const host = createHost({ home, version, echo: o.command === 'run', onEvent: (event, payload) => {
    if (event === 'agents:login') onLogin(payload);
    // 3.7: a new version that does not even start goes back to the previous one (src/server/update.mjs).
    if (event === 'engine:failed' && o.command === 'run') import('./update.mjs').then(({ rollback, appDirOf }) => { const app = appDirOf(); if (app && rollback(app, host.log)) process.exit(1); }).catch(() => {});
  } });
  let control = null;
  let closing = false;
  const close = async (why) => {
    if (closing) return; closing = true;
    host.log(`cerrando (${why})`);
    await control?.close().catch(() => {});
    const r = await host.stop();
    process.exit(r.clean ? (process.exitCode ?? 0) : 1);
  };
  process.on('SIGTERM', () => close('SIGTERM'));
  process.on('SIGINT', () => close('SIGINT'));
  process.on('SIGHUP', () => close('SIGHUP'));
  let info;
  try { info = await host.start(); }
  catch (error) {
    if (o.command === 'run') { const { rollback, appDirOf } = await import('./update.mjs'); const app = appDirOf(); if (app) rollback(app, host.log); }
    throw error;
  }
  if (o.command === 'status') {
    const s = await host.call('app.state');
    const remote = await host.call('remote.status').catch(() => null);
    console.log(JSON.stringify({ version: s.version, home: s.home, role: s.role, name: info.name, agents: s.agentsAvailable, remote: remote ? { running: remote.running, routes: remote.routes?.map((r) => r.url), error: remote.error } : null }, null, 2));
    await close('estado');
    return;
  }
  if (o.command === 'run') {
    // The local door for «orb-server enlazar» while the service runs.
    control = serveControl({ home, call: (m, params) => host.call(m, params, { as: 'control' }), log: host.log });
    const where = await control.ready;
    if (where) host.log(`control local en ${where}`);
    // 3.7: systemd's watchdog (orb-server.service): told only while the engine answers.
    startWatchdog({ healthy: async () => Boolean(await host.call('app.lockState').catch(() => null)), log: host.log });
    return;
  }
  if (o.command === 'login') {
    const r = await host.call('agents.login', { account: o.account, mode: 'device' }).catch((error) => { console.error(error.message); return null; });
    if (!r) return close('entrar');
    console.log(`Abre este enlace en el móvil o en otro PC e inicia sesión:
  ${r.url}`);
    if (r.code) console.log(`Código: ${r.code}`);
    let rl = null;
    if (r.needsCode) {
      console.log('Si la página te muestra un código, pégalo aquí y pulsa Intro:');
      rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => { if (line.trim()) host.call('agents.loginCode', { id: r.id, code: line.trim() }).catch((error) => console.error(error.message)); });
    }
    await new Promise((resolve) => {
      onLogin = (p) => {
        if (p.id !== r.id || p.state === 'esperando') { if (p.id === r.id && p.message) console.log(p.message); return; }
        console.log(p.message ?? p.state); process.exitCode = p.state === 'hecho' ? 0 : 1; resolve();
      };
    });
    rl?.close();
    await close('entrar');
  }
}

// Run only as the command (the tests import parsePair).
const isMain = process.argv[1] && /orb-(server|nucleo)(\.mjs)?$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) main().catch((error) => { console.error(`Orb Server: ${error.message}`); process.exit(1); });
