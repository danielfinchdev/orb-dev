// 3.6 (WS5): the engine's data methods: encrypted backups (src/domain/data/backup.mjs). The daily copy at 03:00 (the owner's
// time zone) runs from the engine's loop (tick). Moving to another PC is a backup restored there with the recovery code. This PC's window only: no phone calls these.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { paths } from '../../platform/paths.mjs';
import { machineKeys } from '../../platform/keys.mjs';
import { BACK_FILE } from '../security/approval-secret.mjs';
import * as K from '../../domain/data/backup.mjs';
import { legacyData, deleteLegacyData } from '../../domain/data/legacy/migrate-38.mjs';
import { utcToZoned, localDay, ownerTz } from '../../shared/tz.mjs';
import { refused } from './master.mjs';

// A backup's Orb version older than 3.8 (one without a version is not counted).
export const before38 = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? '')); return Boolean(m) && (Number(m[1]) < 3 || (Number(m[1]) === 3 && Number(m[2]) < 8)); };

const fail = (message) => { const e = new Error(message); e.userFacing = true; throw e; };
export const DAILY_HOUR = 3;

export function dataApi({ board, emit = () => {}, log = () => {}, version = null }) {
  const secret = () => machineKeys().backup; // this PC's backup key (src/platform/keys.mjs)
  const folder = () => K.backupDir(ctx.home, ctx.config);
  const opts = () => ({ includeProjects: ctx.config.backup?.projects === true, includeAccounts: ctx.config.backup?.accounts === true });
  // A copy named by the list (its file name) or, from the desktop, any .orbbak (restore on a new machine).
  const fileOf = (file) => {
    const f = String(file ?? '');
    if (!f || f.length > 1000 || !f.toLowerCase().endsWith(K.EXT)) fail(tr('data.backup.err.notBackup'));
    const full = path.isAbsolute(f) ? f : path.join(folder(), path.basename(f));
    if (!fs.existsSync(full)) fail(tr('data.backup.err.missing'));
    return full;
  };
  const pass = (p) => (p == null || p === '' ? null : typeof p === 'string' && p.length <= 200 ? p : fail(tr('data.backup.err.wrongPassphrase')));
  let running = null;
  const run = async (kind, extra = {}) => {
    if (running) return running;
    running = (async () => {
      try {
        await cleaned;
        // Its progress as whole percents (the app shows the pre-update one on the update card: src-tauri/src/updater.rs).
        let said = -1;
        const progress = (x) => { const percent = Math.min(100, Math.floor(x * 100)); if (percent !== said) { said = percent; emit('backup:progress', { kind, percent }); } };
        const r = await K.createBackup({ home: ctx.home, secret: secret(), kind, version, folder: folder(), log, progress, ...opts(), ...extra });
        const gone = await K.pruneBackups(folder()).catch(() => []);
        board.setting('backup_last', JSON.stringify({ at: r.header.created, kind, file: path.basename(r.file), ok: true }));
        emit('backup:done', { kind, file: path.basename(r.file), size: fs.statSync(r.file).size, pruned: gone.length });
        return { file: path.basename(r.file), path: r.file, created: r.header.created, files: r.header.counts.files, recovery: Boolean(r.header.wrapped.passphrase), pruned: gone.length };
      } catch (error) {
        board.setting('backup_last', JSON.stringify({ at: new Date().toISOString(), kind, ok: false, error: String(error.message).slice(0, 300) }));
        log(`copia (${kind}): ${error.message}`);
        throw error;
      } finally { running = null; }
    })();
    return running;
  };

  // What a copy cut short left in the backup folders (Orb closed mid-copy, or a new version installed while one was
  // being made) goes at the start, before any copy of this engine begins.
  const cleaned = Promise.resolve().then(() => Promise.all([...new Set([folder(), K.defaultBackupDir(ctx.home)])].map((d) => K.cleanStaleStages(d))))
    .then((counts) => { const n = counts.reduce((a, b) => a + b, 0); if (n) log(`copia: quitados ${n} restos de copias sin terminar`); })
    .catch(() => {});

  // The daily copy: once a day after 03:00 in the owner's zone (a PC that was off at 03:00 makes it when it starts).
  // Not in the first minutes after starting (the engine has more urgent things then; a short run makes none).
  let lastLook = 0; const startedAt = Date.now();
  const firstAfter = Number(process.env.ORB_BACKUP_DELAY_MS ?? 5 * 60_000);
  const tick = (now = Date.now()) => {
    if (ctx.config.backup?.enabled === false || running || now - lastLook < 60_000 || now - startedAt < firstAfter) return false;
    lastLook = now;
    const tz = ownerTz(ctx.config);
    if (utcToZoned(now, tz).hour < DAILY_HOUR) return false;
    const today = localDay(now, tz);
    if (board.setting('backup_daily_day') === today) return false;
    const tried = Number(board.setting('backup_daily_try') ?? 0);
    if (now - tried < 3_600_000) return false; // a failed one is tried again an hour later
    board.setting('backup_daily_try', String(now));
    run('daily').then(() => board.setting('backup_daily_day', today)).catch((error) => board.notice(tr('data.backup.dailyFailed', { error: error.message }), 'warning'));
    return true;
  };

  const methods = {
    'backup.status': () => {
      let last = null; try { last = JSON.parse(board.setting('backup_last') ?? 'null'); } catch { last = null; }
      const rec = K.recoveryOf(ctx.home, secret());
      return { enabled: ctx.config.backup?.enabled !== false, folder: folder(), custom: folder() !== K.defaultBackupDir(ctx.home), recovery: Boolean(rec), recoveryAt: rec?.at ?? null, previousKey: ctx.previousKey || null, last, running: Boolean(running), tz: ownerTz(ctx.config), hour: DAILY_HOUR, ...opts() };
    },
    'backup.list': async () => (await K.listBackups(folder())).map(({ file, ...b }) => ({ ...b, path: file })),
    // kind: manual (Ajustes › Datos) or preupdate (the app, before installing a new version).
    'backup.now': ({ kind }) => run(['preupdate', 'premigration'].includes(kind) ? kind : 'manual'),
    // 3.8: guarded (the master password), and a recovery code typed here has the waits of any password: no trying codes.
    'backup.verify': async ({ file, passphrase }) => {
      const full = fileOf(file); const p = pass(passphrase);
      const check = () => K.verifyBackup(full, { secret: secret(), passphrase: p });
      let r = null;
      if (!p || !ctx.master) r = await check();
      else {
        let error = null;
        const t = await ctx.master.attempt('recovery', async () => { try { r = await check(); return true; } catch (e) { error = e; return e?.code !== 'wrongPassphrase'; } });
        if (!t.ok) throw refused(t, { code: true });
        if (error) throw error;
      }
      return { ok: true, files: r.files, bytes: r.bytes, created: r.header.created, version: r.header.version };
    },
    // The copy is checked and unpacked now; it replaces the data at the next start of the engine (restartNeeded).
    'backup.restore': async ({ file, passphrase }) => {
      const r = await K.stageRestore(ctx.home, fileOf(file), { secret: secret(), passphrase: pass(passphrase) });
      log(`copia lista para restaurar: ${path.basename(file)} (${r.files} archivos)`);
      emit('backup:restoreReady', { file: path.basename(file) });
      return { ok: true, files: r.files, created: r.header.created, restartNeeded: true };
    },
    // The recovery code: a new one is made and shown once (the user writes it down); copies from now on open with it.
    // 3.8.1 (Tauri): after «Empezar con una clave nueva», Windows opens the key from before again: go back to it at the
    // next start (src-tauri/vault/src/machine.rs › previous_key). Guarded like the recovery code.
    'backup.previousKey': () => {
      if (!ctx.previousKey) fail(tr('data.backup.err.noPreviousKey'));
      fs.writeFileSync(path.join(paths(ctx.home).data, BACK_FILE), JSON.stringify({ at: new Date().toISOString() }));
      return { restart: true };
    },
    'backup.recovery': ({ code }) => {
      const value = code == null || code === '' ? K.newRecoveryCode() : String(code);
      if (value.length < 12 || value.length > 200) fail(tr('data.backup.err.shortPassphrase'));
      K.setRecovery(ctx.home, secret(), value);
      return { code: code ? null : value, at: new Date().toISOString() };
    },
    // 3.8: what Orb 3.7 left (the archives and the copies of its database), and «Borrar los datos de Orb 3.7».
    // oldBackups (review F3b M5): the copies made before Orb 3.8 still hold 3.7's keys without the master password.
    'legacy.status': async () => {
      const d = legacyData(ctx.home);
      const oldBackups = (await K.listBackups(folder())).filter((b) => !b.damaged && before38(b.version)).length;
      return { archives: d.archives.map((f) => path.basename(f)), copies: d.copies.map((f) => path.basename(f)), bytes: d.bytes, oldBackups };
    },
    'legacy.delete': () => {
      const d = deleteLegacyData(board.db, ctx.home);
      log(`3.8: datos de Orb 3.7 borrados: ${[...d.archives, ...d.copies].map((f) => path.basename(f)).join(', ') || 'ninguno'}`);
      return { deleted: d.archives.length + d.copies.length, bytes: d.bytes };
    },
  };
  return { methods, tick, run };
}
