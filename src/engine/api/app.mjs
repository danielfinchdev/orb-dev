// this PC's tools that need no window: a terminal in a folder
// (Ctrl+J), the project in an editor or the File Explorer, a project's action in a terminal of its own, the feedback mail
// and the author's other apps. In the engine they work the same under any app; what only the
// app can do (open a link or a folder; a terminal, an editor or an action, the program picked by the app) is asked to it
// (src/engine/host/host.mjs).
// This PC only (src/domain/security/permissions.mjs). engine.mjs also answers them while core or the data are blocked.
import { ctx, tr } from '../../platform/context.mjs';
import { fail } from './common.mjs';
import { hostCall, localPath } from '../host/host.mjs';
import { findEditors, EDITOR_IDS, fileArgs } from '../host/editors.mjs';
import { insideProject } from '../host/expert.mjs';
import { isSecretPath } from '../../shared/secrets-scan.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { guardedCore } from '../desktop-home.mjs';
import { checkUnlock } from './master.mjs';
import { sendFeedback, moreApps } from '../host/feedback.mjs';

const absolute = localPath;

// The same folder however it is written (case on Windows, trailing separators, links).
const folderKey = (p) => { let r = path.resolve(p); try { r = fs.realpathSync.native(r); } catch { /* not there: as written */ } return process.platform === 'win32' ? r.toLowerCase() : r; };

// home: the workspace (also before useHome, while core is blocked); version: the app's.
// folders: () => the folders a file may be opened from (the projects' and the tasks' work folders); without it none is.
export function appMethods({ home, version, folders = () => [] }) {
  const language = () => (ctx.config?.language === 'en' ? 'en' : 'es');
  const choice = () => ctx.config?.ui?.terminal ?? 'auto';
  const openUrl = (url) => hostCall('host.openUrl', { url });
  return {
    // Ctrl+J: a terminal (Warp, Windows Terminal, PowerShell…) in the folder the window shows, or the workspace.
    // core itself and its secrets are not opened this way (that is the File Explorer's, with the master password): the
    // terminal opens in the workspace instead.
    'app.openTerminal': ({ dir } = {}) => {
      let target = absolute(dir) ? dir : home;
      if (target && home && guardedCore(home, target)) target = home;
      if (!target) fail(tr('sys.main.noFolderYet'));
      return hostCall('host.openTerminal', { dir: target, choice: choice() });
    },
    // God mode: which editors this PC has (only those are offered), and the project opened in one of them.
    'app.editors': () => { const e = findEditors(); return Object.fromEntries(EDITOR_IDS.map((id) => [id, Boolean(e[id])])); },
    // core itself and its secrets open in the File Explorer only with a fresh unlock of the master password (unlock), as
    // the window's own «Abrir carpeta» (app:openPath).
    'app.openIn': async ({ which, dir, unlock } = {}) => {
      if (!['explorer', ...EDITOR_IDS].includes(which) || !absolute(dir)) fail(tr('sys.main.badPath'));
      if (guardedCore(home, dir)) checkUnlock('master.check', { unlock });
      if (which === 'explorer') { await hostCall('host.openPath', { path: dir }); return true; }
      await hostCall('host.openEditor', { which, dir });
      return true;
    },
    // One file of a project (and a line) in the editor the user chose. The path is resolved inside the folder with the
    // same check as God mode's viewer (no .., absolute or odd Windows names, no link out), it must be a file that
    // exists, and a secret-looking one is never opened. The host is asked by kind (host.openEditor), never a command.
    'app.openFileIn': async ({ which, dir, file, line, unlock } = {}) => {
      if (!EDITOR_IDS.includes(which) || !absolute(dir) || typeof file !== 'string') fail(tr('sys.main.badPath'));
      if (line != null && !(Number.isInteger(line) && line > 0 && line <= 10_000_000)) fail(tr('sys.main.badPath'));
      if (guardedCore(home, dir)) checkUnlock('master.check', { unlock });
      // only the folder of a project or of a task's work: never an arbitrary one the caller names
      const key = folderKey(dir);
      if (!folders().some((d) => typeof d === 'string' && d && folderKey(d) === key)) fail(tr('sys.main.badPath'));
      if (!findEditors()[which]) fail(tr('sys.main.badPath'));
      const { abs, rel } = insideProject(dir, file);
      // the file itself may sit in core even when the folder given does not (the workspace folder holds core/)
      if (guardedCore(home, abs)) checkUnlock('master.check', { unlock });
      if (isSecretPath(rel) || isSecretPath(rel.toLowerCase())) fail(tr('msg.expert.secrets'));
      if (!fs.statSync(abs).isFile()) fail(tr('msg.expert.notFile'));
      const args = fileArgs(which, dir, abs, line ?? null);
      await hostCall('host.openEditor', { which, dir, file: rel, line: line ?? null });
      return { file: rel, line: line ?? null, args };
    },
    // A project's action in a terminal window of its own; its preview (only a page of this PC) opens a moment later.
    // Never in core itself or its secrets without a fresh unlock (as app.openIn).
    'app.runAction': async ({ dir, command, preview, openPreview, unlock } = {}) => {
      if (!absolute(dir) || typeof command !== 'string' || !command.trim() || command.length > 2000) fail(tr('sys.main.badAction'));
      if (home && guardedCore(home, dir)) checkUnlock('master.check', { unlock });
      await hostCall('host.runAction', { command, dir, choice: choice() });
      if (openPreview && typeof preview === 'string') {
        let u = null; try { u = new URL(preview); } catch { /* not a link */ }
        if (u && /^https?:$/.test(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) setTimeout(() => { openUrl(u.toString()).catch(() => {}); }, 2500).unref?.();
      }
      return true;
    },
    // Ajustes › Contribuye and Más aplicaciones (src/engine/host/feedback.mjs).
    'app.feedbackSend': (data = {}) => sendFeedback(data, { version, language: language() }),
    'app.moreApps': () => moreApps(version)
  };
}
