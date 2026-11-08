// 3.8: the master password in the engine's API (this PC's window only: src/core/permissions.mjs). It is made at the welcome
// (or at the first start of 3.8), unlocks the window's guarded actions for 5 minutes (a token in memory, dropped when the
// window locks or closes) and can be changed. Forgotten, a new one needs the backups' recovery code (a new data key, every
// phone unlinked); without the code the only way is «Borrar secretos y empezar de cero». The crypto lives in
// src/core/master.mjs.
import fs from 'node:fs';
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { paths, readKey } from '../core/home.mjs';
import { Master, MasterError, mirrorTo, restoreMissing, checkPassword, MIN_LENGTH, UNLOCK_MS } from '../core/master.mjs';
import { sealConnectors, connectorSecrets, refOf, secretId, ENV_NAME, bindMissing } from '../core/connector-secrets.mjs';
import { needsUnlock, FRESH_UNLOCK, FRESH_PURPOSES } from '../core/permissions.mjs';
import { isRecoveryCode, hasRecovery } from '../core/backup.mjs';
import { str } from './api-common.mjs';
import { scrubVaultedSecrets, DONE_AT } from '../core/migrate-38.mjs';

const userError = (key, vars, extra = {}) => Object.assign(new Error(tr(key, vars)), { userFacing: true, status: 403, ...extra });
const WORDS = { short: 'msg.master.short', long: 'msg.master.long', exists: 'msg.master.exists', lost: 'msg.master.lost', locked: 'msg.master.locked', damaged: 'msg.master.damaged', none: 'msg.master.none' };
const asUser = (error) => (error instanceof MasterError ? userError(WORDS[error.code] ?? 'msg.master.damaged', { n: MIN_LENGTH }, { reason: error.code }) : error);
// What a failed check says: how many tries are left, or how long to wait. code: it was the recovery code.
export function refused(r, { code = false } = {}) {
  if (r.reason === 'none') return userError('msg.master.none', {}, { reason: 'none' });
  if (r.reason === 'tries') return userError('msg.master.tries', {}, { reason: 'tries' });
  if (r.until) return userError(r.reason === 'wrong' ? (code ? 'msg.master.codeWrongWait' : 'msg.master.wrongWait') : 'msg.master.wait', { s: Math.max(1, Math.ceil((Date.parse(r.until) - Date.now()) / 1000)) }, { reason: 'wait', until: r.until });
  if (code) return userError('msg.master.codeWrong', { n: r.left }, { reason: 'wrong', left: r.left });
  return userError(r.left === 1 ? 'msg.master.wrongOne' : 'msg.master.wrong', { n: r.left }, { reason: 'wrong', left: r.left });
}
// Where the wrong tries came from, for the owner's notice.
const WHERE = { pc: 'msg.master.wherePc', pair: 'msg.master.wherePair', recovery: 'msg.master.whereRecovery' };

// The engine's master: core\secretos, this PC's secret, and the copy outside core (mirror: a folder of the app's data,
// next to its copy of clave.enc). What is missing in core comes back from that copy first. notice(text): told to the
// owner (five wrong tries in a row on one channel).
export function openMaster(home, secret, { mirror = null, log = () => {}, notice = () => {} } = {}) {
  const dir = paths(home).secrets;
  try { const back = restoreMissing(dir, mirror); if (back.length) log(`secretos: ${back.join(', ')} recuperados de la copia fuera de core`); } catch (error) { log(`secretos: copia: ${error.message}`); }
  const master = new Master(dir, { secret });
  master.onChange = () => { try { mirrorTo(dir, mirror); } catch (error) { log(`secretos: copia: ${error.message}`); } };
  master.onFails = (channel, n) => { log(`contraseña maestra: ${n} intentos incorrectos seguidos (${channel})`); notice(tr('msg.master.failsNotice', { n, where: tr(WHERE[channel] ?? WHERE.pc) })); };
  try { if (!master.openWithMachine()) log('secretos: este PC no puede abrirlos solo; hace falta la contraseña maestra'); } catch (error) { log(`secretos: ${error.message}`); }
  try { master.onChange(); } catch { /* next change */ }
  return master;
}

