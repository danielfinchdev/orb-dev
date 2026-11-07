// 3.6 (WS5): the engine's data methods: encrypted backups (src/core/backup.mjs) and moving the Orb to another machine. The daily copy at 03:00 (the owner's time zone) runs
// from the engine's loop (tick). This PC's window only: no phone calls these.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr, saveConfig } from '../core/context.mjs';
import { readKey, paths } from '../core/home.mjs';
import { ownerId, getPerson, mustPerson, dropTickets } from '../core/persons.mjs';
import * as K from '../core/backup.mjs';
import { moveExport, moveUndo, moveKeepBoth, movedAway, exportPerson, deletePerson, purgePersonsTrash } from '../core/export.mjs';
import { utcToZoned, localDay, isValidTz, systemTz } from '../core/tz.mjs';

// 3.6: what an Orb that moved away still answers (the rest is refused until the move is undone or both are kept).
export const MOVED_OK = /^(app\.state|data\.move(Status|Undo|KeepBoth)|backup\.(status|list|verify))$/;
const fail = (message) => { const e = new Error(message); e.userFacing = true; throw e; };
// 3.6: the owner's zone (persons.tz), else the Orb's own setting, else this machine's.
export const ownerTz = (board = null) => {
  let tz = null; try { tz = board ? getPerson(board, ownerId(board))?.tz : null; } catch { tz = null; }
  return isValidTz(tz) ? tz : isValidTz(ctx.config?.tz) ? ctx.config.tz : systemTz();
};
export const DAILY_HOUR = 3;

