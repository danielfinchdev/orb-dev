// The engine: a process of its own (the bundled Node, started by the app, or a plain Node child in tests) that owns the database, the
// agents' processes and the scheduler. The window talks to it only through messages relayed by the app (Rust):
// { type: 'call', id, method, params } → { type: 'reply', id, ok, result | error }, and { type: 'event', event, payload }.
// There is no HTTP server: nothing on the network or in a browser can reach it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useHome, ctx, tr } from '../core/context.mjs';
import { ensureLayout, paths } from '../core/home.mjs';
import { keysOf, machineKeys } from '../core/machine-keys.mjs';
import { IN_VAULT } from '../core/master.mjs';
import { coreHealth } from '../core/core-folder.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { PRODUCT } from '../core/product.mjs';
import { DESKTOP, authorize } from '../core/permissions.mjs';

import { stdioTransport } from './stdio.mjs';
import { attachHost, hostReply, hostCall } from './host.mjs';
import { appMethods } from './api-app.mjs';
import { locateHome, setupHome, switchHome, secretCopy, secretsCopy, adoptOldKeyNames, secretDir } from './desktop-home.mjs';
import { loadConfig, homeKey } from '../core/home.mjs';
import es from '../core/locales/es.mjs';
import en from '../core/locales/en.mjs';

// A plain process with JSON lines on stdin/stdout (the app starts the bundled node.exe with ORB_ENGINE_STDIO=1;
// src/engine/stdio.mjs), or a Node child with an IPC channel (the tests).
const transport = (() => {
  if (process.env.ORB_ENGINE_STDIO === '1') return stdioTransport({ onClose: () => shutdown() });
  if (process.send) return { send: (m) => process.send(m), on: (fn) => process.on('message', fn) };
  throw new Error('el motor debe arrancarse desde la app');
})();
// The engine's own calls to the app (open a link or a folder, start a program outside the engine): src/engine/host.mjs.
attachHost((m) => transport.send(m));
// This PC's tools that need no window (src/engine/api-app.mjs), set when the engine starts: also answered while core or
// the data are blocked.
let tools = {};
let remote = null; // phone access (src/engine/remote.mjs), when turned on
let devControl = null; // 3.1: the developer's control line (src/engine/dev-control.mjs), only in Orb.dev
// Every event goes to this PC's window, the linked phones and browsers (remote.mjs picks what they need) and the
// developer's control line.
const toWindow = (event, payload) => { try { transport.send({ type: 'event', event, payload }); } catch { /* window gone */ } };
const emit = (event, payload) => {
  // 3.8.1: the agents' browser lives here: a task that ended closes its pages.
  if (event === 'agentBrowser:closeTask' && hostBrowser) { try { hostBrowser.closeTask(payload?.task); } catch { /* going away */ } return; }
  toWindow(event, payload);
  try { remote?.broadcast(event, payload); } catch (error) { log(`móvil: ${event}: ${error.message}`); }
  try { devControl?.broadcast(event, payload); } catch (error) { log(`control: ${event}: ${error.message}`); }
};

let api = null;
// 3.8.2 (T3 3.11): where an element pointed at and a recording of the agents' browser go (browser-record.mjs), once the
// sessions exist.
let browserFiles = null;
let hostBrowser = null; // 3.8.1 (D7): the agents' browser when the app's pages are driven from here (src/engine/host-browser.mjs)
let logFile = null;
const log = (line) => { try { if (logFile) { rotateIfBig(logFile); fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } } catch { /* never fatal */ } };
process.on('uncaughtException', (error) => log(`uncaughtException: ${error?.stack ?? error}`));
process.on('unhandledRejection', (error) => log(`unhandledRejection: ${error?.stack ?? error}`));

// 3.8.1: one engine per workspace on this PC (two starts of the app, or a build from the code next to the installed
// one, whose single-instance locks do not see each other): two engines on one database and one key would step on each other. A lock file in
// %TEMP% (never in the workspace) kept open with no sharing for the engine's whole life (approval-secret.mjs ›
// exclusiveOpen): while this engine lives nobody can open, rename or delete it (Storage Sense or a cleaner neither), it
// never ages (a PC asleep or a long migration do not free it), and Windows lets it go when the engine ends, however it
// ends (a process id given to another program means nothing here).
let held = null;
const HOME_WAIT_TRIES = Number(process.env.ORB_HOME_WAIT ?? 20); // seconds the workspace's folder is waited for at the start
async function holdWorkspace(home) {
  if (held) return;
  const { exclusiveOpen } = await import('./approval-secret.mjs');
  const file = path.join(os.tmpdir(), `orb-motor-${homeKey(home)}.lock`);
  // 3.8.1 (review D10 B7): held for a moment (the engine before this one still ending, an antivirus looking at it): tried
  // again for about 2 s before saying another app has it.
  let fd = exclusiveOpen(file);
  for (let i = 0; fd === null && i < 8; i++) { await new Promise((r) => setTimeout(r, 250)); fd = exclusiveOpen(file); }
  if (fd === null) throw new Error(tr('sys.engine.otherApp', { name: PRODUCT.name }));
  if (fd === undefined) return; // %TEMP% not writable: not a reason to refuse the start
  try { fs.ftruncateSync(fd); fs.writeSync(fd, String(process.pid)); } catch { /* only informative */ }
  held = { file, fd };
  // Elsewhere than Windows the file is the lock ('wx'): kept fresh, and removed at the end.
  if (process.platform !== 'win32') setInterval(() => { try { const now = new Date(); fs.futimesSync(fd, now, now); } catch { /* closed */ } }, 5000).unref();
  process.once('exit', () => { try { fs.closeSync(fd); fs.rmSync(file, { force: true }); } catch { /* gone, or another engine has it now */ } });
}

