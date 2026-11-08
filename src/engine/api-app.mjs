// 3.8.1: this PC's tools that need no window: a terminal in a folder
// (Ctrl+J), the project in an editor or the File Explorer, a project's action in a terminal of its own, the feedback mail
// and the author's other apps. In the engine they work the same under any app; what only the
// app can do (open a link or a folder; a terminal, an editor or an action, the program picked by the app) is asked to it
// (src/engine/host.mjs).
// This PC only (src/core/permissions.mjs). engine.mjs also answers them while core or the data are blocked.
import { ctx, tr } from '../core/context.mjs';
import { fail } from './api-common.mjs';
import { hostCall, localPath } from './host.mjs';
import { findEditors } from './editors.mjs';
import { guardedCore } from './desktop-home.mjs';
import { checkUnlock } from './api-master.mjs';
import { sendFeedback, moreApps } from './feedback.mjs';

const absolute = localPath;

// home: the workspace (also before useHome, while core is blocked); version: the app's.
export function appMethods({ home, version }) {
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
    // 3.2, God mode: which editors this PC has (only those are offered), and the project opened in one of them.
    'app.editors': () => { const e = findEditors(); return { cursor: Boolean(e.cursor), vscode: Boolean(e.vscode) }; },
    // core itself and its secrets open in the File Explorer only with a fresh unlock of the master password (unlock), as
    // the window's own «Abrir carpeta» (app:openPath).
    'app.openIn': async ({ which, dir, unlock } = {}) => {
      if (!['cursor', 'vscode', 'explorer'].includes(which) || !absolute(dir)) fail(tr('sys.main.badPath'));
      if (guardedCore(home, dir)) checkUnlock('master.check', { unlock });
      if (which === 'explorer') { await hostCall('host.openPath', { path: dir }); return true; }
      await hostCall('host.openEditor', { which, dir });
      return true;
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
    // Ajustes › Contribuye and Más aplicaciones (src/engine/feedback.mjs).
    'app.feedbackSend': (data = {}) => sendFeedback(data, { version, language: language() }),
    'app.moreApps': () => moreApps(version)
  };
}
