// the master password in the engine's API (this PC's window only: src/domain/security/permissions.mjs). It is made at the welcome
// (or at the first start after upgrading from 3.7), unlocks the window's guarded actions for 5 minutes (a token in memory, dropped when the
// window locks or closes) and can be changed. Forgotten, a new one needs the backups' recovery code (a new data key, every
// phone unlinked); without the code the only way is «Borrar secretos y empezar de cero». The crypto lives in
// src/domain/security/master.mjs.
import fs from 'node:fs';
import { ctx, tr } from '../../platform/context.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { paths } from '../../platform/paths.mjs';
import { machineKeys } from '../../platform/keys.mjs';
import { Master, MasterError, IN_VAULT, mirrorTo, restoreMissing, checkPassword, MIN_LENGTH, UNLOCK_MS } from '../../domain/security/master.mjs';
import { sealConnectors, connectorSecrets, refOf, secretId, ENV_NAME, bindMissing } from '../../domain/security/connector-secrets.mjs';
import { agentKeyState, saveAgentKey } from '../../domain/security/agent-keys.mjs';
import { needsUnlock, needsPassword, freshPurpose, FRESH_PURPOSES, HELLO_PURPOSES, HELLO_ENABLE_PURPOSE, RULE_TARGET_METHODS, RAILS_PURPOSE } from '../../domain/security/permissions.mjs';
import { readRule, isRuleId } from '../../domain/rules/rules.mjs';
import { DEFAULT_IDS } from '../../domain/rules/defaults.mjs';
import * as K from '../../domain/data/backup.mjs';
import { str } from './common.mjs';
import { HELLO_ID_PREFIXES } from '../../domain/security/permissions.mjs';
import { scrubVaultedSecrets, DONE_AT } from '../../domain/data/legacy/migrate-38.mjs';