let mirror = null; // 3.8: the copy of core\secretos outside the workspace (the app's data folder), when the app gives one
const validSecret = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
// 3.8.1, Tauri (decision 20 d): this PC's secret is opened by the app's vault (src/core/master.mjs › openMachine, in Rust:
// src-tauri/vault/src/machine.rs, Windows' DPAPI) and stays there; the engine gets only the keys made from it (ctx.keys).
// Never a new secret behind the user's back: a key that cannot be read now is tried again a few times and then the start
// stops (code 'secretBusy': the window offers «Reintentar»); sealed keys that none opens, or only Orb 3.8.0's key files
// (no longer read), stop it too (code 'secretUnreadable': «Reintentar» or «Empezar con una clave nueva», newSecret;
// nothing is deleted).
const startError = (key, code, detail) => Object.assign(new Error(tr(key)), { code, detail });
// What the user should know about the keys, said once the database is open (board.notice in run()).
const keyNotices = [];
const KEY_NOTICES = { previousOpens: 'sys.engine.previousOpens', previousBack: 'sys.engine.previousBack', previousNew: 'sys.engine.previousNew', previousFailed: 'sys.engine.previousFailed' };
// Whether this start switched keys (the way back): the recovery code made with the other key no longer opens (below).
let switchedKey = false;
async function secretFromApp(home, userData, newSecret) {
  const { openMachine } = await import('../core/master.mjs');
  for (let attempt = 1; ; attempt++) {
    try {
      const keys = openMachine({ dir: secretDir(home), copy: secretCopy(userData, home), allowNew: newSecret === true });
      for (const { code, detail } of keys.warns) {
        console.error(`clave: ${code} (${detail})`);
        // Ajustes › Datos offers the way back: to the key from before «Empezar con una clave nueva» ('anterior') or,
        // after going back to it, to the new one again ('nueva').
        if (code === 'previousOpens' || code === 'previousQuiet') ctx.previousKey = 'anterior';
        if (code === 'newAvailable') ctx.previousKey = 'nueva';
        if (code === 'previousBack' || code === 'previousNew') switchedKey = true;
        if (KEY_NOTICES[code] && !keyNotices.includes(KEY_NOTICES[code])) keyNotices.push(KEY_NOTICES[code]);
      }
      return { approval: keys.approval, backup: keys.backup, inVault: true };
    } catch (error) {
      const code = error.code ?? 'busy';
      console.error(`clave: ${error.message}`);
      if (code === 'old') throw startError('sys.engine.secretOld', 'secretUnreadable', error.detail);
      if (code === 'unreadable') throw startError('sys.engine.secretUnreadable', 'secretUnreadable', error.detail);
      if (code === 'noVault' || attempt >= 3) throw startError('sys.engine.secretBusy', 'secretBusy', error.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
// userData: the app's data folder (the engine keeps the copies outside the workspace there). hostSecret: that app's vault opens this PC's secret (secretFromApp); secret: one given (tests); newSecret: the
// user chose to start with a new key after the sealed ones could not be opened.
async function start(home, version, secret, browser, keep = null, userData = null, hostSecret = false, newSecret = false) {
  if (!home || !path.isAbsolute(home)) throw new Error(tr('sys.engine.notHome', { home }));
  await holdWorkspace(home);
  // This workspace's keys only (a switch of workspace starts again in the same process).
  let keys = null; ctx.keys = null; ctx.secret = null;
  if (typeof userData === 'string' && path.isAbsolute(userData)) {
    adoptOldKeyNames(userData, home);
    keep ??= secretsCopy(userData, home);
    if (!validSecret(secret) && hostSecret === true) keys = await secretFromApp(home, userData, newSecret);
    // After switching keys, copia-clave.json (the recovery code's wrap, sealed with the other key) does not open: the
    // scheduled copies go out without the code and «He olvidado la contraseña» cannot check it. Said (review D10 M6).
    if (switchedKey && keys) {
      switchedKey = false;
      const B = await import('../core/backup.mjs');
      if (fs.existsSync(path.join(paths(home).data, 'copia-clave.json')) && !B.hasRecovery(home, keys.backup) && !keyNotices.includes('sys.engine.recoveryOtherKey')) keyNotices.push('sys.engine.recoveryOtherKey');
    }
    // An app that cannot open a sealed secret (in core or its copy outside, which would be put back): never a new plain
    // key instead, or this workspace's approvals and backups would no longer open.
    const { enc2, copy2 } = (await import('./approval-secret.mjs')).secret2Files(secretDir(home), secretCopy(userData, home));
    if (!keys && !validSecret(secret) && [path.join(secretDir(home), 'clave.enc'), secretCopy(userData, home), enc2, copy2].some((f) => fs.existsSync(f))) throw new Error(tr('sys.engine.sealedSecret'));
  }
  // The approval secret comes from the app (kept encrypted by Windows); without it, the file fallback is used.
  // A secret given (tests): the engine has it anyway, and makes the keys itself (src/core/machine-keys.mjs).
  if (validSecret(secret)) { ctx.secret = Buffer.from(secret, 'hex'); ctx.keys = keysOf(ctx.secret); } else if (keys) { ctx.secret = null; ctx.keys = keys; }
  // The agents' browser (browser 'host'): it lives here, with the app's hidden pages (src/engine/host-browser.mjs).
  if (browser === 'host' && !hostBrowser) {
    const { createHostBrowser } = await import('./host-browser.mjs');
    const AGENTS = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };
    hostBrowser = createHostBrowser({
      log: (line) => log(line), language: () => ctx.config?.language ?? 'es', skin: () => ctx.config?.ui?.skin ?? 'orb',
      pipEnabled: () => ctx.config?.ui?.pip !== false && ctx.config?.browser?.enabled !== false,
      label: (agent) => (agent === 'orb' ? ctx.config?.assistantName ?? PRODUCT.assistant : AGENTS[agent] ?? agent),
      onPointed: (p) => { browserFiles?.pointed(p).catch((error) => log(`navegador del agente: señalar: ${error.message}`)); },
      saveRecording: (session, avi) => browserFiles?.saveRecording(session, avi) ?? null
    });
    await hostBrowser.ready;
  }
  if (hostBrowser) ctx.browser = { pipe: hostBrowser.pipe, token: hostBrowser.token };
  if (typeof keep === 'string' && path.isAbsolute(keep)) mirror = keep;
  tools = appMethods({ home, version });
  // 3.8: the folders of Orb 3.7 move into core (src/core/core-folder.mjs); then, if core or part of it is gone (deleted
  // by mistake while Orb was closed, or noticed by the watcher in run()), what is missing comes back from the newest
  // backup, which lives outside the workspace. Without a backup, or with one this PC cannot open, the window shows why
  // and what can be done (coreBlocked). All of it before the database opens.
  // 3.8.1 (review F3a B2): a workspace on a drive that is waking up or coming back (a USB or network disk) is waited for
  // a little before saying it is not there.
  for (let i = 0; !fs.existsSync(home) && i < HOME_WAIT_TRIES; i++) await new Promise((r) => setTimeout(r, 1000));
  if (!fs.existsSync(home)) throw new Error(tr('sys.engine.notHome', { home }));
  const { migrateWorkspace } = await import('../core/core-folder.mjs');
  migrateWorkspace(home); // a folder some program is using: nothing moves and the start fails with a clear message
  // The first 3.8 builds named this workspace's backups' folder after its whole path: taken over once.
  { const { adoptOldBackupRoot } = await import('../core/backup.mjs'); try { adoptOldBackupRoot(home); } catch (error) { console.error(`copias: ${error.message}`); } }
  // 3.8: the master password's files come back first from their copy outside core (newer than any backup).
  { const { restoreMissing } = await import('../core/master.mjs'); try { restoreMissing(paths(home).secrets, mirror); } catch (error) { console.error(`secretos: ${error.message}`); } }
  const { repairCore } = await import('../core/backup.mjs');
  const repair = await repairCore(home, { secret: secretOf(home) });
  if (!repair.ok) return coreBlocked({ home, version, repair });
  return open({ home, version, repair });
}
// The secret the backups are sealed with: the app's, or the plain one of a run without the app (never made here).
// This PC's backup key: from the vault (the app), or from the plain clave.bin of a run without it (never made here).
const secretOf = (home) => machineKeys({ create: false, home })?.backup ?? null;
// What opens core\secretos for this PC: the vault's own secret (the app), a given one, or the plain clave.bin.
const masterSecret = (home) => (ctx.keys?.inVault ? IN_VAULT : ctx.secret ?? (() => { try { const k = fs.readFileSync(paths(home).key); return k.length >= 32 ? k : null; } catch { return null; } })());

async function open({ home, version, repair = null }) {
  // the fixed folders, and folders made by older versions put in order; core hidden without waiting (said if it failed)
  const hidden = ensureLayout(home, null, { wait: false });
  if (process.platform === 'win32') hidden?.then?.((ok) => { if (!ok) console.error('core: no se pudo ocultar la carpeta (attrib)'); });
  // 3.8: a backups' folder inside the workspace (allowed by 3.7) is not used any more: dropped from the settings.
  { const { keepBackupsOutside } = await import('../core/core-folder.mjs'); try { keepBackupsOutside(home); } catch (error) { console.error(`copias: ${error.message}`); } }
  useHome(home);
  // 3.6: a backup restored from Ajustes › Datos replaces the data now, before the database
  // opens (what was there goes to core/antes-de-restaurar-<fecha>). This PC's secret stays (never in a backup).
  const { applyPendingRestore } = await import('../core/backup.mjs');
  let restored = null;
  try { restored = applyPendingRestore(home); } catch (error) { console.error(`restaurar: ${error.message}`); }
  if (restored) useHome(home);
  logFile = path.join(ctx.paths.runs, 'motor.log');
  fs.mkdirSync(ctx.paths.runs, { recursive: true });
  // 3.8: the backups' folders and the copies of the sealed secrets are kept from the agents like core.
  { const { guardOutside } = await import('./workspace-layout.mjs'); guardOutside({ mirror }); }
  // 3.8: the backups of 3.7 (inside the data folder, now core) go where backups go now, outside the workspace.
  try { const { adoptOldBackups } = await import('../core/backup.mjs'); const n = adoptOldBackups(home, ctx.config); if (n) log(`copias: ${n} copia(s) de 3.7 movidas fuera de core`); } catch (error) { log(`copias de 3.7: ${error.message}`); }
  // 3.8.2: Android's adb is no longer in the agents' PATH nor downloaded at start: the first use downloads it
  // (src/engine/android.mjs) and agents reach the phone through Orb's tools.
  const { Board } = await import('../core/board.mjs');
  // 3.8: a data folder of 3.5–3.7 is moved to 3.8 when its database opens (src/core/migrate-38.mjs). If that could not be
  // done (or its files and orb.json could not be finished), Orb does not run on those data (other users' conversations,
  // schedules, devices, accounts and connectors): no scheduler, agents or phone access; the window shows why, where the
  // copy is, «Reintentar» and «Buscar actualización» (blocked below).
  const board = new Board();
  const { unfinished } = await import('../core/migrate-38.mjs');
  if (repair?.restored) log(`core: faltaba ${repair.missing.join(', ')}; restaurado de la copia ${repair.restored.from} (${repair.restored.units.join(', ')})`);
  if (unfinished(board.db)) return blocked(board, { home, version, restored, repair });
  return run(board, { home, version, restored, repair });
}

// 3.8: core is gone (or its settings) and Orb could not put it back by itself: only the window's calls about it.
let core = null; // { missing: true, home, reason, backup, error, folder }
function coreBlocked({ home, version, repair }) {
  core = { missing: true, home, reason: repair.reason, backup: repair.backup ?? null, error: repair.error ?? null, folder: null };
  import('../core/backup.mjs').then((K) => { if (core) core.folder = K.defaultBackupDir(home); }).catch(() => {});
  console.error(`core: falta ${repair.missing.join(', ')} y no se pudo restaurar (${repair.reason})`);
  let busy = null;
  // passphrase: the recovery code of the copy; file: another copy (.orbbak); fresh: go on without a copy (core made
  // again with the default settings in the window's language; the projects stay in their folders). The copies there
  // were are put aside where nothing deletes them (src/core/backup.mjs › setAsideBackups): they may hold the only
  // history the user has.
  const repairNow = async ({ passphrase = null, file = null, fresh = false, language = null } = {}) => {
    let next = { ok: true, missing: [] };
    if (fresh === true) {
      const { paths: of, DEFAULT_CONFIG, writeJson, merge } = await import('../core/home.mjs');
      const { setAsideBackups } = await import('../core/backup.mjs');
      try { const n = setAsideBackups(home); if (n) console.error(`core: ${n} copia(s) apartadas antes de empezar de nuevo`); } catch (error) { console.error(`core: apartar copias: ${error.message}`); }
      const cfg = of(home).config;
      fs.mkdirSync(path.dirname(cfg), { recursive: true });
      if (!fs.existsSync(cfg)) writeJson(cfg, merge(DEFAULT_CONFIG, { language: language === 'en' ? 'en' : 'es' }));
    } else {
      const { repairCore } = await import('../core/backup.mjs');
      next = await repairCore(home, { secret: secretOf(home), passphrase: typeof passphrase === 'string' && passphrase ? passphrase.slice(0, 200) : null,
        file: typeof file === 'string' && /\.orbbak$/i.test(file) && path.isAbsolute(file) && fs.existsSync(file) ? file : null });
      if (!next.ok) { core = { ...core, reason: next.reason, backup: next.backup ?? core.backup, error: next.error ?? null }; return core; }
    }
    core = null;
    await open({ home, version, repair: next });
    return { missing: false };
  };
  api = {
    // Who calls counts here too (only this PC's window reaches these today; the phone and the developer's line start
    // later, but nothing should depend on that).
    async call(method, params, principal) {
      authorize(principal, method);
      if (method === 'app.coreState') return core;
      if (method === 'app.coreRepair') { busy ??= repairNow(params ?? {}).finally(() => { busy = null; }); return busy; }
      if (method === 'app.migrationState') return { failed: false };
      if (Object.hasOwn(tools, method)) return tools[method](params ?? {});
      throw Object.assign(new Error(tr('data.core.blocked')), { userFacing: true });
    },
    shutdown() {}
  };
  return { home, name: PRODUCT.assistant, core };
}

// While the data could not be updated: only the window's calls about it (and core is whole). → what start() returns.
let migration = null; // { failed: true, reason, backup, data, committed }
// 3.8.2 (review F2.5b M6): meanwhile a linked phone is told the PC needs attention (remote.mjs › startAttention) instead
// of finding nothing there («sin conexión»). Closed before the engine runs on the updated data (the real phone access
// takes the same port) and when it ends.
let attention = null; // promise of { stop } or null
const stopAttention = async () => { const a = attention; attention = null; await (await a)?.stop().catch(() => {}); };
async function blocked(board, info) {
  const { migrationFailure, unfinished, isLegacy } = await import('../core/migrate-38.mjs');
  const f = migrationFailure();
  migration = { failed: true, reason: f?.reason ?? tr('data.migration38.blocked'), backup: f?.backup ?? null, data: ctx.paths.db, committed: f?.committed ?? !isLegacy(board.db) };
  log(`3.8: la migración no se pudo hacer; Orb no arranca sobre los datos de 3.7: ${migration.reason}`);
  attention ??= import('./remote.mjs').then(({ startAttention }) => startAttention({ log })).catch((error) => { log(`móvil (atención): ${error.message}`); return null; });
  let retrying = null;
  const retry = async () => {
    try { board.db.close(); } catch { /* closed */ }
    const { Board } = await import('../core/board.mjs');
    const next = new Board();
    if (unfinished(next.db)) { await blocked(next, info); return migration; }
    migration = null;
    await stopAttention();
    await run(next, info);
    return { failed: false };
  };
  api = {
    async call(method, params, principal) {
      authorize(principal, method);
      // core is whole (the window asks this first: src/ui/lib/startup.js).
      if (method === 'app.coreState') return null;
      if (method === 'app.migrationState') return migration;
      if (method === 'app.migrationRetry') { retrying ??= retry().finally(() => { retrying = null; }); return retrying; }
      if (Object.hasOwn(tools, method)) return tools[method](params ?? {});
      throw Object.assign(new Error(tr('data.migration38.blocked')), { userFacing: true });
    },
    shutdown() { try { board.db.close(); } catch { /* closed */ } }
  };
  return { home: info.home, name: ctx.config.assistantName, migration };
}

async function run(board, { home, version, restored, repair }) {
  const { Sessions } = await import('./sessions.mjs');
  const { Orchestrator } = await import('./orchestrator.mjs');
  const { Scheduler } = await import('./scheduler.mjs');
  const { buildApi } = await import('./api.mjs');
  // 3.8: who each agent's MCP process is lives only in this process's memory (agent-auth.mjs); the signatures that
  // earlier versions kept in the database are gone at start (they sign nothing).
  board.run("DELETE FROM settings WHERE key = 'orchestrator_key_hash' OR key LIKE 'orchestrator_conv:%' OR key LIKE 'agent_id:%'");
  try { const released = board.releaseUnclaimed(); if (released.length) log(`tareas manuales sin conversación devueltas a la cola: ${released.join(', ')}`); } catch (error) { log(`liberar tareas manuales: ${error.message}`); }
  const sessions = new Sessions(board, { emit, log });
  browserFiles = (await import('./browser-record.mjs')).browserSink({ sessions, toWindow, log });
  const { plainAction, looksEnglish } = await import('../core/guard.mjs');
  const { adapter } = await import('../agents/index.mjs');
  const { recordRate } = await import('../core/budget.mjs');
  // The real usage the agents report (Claude and Codex): the budget guard uses it instead of guessing.
  sessions.onRate = (accountId, rate) => recordRate(board, accountId, rate);
  // A task waiting for a click: a line in the assistant's chat so the user sees it wherever they are (also the phone).
  sessions.onApproval = (s, item) => {
    if (s?.kind !== 'task') return;
    // 3.1: in plain words (what for, and why it asks); the command itself goes in the notice's details, one click away.
    const wait = Number(ctx.config.approvalWaitMinutes ?? 10);
    // What it does comes from the command itself; what the agent says it is for is shown as its words, not as a fact.
    const what = plainAction(item.body?.title ?? '', { lang: ctx.config.language });
    // 3.2.1: cut at a word, and not quoted when it is in English and the app is not (Claude describes its commands in
    // English: «Start Vite dev server»).
    const summary = String(item.body?.summary ?? '').trim();
    const shown = summary && !(ctx.config.language !== 'en' && looksEnglish(summary)) ? (summary.length > 160 ? `${summary.slice(0, 160).replace(/\s+\S*$/, '')}…` : summary) : '';
    const says = shown ? tr('msg.engine.agentSays', { text: shown }) : '';
    let agent = s.agent; try { agent = adapter(s.agent).label; } catch { /* id */ }
    board.addChat('system', tr(wait > 0 ? 'msg.engine.taskNeedsPermissionWait' : 'msg.engine.taskNeedsPermission', { id: s.task_id, agent, what, reason: item.body?.reason ?? '', min: wait }) + says,
      { kind: 'task-approval', session: s.id, task: s.task_id, request: item.body?.id, detail: String(item.body?.title ?? '').slice(0, 2000) });
  };
  // 3.1: the chat line of a task's permission shows how it ended (answered here or in the task, nobody answered, the task
  // stopped), instead of staying «pending» with buttons that no longer work.
  sessions.onApprovalDone = (s, requestId, status) => {
    if (s?.kind !== 'task' || requestId == null) return;
    for (const row of board.all("SELECT id, meta FROM chat WHERE meta LIKE '%task-approval%' ORDER BY id DESC LIMIT 50")) {
      let meta; try { meta = JSON.parse(row.meta); } catch { continue; }
      if (meta?.kind === 'task-approval' && meta.session === s.id && String(meta.request) === String(requestId)) { board.patchChatMeta(row.id, { ...meta, status }); break; }
    }
  };
  sessions.onApprovalExpired = (s, item) => {
    if (s?.kind !== 'task') return;
    board.notice(tr('msg.engine.permissionTimedOut', { id: s.task_id, title: plainAction(item.body?.title ?? '', { lang: ctx.config.language }), min: Number(ctx.config.approvalWaitMinutes ?? 10) }), 'warning');
  };
  // 3.2: a new conversation gets its title from Orb (the lightest model of its agent), once; the quick one stays if not.
  const { autoTitle } = await import('./titles.mjs');
  const title = (c, text) => {
    if (c.titled) return;
    board.updateConversation(c.id, { titled: true });
    // Not over one the user wrote meanwhile.
    autoTitle(board, { agent: c.agent, account: c.account, text }).then((t) => { if (t && board.conversation(c.id)?.title === c.title) board.updateConversation(c.id, { title: t }); }).catch(() => {});
  };
  const orchestrator = new Orchestrator(board, { emit, log, title });
  const scheduler = new Scheduler(board, sessions, { log, orchestrator, emit });
  const { createRemote } = await import('./remote.mjs');
  const remoteRef = { current: null };
  // 3.7: Monitoreo del equipo and Opti Bot are gone: their settings and conversation are tidied once (engine/retired.mjs).
  { const { tidyRetired } = await import('./retired.mjs'); tidyRetired(board, log); }
  // 3.8: the master password and Orb's own secrets (src/core/master.mjs): opened with this PC's secret, or locked until
  // the password is typed (another PC, another Windows user). What earlier versions kept in clear moves into it now.
  const { openMaster, migrateSecrets } = await import('./api-master.mjs');
  ctx.master = openMaster(home, masterSecret(home), { mirror, log, notice: (text) => board.notice(text, 'warning') });
  try { migrateSecrets(board, ctx.master, { log, emit }); } catch (error) { log(`secretos: ${error.message}`); }
  // Unlocked later (the password on another PC): the phone access opens then.
  // 3.8.1: also the keys of a connector Orb moved while it was locked (src/engine/api-extensions.mjs › rebindMovedOrWait).
  const { settleWaitingKeys } = await import('./api-extensions.mjs');
  const onUnlocked = () => { settleWaitingKeys(board, log); if (ctx.config.mobile?.enabled) remote?.start().catch((error) => log(`móvil: ${error.message}`)); };
  if (ctx.master.unlocked()) settleWaitingKeys(board, log);
  // 3.8.2: Orb locked: the agents' browser stops recording (host-browser.mjs › lock).
  const onLocked = () => { hostBrowser?.lock().catch?.((error) => log(`navegador del agente: grabación: ${error.message}`)); };
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef, onUnlocked, onLocked });
  remote = remoteRef.current = createRemote({ board, api, log, emit, version });
  // 3.1: only an unpacked Orb.dev started with ORB_DEV_CONTROL=1 (the app decides: src-tauri/src/lib.rs; never an installed Orb).
  if (process.env.ORB_DEV_CONTROL === '1') {
    const { startDevControl } = await import('./dev-control.mjs');
    devControl = startDevControl({ api, board, sessions, log, home, internalDir: ctx.paths.internal });
  }
  if (ctx.config.mobile?.enabled && ctx.master.unlocked()) remote.start().catch((error) => log(`móvil: ${error.message}`));

  // Changes made by this process are pushed right away; changes made by MCP processes (other connections) are found with
  // PRAGMA data_version, which only moves when another connection commits.
  // The list says what changed, never its content.
  let pending = new Set(); let flush = null;
  const changed = (what) => {
    pending.add(what);
    flush ??= setTimeout(() => {
      flush = null; const list = [...pending]; pending = new Set();
      emit('board:changed', list);
      api.notifyNewChat();
    }, 120);
  };
  board.onChange(changed);
  let dataVersion = board.one('PRAGMA data_version').data_version;
  const { syncProjects } = await import('../core/projects.mjs');
  // 3.8.1: a project delete the app left half-way (closed between the check and the end) is finished or undone.
  try { (await import('../core/project-close.mjs')).settleDeleting(board, home, { all: true }); } catch (error) { log(`eliminar proyecto: ${error.message}`); }
  syncProjects(board);
  // 3.8.1: the skills of core that are on, ready for the agents (core\skills\.activas).
  try { (await import('./api-extensions.mjs')).refreshSkills(); } catch (error) { log(`skills: ${error.message}`); }
  let ticking = false; let lastSync = Date.now();
  const loop = () => {
    if (ticking) return; ticking = true;
    try {
      // Folders created or deleted by hand in the assistant's folder show up in the app within a few seconds.
      if (Date.now() - lastSync > 5000) {
        lastSync = Date.now();
        // 3.8: core (or its settings or database) gone while Orb runs: everything stops and the engine ends; the app
        // starts it again and the start puts back what is missing from the newest backup (or shows why it cannot).
        if (!coreHealth(home).ok) { coreLost(home, board); return; }
        syncProjects(board);
      }
      const v = board.one('PRAGMA data_version').data_version;
      if (v !== dataVersion) { dataVersion = v; changed('external'); }
      scheduler.tick();
      api.dataTick?.();
    } catch (error) { log(`tick: ${error.stack}`); } finally { ticking = false; }
  };
  setInterval(loop, 1500);
  board.onChange((what) => { if (what === 'tasks') setImmediate(loop); });
  log(`motor arrancado (versión ${version}) en ${home}`);
  if (repair?.restored?.recoveryOther || restored?.recoveryOther) board.notice(tr('sys.engine.recoveryRestored'), 'warning');
  if (repair?.restored) board.notice(tr('data.core.restored', { created: String(repair.restored.created ?? '').slice(0, 16).replace('T', ' ') }), 'warning');
  // Review D10 B9: «two keys» is said once for each clave.enc of Orb 3.8.0, not at every start.
  for (const key of keyNotices.splice(0)) board.notice(tr(key, { name: PRODUCT.name }), 'warning');
  if (restored) { log(`copia restaurada: ${restored.from} (lo anterior está en ${restored.aside})`); board.notice(tr('data.backup.restored', { created: String(restored.header?.created ?? '').slice(0, 16).replace('T', ' ') }), 'success'); }
  // 3.8: a data folder of 3.5–3.7 was moved to 3.8 when its database opened (src/core/migrate-38.mjs): said once.
  {
    const { takeNotice } = await import('../core/migrate-38.mjs');
    const m = takeNotice(board);
    if (m) {
      log(`3.8: datos de 3.7 migrados: ${m.bots} bots y ${m.conversations} conversaciones de bots, ${m.users.length} usuarios (${m.users.join(', ') || 'ninguno'}) archivados en ${m.archive}; copia de la base en ${m.backup}`);
      board.notice(`${tr('data.migrated38', { path: m.archive })}${m.haToken ? ` ${tr('data.migrated38.haToken')}` : ''}`, 'info');
    }
    // 30 days later, the copies of the database of 3.7 lose its secrets (PIN hashes, devices' keys, Home Assistant's token).
    try {
      const { scrubPreCopies } = await import('../core/migrate-38.mjs');
      const n = scrubPreCopies(board.db);
      if (n) { log(`3.8: claves quitadas de ${n} copia(s) de la base de datos de 3.7`); board.notice(tr('data.migration38.scrubbed'), 'info'); }
    } catch (error) { log(`3.8: limpiar la copia de 3.7: ${error.message}`); }
  }
  // Which agents this PC has, as the engine sees them (with the app's environment): first thing to look at if «Agentes»
  // says one is missing.
  const { ADAPTERS } = await import('../agents/index.mjs');
  log(`agentes: ${Object.keys(ADAPTERS).map((a) => { let cmd = null; try { cmd = ADAPTERS[a].detect(ctx.config.agents[a] ?? {})?.cmd ?? null; } catch { /* not found */ } return `${a}=${cmd ?? 'no'}`; }).join(' · ')}`);
  loop();
  // 2.6: the models of every installed agent, asked to the agents themselves a moment after starting (each one at most
  // once every 12 h), so the brain selector names them before any conversation.
  const { refreshAllModels } = await import('./catalog.mjs');
  setTimeout(() => { refreshAllModels(board, { log }).catch(() => {}); }, Number(process.env.ORB_MODELS_DELAY_MS ?? 3000)).unref?.();
  // 3.1: the plan of every account (Claude Pro, ChatGPT Plus, Cursor Pro…), so the usage limits fit what is paid for.
  // Not with the test agents: a fake engine must not start the real CLIs.
  if (!process.env.ORB_FAKE_AGENTS) {
    const { refreshPlans } = await import('./plans.mjs');
    setTimeout(() => { refreshPlans(board, { log }).catch(() => {}); }, Number(process.env.ORB_MODELS_DELAY_MS ?? 3000) + 2000).unref?.();
  }
  // 2.6: the reports the assistant still owed when the app was closed come back.
  const owed = orchestrator.resume();
  if (owed) log(`asistente: ${owed} aviso(s) pendientes recuperados`);
  return { home, name: ctx.config.assistantName, migration: null };
}

// core gone while running (see run): said to the window, everything stopped, and the engine ends so the app starts it
// again (exit code 75).
let lost = false;
function coreLost(home, board) {
  if (lost) return; lost = true;
  log(`core: falta (${coreHealth(home).missing.join(', ')}); el motor se detiene para restaurarla`);
  emit('core:lost', {});
  emit('notice', { body: tr('data.core.lost'), tone: 'warning' });
  try { api?.shutdown(); } catch { /* stopping anyway */ }
  try { remote?.stop(); } catch { /* stopping anyway */ }
  setTimeout(() => { try { board.db.close(); } catch { /* closed */ } process.exit(75); }, 500);
}

// The app asked the engine to stop (or, over stdio, closed its end: it quit or died). The phone access may have to turn
// off `tailscale serve` first (a few seconds at most).
let stopping = false;
function shutdown() {
  if (stopping) return; stopping = true;
  try { api?.shutdown(); } catch { /* closing anyway */ }
  try { hostBrowser?.shutdown(); } catch { /* closing anyway */ }
  try { devControl?.stop(); } catch { /* closing anyway */ }
  Promise.race([Promise.all([Promise.resolve(remote?.stop()).catch(() => {}), stopAttention()]), new Promise((r) => setTimeout(r, 4000))]).finally(() => setTimeout(() => process.exit(0), 300));
}

// 3.8.1: what an app without Node of its own (Tauri) asks the engine before and around the start, answered as
// { type: 'reply', id, ok, result | error }: where the workspace is, the first-run setup, moving to another workspace
// (src/engine/desktop-home.mjs) and the texts of its own dialogs and errors
// (sys.main.*, sys.dialog.* and sys.terminal.*: the terminals and editors it opens) in the language of the settings.
// Not API methods: the window cannot send them.
const SHELL_TEXTS = /^sys\.(main|dialog|terminal)\./;
const APP_MESSAGES = {
  locate: (m) => ({ home: locateHome({ userData: String(m.userData ?? ''), packaged: m.packaged === true, separateData: m.separateData === true, documents: m.documents ?? null, profile: m.profile ?? null }) }),
  setup: (m) => ({ home: setupHome({ userData: String(m.userData ?? ''), base: m.base, assistantName: m.assistantName, userName: m.userName, language: m.language }) }),
  switchHome: (m) => ({ ok: switchHome({ userData: String(m.userData ?? ''), target: m.target }) }),
  // The little window of the agents' browser: its buttons and Ajustes › «Ver el navegador» (src/engine/host-browser.mjs).
  pip: (m) => hostBrowser?.pip(String(m.action ?? ''), { x: m.x, y: m.y }) ?? null,
  texts: (m) => {
    let lang = ctx.config?.language;
    if (!lang && typeof m.home === 'string' && m.home) { try { lang = loadConfig(m.home).language; } catch { /* Spanish */ } }
    const dict = { ...es, ...(lang === 'en' ? en : {}) };
    return Object.fromEntries(Object.entries(dict).filter(([k]) => SHELL_TEXTS.test(k)));
  }
};

transport.on(async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'start') {
    // The app's lock screen was up when this engine (re)started (review final B1): it stays up (api-master.mjs).
    ctx.screenAtStart = msg.screenLocked === true;
    try { transport.send({ type: 'started', ok: true, result: await start(msg.home, msg.version, msg.secret, msg.browser, msg.keep, msg.userData, msg.hostSecret, msg.newSecret) }); }
    catch (error) { transport.send({ type: 'started', ok: false, error: error.message, ...(error.code && /^secret/.test(error.code) ? { code: error.code } : {}) }); }
    return;
  }
  if (msg.type === 'shutdown') return shutdown();
  if (msg.type === 'hostReply') { hostReply(msg); return; }
  if (msg.type === 'browserEvent') { hostBrowser?.event(msg); return; }
  if (Object.hasOwn(APP_MESSAGES, msg.type)) {
    try { transport.send({ type: 'reply', id: msg.id, ok: true, result: await APP_MESSAGES[msg.type](msg) }); }
    catch (error) { transport.send({ type: 'reply', id: msg.id, ok: false, error: oneLine(error?.message ?? String(error), 1000) }); }
    return;
  }
  if (msg.type !== 'call') return;
  try {
    if (!api) throw new Error(tr('sys.engine.notStarted', { name: PRODUCT.name }));
    // This PC's window: every method (src/core/permissions.mjs).
    const result = await api.call(String(msg.method), msg.params ?? {}, DESKTOP);
    transport.send({ type: 'reply', id: msg.id, ok: true, result: result === undefined ? null : result });
  } catch (error) {
    if (!error?.userFacing) log(`${msg.method}: ${error?.stack ?? error}`);
    transport.send({ type: 'reply', id: msg.id, ok: false, error: oneLine(error?.message ?? String(error), 1000) });
  }
});

