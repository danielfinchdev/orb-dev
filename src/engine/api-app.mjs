// 3.8.1: this PC's tools that used to live in Electron's main process and need no window: a terminal in a folder
// (Ctrl+J), the project in an editor or the File Explorer, a project's action in a terminal of its own, the feedback mail
// and the author's other apps. In the engine they work the same under any app (Electron now, Tauri next); what only the
// app can do (open a link or a folder, start a program outside the engine) is asked to it (src/engine/host.mjs).
// This PC only (src/core/permissions.mjs). engine.mjs also answers them while core or the data are blocked.
import path from 'node:path';
import { ctx, tr } from '../core/context.mjs';
import { fail } from './api-common.mjs';
import { hostCall } from './host.mjs';
import { openTerminal } from './terminal.mjs';
import { findEditors, openInEditor, runAction } from './editors.mjs';
import { sendFeedback, moreApps } from './feedback.mjs';

const absolute = (p) => typeof p === 'string' && p.length < 2000 && path.isAbsolute(p);

// home: the workspace (also before useHome, while core is blocked); version: the app's.
export function appMethods({ home, version }) {
  const language = () => (ctx.config?.language === 'en' ? 'en' : 'es');
  const choice = () => ctx.config?.ui?.terminal ?? 'auto';
  const openUrl = (url) => hostCall('host.openUrl', { url });
  const spawn = (plan) => hostCall('host.spawnDetached', plan);
  return {
    // Ctrl+J: a terminal (Warp, Windows Terminal, PowerShell…) in the folder the window shows, or the workspace.
    'app.openTerminal': ({ dir } = {}) => {
      const target = absolute(dir) ? dir : home;
      if (!target) fail(tr('sys.main.noFolderYet'));
      return openTerminal(target, choice(), { openExternal: openUrl, spawn, language: language() });
    },
    // 3.2, God mode: which editors this PC has (only those are offered), and the project opened in one of them.
    'app.editors': () => { const e = findEditors(); return { cursor: Boolean(e.cursor), vscode: Boolean(e.vscode) }; },
    'app.openIn': async ({ which, dir } = {}) => {
      if (!['cursor', 'vscode', 'explorer'].includes(which) || !absolute(dir)) fail(tr('sys.main.badPath'));
      if (which === 'explorer') { await hostCall('host.openPath', { path: dir }); return true; }
      await openInEditor(which, dir, { language: language(), spawn });
      return true;
    },
    // A project's action in a terminal window of its own; its preview (only a page of this PC) opens a moment later.
    'app.runAction': async ({ dir, command, preview, openPreview } = {}) => {
      if (!absolute(dir) || typeof command !== 'string' || !command.trim() || command.length > 2000) fail(tr('sys.main.badAction'));
      await runAction(command, dir, { choice: choice(), language: language(), spawn });
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