export function dataApi({ board, emit = () => {}, log = () => {}, version = null }) {
  const secret = () => ctx.secret ?? readKey(ctx.home);
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
        const r = await K.createBackup({ home: ctx.home, secret: secret(), kind, version, folder: folder(), log, ...opts(), ...extra });
        const gone = kind === 'move' ? [] : await K.pruneBackups(folder()).catch(() => []);
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

  // The daily copy: once a day after 03:00 in the owner's zone (a PC that was off at 03:00 makes it when it starts).
  // Not in the first minutes after starting (the engine has more urgent things then; a short run makes none).
  let lastLook = 0; const startedAt = Date.now();
  const firstAfter = Number(process.env.ORB_BACKUP_DELAY_MS ?? 5 * 60_000);
  const tick = (now = Date.now()) => {
    if (ctx.config.backup?.enabled === false || running || now - lastLook < 60_000 || now - startedAt < firstAfter) return false;
    lastLook = now;
    const tz = ownerTz(board);
    if (utcToZoned(now, tz).hour < DAILY_HOUR) return false;
    const today = localDay(now, tz);
    if (board.setting('backup_daily_day') === today) return false;
    const tried = Number(board.setting('backup_daily_try') ?? 0);
    if (now - tried < 3_600_000) return false; // a failed one is tried again an hour later
    board.setting('backup_daily_try', String(now));
    try { const gone = purgePersonsTrash(ctx.home, now); if (gone) log(`personas borradas hace más de 30 días: ${gone} carpetas quitadas`); } catch { /* next day */ }
    run('daily').then(() => board.setting('backup_daily_day', today)).catch((error) => board.notice(tr('data.backup.dailyFailed', { error: error.message }), 'warning'));
    return true;
  };

  const methods = {
    'backup.status': () => {
      let last = null; try { last = JSON.parse(board.setting('backup_last') ?? 'null'); } catch { last = null; }
      const rec = K.recoveryOf(ctx.home, secret());
      return { enabled: ctx.config.backup?.enabled !== false, folder: folder(), recovery: Boolean(rec), recoveryAt: rec?.at ?? null, last, running: Boolean(running), tz: ownerTz(board), hour: DAILY_HOUR, ...opts() };
    },
    'backup.list': async () => (await K.listBackups(folder())).map(({ file, ...b }) => ({ ...b, path: file })),
    // kind: manual (Ajustes › Datos) or preupdate (the app, before installing a new version).
    'backup.now': ({ kind }) => run(['preupdate', 'premigration'].includes(kind) ? kind : 'manual'),
    'backup.verify': async ({ file, passphrase }) => { const r = await K.verifyBackup(fileOf(file), { secret: secret(), passphrase: pass(passphrase) }); return { ok: true, files: r.files, bytes: r.bytes, created: r.header.created, version: r.header.version }; },
    // The copy is checked and unpacked now; it replaces the data at the next start of the engine (restartNeeded).
    'backup.restore': async ({ file, passphrase }) => {
      const r = await K.stageRestore(ctx.home, fileOf(file), { secret: secret(), passphrase: pass(passphrase) });
      log(`copia lista para restaurar: ${path.basename(file)} (${r.files} archivos)`);
      emit('backup:restoreReady', { file: path.basename(file) });
      return { ok: true, files: r.files, created: r.header.created, restartNeeded: true };
    },
    // The recovery code: a new one is made and shown once (the user writes it down); copies from now on open with it.
    'backup.recovery': ({ code }) => {
      const value = code == null || code === '' ? K.newRecoveryCode() : String(code);
      if (value.length < 12 || value.length > 200) fail(tr('data.backup.err.shortPassphrase'));
      K.setRecovery(ctx.home, secret(), value);
      return { code: code ? null : value, at: new Date().toISOString() };
    },
    // Moving the Orb: a copy that opens only with the passphrase, made to be imported on the new machine (orb-nucleo
    // mover importar, or the wizard). This Orb then stops serving (ctx.moved) until the move is undone or both are kept.
    'data.moveExport': async ({ passphrase }) => {
      const p = pass(passphrase); if (!p || p.length < 12) fail(tr('data.backup.err.shortPassphrase'));
      if (running) await running.catch(() => {});
      const r = await moveExport({ home: ctx.home, secret: secret(), passphrase: p, version, folder: folder(), log });
      ctx.moved = movedAway(ctx.home);
      emit('data:moved', { moved: ctx.moved });
      return { file: path.basename(r.file), path: r.file, created: r.header.created, orbId: r.header.orbId, incarnation: r.header.incarnation };
    },
    // One person's data: their own export (a .zip, or sealed with a passphrase), into Orb's exports folder.
    'data.exportPerson': async ({ id, passphrase }, who) => {
      const pid = mustPerson(board, id ?? who?.person ?? ownerId(board)).id;
      const r = await exportPerson(board, pid, { home: ctx.home, folder: path.join(paths(ctx.home).internal, 'exportaciones'), passphrase: pass(passphrase) });
      emit('data:personExported', { person: pid, file: path.basename(r.file) });
      return { file: path.basename(r.file), path: r.file, files: r.files };
    },
    // Deleting a person (themselves, or the owner deleting someone): their export and files wait 30 days in the trash.
    'data.deletePerson': ({ id }, who) => removePersonData(id ?? who?.person),
    'data.moveStatus': () => ({ moved: movedAway(ctx.home) }),
    'data.moveUndo': () => { moveUndo(ctx.home); ctx.moved = null; emit('data:moved', { moved: null }); return { moved: null, restartNeeded: true }; },
    // «Mantener ambos»: this one becomes a new Orb (the links it had are with the one that moved: they are made again).
    'data.moveKeepBoth': () => { const id = moveKeepBoth(ctx.home); ctx.moved = null; emit('data:moved', { moved: null }); return { orbId: id.orbId, restartNeeded: true }; }
  };
  // persons.remove (src/engine/api-persons.mjs) does the same.
  function removePersonData(id) {
    const p = mustPerson(board, id);
    const r = deletePerson(board, p.id, { home: ctx.home });
    dropTickets(p.id);
    // Their accounts in orb.json (their login folders went to the trash with the rest).
    const accounts = (ctx.config.accounts ?? []).filter((a) => a.person !== p.id);
    if (accounts.length !== (ctx.config.accounts ?? []).length) saveConfig({ accounts });
    board.changed?.('persons');
    log(`persona borrada: ${p.id} (papelera ${path.basename(r.trash)})`);
    return { id: p.id, deleted: true };
  }
  return { methods, tick, run, removePersonData };
}
