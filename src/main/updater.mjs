// Updates: Orb looks at GitHub Releases when it opens and every few hours. Installed with the installer, it downloads the new
// version in the background (electron-updater, NSIS) and installs it on «Reiniciar e instalar» or when the app closes.
// A copy that was not installed (Orb Light, the portable .exe, or the program folder copied elsewhere) cannot replace
// itself: it only says there is a new version and opens the download page.
// 3.7, Linux: the AppImage updates itself like the installer (electron-updater, latest-linux.yml); the .deb (or any other
// copy, such as the unpacked folder) only says there is a new version and opens the download page, like Orb Light.
// The window gets the state as the 'app:update' event and asks through app:update* (src/main/main.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import pkg from 'electron-updater';
import { AUTHOR } from '../core/product.mjs';
import { linuxKind } from './linux.mjs';

const { autoUpdater } = pkg;
export const RELEASES_URL = `https://github.com/${AUTHOR.repo}/releases/latest`;
const EVERY = 4 * 60 * 60 * 1000;
const FIRST = 15_000;

// "2.3.10" > "2.3.9"; anything that is not x.y.z counts as older.
export function newer(a, b) {
  const p = (v) => String(v ?? '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const short = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);

// 3.6: beforeInstall(version) makes a backup of the data before a new version touches it (src/core/backup.mjs, kind
// «preupdate»). It runs when the download ends (an update installed when the app closes is covered too) and, if that one
// failed, again on «Reiniciar e instalar». It never blocks the update for long (BACKUP_WAIT) and a failure is logged.
const BACKUP_WAIT = 3 * 60_000;
export function createUpdater({ send, log = () => {}, beforeInstall = null }) {
  const current = app.getVersion();
  // ORB_FAKE_UPDATE=<version>: tests and screenshots see a new version without the network (nothing is downloaded).
  const fake = process.env.ORB_FAKE_UPDATE || '';
  // Not installed: the portable .exe (PORTABLE_EXECUTABLE_FILE), or the packaged app without the installer's uninstaller
  // next to it (its folder copied somewhere else).
  const installed = () => { try { return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${path.basename(process.execPath, '.exe')}.exe`)); } catch { return true; } };
  const linuxPackage = linuxKind(process.platform, process.env);
  const portable = !fake && (Boolean(process.env.PORTABLE_EXECUTABLE_FILE) || (app.isPackaged && process.platform === 'win32' && !installed()) || (app.isPackaged && linuxPackage !== null && linuxPackage !== 'appimage'));
  // Only the packaged app updates (from the code there is nothing to replace); ORB_NO_UPDATE=1 turns it off.
  const enabled = Boolean(fake) || (app.isPackaged && process.env.ORB_NO_UPDATE !== '1');
  let state = { state: enabled ? 'idle' : 'off', current, version: null, percent: 0, error: null, portable, linux: linuxPackage, url: RELEASES_URL };
  const set = (patch) => { state = { ...state, ...patch }; send(state); };
  let timer = null;
  let backedUp = null; // the version a backup was made for
  const backup = async (version) => {
    if (!beforeInstall || backedUp === version) return;
    try {
      await Promise.race([beforeInstall(version), new Promise((_, reject) => setTimeout(() => reject(new Error('la copia tarda demasiado')), BACKUP_WAIT).unref?.())]);
      backedUp = version; log(`actualizar: copia de seguridad hecha antes de la ${version}`);
    } catch (error) { log(`actualizar: no se pudo hacer la copia antes de actualizar: ${short(error)}`); }
  };

  if (enabled && !fake && !portable) {
    autoUpdater.autoDownload = false; // the user decides with «Actualizar»
    autoUpdater.autoInstallOnAppQuit = true; // downloaded and «Más tarde»: it installs when the app closes
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = { info: (m) => log(`actualizar: ${m}`), warn: (m) => log(`actualizar: ${m}`), error: (m) => log(`actualizar: ${m}`), debug: () => {} };
    // ORB_UPDATE_URL: a local feed to try an update before publishing it (only this PC, only http://127.0.0.1).
    if (/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(process.env.ORB_UPDATE_URL ?? '')) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.ORB_UPDATE_URL });
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => set({ state: 'none', version: null }));
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent ?? 0) }));
    autoUpdater.on('update-downloaded', (info) => { set({ state: 'downloaded', version: info.version, percent: 100 }); backup(info.version); });
    // A failed download goes back to «Actualizar» (with the reason) so it can be tried again.
    autoUpdater.on('error', (error) => set({ state: state.state === 'downloading' ? 'available' : 'error', error: short(error) }));
  }

  // The portable copy asks GitHub's API which is the latest release (public repository: no token).
  async function checkPortable() {
    set({ state: 'checking', error: null });
    try {
      const res = await fetch(`https://api.github.com/repos/${AUTHOR.repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orb' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
      const latest = String((await res.json()).tag_name ?? '').replace(/^v/, '');
      set(newer(latest, current) ? { state: 'available', version: latest } : { state: 'none', version: null });
    } catch (error) { set({ state: 'error', error: error.message }); }
  }

  async function check() {
    if (!enabled || ['checking', 'downloading', 'downloaded'].includes(state.state)) return state;
    if (fake) { set(newer(fake, current) ? { state: 'available', version: fake } : { state: 'none' }); return state; }
    if (portable) { await checkPortable(); return state; }
    try { await autoUpdater.checkForUpdates(); } catch (error) { set({ state: 'error', error: short(error) }); }
    return state;
  }

  async function download() {
    if (state.state !== 'available' || portable || fake) return state;
    set({ state: 'downloading', percent: 0, error: null });
    try { await autoUpdater.downloadUpdate(); } catch (error) { set({ state: 'available', error: short(error) }); }
    return state;
  }

  // Closes the app, installs silently and opens the new version (3.6: after the backup of the data).
  async function install() {
    if (state.state !== 'downloaded') return false;
    await backup(state.version);
    // quitAndInstall says nothing when the downloaded installer cannot be started (deleted, quarantined by the antivirus):
    // then the app simply does not quit. It stays, says so and offers to download it again.
    let quitting = false;
    app.once('before-quit', () => { quitting = true; });
    setImmediate(() => { try { autoUpdater.quitAndInstall(true, true); } catch (error) { log(`actualizar: ${error.message}`); } });
    setTimeout(() => {
      if (quitting) return;
      log('actualizar: no se pudo abrir el instalador descargado');
      set({ state: 'available', percent: 0, error: 'install' });
    }, 5000).unref?.();
    return true;
  }

  function start() {
    if (!enabled || fake) return; // a simulated version only shows up when a test asks (check)
    setTimeout(check, FIRST);
    timer = setInterval(check, EVERY);
    timer.unref?.();
  }

  return { get: () => state, check, download, install, start, stop: () => clearInterval(timer), backup };
}
