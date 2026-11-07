// 3.8: the master password in the engine's API (this PC's window only: src/core/permissions.mjs). It is made at the welcome
// (or at the first start of 3.8), unlocks the window's guarded actions for 5 minutes (a token in memory, dropped when the
// window locks or closes) and can be changed, or forgotten on this same PC. The crypto lives in src/core/master.mjs.
import fs from 'node:fs';
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { paths } from '../core/home.mjs';
import { Master, MasterError, mirrorTo, restoreMissing, MIN_LENGTH, UNLOCK_MS } from '../core/master.mjs';
import { sealConnectors, connectorSecrets, refOf, secretId, ENV_NAME } from '../core/connector-secrets.mjs';
import { needsUnlock } from '../core/permissions.mjs';
import { str } from './api-common.mjs';

const userError = (key, vars, extra = {}) => Object.assign(new Error(tr(key, vars)), { userFacing: true, status: 403, ...extra });
const WORDS = { short: 'msg.master.short', long: 'msg.master.long', exists: 'msg.master.exists', locked: 'msg.master.locked', damaged: 'msg.master.damaged', none: 'msg.master.none' };
const asUser = (error) => (error instanceof MasterError ? userError(WORDS[error.code] ?? 'msg.master.damaged', { n: MIN_LENGTH }, { reason: error.code }) : error);
// What a failed check says: how many tries are left, or how long to wait.
function refused(r) {
  if (r.reason === 'none') return userError('msg.master.none', {}, { reason: 'none' });
  if (r.until) return userError(r.reason === 'wrong' ? 'msg.master.wrongWait' : 'msg.master.wait', { s: Math.max(1, Math.ceil((Date.parse(r.until) - Date.now()) / 1000)) }, { reason: 'wait', until: r.until });
  return userError(r.left === 1 ? 'msg.master.wrongOne' : 'msg.master.wrong', { n: r.left }, { reason: 'wrong', left: r.left });
}

// The engine's master: core\secretos, this PC's secret, and the copy outside core (mirror: a folder of the app's data,
// next to its copy of clave.enc). What is missing in core comes back from that copy first.
export function openMaster(home, secret, { mirror = null, log = () => {} } = {}) {
  const dir = paths(home).secrets;
  try { const back = restoreMissing(dir, mirror); if (back.length) log(`secretos: ${back.join(', ')} recuperados de la copia fuera de core`); } catch (error) { log(`secretos: copia: ${error.message}`); }
  const master = new Master(dir, { secret });
  master.onChange = () => { try { mirrorTo(dir, mirror); } catch (error) { log(`secretos: copia: ${error.message}`); } };
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
    // Its bytes overwritten in the file, and the journal emptied: nothing of it stays on disk.
    try { board.db.exec('PRAGMA secure_delete = ON'); } catch { /* older SQLite */ }
    board.run("DELETE FROM settings WHERE key = 'remote_keys'");
    try { board.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* not in WAL mode */ }
    moved.push('remote_keys');
  }
  const sealed = sealConnectors(master, ctx.config.mcpServers ?? []);
  if (sealed) { const c = saveConfig({ mcpServers: sealed }); emit('config:changed', c); moved.push('mcpServers'); }
  if (moved.length) log(`secretos: ${moved.join(', ')} cifrados con la clave de datos`);
  return moved;
}

// The guard of the dispatcher (api.mjs): a guarded call from this PC's window needs a fresh unlock token.
export function checkUnlock(method, params) {
  if (!needsUnlock(method, params)) return;
  const m = ctx.master;
  if (!m?.hasPassword()) throw userError('msg.master.createFirst', {}, { reason: 'unlock' });
  if (!m.checkToken(params?.unlock)) throw userError('msg.master.needUnlock', {}, { reason: 'unlock' });
}

export function masterMethods({ board, emit, log, remoteRef, onUnlocked = () => {} }) {
  const master = () => ctx.master ?? (ctx.master = openMaster(ctx.home, ctx.secret ?? (() => { try { return fs.readFileSync(ctx.paths.key); } catch { return null; } })(), { log }));
  const opened = () => { migrateSecrets(board, master(), { log, emit }); try { onUnlocked(); } catch (error) { log(`secretos: ${error.message}`); } };
  const password = (v) => (typeof v === 'string' ? v : '');
  const connector = (name) => { const n = str(name, 'conector', 40); const s = (ctx.config.mcpServers ?? []).find((x) => x.name === n); if (!s) throw userError('msg.master.noConnector', { name: n }); return s; };
  return {
    'master.state': () => ({ ...master().state(), minLength: MIN_LENGTH, unlockMinutes: UNLOCK_MS / 60_000 }),
    // The first one (the welcome, or the first start of 3.8): no current one to ask for. → a token (the window is unlocked).
    'master.create': async ({ password: p }) => {
      const m = master(); const wasLocked = !m.unlocked();
      try { await m.create(password(p)); } catch (error) { throw asUser(error); }
      log('contraseña maestra creada');
      if (wasLocked) opened(); else migrateSecrets(board, m, { log, emit });
      return m.issue();
    },
    'master.unlock': async ({ password: p }) => {
      const m = master(); const wasLocked = !m.unlocked();
      const r = await m.verify(password(p), 'pc');
      if (!r.ok) throw refused(r);
      if (wasLocked) { log('secretos: abiertos con la contraseña maestra'); opened(); }
      return m.issue();
    },
    // The window locked or closed (main.mjs), or «Bloquear» by hand: every token goes.
    'master.lock': () => { master().lock(); emit('master:locked', {}); return true; },
    // Guarded (checkUnlock): whether the window's token is still good (main.mjs asks before opening core in the Explorer).
    'master.check': () => true,
    'master.change': async ({ current, next }) => {
      let r; try { r = await master().change(password(current), password(next)); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r);
      log('contraseña maestra cambiada');
      emit('master:locked', {});
      return master().issue();
    },
    // «He olvidado la contraseña» (confirm: the user said yes to what it does). Every phone and browser is unlinked. On
    // this PC the secrets stay (its own wrap opens them); on another one they cannot be opened and are gone (wiped).
    'master.forgot': async ({ password: p, confirm }) => {
      if (confirm !== true) throw userError('msg.master.confirmForgot');
      const m = master(); const wasLocked = !m.unlocked();
      let r; try { r = await m.forgot(password(p)); } catch (error) { throw asUser(error); }
      let unlinked = 0;
      try { unlinked = board.one('SELECT COUNT(*) AS n FROM devices').n; if (remoteRef.current) remoteRef.current.revokeAll(); else board.run('DELETE FROM devices'); } catch (error) { log(`olvido: móviles: ${error.message}`); }
      log(`contraseña maestra nueva por olvido${r.wiped ? ' (secretos borrados: este PC no podía abrirlos)' : ''}; ${unlinked} dispositivo(s) desenlazados`);
      board.notice(tr(r.wiped ? 'msg.master.forgotWiped' : 'msg.master.forgotDone', { n: unlinked }), 'warning');
      emit('master:locked', {});
      if (wasLocked) opened();
      return { ...m.issue(), wiped: r.wiped, unlinked };
    },
    // A connector's keys (guarded): to see them, and to change them (empty value: that key goes).
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
      const sealed = sealConnectors(m, list) ?? list; // also drops the keys that went
      const c = saveConfig({ mcpServers: sealed }); emit('config:changed', c);
      return { name: s.name, keys: Object.keys(next) };
    }
  };
}
