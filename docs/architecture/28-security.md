# 28. Security

Part of [How Orb works](../ARCHITECTURE.md).

- **Window:** `sandbox` and context isolation, CSP without `eval`, Markdown is rendered without HTML and every call is
  checked by the app (Rust) and the engine.
- **Approval key:** encrypted by Windows (DPAPI). The engine receives it only in memory and the MCP never has it.
- **Agent identity (`src/domain/security/agent-auth.mjs`):** who an agent's MCP process is lives only in the engine's
  memory, never in the database or a file an agent could write. `mcpServersFor` (`sessions.mjs`) gives every MCP
  server of an agent process a ticket (random, new for every process) and the engine's local pipe (`ORB_AUTH_PIPE`).
  The server trades the ticket for its grant when it starts (`src/mcp/auth-client.mjs`): who it is (agent, task,
  conversation, or the coordinator of one conversation), the assistant folder and the browser's key; it asks the engine
  again on every call. The ticket is bound to the connection that holds it (a second one waits up to 3 s for the first to
  close), so the copy in the agent's environment is worth nothing while the server runs. A ticket is traded once: the
  server acks the grant, and from then on only the reconnect secret that came with it (kept in the server's memory)
  trades it again, so a ticket set free by a dead server is no use to whoever copied it. Cursor, which starts its servers
  again every turn, gets new reusable tickets every turn (`mcpServersOf`, `mcpServersEachTurn`), released when the turn
  ends. A slow hello is retried and a check the engine does not answer in time is a retryable «busy» error, never «not
  signed»; connections that never say hello are closed after 10 s. Tickets end with their agent's process (also when it
  dies mid-turn), with `Sessions.closeLive` / `Lane.closeLive`, with the conversation and with the engine: nothing of an
  earlier run is valid (the hashes 3.8 kept in `settings` are deleted at start). There is no coordinator without a
  conversation.
- **Secrets an agent asks for (3.8.2, `src/engine/security/agent-secrets.mjs`):** `orb_request_secret` (name + reason) shows a
  private card in the chat on this PC only (`secrets.pending` / `secrets.answer` / `secrets.decline` are `pc` methods;
  the `secret:request` event is not one a phone gets; the chat only says which name was asked for). The value typed
  there never goes to the chat, the logs, the database or the agent: the engine issues a one-time grant (`once`) on the
  agents' pipe, bound to that agent process, valid for 10 minutes, and the agent gets a handle for Orb's helper
  `src/mcp/secret-run.mjs`, which trades it once and runs one command without a shell with the value in one environment
  variable (`--env NAME`) or on its stdin (`--stdin`), replacing it with «[secreto]» in that command's output. «Guardar
  en la bóveda» stores it in the vault as `agent/<NAME>`, and «Usar la guardada» reads it back; both need the master
  password (`needsUnlock`). Locking Orb or changing the password cancels every pending request and revokes every handle
  not yet traded. The card always says that Orb never asks for the master password there, and
  the engine refuses a value that is the master password: the vault checks it with its `same` job (`Master.isPassword`),
  which counts no try and keeps nothing, and only while the data key is open.
