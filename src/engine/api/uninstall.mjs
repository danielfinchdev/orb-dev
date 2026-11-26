// «Restablecer Orb» and «Desinstalar Orb» (Ajustes › Datos) and «Datos de antes». This PC's window only: none of these methods
// is in REMOTE_METHODS (src/domain/security/permissions.mjs), so no phone and no agent can call them, and each asks for a recent
// unlock when the vault has a master password. The plan is computed here and shown as it is; the run refuses a plan the
// window did not see (its id).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../../platform/context.mjs';
import { hostCall } from '../host/host.mjs';
import { fail } from './common.mjs';
import { BOXES, MODES } from '../../shared/uninstall-boxes.mjs';
import { BOXES as ALL_BOXES } from '../../shared/uninstall-boxes.mjs';
import { planUninstall, runPlan, uninstallEnv, closeJournal, confirmResume, pendingJournal, stubCoreAfterStop, MARK_FILE } from '../../domain/data/uninstall.mjs';
import { asideList, deleteAside } from '../previous.mjs';

// What must be typed to confirm «Borrar todo»; either language's word is taken.
export const CONFIRM_WORDS = ['BORRAR', 'DELETE'];
const LIST_MAX = 400;

// The mark the installer's hooks read (src-tauri/nsis/hooks.nsh): a compact JSON, so they can look for `"encrypted":true`.
export function markText({ plan, code, now = Date.now() }) {
  return JSON.stringify({ v: 1, at: new Date(now).toISOString(), mode: plan.mode, encrypted: plan.keyKept === true, games: plan.keep.games === true, kept: ALL_BOXES.some((b) => plan.keep[b]) || plan.keptProjects.length > 0, code, expires: now + 3_600_000 });
}

