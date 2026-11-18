# 29. Packaging, versions and CI

Part of [How Orb works](../ARCHITECTURE.md).

The user's WEBVIEW2_* variables are dropped before any webview starts (also names that are not valid Unicode); WebView2
policies set by an administrator in the registry (HKLM/HKCU \Software\Policies\Microsoft\Edge\WebView2) still apply and
are not overridden: they are the PC owner's.

- **Windows installer** (Tauri, NSIS, per user, no admin): `npm run tauri:build`. Next to `Orb.exe` it carries `node\`
  (Node 24, checked against its pinned SHA-256) and `app\` (the engine's `src`, the built window, the Claude SDK, `zod`
  and `@noble/*`): `scripts/tauri-resources.mjs`. The e2e build (`npm run tauri:build:e2e`, cargo feature `e2e`, its own
  target folder) is the only one with a DevTools port, a hidden window, a local update feed and timing marks, and it
  trusts only the test updater key; `scripts/tauri-check-release.mjs` refuses a release `Orb.exe` with any of them.
- **The installer's new face** (3.8.8, **not shipped yet: pending a real install test**; `src-tauri/installer/`, a crate
  of its own, outside the app's workspace, with its own `Cargo.lock` and only dependencies the app's lock already holds, so
  it builds offline): a small WebView2 window that shows the installer's screens (`ui/`) and runs, in silent mode (`/S`),
  the verified NSIS setup that `tauri build` makes and that travels inside it. The face only shows screens; what installs,
  removes Orb 3.8.0 and makes the shortcuts is still the NSIS setup, its hooks (`src-tauri/nsis/hooks.nsh`) and the updater,
  none of which change. Before anything starts (`src/setup.rs`) the setup is written to a new private folder, reopened
  without sharing writes, checked there against the SHA-256 fixed in the binary and the minisign signature with the
  updater's public key, and exactly the path that was checked is started. A refusal of the hooks comes back as an exit code
  and a reason file (`src/nsis.rs`); the window can only show its own origin and the `WEBVIEW2_*` variables are dropped
  (`src/guard.rs`).
  - **Build:** `npm run installer:build -- --setup <Orb_x.y.z_x64-setup.exe> --sig <Orb_x.y.z_x64-setup.exe.sig>`
    (`scripts/installer-build.mjs`), after the setup has been signed: a real build refuses a missing signature or a setup
    of another version. The result is `src-tauri/installer/target/release/Orb-<version>-instalador-nuevo.exe`; nothing is
    signed or published by it.
  - **Test mode:** `npm run installer:build -- --prueba` makes a binary with no setup inside, which can install nothing. A
    run only counts as a test when `--prueba` is on its command line (`src/mode.rs`), and the code that starts a setup asks
    for a token that only a real run can build. `--prueba=ok|rechazo[:reason]|abierto|error` shows each ending.
- **Releases** (review D9): `.github/workflows/release.yml` builds and tests only (read-only token not kept in `.git`,
  actions pinned by commit, no keys): npm and cargo tests, the unsigned installer, the packaged-app smoke test
  (`test/smoke.e2e.mjs`), and the installer as an artifact. The owner signs and publishes on his PC: `npm run
  release:firmar -- <version>` (`scripts/release-firmar.mjs`) downloads that installer, signs it for its version with the
  updater key (`C:\orb-project\claves`, never in GitHub), refuses any key but the one in `tauri.conf.json`, writes
  `latest.json`, `latest.yml` and `Orb-<version>-instalador.exe` (`scripts/release-manifests.mjs`) and creates the
  release with `gh`. Before signing (review D10 M2) it refuses a version not newer than the last release, an installer
  from a run that is not of main's tip (the newest successful push run, or `--run` of main; package.json there must say
  that version) and an installer whose `Orb.exe` (extracted with 7-Zip) does not trust the updater key of
  `tauri.conf.json` or carries anything of the test build. The release goes on that commit (an annotated tag
  `v<version>`, `--target`), with the download section and «What's new in <version>» of `docs/CHANGELOG.md` as notes.
  Recommended on GitHub (not set by Orb): protect `main`, 2FA, and an environment with a reviewer for anything that
  could publish.
- **No DevTools in the published app**: Electron's `ORB_DEVTOOLS=1` is gone with Electron. DevTools exist only in debug
  builds (`npm start`) and the e2e build; to look into a problem in the packaged app, use the logs in `core\logs`.
- **Linux:** planned for a later version (Orb 3.7's Linux builds and `docs/LINUX.md` stay as they were).
- The SDK's copy of Claude Code (238 MB) **is not packaged**: the user's is used.
- The app icon is drawn in `build/icon-src/*.svg`; `npm run icon` renders `build/icon.ico` (10 sizes, the short «o•»
  version up to 32 px; also the window's icon on Windows), `build/icons/` (the sizes Tauri bundles), `build/icon.png`,
  `src/ui/public/icon.png`, `src/ui/public/icon-o.png` (the short «o•», 128 px: the «Acerca de» card), `src/ui/public/icon-maskable.png` (the PWA's maskable icon: the
  tile edge to edge, the word at 80 %), the Android launcher icons (`src-tauri/gen/android/app/src/main/res/mipmap-*`,
  legacy, round and adaptive) and the small notification icon (`drawable-*/ic_stat_orb.png`: the short «o•» as a white
  silhouette on transparent, 24 dp in every density with the drawing in the 20 dp content area, and the cut between the
  «o» and the orb widened at mdpi/hdpi so they stay apart; the app's notifications use it by name, `Notes.kt`).
- **Tests on every push and PR**, on Windows and Linux: `.github/workflows/pruebas.yml`.
- **Installer**: desktop and Start menu shortcut.

**Updates** (`src-tauri/src/updater.rs`, `src/ui/components/update-card.jsx`):
- It checks on open (after 15 s) and every 4 h; it downloads nothing until the user clicks **Download and install**.
- States the window receives (`app:update` event): `checking`, `available`, `downloading` (with `percent`), `downloaded`,
  `installing` (with `step`: `backup` and its `percent`, then `installer`), `none`, `error`, `off`. A card at the top right (below the header: it does not cover the menu or the text box) and an "Updates" card in Settings.
- **Restart and install**: if tasks are running it asks first; then the card shows the pre-update backup with its
  progress (the engine's `backup:progress` event) and the installer opening. That backup starts once per version when
  the download ends (never twice, a failed one is not retried) and the update never waits for it more than 45 s
  (20 s when Orb closes): then it installs without it and says so in `motor-salida.log` (the daily copy is there). If
  the installer cannot be started, the card says so and offers **Download again** and the release page (the engine,
  if it had been stopped for the installer, starts again). With "Later" it installs when Orb closes. What a copy cut
  short leaves in the backup folder (`.preparando-*`, `*.orbbak.<pid>.tmp`) goes at the next start, after an hour.
- Running from source there are no updates (`off`). `ORB_NO_UPDATE=1` turns them off; `ORB_FAKE_UPDATE=<version>`
  simulates a new version without network (tests).
- With `tauri-plugin-updater`. It reads
  `latest.json` of the latest GitHub release; the installer (`Orb_<version>_x64-setup.exe`) is signed with Orb's updater
  key (minisign; the public key is `plugins.updater.pubkey` in `tauri.conf.json`, the private one never enters the
  repository: `TAURI_SIGNING_PRIVATE_KEY` and `_PASSWORD` at build time) and its signature, including the version it was
  signed for (`requireSignedVersion`), is checked before it runs. It installs in passive mode (a progress bar) and Orb
  reopens. The installer is downloaded only from Orb's GitHub releases (https). `ORB_UPDATE_URL` (a local feed) only works
  in the e2e build. Not installed (no `uninstall.exe` next to `Orb.exe`): the button opens the release page.
- **From 3.8.0 (Electron) to 3.8.1 (Tauri)**: the release also publishes a `latest.yml` (electron-updater's format, the
  same installer with its sha512 and size: `scripts/release-manifests.mjs`, which writes `latest.json` too). Orb 3.8.0
  downloads it and runs it with `--updated /S --force-run`. The installer's hooks (`src-tauri/nsis/hooks.nsh`) run
  3.8.0's own uninstaller silently and wait for it (program folder, shortcuts, AppUserModelID and uninstall entry go;
  `%APPDATA%\Orb.dev` and the workspace stay), leave `migrado-desde-electron.json` in `%APPDATA%\Orb.dev`, and open Orb.
  Only from a folder that is surely 3.8.0's (its uninstaller deletes it whole: the default one, or one ending in `\Orb`
  with `Orb.exe` and `resources\app.asar`, and never the workspace, a folder holding it or inside it, nor the data
  folder), with no `Orb.exe` of the user running (3.8.0's uninstaller falls back to `taskkill /IM Orb.exe`, which would
  also end Orb on Tauri), and only on when it worked: otherwise the user is told and nothing is installed
  (`test/puente-ganchos.e2e.mjs`). Orb 3.8.0 opened afterwards never starts: Orb leaves the window Chromium's
  single-instance lock looks for (`desktop.rs › guard_against_electron`), so 3.8.0 quits and Orb comes to the front.
  On that first start (`src-tauri/src/migrate.rs`) Electron's Chromium caches and electron-updater's download folder go
  (never `Local State`, the keys or the workspace) and the window says once that Orb moved to its new base.
  `test/puente-electron.e2e.mjs` checks the whole path with a copy of an installed 3.8.0 on a hidden desktop against a
  fake install; `test/tauri-actualizar.e2e.mjs` checks Tauri → Tauri against a local feed, and
  `test/tauri-instalar.e2e.mjs` installs two test builds («OrbPrueba», this version and the next) in a temporary folder
  and updates one to the other through the card's **Restart and install**, as the user does.