- **The user's connectors:** an agent gets `src/mcp/launch.mjs` and a ticket instead of the connector; the
  launcher gets the real command, arguments and keys from the engine and starts it (and stops its whole tree when the
  ticket is taken back). On Windows (`src/platform/proc-win.mjs`) an npm shim (`npx.cmd`, a global package's cmd-shim) runs
  as its script with node and an `.exe` directly, so arguments such as `C:\dir\`, `%VAR%` or quotes arrive intact; any
  other batch file goes through cmd.exe with MSVCRT and double cmd escaping. A program is looked up only in the PATH
  (never the current folder, the project): not found is an error. Connector names that would share an environment
  variable (`git-hub` / `git_hub`, case) are refused. So no connector key is on a command line, in the agent's environment (its shell) or in a session
  log. What is in an agent's environment (tickets, the pipe) is handed by name: Claude's `--mcp-config` names
  `${VAR}` (`mcpEnvByRef` in `common.mjs`), Cursor's `.cursor/mcp.json` `${env:VAR}`, Codex `env_vars` with a name per
  server (`mcpSecrets` in `codex.mjs`, and `shell_environment_policy.exclude=["ORB_*"]` keeps them out of its commands),
  and the ACP agents get them over stdin (`session/new`), with every value hidden in `registro.jsonl`
  (`hidingEnvValues` in `live.mjs`). Residual: an agent that kills its own launcher can redeem that ticket from its shell and read
  that connector's keys (the connector is one the user enabled for that agent). In coordinator mode Codex uses
  `untrusted` + `read-only`, so every command goes through the guard, which denies it in `leer`.
- **Pending assistant notices:** `orchestrator_pending` stores the engine notices not yet answered
  (`keep`/`resume` in `orchestrator.mjs`); when the app closes, the one in progress is repeated when it is reopened, and
  "New chat" does not discard them.
- **Worker identity:** the MCP takes agent, task and conversation from its grant (above), never from `ORB_AGENT` or
  `ORB_TASK_ID`: an agent that starts the MCP on its own cannot impersonate another or close someone else's task
  (`identity()` in `src/mcp/server.mjs`). An unsigned process gets every tool refused, and a signed one acts only on
  its own conversation or task (section 34). The grant also names the conversation (session) it runs in, so two direct
  conversations of one agent are two identities. Workers of one conversation may message each other's tasks by number;
  read marks are per task (`claude#3`).
- **Agents:** clean environment (without the app's secret variables), permission guard, internal data off limits and
  warnings for pushes or mass deletions.
- **Orb's data folder (`isOrbData` in `guard.mjs`):** matched by RESOLVED path (against the agent's folder, any case
  or separator, symlinks followed), not by names: a project may have its own `orb.db` or talk about `ORB_HOME`. Denied,
  also in «total» (3.8.2: it asked before). Isolated copies (`core/copias/aisladas`) and the tools (`core/herramientas`)
  stay open; the logs moved into core (`core/bitacora`) are open to reading tools only (the user's rules for
  agents may point there; they are written through Orb's own tools, and a write or a command there is denied with a
  reason that names `orb_write_log`). 3.8.1: the skills (`core/skills`) are open to reading tools too; a command that
  only runs one of their scripts asks (anything else there is denied), and `core/preparacion` (what an agent makes for
  the user to turn on) is open like the isolated copies (section 25). A path is resolved to where it really is, also for
  a file not made yet (its nearest existing parent, and a link whose target is missing, are followed), so a junction
  made earlier cannot send a write into core; and a command that makes a link (`mklink`, `New-Item -ItemType
  Junction|SymbolicLink|HardLink`, `fsutil hardlink|reparsepoint`, `ln`, .NET `CreateSymbolicLink`, Node
  `fs.symlink`/`fs.link`, Python `os.symlink`/`os.link`…) that names core, runs inside it or points into it is denied.
  The `cd`s of a compound command are followed (`workDirs`: `cd`, `chdir`, `pushd`/`popd`, `Set-Location`/`sl`,
  `Push-Location`/`Pop-Location`, `cd..`, `cd /d`, through `;`, `&&`, `||`, `&`, `|`, new lines and brackets, also inside
  `cmd /c`, `bash -c` and `powershell -Command`; Git Bash paths such as `/c/...` read as Windows paths): a part that runs
  inside core (but its open folders) is denied whatever it names, and every word of it, also one without a slash (a
  junction's name), is resolved from there. So `core/datos` (with the quarantine), `core/skills` and `core/mcp` are
  denied to tools and to commands, also through `cd .. && cd core && …` or a junction to the workspace. The same goes for what Orb keeps about the workspace outside it (`setGuardedRoots`: the backups' root
  and chosen folder, the app's `claves` folder and its `Local State`; section 36; also when a command names them through
  `%APPDATA%`, `$env:APPDATA` or `~`, written out by `expandEnv`). Still not a boundary: a script or a program of the
  same Windows user can always reach the folder another way (its own `chdir`, a path built while it runs, a variable); the agents' identity does not depend on its database any more (tickets,
  above), so what is left is the integrity of Orb's data against an agent bent on it, accepted. The folder is one value
  (`ctx.paths.internal`): all of `core` since 3.8 (section 36).
- **Project agent settings:** a task can write the project's agent settings that later agents (other
  conversations) would load. Claude runs without the project's hooks (`disableAllHooks`) and with
  `allowManagedPermissionRulesOnly` (managed settings), so a project's `permissions.allow` never skips Orb's guard
  (`canUseTool`); a project whose `.claude/settings*.json` would run programs or change the environment (`env`,
  `apiKeyHelper` and the other helpers, aws/gcp refresh, `processWrapper`, status lines, plugins: `projectSettingsRisk`
  in `claude.mjs`) starts without its settings files, and its CLAUDE.md goes through the system prompt; the conversation
  says so. Checked with the real Claude Code against a local stand-in of the API (`test/fixtures/fake-anthropic.mjs`).
  Cursor's turns run without the project's allow rules and hooks (`.cursor/hooks.json` is emptied for the turn and put
  back). Changing `.claude/settings*.json` or `.cursor/{hooks,cli,mcp}.json` asks first (Edit/Write and commands that
  name them). Settings › Agents explains it. Residual: an agent that writes those files from a script without naming
  them changes what already running Claude processes of that folder reload (later ones are checked at start).
- **Agent text:** when it goes back to the assistant it is marked as "data, not instructions".
- **No PC folders on the phone:** every answer, error and event a phone or browser gets goes through
  `withoutPaths` (`remote.mjs`): a value that is one whole absolute path (outside free-text fields) becomes its place in
  the assistant folder (or its last part); in free text, keys and deep values only the assistant folder is cut, in any
  case and separator. `whiteboard.load` goes back as saved (only its attachments are filtered). `/api/upload` answers
  with the picture's name, which the PC resolves to its folder. Deleting a conversation cancels its unfinished tasks (they would otherwise
  share messages with the tasks of no conversation), and manual tasks a 3.7 agent took without a conversation go back to
  the queue at start (`board.releaseUnclaimed`).
- More detail in `docs/historico/AUDITORIA-v2.md` and `docs/historico/AUDITORIA-v2-segunda.md`.
- **`orbpage` is a "local" origin to Tauri (threat-model note):** agent HTML pages are served from
  `http://orbpage.localhost` (`src-tauri/src/pages.rs`), and Tauri's `is_local_url` treats every scheme the app
  registers as the app's own origin. What stops such a page from calling the window's commands is therefore a single
  barrier: the invoke key (`invoke_initialization_script`) is injected only into the **main frame** and the sandboxed
  page frame cannot read it. That holds for Tauri 2.12.4 (`manager/webview.rs`, `main_frame_script`). `test/tauri-invoke-key.test.mjs`
  fails when the Tauri pin changes without this being re-checked, and, when the crate source is on disk, when the
  invoke-key script stops being main-frame-only. Review it on every Tauri bump.
