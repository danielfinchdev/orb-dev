# 36. The workspace and core

Part of [How Orb works](../ARCHITECTURE.md).

The workspace is `C:\Orb` by default (the welcome shows it already chosen; «Cambiar ubicación…» picks another base,
`app:info › defaultBase`, `ORB_DEFAULT_BASE` in tests). It holds `core\` and the six categories, and nothing else of
Orb's (section 2). A folder called Orb that already has other things (notes, projects, `personal\`, an older Orb's
folders) is used as it is: nothing in it is overwritten or moved without the user's say. Only the categories' subfolders
are projects: any other top-level folder is the user's and is never listed. All of Orb's own paths come from `paths()`
in `src/platform/paths.mjs`; nothing else builds them.

- **Orb 3.7's own data** (`migrateWorkspace`, `src/domain/workspace/core-folder.mjs`, called by `ensureLayout` at every start and by
  `createHome`, so before the database opens and before the 3.8 migration of the database, which then finds it in
  `core\datos`): `.orb` → `core`, `orb.json` → `core\orb.json`. Only a folder that has them is taken for a 3.7
  workspace. They are Orb's, so they move without asking.
- **The folders the user decides about** (`planWorkspace` / `applyLayout`; the window's «Ordenar carpetas»,
  `views/layout.jsx`, after the welcome and when an updated Orb finds them: `app.layoutPlan`, `app.layoutApply`, PC
  only): `bitacora\` (default: into `core\bitacora`, the general log's place by the owner's definition; logs merged,
  never overwritten; its row says that other tools may use the old path and that Orb will say which one to put in them.
  After the move a last screen names the exact new place of each of the user's own files in it, e.g.
  `C:\Orb\core\bitacora\notas.md`, for `AGENTS.md`, `CLAUDE.md` and other tools outside Orb, with «Copiar
  ruta» (`app.layoutApply › logsMoved`). A «Dejar donde está» remembered by 3.8.0, whose default was to keep it, is asked
  once more in 3.8.1, alone and with «Mover a core»; `carpetas.json › logsAsked` makes the answer final), `android\adb-tools\` (default:
  `core\herramientas\adb`) and each folder of `mcp-servers\`: 3.8.1, every server goes into `core\mcp` by default, also
  one the user writes (the owner's definition: core holds every MCP server; it keeps working there and is improved in a
  project, section 25), or into a category as a project, or stays. A workspace set up by 3.8.0 (which made the servers
  the user writes projects: `carpetas.json` without `mcpAsked`) is asked once about the projects of its categories that
  are MCP servers (`mcpProject:<category>/<name>`, e.g. `windows\gmail-multi-mcp`, «Mover a core» by default); its
  connector follows (orb.json's paths rewritten, its keys tied to the new path: `rebindMoved`) and the next project sync
  drops it from the list; any answer writes `mcpAsked: 2` and is final. Each row can be «Dejar donde está»; «Dejar todo como está» keeps them all. Nothing moves until
  «Aplicar». What is kept is remembered (`core\carpetas.json`) and not asked again, and a kept `bitacora` or `adb-tools`
  is used where it is (`paths().logs`, `paths().adb`), so the user's own rules that point to `C:\Orb\bitacora` keep
  working. Once the logs moved into core (`decided.bitacora: 'move'`; or nothing decided while core already has its
  `GENERAL.md`, as in a new workspace) core stays the general log: a `bitacora` that shows up at the top again (a tool outside Orb writing to the old path) never takes its place,
  and «Ordenar carpetas» offers to merge it into core. The last screen also says which of the user's files are read-only
  (Orb's agents can only read those). In core the agents read the logs with their reading tools (section 28) and write to them only through Orb:
  `orb_write_log` / `orb_read_log` with `general` (`GENERAL.md`) or, with `archivo`, one of the user's own `.md` files
  at the top of the logs folder (`logs.mjs › ownLogFiles`; a read-only one stays untouched). Settings › Skills y MCP lists the projects that are MCP servers (their name says mcp or they depend on an MCP SDK)
  with «Usar» and «Mover a core» (section 25). A server's own credentials go with its folder: in core they enter every
  backup, which is always encrypted. The
  keys of Orb's connectors live in the master password's vault (section 37).
- **Moving**: before anything moves, every folder to move is checked to be free (on Windows a folder some program uses
  as its working folder, or with a file open, cannot be renamed: tried with a rename beside it and back). If one is not,
  nothing moves and the window says «No se puede mover …: algún programa la está usando… Ciérralo y pulsa
  «Reintentar»» (`LayoutBusy`, code `busy`). Each folder is renamed in one step when it can be; across volumes, or into a
  folder that already exists, entry by entry: copied beside its place, checked (size and sha256), switched in by a
  rename, and only then the old one deleted. A file that already differs in core, or a folder where a file is (or the
  other way round), is kept in `core\conflictos-migracion\<date>\`, never lost. `core\migracion-carpetas.json` lists the
  moves before anything moves (inside `.orb` for Orb's own data, so it travels with it) and is removed at the end: a run
  that stopped halfway is finished by the next start; with nothing to move, nothing happens. Then `rewritePaths` points
  every absolute path into what moved to its new place: orb.json (accounts' folders, connectors' scripts), every text
  column of the database (plain and JSON-escaped; a project whose name only looks like an old folder is left alone) and
  the isolated copies' git worktrees (`<repo>\.git\worktrees\<n>\gitdir`, as `git worktree repair` writes it). What the
  user wrote (the user's chat lines, conversation messages and queued messages) keeps the paths they typed; only Orb's
  own `.orb\` paths there (an image Orb attached) follow. Programs outside Orb that use the old paths are the user's to
  update (the screen says so). The app reads the sealed secret from `.orb\datos` until the engine has
  moved it, and never writes into core before the move. 3.7's `bots\` stays at the top for the 3.8 migration of the
  database, which archives it.
- **Backups outside the workspace** (`src/domain/data/backup.mjs`): `%LOCALAPPDATA%\Orb\copias\<workspace>` on Windows
  (`~/.local/share/Orb/copias/<workspace>` elsewhere; `<workspace>` is `homeKey`: the folder's name and 8 hex of the
  sha256 of its whole path in any case, e.g. `orb-1a2b3c4d`, so two workspaces never share it and a long path never makes
  a long name; what the first 3.8 builds kept under the old name, `C-Orb`, is taken over once): per user, never roaming
  (copies can be big), no administrator, outside both core and the workspace, and the uninstaller leaves it, so deleting
  core (or the whole workspace) does not take the copies with it. Ajustes › Datos can pick another folder, never inside
  the workspace nor one that holds it (`validateConfig`, by real path: a junction counts); one inside it that 3.7 allowed
  is dropped from the settings at start (`keepBackupsOutside`). Wherever they go, the newest copy is noted in the default
  folder (`ultima.json`, with the workspace's `orbId` and the folders copies went to); that is how Orb finds them
  without core. Only the default folder, the chosen one and the folders noted there are read, never a network path the
  settings do not name. The copies 3.7 kept in its data folder (`core\copias-seguridad`) move there at start
  (`adoptOldBackups`; across volumes checked by sha256; never into a folder inside the workspace, and never deleted when
  the chosen folder is that very one). Names inside a copy are relative to the workspace (`core/datos/orb.db`,
  `core/bitacora/…`, `core/mcp` without dependencies, or `bitacora/…` for a log folder kept at the top); a 3.7 copy
  (`.orb/…`, `orb.json`, `bitacora/…`) restores into core (`legacyName`, only for a copy made by 3.7) and its paths are
  rewritten. **This PC's secret** (3.8.1, decision 20 d) is opened and kept in Rust (`src-tauri/vault/src/machine.rs`,
  inside Orb.exe's vault): sealed with DPAPI as `ORB2` in `core\datos\clave2.enc` and in a copy in the app's data folder
  (`%APPDATA%\Orb.dev\claves\<workspace>.v2.enc`) that puts core's back when core loses it. The engine asks for it once
  per start (`src/domain/security/master.mjs › openMachine`) and gets only the keys made from it (`src/platform/keys.mjs`: the
  approvals' HMAC key and this PC's backup key); the vault keeps the secret for this PC's wrap of the data key. The app
  no longer offers sealing to the engine (no `host.seal`/`host.unseal`). Orb 3.8.0's key files (`clave.enc`, Electron's
  `v10`) are not read any more: when only they are there the start stops with `secretUnreadable` and its own message, and
  the window offers «Empezar con una clave nueva»; nothing is deleted. Backups never carry this secret; one made before
  3.8.1 carries it in `core/datos/clave.bin` and is refused (`data.backup.err.oldKey`). A sealed key that cannot be read is
  kept aside (`clave2.<date>.ilegible.enc`) when the user starts with a new key, and noted (`clave-anterior.json`); when
  Windows opens one again, Ajustes › Datos offers to go back to it (`backup.previousKey`, done at the next start, the new
  key kept aside). Never a new secret by itself: `io` is for now (the start stops and the window offers «Reintentar»), any
  other reason is the user's call. Every write goes to a temporary file of its own, flushed, checked (it opens again to
  the same secret) and renamed over the old one; a `clave.lock` held as a handle with no sharing keeps two starts from
  doing it at once (the engine's own lock in %TEMP% works the same way: `engine.mjs › holdWorkspace`). DPAPI per user is
  not a barrier against the agents (same Windows user): it protects the key at rest and from other users.
- **core missing** (`repairCore` in `backup.mjs`, called by `engine.mjs › start` before the database opens): when core,
  its orb.json or its database is gone, only what is missing **of core** is put back (`applyPendingRestore` with
  `onlyMissing`: a database newer than the copy stays; a project or whiteboard the user deleted stays deleted), from the
  newest copy of this workspace that opens (`backupCandidates`: newest first, only those with this workspace's `orbId`
  — from core, or from `ultima.json` when core is gone —; one this PC cannot open by itself, or a damaged one, gives way
  to the next), and the owner is told («Faltaba la carpeta core…»). A database that is missing with no copy at all is a
  workspace made a moment ago. Without core's settings and no usable copy the engine waits (`coreBlocked`:
  `app.coreState`, `app.coreRepair`, PC only) and the window shows «Falta la carpeta core» (`views/core-missing.jsx`,
  `lib/core-access.js › coreView`): the recovery code of the newest copy that needs it, another copy, or «Seguir sin
  copia» (core made again with the default settings in the window's language; the projects stay in their folders). That
  last one is offered at once only when there is no usable copy; with a copy that only needs its code it is behind «No
  tengo el código». Either way the copies there were are first put aside in `antes-de-empezar-de-nuevo-<date>\` inside
  their folder (`setAsideBackups`), where the retention never deletes them and nothing restores them by itself. While Orb
  runs, the engine's loop checks core every 5 s (`coreHealth`); if it goes it emits `core:lost`, stops the agents and
  ends (exit code 75): the app starts the engine again (`startEngine` restarts it) and the start restores it; the window
  reloads. A saved workspace whose core is gone is still opened (`readLocation`); a workspace folder that is gone
  altogether brings the welcome back.
- **Protection** (`protectCore`, every start): core gets the hidden attribute only (a system attribute would make the
  user's own backup tools, such as robocopy `/XA:SH`, skip it). No access rule (ACE) is set: deleting a folder on NTFS is
  allowed by DELETE on the folder *or* FILE_DELETE_CHILD on its parent, and the owner has full control of the workspace,
  so a deny-DELETE on core alone does not stop a rename or a move to the recycle bin; denying FILE_DELETE_CHILD on the
  workspace would also stop the user deleting their own top-level folders, and an inherited deny would block Orb's own
  writes. Measured on Windows 11, a deny ACE did not stop a rename by the owner. So core relies on being hidden, on the
  agents' guard (section 28: `isOrbData` denies `paths().internal`, i.e. all of core, except the isolated copies in
  `core\copias\aisladas` and the tools in `core\herramientas`, which agents run by their full path, and `core\bitacora`
  for reading tools only; and the roots the
  engine names with `setGuardedRoots`: the backups' root, the chosen backups' folder, the app's `claves` folder and its
  `Local State` (section 37), never
  one that holds the workspace, and (3.8.1, owner's decision 19 g) the owner's private `<workspace>\personal`, denied
  to every agent for reading too; Cursor gets the same as deny rules) and on the watcher and the backups above. The guard
  is not a boundary (section 28), and Ajustes › Datos says so.
- **Master password**: every window action on core (open it, restore a copy, choose where copies go) goes through
  `unlockCore` in `src/ui/lib/core-access.js`, which asks for the master password (section 37).

Tests: `test/core-carpeta.test.mjs` (a new workspace; a 3.7 workspace: its own data moved, the rest on the user's
choice, with its paths, the user's text left alone and a working isolated copy; a move cut halfway; another volume and a
file where a folder was; a folder in use: nothing moves, the message, «Reintentar»; core deleted with Orb closed; only
orb.json missing with a newer database; core deleted while the engine runs; no copy, «Seguir sin copia» and a copy that
needs its recovery code; the screen), `test/espacio-dueno.test.mjs` (the owner's real `C:\Orb` without `.orb`: nothing
moves at the welcome, his bitacora kept and used where it is, a 3.8.0 «keep» asked once more and the new path named, his MCP server moved as a project (his choice) and offered in Ajustes ›
Skills y MCP, the server 3.8.0 made a project offered once to move into core\mcp, `personal\` untouched and unlisted, only core restored; the copy that comes back; `homeKey`; 3.7 copies in a folder
inside `.orb`; «Seguir sin copia» keeps the copies; the guard outside the workspace; the vault's secrets out of the 3.7
archive; the sealed secret's copy), `test/copias.test.mjs` (where copies go, old ones adopted, never inside the
workspace), `test/multiplataforma.test.mjs` and `test/migracion-38.test.mjs` (the engine on a 3.7-shaped workspace).
