# 25. Skills and MCP servers

Part of [How Orb works](../ARCHITECTURE.md).

3.8.1, the owner's definition: **`core\skills` holds every skill and `core\mcp` every MCP server** (the ones Orb installs
and the ones the user writes). Agents never write in core; the only way in is through the user (Settings, «Importar»)
or an agent's request the user approves. `src/domain/extensions/extensions.mjs` does the work (no engine imports: the engine, the
agents' MCP server, «Ordenar carpetas» and the tests use it); `src/engine/api/extensions.mjs` is its API (PC only).

- **What there is** (`listExtensions`): each folder of `core\skills` with its `SKILL.md` (frontmatter `name` and
  `description`, the Agent Skills format) and each folder of `core\mcp` with the command that starts it (`startCommand`:
  `bin`/`main` of package.json or typical files like `src/server.js` or `server.py`). orb.json keeps the state:
  `skills` (`[{ name, enabled, source }]`) and the connectors (`mcpServers`, with `source`: `orb`, `importado`, `creado`,
  `usuario`). A folder without an entry is off. Dot folders (`.activas`, `.anterior`) are Orb's.
- **Settings › Skills y MCP** (its own section, `views/extensions.jsx`, not on the phone): skills, MCP servers of core,
  the connectors of the PC that are not a folder (a package run with `npx`, a program; «Añadir conector» as before) and
  the projects that are MCP servers («Usar» from where they are, «Mover a core»: `extensions.adopt`, the same move as
  «Ordenar carpetas», `core-folder.mjs › moveIntoCore`). Each row: name, description, source, an on/off
  switch (`extensions.toggle`: a server of core gets its connector made from its start command; a skill is checked with
  `checkSkill` first, also one put in core by hand; a server whose package.json names dependencies that are not there is
  turned on only after a dialog says Orb will download them, `install: true`, and then `installDeps` runs), «Keys» (section 37),
  «Abrir carpeta» and «Quitar» (`extensions.remove`, in `UNLOCK_METHODS`: the master password, since it deletes from
  core). «Importar» (`extensions.import`, asynchronous: the engine never waits on git): from a folder or a git repository
  (`git clone --depth 1`, only `https://`, `git@host:` or `ssh://`; `file://`, `ext::` and local paths are refused, the
  file/ext protocols are off, and **nothing of the repository runs**: `core.hooksPath` and `--template` point to an empty
  folder, `--no-recurse-submodules`, `core.symlinks=false`, `GIT_LFS_SKIP_SMUDGE`), into the **quarantine**
  (`core\datos\cuarentena`, which no agent may write) with `copyTree`: file by file, never following a link (a symlink,
  junction or hard link refuses the import; each file is opened, checked to be the same file by its id and copied from
  that handle, its main content only, so NTFS alternate data streams stay behind), without `.git`, dependencies (`node_modules`, `.venv`, `venv`,
  `__pycache__`, `.cache`) or the package managers' settings (`.npmrc`, `.yarnrc*`, `.pnpmfile.cjs`,
  `pnpm-workspace.yaml`). A folder inside core (also through a junction) or one that holds core is refused. Then checked
  (`checkSkill`: SKILL.md, a valid name and a description; `checkMcp`: a start command; both: no link, at most 20 MB /
  2000 files for a skill and 200 MB / 5000 for a server, over everything that moves) and moved into core **off**
  (`source: importado`). Nothing is installed on import.
- **Dependencies** are installed only when the user turns a server on (after the dialog) or approves an agent's server:
  `npm install --omit=dev --ignore-scripts --install-links=true --no-workspaces --no-save` (no
  `preinstall`/`install`/`postinstall` of the package or of any dependency; packages copied, never linked; nothing
  written but `node_modules`), with the folder's `.npmrc`/`.yarnrc*` renamed out of the way first (they may name programs
  npm runs). A **local dependency** (`file:`, `link:`, `workspace:`, `portal:`, `git+file:`, a path, `workspaces`, in
  package.json, its overrides or the lock: `localDep`) is refused before anything runs (`checkMcp`, `installDeps`): npm
  would make it a junction to a folder agents still write. After installing, `linkOut` walks the whole folder
  (`node_modules` too) and a link that leads out of it removes `node_modules` and fails; a server holding one is neither
  turned on (`mcpWith`) nor started (`connectorSafe`), reused dependencies with one are dropped, and «Mover a core»
  (`moveIntoCore`) refuses a project with one. A new version whose package.json and lock did not change keeps the
  dependencies of the version in core.
