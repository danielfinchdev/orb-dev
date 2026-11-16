# 2. First launch and the assistant folder

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** It introduces itself ("Hi, I'm Orb·e", with the title "Your pocket director") and asks for the
assistant's name (Orb·e by default), what to call you and where to create its folder. The folder is always
`<chosen folder>\Orb` (or the chosen one, if it is already called Orb), whatever the assistant is called, and it has the
same structure for everyone:

> **Existing folder.** If no location is saved (new install), the installed app looks for an Orb folder that
> already exists (`<drive>:\Orb`, `Documents\Orb` or `<user>\Orb`, the most recently used) and uses it as is, without the
> welcome (`findExistingHome` in `src/engine/desktop-home.mjs`). It does not do this when running from source or in tests
> (`ORB_USER_DATA`).

> **Names.** The program is **Orb** (`Orb.exe`); its robot, **Orb·e**; **Orb.dev** is only the development build (this
> repository). They live in `src/shared/product.mjs`. Up to 2.3.3 the program was called "Orb.dev": that is why its Windows
> data (where the folder is, interface size) is still in `%APPDATA%\Orb.dev` and an updated install is still in
> `%LOCALAPPDATA%\Programs\Orb.dev`. Anyone who had the default name "Orb" becomes Orb·e when updating
> (`loadConfig`, `version` 4); a name chosen by hand stays.

```
C:\Orb\                   (C:\Orb by default; always <chosen folder>\Orb, the same for everyone)
  core\                   Orb's own folder, hidden: everything Orb needs to work (section 36)
    orb.json              settings
    datos\                database, sealed secret, identity
    ejecuciones\ copias\  task runs; isolated copies and undo checkpoints
    bitacora\             GENERAL.md (general memory) and proyectos\ (one per project), in the Settings language
    mcp\                  every MCP server (Settings › Skills y MCP, section 25)
    skills\               every skill; .activas: the ones on, as the agents load them (section 25)
    preparacion\          what an agent makes for core until the user turns it on (section 25)
    herramientas\adb\     Google's adb and fastboot, downloaded by the app
    secretos\             the master password's files: the data key, wrapped, and Orb's own secrets (section 37)
  windows\ linux\ ios\ android\ web\
                          categories: each folder inside one of them is a project
                          (the ones the app creates and the ones you create in Explorer)
  multi\<project>\        a multiplatform project: one repository, a folder per platform and compartido\
```

