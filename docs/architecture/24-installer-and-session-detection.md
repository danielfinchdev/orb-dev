# 24. Installer and session detection

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** On first launch, and in Agents, it detects what you have and installs what is missing with the
official installers. PowerShell runs hidden and the app shows the progress; its output stays in
`core/ejecuciones/instalacion/progreso-*-salida.txt`. At startup the engine notes in `motor.log` which agents it finds
(`agentes: claude=… · codex=…`). It also looks for them in `AppData` copies moved to another drive
(`appDataDirs()` and `npmPrefixes()` in `src/agents/common.mjs`: `<drive>:\AppData` or up to two folders below, like
`D:\ComputerApps\AppData`), even if PATH still points to `C:`. It installs:
- tools: Git, Node.js, GitHub CLI and Tailscale;
- agents: Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode and Qwen.

**If you are already signed in** to an agent (for example Codex with your ChatGPT account), Orb uses that session as is:
there is no need to sign in inside the app. Otherwise, "Sign in" opens the program's official login.

**Signing in without a console.** Claude Code and Codex sign in without a window (`src/agents/login.mjs`). The CLI is
launched hidden, with its output read by Orb, and it stores the session in the account's folder (`CLAUDE_CONFIG_DIR` /
`CODEX_HOME`) as always; Orb never sees a token.
- Claude: `claude auth login --claudeai`. Orb reads the link ("If the browser didn't open, visit: …"). On a PC, Claude
  opens the browser itself, with a localhost callback. If the page shows a code ("code#state", when signing in on
  another device), it is pasted into Orb and reaches it via stdin (`agents.loginCode`). It ends with "Login
  successful.", exit 0 and `.credentials.json`.
- Codex: `codex app-server` → `account/login/start` with `chatgpt` (`authUrl`, which Orb opens with
  `shell.openExternal`) or `chatgptDeviceCode` (`verificationUrl` + `userCode`, `mode: 'device'`). It ends with
  `account/login/completed`, which is checked with `account/read`. A Codex without that method falls back to
  `codex login --device-auth`, whose output provides the link and the code.
- API: `agents.login({ account, mode?, console? })` → `{ id, url, code, opened, needsCode, mode }`, plus
  `agents.loginCode`, `agents.loginCancel` and `agents.loginState`. `agents:login` events (waiting, done, error,
  cancelled). When it succeeds, the "not signed in" pause is lifted and models and plan are requested again.
  `console: true` opens the old console (Windows only, "Open console" button). Cursor and the ACP agents keep their
  console.
- Signing in is PC only (section 34).
- Installing or updating from Agents (`agents.install`, `agents.installState`, `agents:install` events): Claude with its
  native installer (`install.ps1` / `install.sh`, into `~/.local/bin`) and Codex with
  `npm install -g @openai/codex@latest` (on Windows, the user's npm folder; on Linux and macOS, `--prefix ~/.local`). It
  runs hidden, without admin rights and for at most 15 minutes.

**Files.**
- `src/engine/host/installer.mjs`: `ITEMS`, `check()` and the PowerShell script.
- Each adapter's `detect()` and `loginState()` (for example, the Codex session is in `~/.codex/auth.json`).
- `src/domain/usage/accounts.mjs`: several accounts per agent; each one has its login folder and its usage.

**Developer tools from a fixed list (3.8.11).** `src/engine/host/tool-catalog.mjs` is the only source of what Orb can
install: a fixed list of winget ids (plus fixed commands for the few that winget does not cover, e.g. Playwright pinned to
a version). Nothing the user or an agent types reaches a shell. `installer.updates` (looks for newer versions, only when
asked, cached for 30 minutes) and `installer.suggest` (tools that fit the open project) are accepted only from `'pc'`.
Installs and failures are written to Activity.

## Uninstall, reset and old data (3.8.12)

Settings › Data ends with «Restablecer y desinstalar» (`src/ui/views/uninstall.jsx`). It is PC-only: the new methods
(`src/engine/api/uninstall.mjs`) are not in `REMOTE_METHODS`, so an agent or the phone cannot call them, and they need a
recent unlock.

- **Plan.** `src/domain/data/uninstall.mjs` turns the ticked boxes (`src/shared/uninstall-boxes.mjs`) into a plan of
  paths and database tables, applying dependencies (keeping MCP keys, the phone link or backups keeps the vault; the PC
  key stays while anything encrypted stays). The window shows that plan as it is, with sizes. Every path must be in the
  allowed list or be a project folder carrying both marks (`created_by_orb` in `orb.db` and the `.orb-creada` token file,
  `src/domain/projects/created-marks.mjs`); anything else is skipped. Links and junctions are never followed, and the
  backup folder the user chose is never touched.
- **Signed journal.** Before deleting, the engine writes the plan to a signed journal and stops the engine and agents.
  Order: projects to the Recycle Bin (a folder too big for it is deleted for good, after asking), data, vault and its
  replica, the PC key last. Each step is recorded; at the next start a cut-short run is finished or reported, and a
  journal whose signature does not match is not followed. A reported failure stops the run and the installer is not
  launched. Reset keeps `ubicacion.json`, marks core `restablecido` and writes a fresh core before restarting so nothing
  is restored.
- **NSIS hooks** (`src-tauri/nsis/hooks.nsh`, `src-tauri/src/uninstall.rs`). Uninstall writes
  `%APPDATA%\Orb.dev\desinstalado.json` with a one-hour one-time code and runs `uninstall.exe /P /ORBPURGE=<code>`.
  `NSIS_HOOK_POSTUNINSTALL` purges `Orb.dev` and `dev.orb.app` only with a valid, unexpired code and never on an update
  (`$UpdateMode`), respecting `claves\` when encrypted data was kept. `NSIS_HOOK_PREUNINSTALL` writes the marker (no code)
  when the uninstall did not come from Orb; `NSIS_HOOK_POSTINSTALL` removes one written during its own run.
- **Old data on reinstall** (`src/engine/previous.mjs`). With a marker, or with no `ubicacion.json` but an existing home,
  Orb asks to recover or start from scratch. Starting from scratch moves the old data into `core\anterior-<date>\`
  (replica of the vault included) and repairs the moved worktrees; nothing is deleted and «Datos de antes» can remove it.
- **Survey** (`src/shared/uninstall-survey.mjs`). An optional line of up to 280 characters; if written, Orb shows it and
  opens a prefilled new issue in the browser (no shell). The user sends it.