// The secrets that earlier versions kept in clear move into the vault (once the vault is open): this PC's keys for the
// phones (the database's remote_keys) and the connectors' keys (orb.json). → what moved.
export function migrateSecrets(board, master = ctx.master, { log = () => {}, emit = () => {} } = {}) {
  if (!master?.unlocked()) return [];
  const moved = [];
  const legacy = board.settingJson('remote_keys');
  if (legacy) {
    if (!master.get('remote_keys')) master.set('remote_keys', legacy);
    // Its bytes overwritten in the file, the free pages rebuilt (VACUUM: older versions of the row go too) and the
    // journal emptied: nothing of it stays on disk.
    try { board.db.exec('PRAGMA secure_delete = ON'); } catch { /* older SQLite */ }
    board.run("DELETE FROM settings WHERE key = 'remote_keys'");
    try { board.db.exec('VACUUM'); } catch (error) { log(`secretos: VACUUM: ${error.message}`); }
    try { board.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* not in WAL mode */ }
    moved.push('remote_keys');
  }
  const sealed = sealConnectors(master, ctx.config.mcpServers ?? [], { trusted: true });
  if (sealed) { const c = saveConfig({ mcpServers: sealed }); emit('config:changed', c); moved.push('mcpServers'); }
  else if (bindMissing(master, ctx.config.mcpServers ?? [])) moved.push('mcpBindings');
  if (moved.length) log(`secretos: ${moved.join(', ')} cifrados con la clave de datos`);
  // And they leave the archive of 3.7 and the copies of its database now (not 30 days later).
  try {
    const n = scrubVaultedSecrets(ctx.home, { inVault: (id) => { try { return master.get(id) != null; } catch { return false; } } });
    if (n) log(`secretos: quitados en claro de ${n} archivo(s) de 3.7`);
  } catch (error) { log(`secretos: archivo de 3.7: ${error.message}`); }
  return moved;
}

// The guard of the dispatcher (api.mjs): a guarded call from this PC's window needs a fresh unlock token.
export function checkUnlock(method, params) {
  if (!needsUnlock(method, params, ctx.config)) return;
  const m = ctx.master;
  if (!m?.hasPassword()) throw userError(m?.state().lost ? 'msg.master.lost' : 'msg.master.createFirst', {}, { reason: 'unlock' });
  // 3.8.1: a token for one action (FRESH_UNLOCK) opens it once: it is used up here.
  const purpose = FRESH_UNLOCK[method] ?? null;
  if (!m.checkToken(params?.unlock, purpose, { consume: Boolean(purpose) })) throw userError('msg.master.needUnlock', {}, { reason: 'unlock' });
}