const userError = (key, vars, extra = {}) => Object.assign(new Error(tr(key, vars)), { userFacing: true, status: 403, ...extra });
const WORDS = { phrase: 'msg.master.codePhrase', needsPassword: 'msg.master.rekeyNeedsPassword', short: 'msg.master.short', long: 'msg.master.long', exists: 'msg.master.exists', lost: 'msg.master.lost', locked: 'msg.master.locked', damaged: 'msg.master.damaged', none: 'msg.master.none' };
const asUser = (error) => (error instanceof MasterError ? userError(WORDS[error.code] ?? 'msg.master.damaged', { n: MIN_LENGTH }, { reason: error.code }) : error);
// The causes master.lock is told (the window: 'idle' and 'hand'; the app: 'windows' and 'sleep'); anything else is not known.
const LOCK_REASONS = { idle: 'idle', hand: 'manual', windows: 'windows', sleep: 'sleep' };
// What a failed check says: how many tries are left, or how long to wait. code: it was the recovery code.
export function refused(r, { code = false } = {}) {
  if (r.reason === 'none') return userError('msg.master.none', {}, { reason: 'none' });
  if (r.reason === 'tries') return userError('msg.master.tries', {}, { reason: 'tries' });
  if (r.reason === 'needsAuth') return userError('msg.master.needProof', {}, { reason: 'needsAuth' });
  if (r.reason === 'noCode') return userError('msg.master.noRecovery', {}, { reason: 'noRecovery' });
  if (r.reason === 'noKey') return userError('msg.master.codeNoKey', {}, { reason: 'noKey' });
  if (r.until) return userError(r.reason === 'wrong' ? (code ? 'msg.master.codeWrongWait' : 'msg.master.wrongWait') : 'msg.master.wait', { s: Math.max(1, Math.ceil((Date.parse(r.until) - Date.now()) / 1000)) }, { reason: 'wait', until: r.until });
  // nextWait: the seconds the vault will make the user wait once the free tries are gone (absent in an older vault).
  const next = Number.isFinite(r.nextWait) && r.nextWait > 0 ? r.nextWait : 0;
  const extra = next ? { nextWait: next } : {};
  if (next) {
    const wait = next < 60 ? tr('msg.master.waitSeconds', { n: next }) : Math.round(next / 60) === 1 ? tr('msg.master.waitMinute') : tr('msg.master.waitMinutes', { n: Math.round(next / 60) });
    const key = `msg.master.${code ? 'codeWrongNext' : 'wrongNext'}${r.left === 1 ? 'One' : ''}`;
    return userError(key, { n: r.left, wait }, { reason: 'wrong', left: r.left, ...extra });
  }
  if (code) return userError('msg.master.codeWrong', { n: r.left }, { reason: 'wrong', left: r.left });
  return userError(r.left === 1 ? 'msg.master.wrongOne' : 'msg.master.wrong', { n: r.left }, { reason: 'wrong', left: r.left });
}
// What a refused Windows Hello says (hello.rs's reasons). Nothing of the proof itself is in a message or in the error's fields.
const HELLO_WORDS = { changed: 'msg.master.helloChanged', alg: 'msg.master.helloChanged', cancelled: 'msg.master.helloCancelled', unavailable: 'msg.master.helloUnavailable', failed: 'msg.master.helloFailed', busy: 'msg.master.helloBusy', none: 'msg.master.helloNone', nonce: 'msg.master.helloExpired', expired: 'msg.master.helloExpired', purpose: 'msg.master.helloNeedsPassword' };
export function helloRefused(r) {
  if (r.reason === 'wait') return userError('msg.master.helloWait', { s: Math.max(1, Math.ceil((Date.parse(r.until) - Date.now()) / 1000)) }, { reason: 'wait', until: r.until });
  return userError(HELLO_WORDS[r.reason] ?? 'msg.master.helloFailed', {}, { reason: HELLO_WORDS[r.reason] ? r.reason : 'failed' });
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
  master.onStale = (what) => { log(`secretos: envolturas de otra clave de datos quitadas (${what.join(', ')})`); notice(tr('msg.master.staleWraps')); };
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
  const sealed = sealConnectors(master, ctx.config.mcpServers ?? [], { trusted: 'unbound' });
  if (sealed) { const c = saveConfig({ mcpServers: sealed }); emit('config:changed', c); moved.push('mcpServers'); }
  else if (bindMissing(master, ctx.config.mcpServers ?? [])) moved.push('mcpBindings');
  if (moved.length) log(`secretos: ${moved.join(', ')} cifrados con la clave de datos`);
  // Plaintext secrets also leave the archive of 3.7 and the copies of its database at once (not 30 days later).
  try {
    const n = scrubVaultedSecrets(ctx.home, { inVault: (id) => { try { return master.get(id) != null; } catch { return false; } } });
    if (n) log(`secretos: quitados en claro de ${n} archivo(s) de 3.7`);
  } catch (error) { log(`secretos: archivo de 3.7: ${error.message}`); }
  return moved;
}

