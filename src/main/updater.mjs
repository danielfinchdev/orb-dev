// Updates: Orb looks at GitHub Releases when it opens and every few hours. Installed with the installer, it downloads the new
// version in the background (electron-updater, NSIS) and installs it on «Reiniciar y actualizar» or when the app closes.
// The portable copy cannot replace itself: it only says there is a new version and opens the download page.
// The window gets the state as the 'app:update' event and asks through app:update* (src/main/main.mjs).
import { app } from 'electron';
import pkg from 'electron-updater';

const { autoUpdater } = pkg;
const OWNER = 'danielfinchdev';
const REPO = 'orb-dev';
export const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
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

export function createUpdater({ send, log = () => {} }) {
  const current = app.getVersion();
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  // ORB_FAKE_UPDATE=<version>: tests and screenshots see a new version without the network (nothing is downloaded).
  const fake = process.env.ORB_FAKE_UPDATE || '';
  // Only the packaged app updates (from the code there is nothing to replace); ORB_NO_UPDATE=1 turns it off.
  const enabled = Boolean(fake) || (app.isPackaged && process.env.ORB_NO_UPDATE !== '1');
  let state = { state: enabled ? 'idle' : 'off', current, version: null, percent: 0, error: null, portable, url: RELEASES_URL };
  const set = (patch) => { state = { ...state, ...patch }; send(state); };
  let timer = null;

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
    autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version, percent: 100 }));
    // A failed download goes back to «Actualizar» (with the reason) so it can be tried again.
    autoUpdater.on('error', (error) => set({ state: state.state === 'downloading' ? 'available' : 'error', error: short(error) }));
  }

  // The portable copy asks GitHub's API which is the latest release (public repository: no token).
  async function checkPortable() {
    set({ state: 'checking', error: null });
    try {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orb.dev' }, signal: AbortSignal.timeout(20_000) });
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

  // Closes the app, installs silently and opens the new version.
  function install() {
    if (state.state !== 'downloaded') return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  function start() {
    if (!enabled) return;
    setTimeout(check, FIRST);
    timer = setInterval(check, EVERY);
    timer.unref?.();
  }

  return { get: () => state, check, download, install, start, stop: () => clearInterval(timer) };
}