- **How agents get the skills that are on** (`exposeSkills`, kept in `api-extensions.mjs › liveSkills` and made again
  when `skills` changes): `core\skills\.activas` is a Claude Code plugin Orb makes (`.claude-plugin\plugin.json`, name
  `orb-skills`, and `skills\<name>`, always a **copy made by Orb**, never a junction). Each skill that is on is checked
  again there (a link or a folder out of core, a wrong name, too big: left out). The copy's SKILL.md has a frontmatter
  **written by Orb** (`orbSkillText`: only `name` and `description`, as JSON strings) and the skill's text after it;
  nothing else of the original frontmatter reaches Claude. Checked with the real Claude Code: `allowed-tools: Bash` let
  a Bash command run without Orb's `canUseTool`, also when the key was quoted (`"allowed-tools"`), a YAML merge key
  (`<<: *a`) or an explicit key (`? allowed-tools`), which a regular expression did not see; with the regenerated
  frontmatter none of them does (`test/extensiones-seguridad.test.mjs` runs that scenario with the SDK's `claude.exe`
  against a local stand-in of the API). A ``!`command` `` in the text ran when the skill loaded; that is off for every
  skill (`disableSkillShellExecution`, `claude.mjs`). A copy is kept while neither the skill nor the copy changed (their
  fingerprints in `.activas\.copias.json`). The row warns when the frontmatter names `allowed-tools` or `hooks` in any
  form («Pide usar herramientas sin preguntarte…»). Per agent:
  - **Claude Code**: the SDK's `plugins: [{ type: 'local', path }]` (`--plugin-dir`); Claude lists them as
    `orb-skills:<name>` and loads one when it fits (checked with the real Claude Code: `supportedCommands()` lists the
    plugin's skill). The assistant (coordinator) does not: it has `Skill` denied and leaves that work to its tasks' agents.
  - **Codex**: the app-server's `skills/extraRoots/set` with `core\skills\.activas\skills`, before `thread/start`
    (checked with codex-cli 0.166: `skills/list` shows them; an older Codex without the method just goes without).
    Nothing is written in the user's `CODEX_HOME`.
  - **Cursor and the ACP agents** (Gemini, OpenCode, Qwen, Copilot): no way to hand them extra skills without writing
    into the project (Cursor reads `.cursor/skills` and `.claude/skills` of the project or the user's home): a task's
    brief lists them instead (`skillsBrief`: name, description and the full path of its SKILL.md, «read it when it fits»).
    Not in their direct conversations (the user's text goes as it is), nor in the coordinator's persona when its brain is
    one of them.
  - The guard (section 28): `core\skills` is open to reading tools; running one of its scripts **asks** (only one
    interpreter and one script file of `core\skills`, as a single plain command: `python <script>`, `node <script>`,
    `powershell -File <script>`; never in «leer»); anything else that touches it (`python -c`, `curl -o`, `tar -C`, a
    redirection…) is denied with a reason that names `orb_create_skill`.
- **Made from the chat** (`orb_create_skill`, `orb_create_mcp`, `orb_request_activation` in `src/mcp/server.mjs`, any
  signed agent): «créame una skill para X» → `draftExtension` makes `core\preparacion\<kind>-<name>-<hex>` with a start
  (a SKILL.md skeleton, or a Node / Python MCP server), or a copy of the current one with `mejorar: true` (a new
  version: its code only, never its secrets, dependencies or links). `core\preparacion` is the only part of core agents
  may write (guard `OPEN_INTERNAL`). Improving a server that **holds keys** (its connector has some, or its folder has
  secret or git-ignored files) waits for the user: the request is `asking`, a card asks «¿Dejar que … mejore …?», and only once allowed
  (`extensions.approve` → `allowDraft`) is the copy made; the agent calls `orb_create_mcp` again to get it. The request
  lives in the database (`extension_requests`, never in the folder the agent writes), with who made it; only that agent,
  or one of the same conversation (the coordinator makes it and a task's agent writes it, as the persona says), may call
  `orb_request_activation`: the folder (never a link) is copied with `copyTree` into the quarantine
  (`core\datos\cuarentena\<id>-<hex>`; a link anywhere refuses it, dependencies and package manager settings are left
  out, the size limit counts everything that moves), checked there, and that copy's **fingerprint** (one JSON line per
  folder and per file: kind, relative path, size and sha256, in one fixed order, so no change of the files gives the
  same fingerprint) and its full list of files are kept. What the agent changes in its folder afterwards never moves. A
  card goes to the conversation (`meta.kind: 'extension'`, `ExtensionRequestCard` in the chat; also «Esperan tu
  aprobación» at the top of Settings › Skills y MCP) with «Activar», «Abrir carpeta» (the quarantine's copy) and
  «Descartar» (PC only; the phone says «Actívalo desde el PC»). «Activar» always opens a dialog first: what it means (a
  server runs on the PC with the user's permissions, in every agent), whether it will download packages, and **every
  file** that will be turned on. `extensions.approve` checks the quarantine's fingerprint again, installs a server's
  dependencies there (or keeps core's), checks the fingerprint **once more right before moving** (installing may take
  minutes), moves **exactly that copy** into core, turns it on (`source: creado`) and marks
  the card; a new version replaces the old one, kept in `core\mcp\.anterior\<name>` (`core\skills\.anterior\<name>`
  for a skill), and keeps the old version's secrets: a new version's own secret files are left out of the quarantine (the
  dialog says so) and core's always win (`carrySecrets` writes over them), so an agent cannot swap the server's account.
  `extensions.reject` deletes the folder and its quarantine.
- **Improving a server of core** («Editar en un proyecto», `extensions.edit`): a copy (git and dependencies too, never its
  secrets nor a link: `secretTest` — `tokens/`, `secrets/`, `credentials/`, WhatsApp session folders (`.wwebjs_auth`,
  `auth_info*`, `store/`, `auth/` and `session(s)/` outside code folders), `.env*`, `*.pem`, `*.key`, `*token*.json`,
  `client_secret*.json`, `*.keys.json`, `.git-credentials`, `credentials`, `auth*.json`, `oauth*.json`, `api_key*`,
  cookies, sessions, Playwright's `storage_state.json`, databases, also as `.bak`/`.old`/`.orig`… plus what the server
  declares in package.json › `orb.secrets` or `.orb-secrets`; nor what its `.gitignore` files leave out of git, read by
  Orb without running git (`gitignored`), build output aside; `.git/config` goes without credentials in remote
  addresses, `[credential]` or `extraheader` (`cleanGitConfig`), and without `FETCH_HEAD`) goes to
  `<workspace>\<category>\<name>` (or `name-2`…) and becomes a project; agents work on it like on any project while the
  version in core keeps running. `extension_edits` remembers it (the row says «en edición», the project «copia para
  editar …»). «Aplicar cambios» (`extensions.applyCheck`, refused while the project has tasks pending or running: the
  project's version is copied into the quarantine and compared with core, secrets aside; then a confirmation;
  `extensions.apply` with the id of that check): exactly the copy the user saw goes into core with core's secrets, the
  old one kept in `.anterior`, and its connector starts what the folder says now (its keys follow:
  `connector-secrets.mjs › rebindMoved`). The same works through an agent with `orb_create_mcp` + `mejorar: true`.
- **Keys**: a connector's keys (its `env`) live in the master password's vault, never in orb.json, which keeps a
  reference (`orb-secret:mcp/<connector>/<NAME>`, `src/domain/security/connector-secrets.mjs`); the engine puts the value back only
  for the connector's launcher. They are tied to the connector's command: when Orb itself moves a server (into
  `core\mcp`, «Mover a core», «Aplicar cambios») the keys are tied to the new command (`rebindMoved`, only when they were
  tied to the old one: a command changed by someone else stays held). With the vault locked (no machine secret, the
  password not typed yet) it is never silent: `rebindOrWait` keeps what has to be tied (names and the two bindings, no
  key) in the `connector_rebinds` setting, a notice says «Las claves de … se activarán cuando desbloquees Orb», and
  `settleRebinds` ties them when the vault opens (`engine.mjs › onUnlocked`, and at start when it opens alone).
- A connector whose program is in a folder of `core\mcp` that is a link or reaches out of core never starts
  (`connectorSafe`, `mcpServersFor`).
- They are passed to the chosen agents along with Orb's MCP (`mcpServersFor` in `sessions.mjs`). Claude uses
  `--strict-mcp-config`, so it only loads the ones Orb passes and not all of the user's. This saves tokens.
- Backups (section 36) carry `core\mcp` and `core\skills` without dependencies, `.activas` or `.anterior`. A server's own
  files (e.g. OAuth tokens of `gmail-multi-mcp`) go with it into every backup, which is always encrypted.