// The guard of the dispatcher (api.mjs): a guarded call from this PC's window needs a fresh unlock token.
// → true when the call was guarded and its token was valid (the token may be used up by now), false when it needed none.
// With defer, unlocked is false, or the strength of the token that opened it: 'password' | 'hello'.
// defer: true → returns { unlocked, settle(ok) } and a rails token is spent by settle(true), after the action has run
// without error (so a call refused for its parameters does not make the owner type the password again). Until then the
// token is held as «in flight», so a second call with the same token cannot slip through while the first one runs.
const inflight = new Set();
export function checkUnlock(method, params, { defer = false } = {}) {
  const none = { unlocked: false, settle: () => {} };
  if (!needsUnlock(method, params, ctx.config)) return defer ? none : false;
  const m = ctx.master;
  if (!m?.hasPassword()) throw userError(m?.state().lost ? 'msg.master.lost' : 'msg.master.createFirst', {}, { reason: 'unlock' });
  // a token for one action (FRESH_UNLOCK) opens it once: it is used up here.
  // pausing or deleting a rule asks every time only when it is a shipped one: its file says so (de_serie), and a shipped id
  // counts even when its file is hidden or broken, so there is no state in which the password is skipped.
  const facts = RULE_TARGET_METHODS.has(method) ? { seedRule: isRuleId(params?.id) && (DEFAULT_IDS.has(params.id) || readRule(params.id)?.de_serie === true) } : {};
  const purpose = freshPurpose(method, params, { ...facts, current: ctx.config });
  // Windows Hello's token is enough everywhere but where a secret is shown, saved or given away (needsPassword).
  // (The phone's one-use approval will be the other proof a password-only action takes: it plugs in here, beside the password's.)
  const hello = !needsPassword(method, params, ctx.config);
  // A Hello token handed to a password-only action is told apart, so the window asks for the password and not for Hello again.
  const needed = () => (!hello && typeof params?.unlock === 'string' && m.tokenStrength(params.unlock) === 'hello'
    ? userError('msg.master.needPassword', {}, { reason: 'password' })
    : userError('msg.master.needUnlock', {}, { reason: 'unlock' }));
  // Only the rails token waits: its handlers validate the values (saveConfig) before any effect. The other one-use tokens
  // (secrets, rules, project delete) are spent as soon as they are checked: their handlers can fail after their effect.
  // The strength is read before a one-use token is spent: what the handler may trust depends on it (config.save re-ties a held connector's keys only for the password).
  const strength = hello && typeof params?.unlock === 'string' ? (m.tokenStrength(params.unlock) ?? 'password') : 'password';
  if (!defer || purpose !== RAILS_PURPOSE) {
    if (!m.checkToken(params?.unlock, purpose, { consume: Boolean(purpose), hello })) throw needed();
    return defer ? { unlocked: strength, settle: () => {} } : true;
  }
  const token = params?.unlock;
  if (typeof token !== 'string' || inflight.has(token) || !m.checkToken(token, purpose, { hello })) throw needed();
  inflight.add(token);
  return { unlocked: strength, settle: (ok) => { inflight.delete(token); if (ok) { try { m.checkToken(token, purpose, { consume: true, hello }); } catch { /* the token was already gone */ } } } };
}

