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
import { needsUnlock, needsPassword, freshPurpose, FRESH_PURPOSES, HELLO_PURPOSES, HELLO_ENABLE_PURPOSE, RULE_TARGET_METHODS, RAILS_PURPOSE, mobileMayApprove, APPROVE_REGISTER_PURPOSE, REBUILD_PURPOSE } from '../../domain/security/permissions.mjs';
import { approveSummary, approvePurpose, SUMMARY_MAX } from '../../domain/security/approve.mjs';
import crypto from 'node:crypto';

// The key that keeps the secrets in an approval's summary from being guessed: made once, kept in the vault, never sent to a phone.
function approveKey() {
  const m = ctx.master;
  let k = m.get('approve_summary_key');
  if (typeof k !== 'string' || k.length < 32) { k = crypto.randomBytes(32).toString('hex'); m.set('approve_summary_key', k); }
  return Buffer.from(k, 'hex');
}
import { readRule, isRuleId } from '../../domain/rules/rules.mjs';
import { DEFAULT_IDS } from '../../domain/rules/defaults.mjs';
import * as K from '../../domain/data/backup.mjs';
import { str, oneOf } from './common.mjs';
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
  const hello = !needsPassword(method, params, ctx.config);
  // The phone's one-use approval is the other proof a password-only action takes: it is good for this action with these very
  // parameters (the vault holds the purpose the phone signed for) and is spent here.
  if (!hello && typeof params?.unlock === 'string' && m.tokenStrength(params.unlock) === 'mobile') {
    if (!mobileMayApprove(method, params, ctx.config) || !m.checkToken(params.unlock, approvePurpose(method, params, approveKey()), { consume: true, mobile: true })) throw userError('msg.master.needUnlock', {}, { reason: 'unlock' });
    return defer ? { unlocked: 'mobile', settle: () => {} } : true;
  }
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
  const locked = (why) => { try { remoteRef.current?.cancelLinkCode?.(); } catch (error) { log(`enlace: ${error.message}`); } try { const r = onLock(why); if (r?.catch) r.catch((error) => log(`acceso: ${error.message}`)); } catch (error) { log(`acceso: ${error.message}`); } };
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
    try { master().approveForgetAll(); } catch (error) { log(`${why}: aprobaciones del móvil: ${error.message}`); }
    return n;
  };

  // ---- a phone's fingerprint (the vault checks every signature: src-tauri/vault/src/approve.rs). This PC asks and waits; the phone answers.
  // What the window waits for, by request: { nonce, device, kind: 'approve' | 'enroll' | 'rebuild', state, until, token? }.
  const requests = new Map();
  const orbId = () => K.orbIdOf(ctx.home).orbId;
  const sweepRequests = () => { for (const [id, r] of requests) if (r.until <= Date.now()) { requests.delete(id); remoteRef.current?.stopAsking(r.device); } };
  const phones = () => board.all("SELECT id, name, last_seen FROM devices WHERE public_key IS NOT NULL AND kind = 'phone' ORDER BY last_seen DESC");
  // The phone to ask: the one named, or else the registered one seen last.
  const registeredPhone = (id) => {
    const reg = new Set(master().approveList().map((r) => r.id));
    const list = phones().filter((p) => reg.has(p.id));
    const pick = id == null ? list[0] : list.find((p) => p.id === String(id));
    if (!pick) throw userError('msg.approve.none', {}, { reason: 'none' });
    return pick;
  };
  const refusedApproval = (r) => userError(r?.reason === 'big' ? 'msg.approve.big' : r?.reason === 'noKeys' ? 'msg.approve.noKeys' : 'msg.approve.none', {}, { reason: r?.reason ?? 'none' });
  // The challenge goes to the phone as a sealed event; the window gets an id to poll.
  const startRequest = (kind, phone, ch) => {
    sweepRequests();
    const id = crypto.randomUUID();
    requests.set(id, { nonce: ch.nonce, device: phone.id, kind, state: 'waiting', until: ch.until });
    const delivered = remoteRef.current?.sendTo(phone.id, { e: 'approve', p: { kind, nonce: ch.nonce, payload: ch.payload, summary: ch.summary, until: ch.until, deviceId: phone.id } }, { until: ch.until }) ?? 0;
    return { id, device: phone.name, delivered: delivered > 0, until: ch.until };
  };
  // Who answers: the linked phone itself. This PC's own window may name it (the vault checks the signature, which only the phone's key makes).
  const answeringDevice = (principal, params) => (principal?.channel === 'phone' ? principal.device : principal?.channel === 'desktop' && typeof params?.device === 'string' ? params.device : null);
  const answered = (device, nonce, patch) => {
    remoteRef.current?.stopAsking(device);
    const r = [...requests.values()].find((x) => x.nonce === nonce && x.device === device);
    if (r) Object.assign(r, patch);
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
      // REBUILD_PURPOSE is the first step of «Lo he olvidado todo»: its token starts nothing but master.rebuildStart.
      if (purpose != null && purpose !== REBUILD_PURPOSE && !HELLO_PURPOSES.includes(purpose)) throw helloRefused({ reason: 'purpose' });
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
    // ---- link a phone without the master password: a one-use code (src-tauri/vault/src/link.rs), shown after Windows Hello or the
    // password. The vault takes only the one-use token made for it (any other, or none, is refused there).
    'link.codeNew': async ({ unlock, kind } = {}) => {
      const m = master(); const remote = remoteRef.current;
      const via = oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined);
      if (typeof unlock !== 'string' || !m.hasPassword()) throw userError('msg.master.needUnlock', {}, { reason: 'unlock' });
      if (!remote.status().running) {
        if (!ctx.config.mobile?.enabled) { const c = saveConfig({ mobile: { enabled: true } }); emit('config:changed', c); }
        await remote.start();
      }
      let made; try { made = m.linkNew(unlock); } catch (error) { throw error instanceof MasterError && error.code === 'locked' ? userError('msg.master.needUnlock', {}, { reason: 'unlock' }) : asUser(error); }
      if (!made.ok) throw userError('msg.link.noKeys', {}, { reason: made.reason });
      log('enlace sin contraseña: código nuevo');
      return remote.openLinkCode(via, made);
    },
    // The owner's answer to «¿Enlazar <name>?».
    'link.codeAnswer': ({ id, accept } = {}) => ({ ok: remoteRef.current?.answerLinkCode(str(id, 'id', 64), accept === true) === true }),
    'link.codeWaiting': () => remoteRef.current?.waitingLinkCode() ?? null,
    'link.codeCancel': () => { remoteRef.current?.cancelLinkCode(); return true; },
    // ---- a phone approves sensitive actions with its fingerprint
    // The linked phones and whether each may approve; a registration whose phone was unlinked is dropped on the way.
    'approve.devices': () => {
      const m = master();
      const reg = new Map(m.approveList().map((r) => [r.id, r]));
      for (const id of [...reg.keys()]) if (!board.one('SELECT 1 AS x FROM devices WHERE id = ?', id)) { try { m.approveForget(id); } catch { /* next time */ } reg.delete(id); }
      return { phones: phones().map((p) => ({ id: p.id, name: p.name, registered: reg.has(p.id), at: reg.get(p.id)?.at ?? null })) };
    },
    // Registering a phone takes the password or the recovery code typed now, with its name in sight; the phone then makes its key
    // and signs the first challenge with its fingerprint. → { id } to poll.
    'approve.register': async ({ id, password: p, code }) => {
      const m = master();
      const phone = phones().find((x) => x.id === String(id));
      if (!phone) throw userError('msg.approve.notPhone', {}, { reason: 'notPhone' });
      const byCode = typeof code === 'string' && code !== '' && !password(p);
      let r; try { r = byCode ? await m.unlockWithCode(code, K.recoveryFile(ctx.home)) : await m.verify(password(p), 'pc'); } catch (error) { throw asUser(error); }
      if (!r.ok) throw refused(r, { code: byCode });
      let ch; try { ch = m.approveBegin({ token: m.issue(APPROVE_REGISTER_PURPOSE).unlock, orbId: orbId(), deviceId: phone.id, name: phone.name }); } catch (error) { throw asUser(error); }
      if (!ch.ok) throw refusedApproval(ch);
      log(`aprobaciones del móvil: registro pedido a «${phone.name}»`);
      return startRequest('enroll', phone, ch);
    },
    'approve.unregister': ({ id }) => {
      master().approveForget(String(id)); remoteRef.current?.stopAsking(String(id));
      for (const [k, r] of requests) if (r.device === String(id)) requests.delete(k);
      log('aprobaciones del móvil: quitadas');
      return { ok: true };
    },
    // Asks the phone to approve `method` with `params` (what a password-only action would take). The token that comes back is for
    // that call and nothing else: poll it, then make the call with it as `unlock`.
    'approve.request': ({ method, params, device }) => {
      const m = master();
      if (typeof method !== 'string' || !params || typeof params !== 'object' || Array.isArray(params) || !mobileMayApprove(method, params, ctx.config)) throw userError('msg.approve.badMethod', {}, { reason: 'method' });
      const summary = approveSummary(params, approveKey());
      if (summary.length > SUMMARY_MAX) throw userError('msg.approve.big', {}, { reason: 'big' });
      const phone = registeredPhone(device);
      let ch; try { ch = m.approveAsk({ orbId: orbId(), deviceId: phone.id, action: method, summary }); } catch (error) { throw asUser(error); }
      if (!ch.ok) throw refusedApproval(ch);
      return startRequest('approve', phone, ch);
    },
    // → { state: 'waiting' | 'done' | 'refused' | 'expired' | 'gone', unlock?, until?, strength? }. A token is handed over once.
    'approve.poll': ({ id }) => {
      const r = requests.get(String(id));
      if (!r) return { state: 'gone' };
      // A phone unlinked or removed since it answered: what it made is not handed over.
      if (!master().approveList().some((x) => x.id === r.device) && r.kind !== 'enroll') { requests.delete(String(id)); return { state: 'gone' }; }
      if (r.state === 'waiting' && r.until <= Date.now()) { requests.delete(String(id)); remoteRef.current?.stopAsking(r.device); return { state: 'expired' }; }
      if (r.state === 'refused') { requests.delete(String(id)); return { state: 'refused' }; }
      if (r.state === 'done' && r.kind !== 'rebuild') { requests.delete(String(id)); return { state: 'done', ...(r.token ? { unlock: r.token, until: r.tokenUntil, strength: 'mobile' } : {}) }; }
      return { state: r.state };
    },
    // The phone's side: its public key and the first signature (it proves the key is there, behind the fingerprint).
    'approve.enroll': ({ nonce, pub, sig, ...rest }, principal) => {
      const device = answeringDevice(principal, rest);
      if (!device) throw userError('msg.approve.badMethod', {}, { reason: 'method' });
      const r = master().approveEnroll(device, str(nonce, 'nonce', 64), str(pub, 'clave', 200), str(sig, 'firma', 200));
      if (!r.ok) { answered(device, nonce, { state: 'refused' }); return { ok: false, reason: r.reason }; }
      answered(device, nonce, { state: 'done' });
      log(`aprobaciones del móvil: «${r.name}» puede aprobar`);
      board.notice(tr('msg.approve.registered', { name: r.name }), 'info');
      return { ok: true, orbId: orbId() };
    },
    // The phone's answer to an approval (or to the rebuild's step): only the signature; the token never goes back to the phone.
    'approve.respond': ({ nonce, sig, ...rest }, principal) => {
      const device = answeringDevice(principal, rest);
      if (!device) throw userError('msg.approve.badMethod', {}, { reason: 'method' });
      const r = master().approveSign(device, str(nonce, 'nonce', 64), str(sig, 'firma', 200));
      if (!r.ok) { answered(device, nonce, { state: 'refused' }); return { ok: false, reason: r.reason }; }
      answered(device, nonce, { state: 'done', ...(r.unlock ? { token: r.unlock, tokenUntil: r.until } : {}) });
      log(r.kind === 'rebuild' ? 'aprobaciones del móvil: aprobado el último paso de «Lo he olvidado todo»' : 'aprobaciones del móvil: acción aprobada');
      return { ok: true };
    },
    // «Lo he olvidado todo» (no password, no code): Windows Hello first (master.unlockHello with purpose 'rebuild-master'), then the
    // phone that was registered, then a new password and code in one request. Without that phone nothing is made.
    'master.rebuildStart': ({ unlock, device }) => {
      const m = master();
      if (!m.hasPassword()) throw userError(m.state().lost ? 'msg.master.lost' : 'msg.master.createFirst', {}, { reason: 'unlock' });
      const phone = registeredPhone(device);
      let ch; try { ch = m.rebuildBegin({ token: typeof unlock === 'string' ? unlock : '', orbId: orbId(), deviceId: phone.id }); } catch (error) { throw asUser(error); }
      if (!ch.ok) throw refusedApproval(ch);
      log('aprobaciones del móvil: «Lo he olvidado todo» pide la aprobación del móvil');
      return startRequest('rebuild', phone, ch);
    },
    // Like approve.poll, but the rebuild's yes stays until master.rebuildFinish uses it.
    'master.rebuildPoll': ({ id }) => {
      const r = requests.get(String(id));
      if (!r || r.kind !== 'rebuild') return { state: 'gone' };
      if (!master().approveList().some((x) => x.id === r.device)) { requests.delete(String(id)); return { state: 'gone' }; }
      if (r.state === 'waiting' && r.until <= Date.now()) { requests.delete(String(id)); remoteRef.current?.stopAsking(r.device); return { state: 'expired' }; }
      if (r.state === 'refused') requests.delete(String(id));
      return { state: r.state };
    },
    'master.rebuildFinish': async ({ id, password: p }) => {
      const m = master();
      const r = requests.get(String(id));
      if (!r || r.kind !== 'rebuild' || r.state !== 'done') throw userError('msg.approve.notYet', {}, { reason: 'approval' });
      let next; try { next = checkPassword(password(p)); } catch (error) { throw asUser(error); }
      const value = K.newRecoveryCode(); const secret = machineSecret();
      let out; try { out = await m.rebuildFinish(next, value); } catch (error) { throw asUser(error); }
      if (!out.ok) throw userError('msg.approve.notYet', {}, { reason: 'approval' });
      requests.delete(String(id));
      let copyWrapFailed = false;
      try { K.setRecovery(ctx.home, secret, value); } catch (error) {
        copyWrapFailed = true;
        try { fs.rmSync(K.recoveryFile(ctx.home), { force: true, recursive: true }); } catch { /* the notice says it */ }
        log(`código de recuperación: copia-clave.json: ${error.message}`);
        board.notice(tr('msg.master.codeCopyWrap'), 'warning');
      }
      log('contraseña maestra y código de recuperación nuevos con la aprobación del móvil (misma clave de datos)');
      board.notice(tr('msg.approve.rebuilt'), 'warning');
      locked('contraseña nueva');
      emit('master:locked', {}); screenOff();
      return { code: value, at: new Date().toISOString(), ...(copyWrapFailed ? { copyWrapFailed } : {}), ...m.issue() };
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