export function masterMethods({ board, emit, log, remoteRef, onUnlocked = () => {} }) {
  const master = () => ctx.master ?? (ctx.master = openMaster(ctx.home, ctx.secret ?? (() => { try { return fs.readFileSync(ctx.paths.key); } catch { return null; } })(), { log }));
  const opened = () => { migrateSecrets(board, master(), { log, emit }); try { onUnlocked(); } catch (error) { log(`secretos: ${error.message}`); } };
  const password = (v) => (typeof v === 'string' ? v : '');
  const connector = (name) => { const n = str(name, 'conector', 40); const s = (ctx.config.mcpServers ?? []).find((x) => x.name === n); if (!s) throw userError('msg.master.noConnector', { name: n }); return s; };
  const machineSecret = () => ctx.secret ?? readKey(ctx.home);
  // Every phone and browser goes (they link again with the new password); this PC's keys for them are read again.
  const unlinkAll = (why) => {
    let n = 0;
    try { n = board.one('SELECT COUNT(*) AS n FROM devices').n; if (remoteRef.current) remoteRef.current.revokeAll(); else board.run('DELETE FROM devices'); } catch (error) { log(`${why}: móviles: ${error.message}`); }
    return n;
  };
  return {
    // canForget: «He olvidado la contraseña» can keep the secrets (this PC opened them and has a recovery code).
    'master.state': () => {
      const m = master();
      let recovery = false; try { recovery = hasRecovery(ctx.home, machineSecret()); } catch { recovery = false; }
      // upgraded: the data came from Orb 3.7 (the first start of 3.8 asks for the password with its own words).
      return { ...m.state(), canForget: m.unlocked() && recovery, minLength: MIN_LENGTH, unlockMinutes: UNLOCK_MS / 60_000, upgraded: Boolean(board.setting(DONE_AT)) };
    },
    // The first one (the welcome, or the first start of 3.8): no current one to ask for. → a token (the window is unlocked).
    'master.create': async ({ password: p }) => {
      const m = master(); const wasLocked = !m.unlocked();
      try { await m.create(password(p)); } catch (error) { throw asUser(error); }
      log('contraseña maestra creada');
      if (wasLocked) opened(); else migrateSecrets(board, m, { log, emit });
      return m.issue();
    },
    // purpose: one of FRESH_PURPOSES (an action that asks every time): a token for that action only.
    'master.unlock': async ({ password: p, purpose }) => {
      const m = master(); const wasLocked = !m.unlocked();
      const r = await m.verify(password(p), 'pc');
      if (!r.ok) throw refused(r);
      if (wasLocked) { log('secretos: abiertos con la contraseña maestra'); opened(); }
      return m.issue(FRESH_PURPOSES.includes(purpose) ? purpose : null);
    },
    // The window locked or closed (the app), or «Bloquear» by hand: every token goes.
    'master.lock': () => { master().lock(); emit('master:locked', {}); return true; },
    // Guarded (checkUnlock): whether the window's token is still good (the app asks before opening core in the Explorer).
    'master.check': () => true,
    'master.change': async ({ current, next }) => {
      let r; try { r = await master().change(password(current), password(next)); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r);
      log('contraseña maestra cambiada');
      emit('master:locked', {});
      return master().issue();
    },
    // «He olvidado la contraseña»: the backups' recovery code proves it is the owner (with the same waits as a password).
    // The secrets stay, encrypted again with a new data key; this PC's keys for the phones are new and every phone goes.
    'master.forgot': async ({ code, password: p, confirm }) => {
      if (confirm !== true) throw userError('msg.master.confirmForgot');
      const m = master();
      let next; try { if (!m.unlocked()) throw new MasterError('locked'); next = checkPassword(password(p)); } catch (error) { throw asUser(error); }
      if (isRecoveryCode(ctx.home, machineSecret(), '') === null) throw userError('msg.master.noRecovery', {}, { reason: 'noRecovery' });
      const r = await m.attempt('recovery', () => isRecoveryCode(ctx.home, machineSecret(), typeof code === 'string' ? code : '') === true);
      if (!r.ok) throw refused(r, { code: true });
      try { await m.forgot(next, { keep: (id) => id !== 'remote_keys' }); } catch (error) { throw asUser(error); }
      const unlinked = unlinkAll('olvido');
      log(`contraseña maestra nueva con el código de recuperación (clave de datos nueva); ${unlinked} dispositivo(s) desenlazados`);
      board.notice(tr('msg.master.forgotDone', { n: unlinked }), 'warning');
      emit('master:locked', {});
      return { ...m.issue(), unlinked };
    },
    // «Borrar secretos y empezar de cero» (confirm: the user read what it does): without the recovery code, or on a PC that
    // cannot open them. The secrets go (here and in the copy outside core; never the backups), every phone is unlinked and
    // the connectors' keys have to be typed again.
    'master.reset': async ({ password: p, confirm }) => {
      if (confirm !== true) throw userError('msg.master.confirmReset');
      const m = master(); const wasLocked = !m.unlocked();
      try { await m.reset(password(p)); } catch (error) { throw asUser(error); }
      const unlinked = unlinkAll('empezar de cero');
      log(`secretos borrados y contraseña maestra nueva; ${unlinked} dispositivo(s) desenlazados`);
      board.notice(tr('msg.master.resetDone', { n: unlinked }), 'warning');
      emit('master:locked', {});
      if (wasLocked) opened();
      return { ...m.issue(), unlinked };
    },
    // A connector's keys (guarded): to see them, and to change them (empty value: that key goes). Saving ties them to the
    // connector's command as it is now.
    'secrets.connector': ({ name }) => { const s = connector(name); try { return { name: s.name, env: connectorSecrets(master(), s) }; } catch (error) { throw asUser(error); } },
    'secrets.saveConnector': ({ name, env }) => {
      const s = connector(name); const m = master();
      if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 40) throw userError('msg.master.badKeys');
      const next = {};
      for (const [k, v] of Object.entries(env)) {
        if (!ENV_NAME.test(k) || typeof v !== 'string' || v.length > 8000) throw userError('msg.master.badKeys');
        if (!v) continue;
        try { m.set(secretId(s.name, k), v); } catch (error) { throw asUser(error); }
        next[k] = refOf(s.name, k);
      }
      const list = (ctx.config.mcpServers ?? []).map((x) => (x.name === s.name ? { ...x, env: next } : x));
      const sealed = sealConnectors(m, list, { trusted: true }) ?? list; // also drops the keys that went
      const c = saveConfig({ mcpServers: sealed }); emit('config:changed', c);
      return { name: s.name, keys: Object.keys(next) };
    }
  };
}