- **Categories** (`windows`, `linux`, `ios`, `android`, `web`, `multi`; `src/shared/layout.mjs`): projects are their
  subfolders. When creating or cloning a project you pick the category (web by default); the assistant sets it in
  `orb_create_project`. **Multiplatform** (`multi`): one folder and one git repository, `multi\<name>\<platform>\` for
  each platform chosen plus `compartido\` and a `LEEME.md` (`createProject` with `platforms`). The 2.7–3.7 groups
  (`<name>-android`, `<name>-ios`… with `comun\<name>`) are no longer made; existing ones still work together.
- **core** is never a project and cannot be linked as one; nothing else at the top is Orb's.
- **adb** (3.8.2): the first time it is needed (Settings → Android, or an agent's `orb_android_*` tool) the engine
  downloads a pinned version of Google's platform-tools (size, Google's SHA-1 and a SHA-256 checked before unpacking)
  into `core\herramientas\adb` (`src/engine/host/android.mjs`). It is not in the agents' PATH: agents reach the phone paired
  in Settings → Android through Orb's tools, only in a chat with «Usar mi móvil Android» (`src/engine/security/grants.mjs`),
  and run adb by hand only with «Acceso total» as well. adb's server stops when Orb locks or closes.
  **Emulators** (3.8.2): when the Android SDK's emulator is already installed (`ANDROID_SDK_ROOT`, `ANDROID_HOME` or
  Android Studio's folder; Orb never downloads it nor its system images), Settings → Android lists its AVDs
  (`emulator -list-avds`) and starts one by its exact name with the master password; agents use
  `orb_android_emulators` / `orb_android_emulator` under the same grant as the phone. The emulator starts without the
  engine's `ORB_*` variables and is one more adb device (`emulator-5554`) for the other `orb_android_*` tools.
- **Development tools** (3.8.3, `src/platform/dev-tools.mjs`): Flutter, the Android SDK and a JDK live in their own
  standard places outside Orb's folder (Android Studio's `%LOCALAPPDATA%\Android\Sdk`; Flutter in a folder of the user),
  so agents and the user's terminal run them and reinstalling Orb never removes them. Orb downloads none of them; it
  checks the files (no program started), lists them in Settings → Android with a link to install each, and gives the
  coordinator's briefing (and the brief of a mobile or multiplatform task) what it found, which overrides older notes in
  the logs. A PATH entry that does not exist is named as such; a copy inside core (outside `core\herramientas`, the only
  part open to agents) counts as unusable.
- **Older folders**: `ensureLayout` (every start) moves Orb 3.7's own data into core (its other folders move only as the
  user chooses, section 36), creates whatever is missing and moves 2.3.0's `bitacoras\` into the log folder (if a file exists in both, the old entries are
  appended at the end). It only discards the empty logs that 2.3.0 created for the categories and configuration folders
  it mistook for projects; those "projects" go away on their own (`syncProjects`).
- **The end of a project** (3.8.1, Proyectos › right click, a long press or «…» on the row; `src/domain/projects/project-close.mjs`):
  «Finalizar proyecto» (also from the phone: `projects.finish`) cancels its pending tasks, puts its tasks, conversations
  and direct conversations in «Completadas», pauses its schedules and takes it out of Orb while its folder stays;
  `projects_finished` (a setting) keeps it out of `syncProjects` (one whose folder is missing stays there for 30 days:
  a folder renamed for a while or a disk unplugged is still finished when it is back), and the «Finalizados» tab lists
  it with «Reabrir» (`projects.reopen`, its schedules back on). Tasks, conversations, direct conversations and schedules
  are tied to a project by name: when it is finished or deleted they move to a name of their own (`«name»: finalizado` /
  `«name»: eliminado`; «:» cannot be in a project's name), so a new project with that name starts clean, and a reopened
  one (under `«name» (category)` when the name was taken) gets them back, with its log, as `renameProject` does.
  «Eliminar proyecto» (PC only, behind the master password, asked every time: `projects.deleteCheck` is in
  `UNLOCK_METHODS` and `FRESH_UNLOCK`) moves its folder to the Recycle Bin. `main.mjs › app:deleteProject` asks the
  engine to check it (`checkDelete`: from then on the project is being deleted — `projects_deleting`; `board.createTask`,
  the scheduler and its direct conversations refuse —, its pending tasks are cancelled, its schedules paused and the
  processes of its direct conversations closed; it returns a one-off ticket, valid 30 minutes), checks the folder again
  by its real path (`deletableFolder`: only a folder straight inside a category of the workspace, never a link or a
  junction, a category, core or the workspace), calls `shell.trashItem` and then tells the engine (`projects.delete`
  with the ticket and `trashed`: whatever still works there is stopped, not refused). When the Recycle Bin cannot take
  it: a folder some program is using (the rename test, `folderInUse`) offers only «Reintentar»; otherwise «Reintentar»
  or «Borrar para siempre» (accepted by `main.mjs` only after that failure; refused while the folder is in use; one that
  stops half-way says what is left). Cancelling (`projects.deleteAbort`) gives the project back with its schedules; a
  delete left half-way (the app closed, the ticket expired) is finished when its folder is gone, undone otherwise
  (`settleDeleting`, at start and in the project sync). Finishing and checking a delete refuse while a task of the
  project runs, a direct conversation answers or a coordinator is in the middle of a turn in one of its conversations.

On Windows, it then offers to install whatever is missing (section 24).

**Files.**
- Interface: `src/ui/views/setup.jsx`.
- Creating and organizing the folder: `src/platform/paths.mjs` (`createHome`, `homeFor`, `ensureLayout`, `paths`, `categoryOf`, `DEFAULT_CONFIG`, `loadConfig`), `src/shared/layout.mjs` (the names), `src/domain/workspace/core-folder.mjs` (core).
- Projects by category: `src/domain/projects/projects.mjs` (`createProject`, `syncProjects`).
- Remembering where it is: `src/engine/desktop-home.mjs` (`ubicacion.json` in the app data).

**Inside.**
- `loadConfig` merges `core\orb.json` with the defaults. It adds new things to an old folder on its own:
  - accounts for new agents;
  - in version 3, the new usage caps (section 12).
- `ORB_USER_DATA` lets you separate the app data (another copy or the tests).