export function uninstallApi({ board, emit = () => {}, log = () => {}, remoteRef = { current: null }, backupNow = async () => null, quiesce = async () => {}, leave = null }) {
  // The engine ends so the app starts it again on the new core (exit code 75, as when core is lost).
  const restart = leave ?? (() => setTimeout(() => process.exit(75), 700).unref?.());
  const userData = () => { if (!ctx.userData) fail(tr('uninstall.noApp')); return ctx.userData; };
  const env = () => uninstallEnv({ home: ctx.home, userData: userData(), config: ctx.config, signKey: ctx.keys?.approval ?? null });

  const parse = (p = {}) => {
    const mode = MODES.includes(p.mode) ? p.mode : fail(tr('msg.api.invalid', { name: 'mode' }));
    const keep = {};
    for (const b of BOXES) { if (p.keep?.[b] !== undefined && typeof p.keep[b] !== 'boolean') fail(tr('msg.api.invalid', { name: b })); keep[b] = p.keep?.[b] === true; }
    const forever = Array.isArray(p.forever) ? p.forever : [];
    if (forever.length > 200 || forever.some((x) => typeof x !== 'string' || x.length > 200)) fail(tr('msg.api.invalid', { name: 'forever' }));
    return { mode, keep, copyFirst: p.copyFirst === true, forever };
  };
  const plan = (input) => planUninstall({ env: env(), ...input, projects: board.projects(), devices: board.one('SELECT COUNT(*) AS n FROM devices')?.n ?? 0 });
  const view = (pl) => ({
    id: pl.id, mode: pl.mode, keep: pl.keep, forced: pl.forced, copyFirst: pl.copyFirst, boxes: pl.boxes, facts: pl.facts, keyKept: pl.keyKept,
    trash: pl.trash.map((t) => ({ name: t.name, path: t.path, bytes: t.bytes, forever: t.forever })),
    keptProjects: pl.keptProjects.map((x) => ({ name: x.name, why: x.why, bytes: x.bytes ?? null })),
    oldProjects: pl.oldProjects.map((x) => x.name),
    dirty: pl.dirty.map((d) => ({ project: d.project })),
    skipped: pl.skipped.map((s) => ({ box: s.box, path: s.path, why: s.why })),
    items: pl.items.slice(0, LIST_MAX).map((i) => ({ box: i.box, kind: i.kind, path: i.path ?? null, bytes: i.bytes ?? 0 })), itemsTotal: pl.items.length
  });
  // «Borrar todo» of an uninstall (nothing kept at all) is typed; a reset keeps the projects whatever the box says, so its
  // «Borrar todo» is the default and asks no word.
  const needsWord = (pl) => pl.mode === 'uninstall' && BOXES.every((b) => !pl.keep[b]);
  let running = false;

  const methods = {
    'uninstall.plan': async (p) => view(await plan(parse(p))),
    'uninstall.run': async (p) => {
      if (running || ctx.uninstalling) fail(tr('uninstall.busy'));
      const input = parse(p);
      const pl = await plan(input);
      if (typeof p?.planId !== 'string' || p.planId !== pl.id) fail(tr('uninstall.planChanged'));
      if (needsWord(pl) && !CONFIRM_WORDS.includes(String(p?.typed ?? '').trim().toUpperCase())) fail(tr('uninstall.needWord'));
      const dir = userData();
      // The program's own uninstaller must be there before anything goes: data deleted with no way to finish helps nobody.
      if (pl.mode === 'uninstall') {
        let ready = false;
        try { ready = (await hostCall('host.uninstallCheck', {}, 15_000))?.ready === true; } catch { ready = false; }
        if (!ready) fail(tr('uninstall.noUninstaller'));
      }
      running = true;
      try {
        // 1. a copy first when asked: a copy that fails stops everything (nothing is deleted yet)
        if (pl.copyFirst) await backupNow();
        // 2. with the engine still alive: every phone and browser is unlinked and its keys forgotten
        if (!pl.keep.link) { try { remoteRef.current?.revokeAll(); } catch (error) { log(`desinstalar: móviles: ${error.message}`); } }
        // 3. from here nothing of Orb works: the loop of the engine stops looking at core, the agents and the servers stop
        ctx.uninstalling = true;
        try {
        await quiesce();
        log(`desinstalar: ${pl.mode}, ${pl.items.length} elementos`);
        const hooks = {
          trash: (folder, token, name, forever) => hostCall('host.trashFolder', { path: folder, token, ...(forever ? { forever: true } : {}) }, 600_000),
          project: (name) => board.project(name),
          dropProject: (name) => board.run('DELETE FROM projects WHERE name = ?', name),
          closeDb: () => { try { board.db.close(); } catch { /* closed */ } },
          onStep: () => {}
        };
        const r = await runPlan({ env: env(), plan: pl, hooks });
        if (!r.ok) {
          log(`desinstalar: cortado (${r.failed[0]?.error ?? 'pendiente'})`);
          // core's data may be gone already: the next start needs something healthy, not a restore from a backup
          try { await stubCoreAfterStop(env(), pl); } catch (error) { log(`desinstalar: core mínimo: ${error.message}`); }
          restart();
          return { ok: false, report: r };
        }
        if (pl.mode === 'uninstall') {
          const code = crypto.randomBytes(16).toString('hex');
          fs.writeFileSync(path.join(dir, MARK_FILE), markText({ plan: pl, code }));
          closeJournal(dir);
          return { ok: true, mode: 'uninstall', code, report: r };
        }
        closeJournal(dir);
        restart();
        return { ok: true, mode: 'reset', report: r };
        } catch (error) {
          // anything unexpected after the engine stopped working: it ends, to start again (its journal, if any, says where it was)
          log(`desinstalar: ${error.stack ?? error}`);
          restart();
          throw error;
        }
      } finally { running = false; }
    },
    // after a stopped run the user said to go on: the journal is let loose and the engine starts again to run it
    'uninstall.resume': () => { if (!confirmResume(userData(), ctx.keys?.approval ?? null)) fail(tr('uninstall.noJournal')); restart(); return { ok: true }; },
    // what waits from a run that stopped or cannot be checked: the window offers «Seguir borrando» and «Dejarlo así»
    'uninstall.pending': () => pendingJournal(userData(), ctx.keys?.approval ?? null),
    // «Dejarlo así»: the journal is closed and nothing more is deleted (never while a run is going on)
    'uninstall.discard': () => {
      if (running || ctx.uninstalling) fail(tr('uninstall.busy'));
      const now = pendingJournal(userData(), ctx.keys?.approval ?? null);
      if (now.state !== 'stopped' && now.state !== 'untrusted') fail(tr('uninstall.noJournal'));
      closeJournal(userData());
      return { ok: true };
    },
    // the uninstaller could not be started (the window says so): the engine, closed by the run, starts again
    // its mark goes: nothing was uninstalled, so the next start must not ask the reinstall question
    'uninstall.restart': () => { try { fs.rmSync(path.join(userData(), MARK_FILE), { force: true }); } catch { /* the mark expires in an hour */ } restart(); return { ok: true }; },
    'previous.list': () => ({ list: asideList(ctx.home) }),
    'previous.delete': ({ name }) => {
      const r = deleteAside(ctx.home, String(name ?? ''), { projects: board.projects().map((x) => x.path) });
      log(`datos de antes borrados: ${r.deleted}`);
      return { ok: true, ...r };
    }
  };
  return { methods };
}