// onLock(why): Orb locked (or its password changed): what the master password gave the chats goes
// (src/engine/security/grants.mjs › revokeAll).
// onScreen(locked): Orb's lock screen goes up (true) or down (false); also once at the start.
export function masterMethods({ board, emit, log, remoteRef, onUnlocked = () => {}, onLock = () => {}, onScreen = () => {} }) {
  const locked = (why) => { try { const r = onLock(why); if (r?.catch) r.catch((error) => log(`acceso: ${error.message}`)); } catch (error) { log(`acceso: ${error.message}`); } };
  const master = () => ctx.master ?? (ctx.master = openMaster(ctx.home, ctx.keys?.inVault ? IN_VAULT : ctx.secret ?? (() => { try { return fs.readFileSync(ctx.paths.key); } catch { return null; } })(), { log }));
  const opened = () => { migrateSecrets(board, master(), { log, emit }); try { onUnlocked(); } catch (error) { log(`secretos: ${error.message}`); } };
  const password = (v) => (typeof v === 'string' ? v : '');
  const connector = (name) => { const n = str(name, 'conector', 40); const s = (ctx.config.mcpServers ?? []).find((x) => x.name === n); if (!s) throw userError('msg.master.noConnector', { name: n }); return s; };
  // Windows keeps Hello's key under this name (vault accepts letters, digits and . _ - :): one per workspace.
  const helloAccount = () => `orb-${K.orbIdOf(ctx.home).orbId}`;
  const machineSecret = () => machineKeys().backup; // this PC's backup key (the recovery wrap)
  // The secrets that go on under a new data key: not the phones' keys (every phone is unlinked), nor what the old key authenticated.
  const keepOnRekey = (id) => id !== 'remote_keys' && !HELLO_ID_PREFIXES.some((x) => id === x || id.startsWith(`${x}/`));
  // Every phone and browser goes (they link again with the new password); this PC's keys for them are read again.
  const unlinkAll = (why) => {
    let n = 0;
    try { n = board.one('SELECT COUNT(*) AS n FROM devices').n; if (remoteRef.current) remoteRef.current.revokeAll(); else board.run('DELETE FROM devices'); } catch (error) { log(`${why}: móviles: ${error.message}`); }
    return n;
  };
  // Orb's own lock screen (the owner's decision): after the minutes of Ajustes › Datos without use, when
  // Windows locks or the PC sleeps (Rust's power.rs calls master.lock), or by hand, the window shows only the password.
  // The agents keep working (the vault stays open: only the window's tokens go). Kept in memory: a reload of the window
  // finds it locked; a new start of Orb opens as usual (this PC's own key, as at every start).
  let screen = ctx.screenAtStart === true; // an engine restarted under the lock screen keeps it (the app says so)
  const screenTold = (v) => { try { onScreen(v); } catch (error) { log(`pantalla de bloqueo: ${error.message}`); } };
  screenTold(screen);
  // When and why the screen locked, for its subtitle. Not known for an engine restarted under the lock (the app only says it was locked).
  let lockedAt = null; let lockReason = null;
  const screenOff = () => { if (screen) { screen = false; lockedAt = null; lockReason = null; screenTold(false); emit('master:unlocked', {}); } };
  return {
    // canForget: «He olvidado la contraseña» can keep the secrets (this PC opened them and has a recovery code).
    'master.state': () => {
      const m = master();
      let recovery = false; try { recovery = K.hasRecovery(ctx.home, machineSecret()); } catch { recovery = false; }
      // upgraded: the data came from Orb 3.7 (the first start after upgrading asks for the password with its own words).
      const screenLocked = screen && m.hasPassword();
      // lockedAt / lockReason only while the screen is locked; this PC's window only (master.state is never a phone's call).
      const st = m.state();
      return { ...st, canForget: (m.unlocked() && recovery) || st.hasCode === true, minLength: MIN_LENGTH, unlockMinutes: UNLOCK_MS / 60_000, screenLocked, ...(screenLocked ? { lockedAt, lockReason } : {}), upgraded: Boolean(board.setting(DONE_AT)) };
    },
    // The first one (the welcome, or the first start after upgrading from 3.7): no current one to ask for. → a token (the window is unlocked).
    'master.create': async ({ password: p }) => {
      const m = master(); const wasLocked = !m.unlocked();
      try { await m.create(password(p)); } catch (error) { throw asUser(error); }
      log('contraseña maestra creada');
      if (wasLocked) opened(); else migrateSecrets(board, m, { log, emit });
      screenOff();
      return m.issue();
    },
    // purpose: one of FRESH_PURPOSES (an action that asks every time): a token for that action only.
    // code: the generated recovery code instead of the password (it opens the data key by itself, on any PC).
    'master.unlock': async ({ password: p, code, purpose }) => {
      const m = master(); const wasLocked = !m.unlocked();
      const byCode = typeof code === 'string' && code !== '' && !password(p);
      let r; try { r = byCode ? await m.unlockWithCode(code, K.recoveryFile(ctx.home)) : await m.verify(password(p), 'pc'); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r, { code: byCode });
      if (wasLocked) { log('secretos: abiertos con la contraseña maestra'); opened(); }
      if (screen) log('pantalla de bloqueo: desbloqueada');
      screenOff();
      return m.issue(FRESH_PURPOSES.includes(purpose) ? purpose : null);
    },
    // ---- Windows Hello (the proof is checked in the vault; src-tauri/vault/src/hello.rs). This PC's window only.
    'master.helloState': () => {
      const m = master();
      const st = m.helloState();
      return { ...st, ...(st.enabled === true && st.valid === false ? { changed: true } : {}) };
    },
    // Turning it on takes the password or the recovery code, whatever token the window holds: the vault takes only the
    // one-use token of password strength made here for it.
    'master.helloEnable': async ({ password: p, code }) => {
      const m = master();
      const byCode = typeof code === 'string' && code !== '' && !password(p);
      let r; try { r = byCode ? await m.unlockWithCode(code, K.recoveryFile(ctx.home)) : await m.verify(password(p), 'pc'); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r, { code: byCode });
      let out; try { out = await m.helloEnable(helloAccount(), m.issue(HELLO_ENABLE_PURPOSE).unlock); } catch (error) { throw asUser(error); }
      if (!out.ok) throw helloRefused(out);
      log('Windows Hello activado');
      return { ok: true, tpm: out.tpm === true, at: out.at };
    },
    // A token from Windows Hello: purpose is one of HELLO_PURPOSES (the actions that ask every time and may take Hello), or
    // none for the window's own 5 minutes (it also lifts the lock screen). The secrets' and the new key's purposes want the
    // password. → { ok: true, unlock, until, strength: 'hello' }.
    'master.unlockHello': async ({ purpose } = {}) => {
      const m = master();
      if (purpose != null && !HELLO_PURPOSES.includes(purpose)) throw helloRefused({ reason: 'purpose' });
      if (!m.hasPassword()) throw userError(m.state().lost ? 'msg.master.lost' : 'msg.master.createFirst', {}, { reason: 'unlock' });
      let r; try { r = await m.helloUnlock(K.orbIdOf(ctx.home).orbId, purpose ?? null); } catch (error) { throw asUser(error); }
      if (!r.ok) throw helloRefused(r);
      if (purpose == null) { if (screen) log('pantalla de bloqueo: desbloqueada con Windows Hello'); screenOff(); }
      return { ok: true, unlock: r.unlock, until: r.until, strength: 'hello' };
    },
    // Any token of the window proves it (the vault checks it).
    'master.helloDisable': ({ unlock } = {}) => {
      let r; try { r = master().helloDisable(typeof unlock === 'string' ? unlock : ''); } catch (error) { throw asUser(error); }
      if (!r?.ok) throw userError('msg.master.needUnlock', {}, { reason: 'unlock' });
      log('Windows Hello desactivado');
      return { ok: true };
    },
    // Windows locked or the PC sleeps (the app), Orb unused for a while (the window) or «Bloquear» by hand: every token
    // goes and, with a master password, the window shows the lock screen (screen: true) until it is typed.
    'master.lock': ({ reason } = {}) => {
      const m = master(); m.lock();
      locked(reason === 'idle' ? 'bloqueo (sin usar)' : reason === 'hand' ? 'bloqueo (a mano)' : 'bloqueo');
      const was = screen; screen = m.hasPassword();
      // The first lock keeps its time and cause: a second one (Windows locks while Orb already shows the lock) does not rewrite them.
      if (screen && !was) { lockedAt = new Date().toISOString(); lockReason = Object.hasOwn(LOCK_REASONS, reason) ? LOCK_REASONS[reason] : null; }
      if (screen) screenTold(true);
      if (screen && !was) log(`pantalla de bloqueo${reason === 'idle' ? ' (sin usar)' : ''}`);
      emit('master:locked', { screen });
      return true;
    },
    // Guarded (checkUnlock): whether the window's token is still good (the app asks before opening core in the Explorer).
    'master.check': () => true,
    'master.change': async ({ current, next }) => {
      let r; try { r = await master().change(password(current), password(next)); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r);
      log('contraseña maestra cambiada');
      locked('contraseña cambiada');
      emit('master:locked', {}); screenOff();
      return master().issue();
    },
    // «He olvidado la contraseña»: the recovery code proves it is the owner (the vault checks it, with the same waits as a
    // password). A generated code opens the data key: the secrets, this PC's keys for the phones and every phone stay. A
    // phrase the user chose makes a new data key (the secrets are encrypted again, every phone goes), as it always did.
    'master.forgot': async ({ code, password: p, confirm }) => {
      if (confirm !== true) throw userError('msg.master.confirmForgot');
      const m = master(); const wasLocked = !m.unlocked();
      let next; try { next = checkPassword(password(p)); } catch (error) { throw asUser(error); }
      let r; try { r = await m.forgot(next, { code: typeof code === 'string' ? code : '', copy: K.recoveryFile(ctx.home), keep: keepOnRekey }); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r, { code: true });
      let unlinked = 0;
      if (r.rotated) {
        unlinked = unlinkAll('olvido');
        log(`contraseña maestra nueva con el código de recuperación (clave de datos nueva); ${unlinked} dispositivo(s) desenlazados`);
        board.notice(tr('msg.master.forgotDone', { n: unlinked }), 'warning');
      } else {
        log('contraseña maestra nueva con el código de recuperación (misma clave de datos)');
        board.notice(tr('msg.master.forgotKept'), 'warning');
      }
      locked('contraseña nueva');
      emit('master:locked', {}); screenOff();
      if (wasLocked) opened();
      return { ...m.issue(), unlinked };
    },
    // The recovery code: a new generated one is made and shown once (the user writes it down); a phrase of the user's own
    // takes its place for the copies only. Asked for with the password or the code now in force (current), both checked in
    // the vault: a token proves nothing here, because the code opens the vault. rekey (default: yes when a code is replaced)
    // also makes a new data key: the old code, and every copy from before it, stop opening what is kept from now on.
    // confirm: the phrase will take the generated code's place (the vault's wrap goes).
    'backup.recovery': async ({ code, password: p, current, rekey, confirm } = {}) => {
      const m = master();
      const chosen = code != null && code !== '';
      const value = chosen ? String(code) : K.newRecoveryCode();
      if (value.length < 12 || value.length > 200) throw userError('data.backup.err.shortPassphrase');
      const secret = machineSecret();
      const hadCode = m.state().hasCode === true;
      const replaces = hadCode || K.hasRecovery(ctx.home, secret);
      if (chosen && hadCode && confirm !== true) throw userError('msg.master.phraseDropsCode', {}, { reason: 'dropsCode' });
      const wantRekey = !chosen && (typeof rekey === 'boolean' ? rekey : replaces);
      let r;
      try {
        r = await m.setCode({ code: chosen ? '' : value, drop: chosen, password: typeof p === 'string' ? p : '', current: typeof current === 'string' ? current : '', copy: K.recoveryFile(ctx.home), rekey: wantRekey });
      } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r, { code: !password(p) });
      // The vault has already changed: whatever fails here, the code is still shown and a new data key still unlinks the phones.
      let copyWrapFailed = false;
      try { K.setRecovery(ctx.home, secret, value); } catch (error) {
        // The scheduled copies must not go on with the old code's wrap: without a wrap they go out without a code.
        copyWrapFailed = true;
        try { fs.rmSync(K.recoveryFile(ctx.home), { force: true, recursive: true }); } catch { /* the notice says it */ }
        log(`código de recuperación: copia-clave.json: ${error.message}`);
        board.notice(tr(chosen ? 'msg.master.phraseCopyWrap' : 'msg.master.codeCopyWrap'), 'warning');
      }
      const at = new Date().toISOString();
      if (r.rekeyed) {
        const unlinked = unlinkAll('código nuevo');
        log(`código de recuperación nuevo con clave de datos nueva; ${unlinked} dispositivo(s) desenlazados`);
        board.notice(tr('msg.master.codeRekeyed', { n: unlinked }), 'warning');
        emit('master:locked', {});
        return { code: value, at, rekeyed: true, unlinked, ...(copyWrapFailed ? { copyWrapFailed } : {}), ...m.issue() };
      }
      log(chosen ? 'código de recuperación: frase propia (el código ya no abre la bóveda)' : 'código de recuperación nuevo (misma clave de datos)');
      // Only a replaced code can still be out there: copies made before keep its wrap, and with them the old code opens what they hold.
      return { code: chosen ? null : value, at, rekeyed: false, ...(copyWrapFailed ? { copyWrapFailed } : {}), ...(!chosen && replaces ? { warn: tr('msg.master.codeKeptKey') } : {}) };
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
      locked('secretos borrados');
      emit('master:locked', {}); screenOff();
      if (wasLocked) opened();
      return { ...m.issue(), unlinked };
    },
    // A connector's keys (guarded): to see them, and to change them (empty value: that key goes). Saving ties them to the
    // connector's command as it is now.
    'secrets.connector': ({ name }) => { const s = connector(name); try { return { name: s.name, env: connectorSecrets(master(), s) }; } catch (error) { throw asUser(error); } },
    // The API keys of the agents that take one (Grok, Devin, Droid): which are saved (never their values), and saving or
    // removing one (empty value). The window never gets a value back: a key typed is only ever written.
    'agentKeys.state': () => agentKeyState(master()),
    'agentKeys.save': ({ agent, name, value }) => {
      try { return { saved: saveAgentKey(master(), String(agent ?? ''), String(name ?? ''), value ?? '') }; }
      catch (error) { throw error instanceof MasterError ? asUser(error) : userError('msg.master.badKeys'); }
    },
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
