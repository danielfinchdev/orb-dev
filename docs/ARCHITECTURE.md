# How Orb works, feature by feature

This document explains each feature on its own: what it does, how it is used, which files implement it and how it works
inside. It is meant for reworking **one specific feature** without touching the rest. Each section says which files to
change and which other features it connects to.

> **Orb's idea does not change:** a chat with an assistant that, when you tell it about a project, writes token-optimized
> briefs and splits them among several AI agents from different providers, which work at the same time and in a
> coordinated way. Then it reviews what they did and asks for your OK.

## Contents

1. [App map](#1-app-map)
2. [First launch and the assistant folder](#2-first-launch-and-the-assistant-folder)
3. [The chat with the assistant (orchestrator and direct conversations)](#3-the-chat-with-the-assistant)
4. [Token-optimized briefs](#4-token-optimized-briefs)
5. [The task board](#5-the-task-board)
6. [The scheduler: who does each task and when](#6-the-scheduler)
7. [Live agents (adapters)](#7-live-agents)
8. [Permission guard and approval cards](#8-permission-guard-and-approvals)
9. [Direct conversations](#9-direct-conversations)
10. [Queue and live steering](#10-queue-and-live-steering)
11. [Fork, continue and details](#11-fork-continue-and-details)
12. [Context and real usage (no token burning)](#12-context-and-real-usage)
13. [Limited tasks and continuity](#13-limited-tasks-and-continuity)
14. [Delegation between agents](#14-delegation-between-agents)
15. [Task Review](#15-task-review)
16. [Scheduled tasks](#16-scheduled-tasks)
17. ["@" to attach context](#17--to-attach-context)
18. [Report, OK and undo](#18-report-ok-and-undo)
19. [Logs](#19-logs)
20. [GitHub](#20-github)
21. [The agents' browser and mini window](#21-the-agents-browser)
22. [Mobile: phone and browser with Magic Link](#22-mobile)
23. [God mode (expert view)](#23-god-mode-expert-view)
24. [Installer and session detection](#24-installer-and-session-detection)
25. [Skills and MCP servers](#25-skills-and-mcp-servers)
26. [Languages](#26-languages)
27. [Interface: sidebar, inbox, theme, size and robot](#27-interface)
28. [Security](#28-security)
29. [Packaging, versions and CI](#29-packaging-versions-and-ci)
30. [Tests](#30-tests)
31. [How to rework a feature without breaking the rest](#31-how-to-rework-a-feature)
32. [The CORE: from request to report](#32-the-core)
33. [Conversations](#33-conversations)
34. [Permissions](#34-permissions)
35. [From 3.7 to 3.8 (migration)](#35-from-37-to-38-migration)
36. [The workspace and core](#36-the-workspace-and-core)
37. [The master password and Magic Link](#37-the-master-password-and-magic-link)

---

## 1. App map

```
Window (React, WebView2)  ──commands──►  App (Tauri 2, Rust)  ──JSON lines──►  Engine (bundled Node)
src/ui/** + tauri-bridge.js             src-tauri/src/*.rs               src/engine/engine.mjs
                                                                         ├─ api.mjs          window actions
                                                                         ├─ sessions.mjs     live conversations
                                                                         ├─ scheduler.mjs    tasks
                                                                         ├─ orchestrator.mjs the assistant
                                                                         └─ remote.mjs       phone access (Magic Link)
Agents (processes)  ◄── adapters src/agents/*.mjs (live) ──┘
   └─ each agent loads Orb's MCP server: src/mcp/server.mjs (the shared board)
Data: <workspace>/core/datos/orb.db (SQLite, src/core/db.mjs)
```

- **There is no web server for the window.** The window talks to the engine through the app's own commands (Tauri's
  IPC, only from Orb's window: `src-tauri/capabilities`, `lib.rs › only_main`), relayed over the engine's stdin/stdout. The
  only server is the phone access (section 22), which is off by default and only listens on the home network and
  Tailscale addresses.
- **The engine** is a separate process: the bundled `node.exe` (Node 24, `scripts/tauri-resources.mjs`) in a Job Object,
  speaking one JSON message per line on stdin/stdout (`ORB_ENGINE_STDIO=1`, `src/engine/stdio.mjs`; console output goes
  to stderr; `src-tauri/src/engine.rs`, `pipes.rs`). If it crashes, the app restarts it, up to three times. It asks the app for
  what only the app can do — open a link or a folder, start a program that outlives Orb — with `host.*` messages
  (`src/engine/host.mjs`). Orb's own Node scripts for the agents run with `ORB_NODE` (the bundled `node.exe`) or the
  engine's runtime (`src/agents/common.mjs › nodeRuntime`). The Tauri installer installs per user
  (`%LOCALAPPDATA%\Programs`), a folder any program of the user can write: the agents' guard keeps it read-only for them
  (`guard.mjs › setAppRoots`, `workspace-layout.mjs › appInstallDir`), which does not stop other programs. A per-machine
  install (Program Files, writable only by administrators: NSIS `installMode: "perMachine"` or `"both"`) is the option for
  whoever wants that; it is not the default because it asks for administrator rights.
- **The agents** are the official programs the user already has (Claude Code, Codex, Cursor, Gemini CLI…), with their
  own session. Orb never sees credentials.
- **Layers** (bottom to top):
  1. `src/core` is the pure logic: board, approvals, usage, guard, folders and scheduled tasks.
  2. `src/agents` are the adapters.
  3. `src/engine` puts the pieces together.
  4. `src/ui` is the interface.
- **Only coding.** Orb coordinates coding agents and nothing else: what older versions had around it (the PC monitor,
  Opti Bot, the bots) is gone. For old data only: `engine/retired.mjs` archives Opti Bot's old conversation once and
  expires its waiting proposals, deleting nothing; `loadConfig` drops the old `monitor`, `bots` and `oce` settings; the
  3.8 migration archives the rest (section 35).

## 2. First launch and the assistant folder

**What it does.** It introduces itself ("Hi, I'm Orb·e", with the title "Your pocket director") and asks for the
assistant's name (Orb·e by default), what to call you and where to create its folder. The folder is always
`<chosen folder>\Orb` (or the chosen one, if it is already called Orb), whatever the assistant is called, and it has the
same structure for everyone:

> **Existing folder.** If no location is saved (new install), the installed app looks for an Orb folder that
> already exists (`<drive>:\Orb`, `Documents\Orb` or `<user>\Orb`, the most recently used) and uses it as is, without the
> welcome (`findExistingHome` in `src/engine/desktop-home.mjs`). It does not do this when running from source or in tests
> (`ORB_USER_DATA`).

> **Names.** The program is **Orb** (`Orb.exe`); its robot, **Orb·e**; **Orb.dev** is only the development build (this
> repository). They live in `src/core/product.mjs`. Up to 2.3.3 the program was called "Orb.dev": that is why its Windows
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

- **Categories** (`windows`, `linux`, `ios`, `android`, `web`, `multi`; `src/core/layout.mjs`): projects are their
  subfolders. When creating or cloning a project you pick the category (web by default); the assistant sets it in
  `orb_create_project`. **Multiplatform** (`multi`): one folder and one git repository, `multi\<name>\<platform>\` for
  each platform chosen plus `compartido\` and a `LEEME.md` (`createProject` with `platforms`). The 2.7–3.7 groups
  (`<name>-android`, `<name>-ios`… with `comun\<name>`) are no longer made; existing ones still work together.
- **core** is never a project and cannot be linked as one; nothing else at the top is Orb's.
- **adb** (3.8.2): the first time it is needed (Settings → Android, or an agent's `orb_android_*` tool) the engine
  downloads a pinned version of Google's platform-tools (size, Google's SHA-1 and a SHA-256 checked before unpacking)
  into `core\herramientas\adb` (`src/engine/android.mjs`). It is not in the agents' PATH: agents reach the phone paired
  in Settings → Android through Orb's tools, only in a chat with «Usar mi móvil Android» (`src/engine/grants.mjs`),
  and run adb by hand only with «Acceso total» as well. adb's server stops when Orb locks or closes.
- **Older folders**: `ensureLayout` (every start) moves Orb 3.7's own data into core (its other folders move only as the
  user chooses, section 36), creates whatever is missing and moves 2.3.0's `bitacoras\` into the log folder (if a file exists in both, the old entries are
  appended at the end). It only discards the empty logs that 2.3.0 created for the categories and configuration folders
  it mistook for projects; those "projects" go away on their own (`syncProjects`).
- **The end of a project** (3.8.1, Proyectos › right click, a long press or «…» on the row; `src/core/project-close.mjs`):
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
- Creating and organizing the folder: `src/core/home.mjs` (`createHome`, `homeFor`, `ensureLayout`, `paths`, `categoryOf`, `DEFAULT_CONFIG`, `loadConfig`), `src/core/layout.mjs` (the names), `src/core/core-folder.mjs` (core).
- Projects by category: `src/core/projects.mjs` (`createProject`, `syncProjects`).
- Remembering where it is: `src/engine/desktop-home.mjs` (`ubicacion.json` in the app data).

**Inside.**
- `loadConfig` merges `core\orb.json` with the defaults. It adds new things to an old folder on its own:
  - accounts for new agents;
  - in version 3, the new usage caps (section 12).
- `ORB_USER_DATA` lets you separate the app data (another copy or the tests).

## 3. The chat with the assistant

**What it does.** It is the main screen. You tell it what you want and the assistant turns it into tasks, assigns them,
watches them and reports back. Each "New chat" is its own conversation (section 33). The "Orchestrator" checkbox decides
who a new conversation is with:

- **Orchestrator** (default): with the assistant, which:
  - only coordinates;
  - can **read** the project (Read, Grep, Glob) to write better briefs;
  - does not edit or run anything.
- **Without Orchestrator:** directly with the agent chosen under the box (a direct conversation, section 9), in the
  working project. The user splits the work and can open as many at once as they like.

**Files.**
- Interface: `src/ui/views/chat.jsx` (includes the `Composer`, the message box used across the app).
- Engine: `src/engine/orchestrator.mjs`.
  - `persona()`: its coordinator instructions.
  - `Orchestrator`: the conversations; `Lane`: one conversation with its live session.

**Inside.**
- The assistant is **a live Claude session** (Claude Agent SDK with the user's Claude Code) that stays open between
  messages. The reply streams in (`chat:state.partial`).
- **Any brain:** `orchestrator.agent` can be any installed agent with an account (`chat.settings` with `agent`,
  `model`, `reasoning`, `account`). Claude gets the persona as its system prompt; the others get it when the
  conversation starts, and as coordinator they run read-only. Switching agents starts a new conversation.
- **Brain catalog** (`models.catalog`, `src/engine/catalog.mjs`): installed agents with their models (the configured
  ones and the ones the agent itself reports: Codex's `model/list` and the ACP model option, stored in
  `models:<agent>`), which ones cost more (`heavyModels` or known families) and the real usage of each account. The
  interface (`src/ui/components/brain-picker.jsx`) warns with a bubble if reasoning is high, the model is an expensive
  one or the account is over 75 %.
- **New chat:** opens the screen for a new conversation (route `{ view: 'chat' }` without `id`). The first message
  creates it: with "Orchestrator", `chat.send` without `conversation` (returns its id and the screen switches to that
  conversation); without it, a direct session (`sessions.create` + `sessions.send`) with the chosen agent, model,
  reasoning and project.
- A dialog requested again while it is open does not open on top of itself (`open()` in `dialogs.jsx`).
- **Chat bar:** no name or model; only icons with `BubbleTip` (`overlay.jsx`): pause or resume, restart and
  mini-games. The top bars (`.topbar`) are styled by the theme in `themes.css` (decoration in `::before`, which stops
  before the window buttons, section 27).
- **Theme scenes:** `.theme-band` (menu header `.side-band` and top bars) and `.theme-scene` (background of
  `main`: a blurred layer that moves slowly with `transform`, plus a sharp pattern in `::after`). Each theme defines
  `--band`, `--band-art`, `--scene` and `--scene-pattern` in `themes.css`; the bar backgrounds are fixed to the window,
  so menu and bar read as a single strip. Everything stops with reduced motion or with `html[data-motion="minima"]`
  (Animations off). Per-theme typography while the chosen one is the default (`data-font="outfit"`): Space Grotesk, IBM
  Plex Mono, Nunito/Fredoka and Inter (`fonts.css`).
- **Collapsing the menu:** `sidebarCollapsed` in the store (remembered in `localStorage`); `SidebarToggle` in
  `theme-toggle.jsx`, next to day/night and, when collapsed, at the start of the top bars.
- **Mini-games** (`src/ui/games/`): Snake, Tetris, Chess (own engine with legal moves and alpha-beta search; depth
  depends on difficulty), Jump, 2048 and Bricks. High scores in `localStorage` (this PC). When the assistant replies and
  it has tasks queued or running, it leaves a message in the chat with a button to play (`suggestGames()`, at most every
  30 min; `meta.kind = 'games'`).
- **Notices** (`src/ui/components/notices.jsx`): `chat:new` now carries `meta`; task-end messages (`task-end`), report
  messages (`report`) and attention messages (`attention`, `task-approval`, `approval`) bring out the full-body robot with
  a bubble. Without animations, in the Professional theme or on mobile, a notice at the top (green or orange).
- If you type while it is replying, your message reaches it on its next step (`steer`); no need to wait.
- **Stop** frees the chat immediately. If you type right away, the message waits for the stopped turn to finish closing
  (`inflight` in `orchestrator.mjs`); if it does not finish within 10 s, its process is closed and the conversation
  continues with `resume`.
- **It renews by context, not by turns:** when the context goes over `orchestrator.renewAt` (60 %), or after `maxTurns`
  (60), a new conversation starts. Memory is not lost, because it is on the board and in the logs: the first message of
  each conversation carries a summary (`briefing()` in `logs.mjs`).
- It uses its own identity in the MCP (`orb`), protected by a key that only its process has (section 28).
- Internal messages: the engine notifies it with `AVISO DEL SISTEMA` ("system notice") about things like "the tasks have
  finished, review and report" or "the task got blocked". That closes the loop without you having to type anything.

## 4. Token-optimized briefs

**What it does.** Every brief the assistant writes is compact:
- exact paths, what to change, done criteria and what not to touch;
- it does not copy code or context the agent can read on its own;
- it does not repeat context between tasks: it uses `depends_on` and the next task receives the previous one's result.

**Files.**
- Assistant rules: `src/engine/orchestrator.mjs`, in `persona()` (`ENCARGOS COMPACTOS`).
- What each agent receives: `src/engine/scheduler.mjs`, in `promptFor()`. It includes:
  - the brief;
  - what was done before (at most `MAX_DEP_RESULT` characters per dependency);
  - the latest log notes (about 3000 characters);
  - where it works and how to report.
- Size limit: `MAX_DESCRIPTION` in `src/core/board.mjs`.

## 5. The task board

**What it does.** It stores tasks with:
- status: queued, awaiting approval, working, done, failed, blocked, cancelled or **waiting for quota** (`limited`);
- dependencies, agent, model, reasoning;
- where it works: in the project folder or in an isolated copy with its own branch;
- which task it is a subtask of (`parent_id`), which task it reviews (`review_of`) and which scheduled task it comes
  from (`schedule_id`).

**Files.**
- Logic: `src/core/board.mjs`.
- Database: `src/core/db.mjs` (tables `tasks`, `events`, `messages`, `chat`, `sessions`, `session_items`,
  `session_queue`, `schedules` and `settings`).
- Screen: `src/ui/views/tasks.jsx` (list, detail, actions and Task Review).

**Signed approvals.**
- A task waits for your approval when:
  - it contains risky words (publish, delete, credentials, payments);
  - it uses high reasoning;
  - or it was created by an agent without trusted delegation.
- Approving signs a hash of what you saw (`src/core/approval.mjs`, HMAC with the encrypted key). If the task changes,
  the signature stops being valid and it asks for approval again (`revalidateQueued`).

**How to rework it.**
- A new status: `STATUSES` in `board.mjs`, plus `STATUS` in `src/ui/lib/labels.js` and the filter in `tasks.jsx`.
- A new column: `ADDED` in `db.mjs` (automatic migration).

## 6. The scheduler

**What it does.** Every 1.5 s, and as soon as the board changes:
1. Launches the ready tasks (approved and with their dependencies done).
2. Picks agent and account.
3. Prepares where they work.
4. When each one finishes: saves the result, runs the safety checks, writes to the log and notifies.

**Files.** `src/engine/scheduler.mjs`:
- `tick`: each round.
- `launch`: launching a task.
- `finishNow`: closing a task.
- `promptFor`: the brief the agent receives.
- `explainFailed`: explaining a failure.
- `queueReport`: the final report.

**Assignment.**
- Candidates: only **enabled and installed** agents (`installed()` in `src/agents/index.mjs`) and their accounts with quota left.
- Order: by each account's real usage (section 12) and, if there is no real data, by tasks launched.
- `maxParallel` tasks at once and `perAgent` per account.
- In the project folder, only one writing task at a time. Read-only tasks and isolated copies run in parallel; a
  subtask does not wait for its parent task.

**Work modes.**
- `carpeta`: works in the project folder. A "snapshot" is taken first (`takeCheckpoint`) so it can be undone. A
  repository with no commits (just `git init`) also works: the snapshot is a first commit with no parent.
- `aislada`: its own branch and copy (`prepareWorkdir`, git worktree). When it finishes an automatic commit is made,
  which is blocked if there are files that look like secrets.
  Once the user joins it («Unir», `projects.merge`) or discards it (`tasks.discardBranch`), its copy and branch are
  removed and the task's `branch` is emptied (`dropCopy`), so copies do not pile up and Tasks stops offering them.

**Failures explained.** `src/core/agent-errors.mjs` translates the failure:
- plan without access, not signed in (including "API key is missing"), model not available, no network or missing program.
- If the task was for "any agent", it moves to another one.

## 7. Live agents

**What it does.** Each conversation or task keeps **one live process** of its agent between turns. The reply streams
in, you can steer it mid-run, interrupt it and approve actions, and the agent's conversation is resumed even if the app
closes.

**The common interface** is in `src/agents/live.mjs`. Every agent implements it:

```
live.send({ text, images }) → { final, text, isError, usage, limit }
live.steer({ text })   live.interrupt()   live.respond(id, 'allow'|'always'|'deny')
live.setModel(m)   live.setPermission(p)   live.close()   live.sessionId   live.caps
events: item · delta · session · approval · approval_done · context · rate · limit · exit
```

| Agent | File | How it connects | Session it uses |
|---|---|---|---|
| Claude Code | `src/agents/claude.mjs` | Official Claude Agent SDK with the user's `claude.exe` (`pathToClaudeCodeExecutable`), streaming input, `canUseTool` for the guard, `rate_limit_event` for real usage and `getContextUsage` for context | `~/.claude` (or the account's folder) |
| Codex | `src/agents/codex.mjs` | `codex app-server`: JSON-RPC over stdio with `thread/start`, `resume` and `fork`, `turn/start`, `steer` and `interrupt`, plus the approval requests and `account/rateLimits` | `~/.codex` (ChatGPT or API key) |
| Cursor | `src/agents/cursor.mjs` | The official CLI with `--stream-partial-output`, one process per turn and `--resume` of the chat. Its SDK needs a separate login, so it is not used | `~/.cursor` |
| Gemini CLI, OpenCode, Qwen Code, GitHub Copilot | `src/agents/acp.mjs` | **ACP** (Agent Client Protocol), one adapter for all: `initialize`, `session/new` or `load`, `session/prompt`, `session/update`, `session/request_permission` and `session/cancel` | Each program's own |

**Registry.** `src/agents/index.mjs` gathers the adapters. It holds `adapter()`, `executable()`, `installed()` (with a
30 s cache) and `status()` (version and session for the Agents screen).

**Adding a new ACP agent:**
1. An entry in `ACP_SPECS` in `acp.mjs`: package, binary, ACP arguments, login files, how to install it and models.
2. Its id in `AGENT_IDS` and `DEFAULT_CONFIG.agents` in `src/core/home.mjs`.
3. Its icon in `src/ui/components/agent-icon.jsx`.
4. Its installer item in `src/engine/installer.mjs`.

## 8. Permission guard and approvals

**What it does.** It balances being able to do things with safety. For each agent action it decides:
- **allow** the normal stuff: reading, editing in its folder and ordinary commands;
- **ask** about risky things with an Allow, Always allow or Deny card: push, `gh`, publishing packages, download and
  run, sending data, deleting folders, changing the system, killing processes, ssh, rewriting git or Docker;
- **deny** what is never OK: touching the assistant's internal data (all of `core`, but the isolated copies).

**Permission modes.**

| Mode | What it can do |
|---|---|
| `leer` | Only look |
| `editar` | Default. Edits and runs; risky things ask |
| `preguntar` | Asks before every command |
| `total` | No checks. Only from the PC and with confirmation |

**Files.**
- Decision: `src/core/guard.mjs` (`decide`, `RISKY` and `riskOf`).
- Each adapter calls it at its permission point: `canUseTool` in Claude, `requestApproval` in Codex and
  `request_permission` in ACP.
- Cards:
  - in conversations, `ApprovalCard` in `src/ui/views/session.jsx`;
  - in the chat, `ChatApproval` in `chat.jsx` (the tasks' ones);
  - in the sidebar, "To approve".
- Engine: `sessions.respond()`, `approvals.list` and `chat.approve`.

**How to rework it.**
- Adding or removing risky commands: the `RISKY` list in `guard.mjs`, one line per rule with its reason.
- A task waiting for permission also notifies in the chat (`sessions.onApproval` in `engine.mjs`).

## 9. Direct conversations

**What it does.** You talk directly to an agent in a project folder. You see:
- the streamed reply;
- the commands (with an icon per tool) and the changed files;
- token usage (including cache).

From the header you can change the model, permissions and reasoning. Without a project, it can only read.

**Files.**
- Interface: `src/ui/views/session.jsx` (`newConversation`, `SessionView`, blocks and cards).
- Engine: `src/engine/sessions.mjs` (`create`, `send`, `message`, `getLive`, `onLiveEvent`, paginated `items`).
- Tasks use the same machinery: each task has its conversation.

**Inside.**
- `getLive` creates the live process the first time. To resume, it uses `resumeId` = `sessions.cli_session`, the id of
  the agent's own conversation.
- A process idle for 20 min is closed (`IDLE_CLOSE_MS`) and resumed on the next message.
- With no model chosen, the agent's `defaultModel` is used (Sonnet for Claude), never its program's default, which may
  be the most expensive.

## 10. Queue and live steering

**What it does.** While the agent is working:
- **Enter** steers it on the fly: it reads it on its next step, in the same turn. Works with Claude (`next` priority)
  and Codex (`turn/steer`).
- **Ctrl+Enter** puts the message **in the queue**, sent in order when the turn ends. The queue can be edited, reordered
  and cleared.
- Agents that cannot be steered mid-run always queue.

**Files.**
- `sessions.mjs`: `message()`, `enqueue()`, `editQueued()` and `takeQueued()`.
- Table `session_queue`.
- Interface: the "Queued" block in `session.jsx` and the message box placeholder.
- The assistant can also be steered mid-run (`Orchestrator.ask`).

## 11. Fork, continue and details

- **Fork** copies the conversation from this point to try another idea. Claude and Codex carry their full history
  natively (`forkSession`, `thread/fork`). The others start with a summary. Code: `sessions.fork()` and the button with
  the fork icon.
- **Continue:** a conversation left halfway (the app closed) or at its usage limit shows "Continue" (`sessions.resume()`).
- **Details** ("i" icon): agent, account, permissions, folder, git branch and changes, pull requests, context, task,
  where it comes from and the id of the agent's conversation (`showDetails()` in `session.jsx`).
- **Paginated history:** the last 200 messages are loaded and "See earlier messages" brings more
  (`sessions.items({ before })`).

## 12. Context and real usage

**What it does.** It is the middle ground between working and not burning tokens.
- **Context meter** in each conversation and in the chat. The fuller it is, the more each reply costs.
- **Real usage:** Claude and Codex report how much of their window (5 hours, week) you have used and when it resets.
  From `budget.stopAt` (92 %), new work waits or goes to another account.
- **Safety net:** 20 tasks per window and 6 with expensive models per account.
- Optional spend caps per task (`maxBudgetUsd`) and approval for high reasoning.

**Files.**
- `src/core/budget.mjs`:
  - `recordRate` and `realRate` (real usage);
  - `canLaunch` and `rankAccounts` (decision and order);
  - `startCooldown` (pause until the reset).
- Data source: the adapters' `rate` events, in `sessions.onRate` (`engine.mjs`) and the brain's
  (`orchestrator.onEvent`).
- Screens: Agents ("Usage per account") and Settings ("Quota usage limit (%)").

**The context ring and the usage panel.**
- Next to the send button, `ContextMeter` (`src/ui/views/session.jsx`) is a ring that fills up; clicking it,
  `UsagePanel` requests `usage.now` (`api.mjs`): the brain, the accounts with running sessions and the ones that
  reported recently.
- Each plan window is stored separately in `rates:<account>` (`recordRate` → `rateWindows`, shortest first). Single-model
  windows (`seven_day_opus`, `seven_day_fable`…) are only shown: they do not stop the account (`rate:<account>`).
- Claude only sends its usage near the limit: `planUsage` (`claude.mjs`) requests it after each turn, at most every
  90 s, with the SDK's experimental call. Codex sends its two windows (primary and secondary) in
  `account/rateLimits/updated`.

**Saving or power.** `budget.profile` (0 = max saving … 4 = max usage; `null` = manual). The slider in
Settings › Agents and usage (`SPEND_PRESETS` in `settings.jsx`) sets the limits, and `persona()` (`orchestrator.mjs`,
`SPEND`) tells the brain how cautious to be. "Advanced options" save with `profile: null`.

**Each agent's real models.** `discoverModels(agent)` (`src/agents/index.mjs`, one per adapter: Agent SDK
`supportedModels`, Codex `model/list`, `cursor-agent --list-models`, ACP `session/new`, `opencode models`) in its own
empty folder, one at a time, at startup (every 12 h), with "Check" and when the picker knows none
(`catalog.mjs`: `refreshModels`, `rememberModels`, which cleans up the names). `checkModel` accepts those models in
tasks, and `models.catalog` is cached for 5 s.

## 13. Limited tasks and continuity

- **Usage limit:**
  - if an account hits its limit, the task does not fail: it stays **"Waiting for quota"** (`limited`) with the reset
    time (`limited_until`);
  - it **continues on its own** when usage resets (`resumeLimited()` in the scheduler), in the same agent conversation;
  - meanwhile, new work goes to other accounts.
- **Closing the app:** tasks that were working continue when it is opened again (the `Scheduler` constructor). On a
  normal close, `shutdown()` sets `scheduler.closing` and `finish()` does not close those tasks: they stay `running` and
  are resumed.
- **Task closed by its agent with the process still alive** when the app crashes: at startup, `finish()` does what was
  left (automatic commit, changed files, log, report) and clears its `pid`, so its dependents can continue.
- Both can be turned off in Settings (`continuity.resumeAtReset` and `continuity.resumeAfterRestart`).

## 14. Delegation between agents

**What it does.** An agent working on a task can hand part of it to another agent or model and wait for the result.
- `orb_delegate` creates a subtask; `orb_wait_tasks` waits up to 15 min and returns the results.
- Subtasks hang from their parent task and show up in the task detail.
- **Trusted delegation** (Settings): if the parent task was created by the assistant or by you, and the subtask has
  nothing risky, it goes straight to the queue, at most `delegation.maxPerTask` (4). Otherwise it waits for your approval.

**Files.**
- `src/mcp/server.mjs`: `delegate()` and `waitTasks()`, available only with `ORB_TASK_ID`.
- `src/core/board.mjs`: `createTask` with `parent_id` and the trust rule.
- Codex raises its MCP tool timeout to 960 s so the wait fits.

## 15. Task Review

**What it does.** Another model audits the work read-only and gives its verdict: **CORRECT** or **WITH ISSUES**, with
the list of problems and what to fix first.
- It goes to **another provider** when there is one: Claude's work is reviewed by Codex, Gemini… Otherwise, the same
  agent with another model.
- It is requested from a finished task or for a whole project.
- The verdict shows up next to the reviewed task.
- **Automatic Task Review** (Settings) reviews every finished task before the report.

**Files.**
- `src/engine/scheduler.mjs`:
  - `reviewer()` picks the reviewer;
  - `createReview()` reviews a task;
  - `reviewProject()` reviews a project;
  - `finishNow()` stores the verdict in `review:<id>`.
- API: `tasks.review` and `projects.review`.
- Interface: `askReview()` in `tasks.jsx` and the button in `projects.jsx`.

## 16. Scheduled tasks

**What it does.** Tasks that repeat on their own: every hour, every N hours, every day or on certain weekdays at a set
time. For example, "every Monday at 9, check the dependencies".
- Each run creates a normal task, with the same approvals and the same usage limit.
- If the previous one is still open, it waits: they do not pile up.
- The ones the assistant creates (`orb_schedule`) need your approval once.

**Files.**
- `src/core/schedules.mjs`: `nextRun`, `createSchedule`, `runDue` (called on each `tick`) and `runSchedule`.
- Table `schedules`.
- Screen: `src/ui/views/schedules.jsx`.
- API: `schedules.*`.

## 17. "@" to attach context

**What it does.** Typing `@` in any message box shows a list of tasks, conversations and logs. The chosen item is added
as a **bounded excerpt**, not in full, and marked as "data, not instructions".

**Files.**
- `src/engine/mentions.mjs`: `mentionOptions` (the list) and `expandMentions` (the excerpts: at most 5 per message and
  about 2500 characters each).
- Interface: `useMentions` in `chat.jsx`.
- Applied in `chat.send` and `sessions.send` (`api.mjs`).

## 18. Report, OK and undo

- When all the tasks of a request in a project finish, the assistant reviews them together (`queueReport`) and gives you
  a report with the **OK** and **Request changes** buttons.
- The OK marks the tasks as accepted and writes it to the log (`accept()` in `api.mjs`).
- **Undo this task** restores only the files the task changed and keeps what you touched afterwards (`undoCheckpoint`
  in `src/core/workspace.mjs`). Each file goes back to how it was on disk (`git cat-file --filters`: `core.autocrlf`
  line endings, Git LFS); only the files the task created are deleted, and one that cannot be read is left in place with
  a warning.
- Snapshots are taken once per task (follow-ups reuse the first one). At startup `pruneCheckpoints()` deletes those of
  tasks finished more than 30 days ago (copy or refs `refs/orb/t<id>-*`) and copies no task uses.
- Safety warnings on finish: if it looks like a push, if it deleted 10 or more files, or if a read-only task changed
  something (`afterFolderTask`).

## 19. Logs

- They are the assistant's memory: one general log and one per project, in `<folder>/bitacora` (the only logs folder),
  outside git.
- **Append-only** at the end, signed and with secrets masked (`redactSecrets`).
- Written by the assistant (`orb_write_log`) and by the scheduler when each task closes (`logTask`).
- Files: `src/engine/logs.mjs` and the screen `src/ui/views/logs.jsx`.

## 20. GitHub

- Uses the official `gh` program with your login:
  - project status, branches and open pull requests;
  - publishing a new project, pushing branches, merging a branch and creating a PR from an isolated task.
- Files: `src/engine/github.mjs`, `src/ui/views/projects.jsx` and the actions in `tasks.jsx`.
- **Agents cannot publish:** their pushes go through the guard (it asks) and publishing from the app is always a button
  you press.

## 21. The agents' browser

- Agents open and test websites, including `localhost`, with the `orb_browser_*` tools: open, read, click, type,
  screenshot, scroll, wait and close.
- It has none of your sessions, and pages cannot open dialogs.
- A **mini window** at the top right shows what they do live.
- Files:
  - `src/core/browser-protocol.mjs` (the actions, page scripts and pipe every driver shares);
  - 3.8.1, Tauri: the browser lives in the engine (`src/engine/host-browser.mjs`, `agent-browser.mjs`, the DevTools
    driver `browser-cdp.mjs`). Its pages are hidden WebView2 views in a browser environment of their own
    (`src-tauri/src/browser.rs`), with no DevTools port: Rust passes the engine's DevTools calls with
    `CallDevToolsProtocolMethod` over the engine's stdio channel and enforces the limits (http(s) only, no other app's
    protocol, no new windows, permissions, downloads or HTTP sign-in prompts, sound off: `browser_rules.rs`). The pages
    live on a thread of their own (an STA with its own message loop), never on the window's UI thread, so a page
    flooding DevTools events cannot slow Orb's window; a page past the flood limits (events, console lines or bytes a
    second) is closed and the agent told. The mini window is `src-tauri/src/pip.rs`, fed by a screencast with one frame
    in flight;
  - the tools in `src/mcp/server.mjs`;
  - `src/core/browser-key.mjs`.

## 22. Mobile

**What it does.** The phone (or a browser on another computer) uses the Orb of this PC: the same interface as a web app
with no store, or the Android app ([`ANDROID.md`](ANDROID.md)). Orb has one owner, so a linked device is the owner away
from the PC. It is turned on in Settings › Magic Link, with two routes that are switched on separately:

| Route | Address | What it allows |
|---|---|---|
| **Home wifi** | `http://<PC local IP>:3131/` | Using it at home with the Android app (a browser page over plain http cannot link, below) |
| **Tailscale** | `https://<pc>.<tailnet>.ts.net:3131/` (with `tailscale serve`) or `http://<Tailscale IP>:3131/` if the tailnet has no HTTPS | Using it away from home; with HTTPS it installs as an app and gets notifications |

- From the phone you can chat and approve, answer permissions, edit the queue, continue and fork, request Task Review,
  manage scheduled tasks and give the OK: the methods `src/core/permissions.mjs` marks `'remote'` (section 34).
  Settings, accounts, backups, Magic Link, full access and this PC's files are PC only.
- On the phone, the menu has **"This phone"**: how to install it as an app and the **notifications** switch.

**Linking: Magic Link** (Settings › Magic Link, `src/ui/views/magic-link.jsx`; API in `src/engine/api-link.mjs`, PC
only):
- `link.qr({ kind, device })` turns the access on if it was off and makes a one-time code for 5 minutes, for one route
  (`kind`: `wifi` or `tailscale`) and one kind of device chosen here by the owner, never by the device (`device`:
  `phone` or `browser`). The QR is `<url>#vincular=<code>&pc=<PC key>&v=4&n=<Orb name>&a=<other addresses>` (after `#`,
  the browser does not send it to any server; the other addresses include `<computer>.local`, for when the wifi address
  changes). `link.qr` also returns `payload` (`{ v, urls, pc, code, name, expiresAt }`), the PC fingerprint and a
  **short code** of 8 letters and digits (`ABCD-EFGH`) to type along with the address. Parsing what the phone scans or
  types: `src/core/link-payload.mjs` (pure, shared by the page and the Android app).
- With the short code, the phone requests `GET /api/hello` (the PC's public key, fingerprint, name and addresses; only
  while a code is on screen) and stretches the code with scrypt, tied to the PC's key (`mobile-crypto.mjs ›
  shortSecret`). It works out the fingerprint itself and asks to confirm it against the PC's screen before the password.
- Linking needs the PC's **master password**, typed on the phone and never sent: `/api/pair` has two steps (`start`
  with the code, `finish` with a password-authenticated key exchange against the PC's verifier) and the device is added
  only at the end. The protocol, the wrong-password rules and what an observer learns are in section 37. Without a
  master password on the PC nothing links.
- Each code is used once; 10 failed attempts from one address in 10 min are refused (429) and 20 in total void the
  code on screen.
- **Linked devices** (table `devices`: `kind` `phone` or `browser`, `route`, `ip`, `meta` with the device's protocol):
  `link.devices`, `link.rename`, `link.revoke` (asks for the master password; cuts its live feed and its calls
  immediately). Another Orb is never linked (`kindForPairing`).
- **Browsers over plain http:** pairing from a browser's page that came over the home wifi in plain http is refused
  (`plainHttpBrowser`): the password would be typed in a page that could have been changed on the way. The Android app,
  https (Tailscale), the Tailscale address and this PC are fine.
- **Home network only:** any connection not coming from 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10 or the Tailscale
  IPv6 is rejected (`privateSource`), as are those arriving through Tailscale Funnel.

**Encryption** (`src/core/mobile-crypto.mjs`, the same code on the PC and on the phone):
- The PC has a fixed X25519 key (kept in the master password's vault, section 37); its public part goes in the QR.
- The phone creates its own key and sends only its public part and a proof sealed with a key derived from the code.
  **The code never travels**: a photographed or copied QR is useless once used, and a link without the phone is
  worthless. The PC's reply is sealed too: the phone checks it is talking to the PC from the QR.
- After that, every request, response, live event and image is encrypted with XChaCha20-Poly1305 under a key that only
  that phone and the PC have. Each message states what it is for and which phone it is from (additional data), and
  carries the time and a nonce: the PC rejects replays, old messages (more than 5 minutes off) and tampered ones.
- **Phone with the wrong time:** if a request's time is more than 5 minutes off the PC's, the PC answers 409 with its
  time (only after opening the request with the phone's key, or the code's when pairing). The phone adopts it and
  retries once.
- It also works over http (wifi), where the browser does not offer its crypto: it uses the `@noble/*` libraries.
- **PC off or out of reach:** every request of the phone has its own time limit (`src/ui/lib/net.js`: quick checks
  8 s, calls 45 s, uploads 60 s, the live stream only until its headers). No answer moves to the PC's next address; a
  call or an upload that ran out of time is not sent again elsewhere (the PC may have done it). When no address answers,
  the app opens on «Tu PC está apagado o no se puede alcanzar» and keeps trying in one loop (`retryLoop`: never two
  tries at once, 3 s, 6 s… up to 30 s, none while the app is hidden, and at once when the phone comes back to the app or
  to a network); «Vincular con otro PC» asks before forgetting the phone's keys. A drop while the app is open shows a
  thin line at the top (`link:offline` / `link:online`): the PC writes a ping on the live stream every 25 s, and a stream
  silent for `TIMEOUTS.eventsIdle` (60 s) is dropped and connected again, as it is when any request reaches the PC again.
  If Orb cannot start on the phone, its error screen offers «Reintentar» and «Vincular con otro PC».
- **Notifications offered at the right time:** right after linking, the phone offers them once (`NotifyOffer` in
  `main.jsx`), saying what they do: in the Android app only while it stays alive in the background (no push service:
  `push.whenClosed()` is false), in a browser with Web Push also with the page closed.
- **Navigation on the phone (`src/ui/lib/phone-nav.js`):** the app opens on its chat list unless it was left in a chat
  that still exists or on one of its tabs; routes of screens that are gone (such as the bots of 3.7) fall back to the
  chats; a screen that fails to draw forgets the saved route (`ErrorBoundary`). Android's back (handed over by
  `OrbNativePlugin`) and a phone browser's back close what is open, then go up one level (a task opened from a chat
  back to that chat: its route keeps `from`), and only leave from the chats (twice; the app goes to the background).
  While linking the app, back goes from the password to scanning and closes «Enlazar sin cámara». `OrbNativePlugin`
  replaces the launch intent only after a share, so a notification's action that starts the app reaches the
  notifications plugin.
- Removing a device deletes its key: it is locked out immediately. Devices linked before 3.8 never proved the master
  password and are unlinked once at the first start of 3.8 (`relink_38`, section 37); phones from 2.3.2 or earlier (no
  own key) are dropped at start.

**Notifications** (`src/engine/webpush.mjs`): HTTPS only (Tailscale with HTTPS) for a browser. The phone subscribes from
"This phone" and the PC sends notifications directly to the browser's push service (Google, Apple, Mozilla) with Web
Push: encrypted for that phone (RFC 8291) and signed with the PC's VAPID key (RFC 8292). No servers of our own and no
cost. It notifies each new message in the Orb chat (replies, tasks waiting for approval, finished or failed) when that
phone does not have the app open. On iPhone they work with Orb added to the home screen. `mobile.preview` (`all`,
`chat` by default, `none`; `remote.configure`) sets what a notification shows on a locked phone
(`src/core/notes.mjs › buildNote`). The Android app shows its own notifications ([`ANDROID.md`](ANDROID.md)).

**Inside** (`src/engine/remote.mjs`):
- One http server per address: each private local IP (no virtual adapters) and the Tailscale one, or 127.0.0.1 behind
  `tailscale serve --https=<port>`. Turning access off removes that `tailscale serve` configuration.
- It only answers to its own names (against DNS rebinding) and its own origin, plus the Android app's page
  (`http://localhost`, with CORS).
- Every call goes through `guardCall` (`REMOTE_METHODS`, pictures, full-access rules) and every answer through
  `withoutPaths` (no PC folders on the phone, section 28).
- Every minute it checks whether the network changed (another wifi, another IP) and reopens access.
- The first time it listens on the local network, Windows may ask about the firewall: private networks must be
  allowed. Ajustes does not warn about it in advance (3.8.2): when a device cannot reach any local-network address
  while linking, its error says so (`app.linkOfflineWifi`, `src/ui/lib/web-bridge.js`). If the PC's local IP changes, a phone linked over wifi falls back to `<computer>.local` or the other
  addresses from its QR; a fixed IP on the router avoids it.
- Files: `src/engine/remote.mjs`, `src/engine/api-link.mjs`, `src/engine/webpush.mjs`, `src/core/mobile-crypto.mjs`,
  `src/core/link-payload.mjs`, `src/ui/lib/web-bridge.js`, `src/ui/views/magic-link.jsx` and the "Magic Link" and "This
  phone" cards in `src/ui/views/settings.jsx`. Tests: `test/remote.test.mjs`, `test/webpush.test.mjs`,
  `test/link-ui.test.mjs`, `test/movil-ui.test.mjs`, `test/android.test.mjs`, `test/contrasena-maestra.test.mjs` and
  `test/mobile.e2e.mjs`.
- Pending, on hold: using it from anywhere without Tailscale through our own relay on Cloudflare
  ([`MOBILE-RELAY.md`](MOBILE-RELAY.md)).

## 23. God mode (expert view)

- File explorer and viewer, git changes with their diff, history, what is running, account usage, machine load and
  activity, around the chat. PC only.
- It is turned on in Settings › Advanced › God mode; the panels can only be ticked with the mode on.
- Files: `src/engine/expert.mjs` and `src/ui/views/expert.jsx`.
- **"Open in":** the project in Cursor or VS Code (only the installed ones) or in Explorer (`src/engine/editors.mjs`,
  `app.openIn`; programs are launched directly, never through cmd.exe, and by the app — `host.openEditor`,
  `host.openTerminal`, `host.runAction`: the engine names the kind and the folder, the app picks the program by its
  absolute path — so they outlive Orb). core itself and `core\secretos` open in Explorer only with a fresh unlock of the
  master password.
- **Project actions:** each project's own commands (`actions:<project>` on the board, at most 20;
  `actions.list/save/remove`) with a name, a keyboard shortcut and an optional preview, which can only be a page on this
  PC. They are launched from "Actions" or with their shortcut (`ActionShortcuts`: the God mode project, or the working
  folder outside it) in their own terminal window (`app:runAction`: Windows Terminal or PowerShell; CMD if chosen in
  Settings). PC only: the phone cannot launch them.
- The God mode chat is a conversation of the chosen project (the last one opened, or a new one in it) and
  starting one does not leave God mode.

## 24. Installer and session detection

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
- `src/engine/installer.mjs`: `ITEMS`, `check()` and the PowerShell script.
- Each adapter's `detect()` and `loginState()` (for example, the Codex session is in `~/.codex/auth.json`).
- `src/core/accounts.mjs`: several accounts per agent; each one has its login folder and its usage.

## 25. Skills and MCP servers

3.8.1, the owner's definition: **`core\skills` holds every skill and `core\mcp` every MCP server** (the ones Orb installs
and the ones the user writes). Agents never write in core; the only way in is through the user (Settings, «Importar»)
or an agent's request the user approves. `src/core/extensions.mjs` does the work (no engine imports: the engine, the
agents' MCP server, «Ordenar carpetas» and the tests use it); `src/engine/api-extensions.mjs` is its API (PC only).

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
  reference (`orb-secret:mcp/<connector>/<NAME>`, `src/core/connector-secrets.mjs`); the engine puts the value back only
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

## 26. Languages

- The app is in Spain Spanish and English (Settings → Language, applied immediately).
- Files:
  - base: `src/core/i18n.mjs` (`translate`, `createT`, `localeOf`);
  - dictionaries: one file per area in `src/core/locales/es/` and `en/` (chat, session, tasks, agents,
    settings, setup, msg…), gathered by `es.mjs` and `en.mjs`;
  - interface: `src/ui/lib/i18n.js` (`useT()` and `useLocale()` in components, `t()` and `currentLocale()` outside them);
  - engine: `tr()` from `src/core/context.mjs` (chat notices, errors and guard reasons in the chosen language).
- **Adding a string:** write `t('screen.key')` in the component and add the key to **both** dictionaries. A test checks
  they match.
- What goes to the agents (briefs, assistant instructions) is not translated: the reply language is set by
  `config.language`.

## 27. Interface

- **Sidebar:** assistant, Tasks, Projects, Scheduled (and at the bottom Agents, Logs, Activity, Tutorials and Settings)
  and, below:
  - the **inbox**: "To approve" (permissions and approvals), "In progress" and "Issues" (tasks at their usage limit and
    interrupted or failed conversations; "Mark as resolved" removes them);
  - the **folders** (each project with its tasks and conversations) and "No folder".
  - File: `src/ui/components/sidebar.jsx`. The Tasks filters use the same names (`FILTERS` in
    `src/ui/views/tasks.jsx`): In progress (working or queued), To approve, Completed, Issues, All.
- **Look:** shadcn/ui, Tailwind and the Outfit font, with colors in `src/ui/app.css`.
  - Base components in `src/ui/components/ui/` (buttons, cards, selects, checkboxes and switches with fixed dark mode).
  - Real agent logos in `agent-icon.jsx` (Simple Icons, CC0).
  - Animated robot in `robot.jsx`.
- **Mode** light, dark or system; interface **size** with Ctrl +, Ctrl - and Ctrl 0; **Ctrl J** opens a terminal in the
  folder.
- **Wording:** tone and vocabulary in [`WRITING-GUIDE.md`](WRITING-GUIDE.md).

### Performance (3.8.1)

- **Lazy screens** (`main.jsx`): only the chats, a conversation and the start's master password screen are in the
  entry chunk. The other screens, Settings, the games and the tour are lazy chunks (`lazyScreen` in `lib/lazy.js`) that
  load in the background once the app is up (`loadTheRest`, on the phone too); Settings and the games mount the first
  time they open and then stay (`OnceOpened`). A failed load (a phone's browser gets the files from the PC over the
  network) is not kept: the `ErrorBoundary` recognises it (`isLoadError`) and shows «Sin conexión» with «Reintentar»,
  which makes the screen again (`retryLoads`; the same file with a query if the browser kept the failure; after two
  failed retries, a reload). Settings, the games and the tour have their own boundary: they close and say why.
- **Long lists:** messages (`.lazy-lines`, all but the newest twelve) and chat rows (`.lazy-row`) use
  `content-visibility: auto` (app.css); the chat list draws its first 40 rows with the screen and the rest while idle
  (`useGrowing` in `views/orb/inbox.jsx`). A conversation at its bottom stays there when its lines change height
  (`useAutoScroll` in `chat.jsx`: a `ResizeObserver` while the user has not scrolled up).
- **Fewer redraws:** `Markdown` is memoised on its text, a refetched conversation keeps unchanged lines, an agent's
  blocks compare by content and a chat row only redraws when what it shows changes (`keepSame`, `sameBlock`,
  `sameItem` in `lib/memo.js`, tested in `test/memo-ui.test.mjs`); the models' catalog stays the same object while it
  does not change (`useCatalog`). `chat:state` events are applied once per frame, or within 100 ms and on
  `visibilitychange` when the window draws no frames (`frameBatch` in `lib/batch.js`). Memoised dates move on at
  midnight and with a new time zone (`lib/clock.js`, `useDay`), and the date formatters are cached per language and
  zone.
- **Refreshes as changes:** the lists of every refresh (`tasks.list`, `conversations.list`, `sessions.list`,
  `projects.list` and the chat list's `inbox.list`) take an optional `since: { epoch, v }`. The engine keeps one `Feed`
  per kind of caller (this PC; linked devices in a small cache of their own, so they never push the PC's feeds out),
  method and the parameters that change the list, normalised (any other is ignored) (`src/core/feed.mjs`,
  `src/engine/feeds.mjs`): each row carries the version at which its JSON
  last changed, and gone rows, the order of the keys and the rest of the reply (`meta`) carry one too, so a caller gets
  only what moved since its version (`{ feed, epoch, v, base, rows, gone?, order?, meta? }`), or the whole list (`full`)
  when it is new, of another engine run or too far behind. In a feed, `tasks.list` rows are compact (no brief, result,
  folders or approval fields: the task's screen reads `tasks.get`). Without `since` every method answers as before
  (older phone apps), and `applyFeed` takes a plain reply whole (an older PC). `store.js` applies the replies
  (`applyFeed` keeps the same array and row objects when nothing moved), runs one refresh and one chat-list load at a
  time (`oneAtATime`) and groups the engine's events (120 ms after the last one, at most 1 s after the first). Parity
  is tested in `test/feed.test.mjs` (random changes, callers far behind, the engine, the phone's path stripping).
- **Robot:** a still robot has no compositor layer and builds the visor's code rows only the first time it shows them
  (`orb.jsx`, app.css). Avoid `will-change`, `backdrop-filter` and blend modes on elements repeated in long lists.
- **Idle animations:** while anything on screen moves (the robot floating, its LED, the «orb» theme's clouds) the
  compositor draws every frame, so what matters is the GPU cost of each frame, not style work (≈1–5 ms/s of style
  recalculation at rest). The robot's moves are compositor-only: `transform`/`translate`/`opacity` on HTML elements
  (looking around and peeking move an HTML box around the face's SVG, not the eyes' group; the visor's glint moves with `translate`, not
  `left`); only blinking and talking scale the SVG eyes on the main thread. A robot out of view or in a hidden window
  pauses its animations and schedules no blinks or gestures (`useOnScreen`: one shared `IntersectionObserver`,
  `data-away`). The robot floats and its LED pulses only while something happens (3.8.1, H4e: thinking, talking, a
  mood, agents working, the pointer over it, hello, a random moment every 30–90 s): `data-float`/`data-glow`, set by
  `orb.jsx` and taken away at the end of the sway or pulse in progress (`animationiteration`), where both are at rest,
  so it never jumps. At rest it only blinks (a few main-thread frames every 3–6 s): with nothing else moving the
  compositor draws ~2–10 frames a second instead of 60. The «orb» theme blurs each cloud itself (`filter: blur(8px)`) instead of a full-screen
  `backdrop-filter` that had to blur everything under it again on every frame. Avoid full-screen `backdrop-filter`
  over anything that moves. The clouds drift ~0.5 px per 60 Hz frame, so they step 30 times a second (3.8.1, H4f:
  `steps(dur × 30)` with whole-second durations and delays, so the three clouds step on the same instants and the
  compositor draws ~30 frames a second instead of 60; each step is ~1 px under an 8 px blur). Slow
  `background-position` drifts, which repaint on the main thread, step every ~0.5 px (the Candy band); fast ones move a
  pre-drawn layer with `transform` instead (the Vaporwave floor's grid); the indeterminate progress bar slides with
  `translate`, not `left`. The themes' backdrop pauses while the window is unfocused or hidden (`html.window-idle`).
- **Measuring:** `scripts/medir.mjs` (start, memory, CPU at rest, scrolling smoothness; `--hidden` keeps the window
  offscreen via `ORB_HIDDEN_WINDOW=1`; `--profile <dir>` saves a trace, CPU profiles, the compositor's layers and a
  heap snapshot; `--big` uses a large workspace and times refreshes on the Tasks screen; `--anim <s>` / `--anim-only` measure
  idle animations: main thread, renderer and GPU CPU and, with `--profile`, frames per second and GPU ms per frame,
  plus the robot floating under the pointer with its dropped frames; `--quiet-scene` pauses the theme's backdrop; `--css <file>` adds a style sheet to try a variant on the same build; `--ui <json>` saves an interface setting first, e.g. another theme) and `scripts/medir-motor.mjs`
  (the engine alone: start, memory, call latency and the bytes of a refresh, whole and as feeds, also as a phone gets it).

### Tutorials and guided tour

- **Tutorials** (`src/ui/views/tutorials.jsx`, "Tutorials" menu entry, `tutorials` view): cards per topic
  (`TUTORIALS`: id, icon, number of lines and the screen its button leads to with `go()` / `openSettings()`), keyboard
  shortcuts and FAQs in collapsibles, all filtered by the search box (ignoring accents and case). The strings are in
  `src/core/locales/{es,en}/help.mjs` (`help.tut.<id>.title`, `.l1…`, `.go`; `help.key.<n>.k/.v`; `help.faq.<n>.q/.a`).
  To add a tutorial: an entry in `TUTORIALS` and its keys in both languages.
- **Guided tour** (`src/ui/components/tour.jsx`): the full-body robot (the one from the notices) walks through the app
  step by step. `TOUR_STEPS` lists each step with the `data-testid` of the control it highlights (a `.tour-spot` ring
  whose shadow darkens the rest without catching clicks), the view to show first (`go(view)`) and its strings
  (`help.tour.<id>.title/.text`). Steps whose control is not on screen are skipped (the context ring before the first
  reply, the side menu in narrow windows). Keyboard: Esc skips, ← → move, Tab stays in the bubble. Without animations
  the robot stays still; in the "professional" theme only the bubbles show (styled with the help bubbles' `--tip-*`
  variables, in `app.css`).
- It starts on its own on the first open after the welcome (`Shell` in `main.jsx`, never on the phone) and from "Replay
  the guided tour" in Tutorials (`startTour()` in `store.js`). When finished or skipped, `endTour()` saves
  `ui.tourDone: true` in `orb.json` (`config.save`; `validateConfig` accepts it as a boolean), so it is per assistant
  folder and does not show again. Tests that create a folder with `createHome` write `ui.tourDone` before opening the
  app; `test/app.e2e.mjs` does see it start, advances one step and skips it.

### Settings

- **Window over the app** (`SettingsDialog` in `src/ui/views/settings.jsx`), with sections on the left (`SECTIONS`) and,
  at the bottom, the developer's GitHub and the version. It opens with `openSettings(section)` from
  `src/ui/lib/store.js`; `go('settings')` opens it too. On the phone there is no Settings ("This phone").
- **Appearance** (`src/core/appearance.mjs`): `ui.skin` (orb, vaporwave, retro, profesional, nube), `ui.font`,
  `ui.codeFont` and `ui.codeTheme`. `applyAppearance()` puts them on `<html>` as `data-skin`, `data-font`,
  `data-code-font` and `data-code-theme`, and the CSS reads them: `src/ui/themes.css` (themes; "professional" removes
  the robot in `robot.jsx`, the floating robot, decorative animations and sounds), `src/ui/fonts.css` (typefaces, latin
  and latin-ext only) and `src/ui/code.css` (code colors). Highlighting (`src/ui/lib/highlight.js`, highlight.js with
  common languages) is loaded the first time it is needed (`use-highlight.js`).
- **Window without the Windows title bar:** `titleBarStyle: 'hidden'`. Minimize, maximize and close are drawn by
  `src/ui/components/window-controls.jsx` (the `window_act` command and the `app:window-state` event:
  `src-tauri/src/window.rs`, `src/ui/lib/tauri-bridge.js`), styled per theme in `themes.css` (`.win-control`); `--wco-inset` is their fixed width with
  `html.has-win-controls`. The top bars (`.app-titlebar` in `app.css`) move the window
  (double-click: maximize) and leave room for the buttons (`--wco-inset`, `.wco-pad`). Without the Windows bar there is
  no menu bar (the old `ui.menuBar` setting is dropped when orb.json loads); its shortcuts (zoom, Ctrl+J, F11) live in
  `tauri-bridge.js`. F5 reloads the window (`main.jsx`, `lib/reload.js`): the engine keeps running and the unsent text
  of the message boxes comes back on the same screen.
- **Contribute and More apps** (`src/engine/feedback.mjs`, `app.feedbackSend` / `app.moreApps`, in the engine because the
  window does not go out to the internet; the screenshot and the picked files come from the app): the developer's PayPal; feedback via FormSubmit (to the developer's inbox) with up to 3 PNG/JPEG
  screenshots of the window or from files; and the other apps with their latest version from GitHub Releases.

## 28. Security

- **Window:** `sandbox` and context isolation, CSP without `eval`, Markdown is rendered without HTML and every call is
  checked by the app (Rust) and the engine.
- **Approval key:** encrypted by Windows (DPAPI). The engine receives it only in memory and the MCP never has it.
- **Agent identity (`src/engine/agent-auth.mjs`):** who an agent's MCP process is lives only in the engine's
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
- **The user's connectors:** an agent gets `src/mcp/launch.mjs` and a ticket instead of the connector; the
  launcher gets the real command, arguments and keys from the engine and starts it (and stops its whole tree when the
  ticket is taken back). On Windows (`src/mcp/win-spawn.mjs`) an npm shim (`npx.cmd`, a global package's cmd-shim) runs
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

## 29. Packaging, versions and CI

The user's WEBVIEW2_* variables are dropped before any webview starts (also names that are not valid Unicode); WebView2
policies set by an administrator in the registry (HKLM/HKCU \Software\Policies\Microsoft\Edge\WebView2) still apply and
are not overridden: they are the PC owner's.

- **Windows installer** (Tauri, NSIS, per user, no admin): `npm run tauri:build`. Next to `Orb.exe` it carries `node\`
  (Node 24, checked against its pinned SHA-256) and `app\` (the engine's `src`, the built window, the Claude SDK, `zod`
  and `@noble/*`): `scripts/tauri-resources.mjs`. The e2e build (`npm run tauri:build:e2e`, cargo feature `e2e`, its own
  target folder) is the only one with a DevTools port, a hidden window, a local update feed and timing marks, and it
  trusts only the test updater key; `scripts/tauri-check-release.mjs` refuses a release `Orb.exe` with any of them.
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
  `none`, `error`, `off`. A card at the top right (below the header: it does not cover the menu or the text box) and an "Updates" card in Settings.
- **Restart and install**: if tasks are running it asks first; then the pre-update backup (one at a time: a second asker
  waits for it) and the installer. With "Later" it installs when Orb closes, only once that backup is done (it is
  finished before the engine stops; otherwise the next start offers the version again).
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
  fake install; `test/tauri-actualizar.e2e.mjs` checks Tauri → Tauri against a local feed.

## 30. Tests

| Command | What it covers |
|---|---|
| `npm test` | Every `test/*.test.mjs` (including that the es/en dictionaries match and that the English has no Spanish) of the engine with fake agents (`test/fixtures/fake-live.mjs` via `ORB_FAKE_AGENTS`), the real protocols against fake servers (ACP, codex app-server, Cursor CLI), the guard, sessions, tasks, delegation, Task Review, usage, permissions, the phone access, the master password and migrations |
| `cd src-tauri && cargo test --lib` | The app's Rust: sealing (and Orb 3.8.0's real Electron from the build cache, `ORB_TEST_ELECTRON`), stdio, guards, delete, notices |
| `npm run test:app` | The whole app on the e2e build (`npm run tauri:build:e2e` first), its window hidden, driven over CDP (`test/fixtures/launch-orb.mjs`) |
| `node test/smoke.e2e.mjs` | The packaged app: the e2e build hidden; a release build only in CI (`--visible`), engine and MCP server |
| `node test/tauri-navegador.e2e.mjs` | The agents' browser on real WebView2 (hidden): limits, isolation, a flooding page |
| `node test/tauri-actualizar.e2e.mjs` · `node test/puente-ganchos.e2e.mjs` · `node test/puente-electron.e2e.mjs` | Updates (test key, local feed), the installer's hooks, and the bridge from an installed 3.8.0 (hidden desktop) |
| `node scripts/medir.mjs --hidden` | Performance of the e2e build (`--shell electron --exe <copy of 3.8.0>`: the baseline): start, memory, CPU at rest and scrolling (§27, Performance) |
| `node test/explora.e2e.mjs` | Walkthrough with screenshots in `test-results/explora/`: first launch ("Preparing your PC", with the folder dialog mocked), every view and Settings section in day and night, the five themes, narrow window. With `ORB_LANG=en`, the same in English (`explora-en/`). Notes go to `notas.txt` |
| `node test/real.e2e.mjs claude,codex,cursor` | **Real agents**: conversations, assistant task, report, undo, approval, steering, queue, fork, Task Review and scheduled tasks |
| `node test/packaged-live.e2e.mjs` | The packaged app with real Claude (by hand) |

## 31. How to rework a feature

1. Find the feature in this document and open only its files.
2. Respect the contracts between layers:
   - the live session interface (`live.mjs`);
   - the API actions (`api.mjs`: name and parameters);
   - the events (`session:item`, `session:delta`, `session:queue`, `approval:changed`, `chat:state`, `board:changed`);
   - the `db.mjs` tables (add columns with `ADDED`, never delete them).
3. Give every new API method its line in `METHODS` (`src/core/permissions.mjs`, section 34): `'remote'` if the phone
   may use it, `'pc'` otherwise.
4. New strings with `t()` in both languages.
5. A test in `test/` with the fake agent (`fake-live.mjs` recognizes keywords like `LIMITE`, `PIDE_PERMISO`,
   `DELEGA`, `DUERME`…).
6. `npm run check` and `npm test` green before pushing.

## 32. The CORE

The CORE is Orb's heart: request → Orbe plans → tasks → agents working at the same time → pieces merged → verification
→ report → OK. It is built so that agents do not wait for each other, an unanswered permission does not run out the clock, an agent
that is not installed is never assigned and every agent can close its task.

- **Only available agents** (`Scheduler.refreshAvailable` → setting `agents_available`; `Board.checkAvailable`): Orbe,
  the `orb_*` tools, the app and scheduled tasks only offer and accept agents that are enabled, installed and have an
  account. A queued task for an agent that disappears moves to any agent (except sensitive ones).
- **Accounts and plans** (`engine/plans.mjs`): each account's plan is read from the agent itself (Claude:
  `.credentials.json`, only `subscriptionType`/`rateLimitTier`; Codex: `account/read`; Cursor: `about`). `budget.mjs`
  scales task limits by plan (`PLAN_FACTOR`); the real usage Claude and Codex report still rules. Tasks that write code
  never get a light model (`chooseModel({ writes })`).
- **At the same time** (`Scheduler.tick` → `launch({ isolate })`): if another task is already writing in the folder,
  the new one works in its own copy (worktree) and when it finishes Orb merges it into the folder (`integratePending` →
  `workspace.integrateInto`: three-way merge with `git merge-tree`, all or nothing, without touching branches or the
  index; with a snapshot for undo). If they conflict, a merge task resolves it by hand. Dependents wait for the merge
  (`Board.depsDone`). "One task at a time" (`oneAtATime`) turns it off. Subtasks of an isolated task work in their
  parent's copy.
- **Orb in the middle:** messages between agents delivered mid-run (`deliverMessages`: Claude and Codex get them on their
  next step; those addressed to "orb" reach Orbe as a notice). Cursor gets Orb's tools through a temporary
  `.cursor/mcp.json` (the keys go in an `envFile` outside the project) and the guard rules as `deny` rules in
  `.cursor/cli.json` (`cursorRules`), only during its turn. Each brief carries the files each dependency changed and
  which other tasks are working at the same time.
- **Nothing stalled with the clock running** (`Sessions.watchRun`): the time limit counts only work, not permission
  waits; a permission unanswered within `approvalWaitMinutes` (10 by default) is denied and the agent carries on; a task
  that runs over time is blocked "for review" with its work; an agent that closes its task and does not end its program
  is released (`releaseClosed`); after 10 min of silence it is asked. A task that goes back to the queue continues its
  own conversation. Failed notices to Orbe are retried and the report is never lost.
- **Reviewing is testing:** read-only tasks use the `probar` permission (commands yes, changing files no) and
  verification starts the project and opens the website with `orb_browser_*`.
- **Clear notices:** permissions are explained in plain words (`guard.plainAction`) with the command collapsed, and the
  end of each task is one line with what it did collapsed underneath.
- **Tests:** `test/core-orb.test.mjs` (fake agents) and the real test `test-results/core-real.mjs` with real agents,
  measured with `test-results/informe-core.mjs`.
- **Development control line** (`engine/dev-control.mjs`, `scripts/orb-dev.mjs`): only in unpackaged Orb.dev and with
  `ORB_DEV_CONTROL=1` (`npm run start:control`). It lets you watch and drive the app from the terminal (status, watch,
  approve, allow, send, reply). Local, with a key; the installed Orb never opens it.

## 33. Conversations

**What it does.** Each conversation with the assistant is its own: it has a title, project, brain and status, shows up
in the side menu and can be resumed whenever you want. The assistant can reply in several at once, and each task
belongs to the conversation that asked for it: its report goes back there.

**Files.**
- Data: table `conversations` (`src/core/db.mjs`); `chat.conversation_id` and `tasks.conversation_id`. Board
  (`src/core/board.mjs`): `createConversation`, `updateConversation`, `setConversationDone`, `setConversationProject`,
  `conversationOfTask` (the task's own, or that of the task it comes from: subtask, review, merge) and `openTasksOf`.
  `addChat(role, body, meta, conversation)` infers the conversation from `meta.task` when not given.
- Engine: `src/engine/orchestrator.mjs`. `Orchestrator` keeps one `Lane` per conversation (queue, live process, live
  text); up to `orchestrator.parallel` (3 by default) reply at once and the rest wait their turn.
- Titles: `src/core/titles.mjs` (a quick one taken from the first message) and `src/engine/titles.mjs` (the lightest
  model of the conversation's agent writes one of 2 to 5 words; not with the test agents).
- Project icons: `src/engine/project-icons.mjs` (the one chosen in Orb, stored in `core/iconos`; otherwise, the
  favicon or app icon found in the folder) and `src/ui/components/project-icon.jsx` (with no icon, its initials in a
  color fixed for that name).
- Interface: `src/ui/components/sidebar.jsx` (search box with filter, "To approve", Projects, Conversations and
  Completed, each conversation's bubble), `src/ui/views/chat.jsx` (`ChatView` by `route.id`, `BarTitle` and
  `BarHeading` in the middle of the bar) and `src/ui/views/session.jsx` (the same bar in direct conversations).

**Inside.**
- **Context:** each conversation stores the id of its agent's conversation (`session_id`), its turns and how full its
  context is. A conversation resumed after more than 6 h starts fresh with the usual summary (logs, project,
  whiteboard) and its last messages, without loading the whole long conversation: the logs are the memory. The process
  of an unused conversation is closed after 10 minutes and resumed when you type.
- **Orbe's tools:** its MCP server's grant names its conversation: its questions go to `pending_questions:<id>`, its tasks
  to that conversation, and `orb_set_project` sets that conversation's project (and the working folder for the next
  ones). A conversation without a project takes the one from its first task.
- **Reports:** `queueReport` waits for all of the conversation's tasks to finish and notifies in it. Whatever belongs to
  no conversation (old tasks or those of a scheduled task) goes to the last conversation of its project or to a
  new one. Pending notices keep their conversation (`orchestrator_pending`).
- **Completed:** a finished or cancelled task moves to "Completed" on its own (it can be brought back: `sidebar_kept`).
  A conversation is completed with the OK of its report if it has nothing left open, or after a day with no activity
  and nothing pending; a direct one, after a day with no activity. Typing in a completed one reopens it.
- **Search:** filters in the window itself by title, project and task number, and `conversations.search` also searches
  the messages (of both assistant and direct conversations).
- **Old data:** the first time (a database from before 3.2), the old chat is split at its "New conversation" markers into conversations (the earlier
  ones completed; the last one stays open with the assistant's live session) and the assistant's tasks are distributed
  by date.

## 34. Permissions

**What it does.** One PC, one owner. Who may do what is decided in one place, `src/core/permissions.mjs`, for three
kinds of caller:
- **This PC** (its Orb window, dev-control and the engine itself): every method.
- **A linked phone or browser** (Magic Link): only the methods the table `METHODS` marks `'remote'` (view chats, tasks
  and projects, send messages, approve or reject, start and stop tasks, read the status…). Settings, accounts, backups,
  Magic Link, this PC's tools and anything that deletes outside a conversation are `'pc'`.
- **An agent** (its MCP tools, `src/mcp/server.mjs`): no API method. Its tools act only on what Orb signed it for
  (`ownsTask`): the coordinator, the tasks of its own conversation (signed with that conversation's key); a worker, its
  task and the subtasks it delegated; a direct conversation with an agent, only the manual task that conversation
  claimed (`orb_claim_next`, offered to direct conversations only; `tasks.claimed_session`). An agent Orb did not sign,
  a signature that ended (its process closed, its conversation deleted), a coordinator without a conversation or with
  another conversation's key gets every tool refused. The lists (`orb_board`, `orb_list_tasks`) show a worker its own
  tasks and a coordinator its conversation's and its projects'; messages are read and delivered only inside the
  conversation of the task they are about (a message to another agent must name one of the sender's tasks); the
  coordinator reads and writes the logs of its conversation's projects and the general one; only the coordinator
  registers projects.

A phone or a browser changes the brain of one conversation only (`chat.settings` with `conversation`; a new one
from the phone takes its brain in `chat.send › brain`): the brain new conversations start with and «Orquestador» are
this PC's (`config.orchestrator`). The state it gets (`app.state`, `remote.mjs › shapeResult`) has no folder of this PC
(`home`, `paths`, the working project's path), and its notifications and their buttons follow the same rule as its
calls (`validDevice`: a phone or a browser, used in the last 30 days, the owner's).

**Files.** `src/core/permissions.mjs` (the table, `principalOf`, `authorize`, `ownsTask`); `src/engine/api.mjs ›
call` checks every call before the method runs and refuses one that does not say who makes it (the engine and
dev-control pass `DESKTOP`; the methods get the principal as their second argument); `src/engine/remote.mjs` builds a device's principal and also checks
`REMOTE_METHODS` itself (`guardCall`, with the pictures and the full-access rules); `src/mcp/server.mjs` builds the
agent's `WHO` from its signature (`identity()`, `stillSigned()`).

**Inside.** A method without a line in `METHODS` is refused everywhere: `test/permisos.test.mjs` walks every API method
against the table, checks that a phone or a browser is refused every PC-only method before anything runs, and that an
unsigned or forged agent sees nothing while a signed one stays within its own conversation or task. A phone or a browser
is served only while it has no person: a device with a `person_id` (a 3.7 database) never is, and the phone access
does not open on a database the 3.8 migration (§35) could not finish.

## 35. From 3.7 to 3.8 (migration)

`src/core/migrate-38.mjs`, run once by `openDb` on this home's database (after the older migrations), so before the
engine opens the phone access, and again after a 3.7 backup is restored. Setting `migrated_3_8` marks it done; a new
3.8 database only gets the mark. One process at a time: an exclusive transaction on `core/datos/migracion-3.8.lock.db`
(the system lets it go when the process ends, however it ends; removed once the run is done).

1. **Before anything else**: orb.json as it was, once, in `core/datos/migracion-3.8/orb-3.7.json` (out of the archive
   and the backups: it has other users' keys; the archive and the new orb.json are built from it) and
   `core/datos/orb-pre-3.8.db` (VACUUM INTO a `.tmp`, `PRAGMA quick_check` and the same tables, fsync, rename). An empty
   or broken copy is set aside as `.roto-<date>`; a good one is reused only while the database still matches its
   fingerprint (tables, rows and last rowid of each, settings; kept in `migracion-3.8.json`): a copy of an earlier attempt
   made before Orb 3.7 was used again goes aside as `-intento-<date>` and is deleted when the run is done.
2. **One transaction** (`BEGIN IMMEDIATE`): the readable archive `core/archivo-3.7/` is written and the files are only
   COPIED into it (`LEEME.txt`; `orb-3.7.json` without other users' keys; `bots/`: rows as JSON, the bots'
   conversations, the old `bots/` folder and `bots-borrados`; `usuarios/<name>-<id>/`: each other user's conversations,
   loose chat lines, sessions, tasks (with their settings, run logs, isolated copies without dependencies and undo
   checkpoints), projects, schedules, devices, usage, files and their accounts' names without secrets, by name and by
   value; `usuarios/desconocido/` for accounts of an unknown person; `tablas/`; `orb-json-retirado.json`; the sealed
   `enlaces.json`; the bridge's `%LOCALAPPDATA%\OrbPuente\orb.json`). Then the `home_*` triggers; the bots' and groups'
   conversations and list marks; the other users' rows (their spending too); the owner's rows get `person_id = NULL`
   (the columns go in 3.9) and the list marks the key `'owner'`; devices of kind `orb`/`terminal`; the tables of bots,
   replicas, links and persons and their indexes; the devices' columns `role`, `admin`, `kind_ok`, `approve`, `dev_ok`;
   the old settings. The owner is the active owner, else a deleted owner, else the oldest administrator, else the only
   person; with none and other people's rows, nothing is done. Another user's project shared with the owner, or named by
   the owner's tasks, schedules, sessions or conversations, becomes the owner's; the other ones' folders in the
   categories go to `projects_ignored` (`syncProjects` skips them and drops folders that no longer exist; adding one with
   `board.addProject` lists it again). The same transaction saves the plan of files (`migrated_3_8_files`: originals to
   delete once their copy is in the archive, the other users' sign-in and run folders, the owner's pictures and phone
   uploads to put back in `imagenes/` and `adjuntos-movil/`, renamed «name (3.7).ext» on a clash and the chat lines
   that name them updated), the new orb.json with what it is made of (`migrated_3_8_config`) and `migrated_3_8_at`.
3. **After the COMMIT** (`finish`, also at the next start if the process ended): the plan; orb.json (`bots`, `oce`,
   `monitor`, `role`, `devTarget`, `ui.mode`, `browser.sites` and anyone else's accounts and connectors go; `person`
   leaves the rest; the owner's `userName`, `tz`, language, phone previews and brain from `persons`/`person_settings`),
   written only over the orb.json it came from and made again from the file as it is when that changed meanwhile;
   the original orb.json and the run file are removed and the database is VACUUMed.

A run that fails before the COMMIT leaves the database and the files of 3.7 as they were (only the archive and the copy
are new) and the next one reuses them; a 3.7 database restored after a migration is a new run with a dated archive and
copy (`archivo-3.7-<date>`, `orb-pre-3.8-<date>.db`). While the database is still 3.7, or its files or orb.json are not
finished (`unfinished`: also when orb.json cannot be written), the engine does not start the scheduler, the agents or
the phone access and the MCP server refuses it; the window shows «No se pudieron actualizar tus datos a Orb 3.8», what to
do, the copy («Abrir carpeta»), «Reintentar», «Buscar actualización» (the app's updater) and the reason under «Detalles»
(`app.migrationState`, `app.migrationRetry`, PC only; `committed` says whether going back to 3.7 would need the copy).
The migration writes only inside the data folder and the bridge's file (`insideData`); `ORB_BRIDGE_DIR` is for tests
only, and under `node --test` without it there is no bridge. The engine tells the owner once («Orb 3.8 ya no tiene bots
ni usuarios…», `data.migrated38`, and to revoke Home Assistant's token when 3.7 had one) and logs what was done. 30 days
after, the copies `orb-pre-3.8*.db` lose 3.7's secrets (PIN hashes, devices' keys, `secret:*`, `remote_keys`, agents'
signatures) and are VACUUMed (`scrubPreCopies`, told once). Ajustes › Datos › «Borrar los datos de Orb 3.7»
(`legacy.status`, `legacy.delete`, PC only) deletes the archives and the copies. Backups include every `archivo-3.7*/`
without sign-in folders. Tests: `test/migracion-38.test.mjs` (3.7 with two users, 3.6 and 3.5.1 databases, the phone
access, backups without other users' keys, a failed transaction that leaves every file in place and its retry, orb.json
that cannot be written, a broken or outdated copy, no owner, two restores, the lock, the owner's clashing pictures,
other users' isolated copies, shared projects, the 30-day scrub, the blocked screen and the blocked engine).

## 36. The workspace and core

The workspace is `C:\Orb` by default (the welcome shows it already chosen; «Cambiar ubicación…» picks another base,
`app:info › defaultBase`, `ORB_DEFAULT_BASE` in tests). It holds `core\` and the six categories, and nothing else of
Orb's (section 2). A folder called Orb that already has other things (notes, projects, `personal\`, an older Orb's
folders) is used as it is: nothing in it is overwritten or moved without the user's say. Only the categories' subfolders
are projects: any other top-level folder is the user's and is never listed. All of Orb's own paths come from `paths()`
in `src/core/home.mjs`; nothing else builds them.

- **Orb 3.7's own data** (`migrateWorkspace`, `src/core/core-folder.mjs`, called by `ensureLayout` at every start and by
  `createHome`, so before the database opens and before the 3.8 migration of the database, which then finds it in
  `core\datos`): `.orb` → `core`, `orb.json` → `core\orb.json`. Only a folder that has them is taken for a 3.7
  workspace. They are Orb's, so they move without asking.
- **The folders the user decides about** (`planWorkspace` / `applyLayout`; the window's «Ordenar carpetas»,
  `views/layout.jsx`, after the welcome and when an updated Orb finds them: `app.layoutPlan`, `app.layoutApply`, PC
  only): `bitacora\` (default: into `core\bitacora`, the general log's place by the owner's definition; logs merged,
  never overwritten; its row says that other tools may use the old path and that Orb will say which one to put in them.
  After the move a last screen names the exact new place of each of the user's own files in it, e.g.
  `C:\Orb\core\bitacora\bitacora_project.md`, for `AGENTS.md`, `CLAUDE.md` and other tools outside Orb, with «Copiar
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
- **Backups outside the workspace** (`src/core/backup.mjs`): `%LOCALAPPDATA%\Orb\copias\<workspace>` on Windows
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
  per start (`src/core/master.mjs › openMachine`) and gets only the keys made from it (`src/core/machine-keys.mjs`: the
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

## 37. The master password and Magic Link

One password, made once, protects what Orb keeps for itself and the actions that could hurt. Code: `src-tauri/vault`
(the orb-vault crate: the crypto, the files, the waits, the unlock tokens), `src/core/master.mjs` (the engine's client of
it, same API as before), `src/engine/api-master.mjs` (the API and the guard), `src/core/connector-secrets.mjs`,
`src/core/mobile-crypto.mjs` (linking), `src/ui/views/master.jsx` and `src/ui/lib/core-access.js`.

**Where the secrets live (3.8.1).** In Rust, not in the engine. Orb.exe runs the vault (`src-tauri/src/vault_host.rs`)
and gives each engine process its own named pipe (`ORB_VAULT_PIPE`; first instance, this user's SID only, no remote
clients, only the engine's process id). The data key, this PC's wrap key and every key made from a password stay in
VirtualLock'ed pages and are wiped after use (zeroize); so are the buffers that carried a password or a secret. The
engine asks for concrete operations: open or seal one secret (`get`/`set`), check a password (scrypt runs as a job it
polls), issue or check an unlock token, check a phone's key confirmation (`pairFinish`: the verifier and K never leave
Rust), or a one-time grant of a connector's keys, which its launcher (`src/mcp/launch.mjs`) trades on a second pipe
(`src/mcp/vault-client.mjs`): those keys never pass through the engine. The files on disk are the same as 3.8's. Without
an app (tests, scripts) the engine starts the `orb-vault` binary (`scripts/vault-build.mjs`, run by `npm test`).
This PC's secret is the vault's too (machine.rs): the engine holds only the keys made from it (approvals, backups), from
which this PC's wrap cannot be derived, and the secrets it opens for its own use (this PC's keys for the phones).

**Keys** (`core\secretos\`):
- A random **data key** (32 bytes) encrypts Orb's own secrets: the PC's X25519 and VAPID keys for the phones (the
  database's `remote_keys` in 3.7, in clear), the connectors' keys (the `env` of each MCP server, in orb.json in 3.7) and
  the phones' **verifier** of the password (below). They live in `secretos.json`, one JSON map sealed with
  XChaCha20-Poly1305.
- `maestra.json`: the data key wrapped by a key made from the password with scrypt (N = 2^17, r = 8, p = 1, 16-byte
  salt). The parameters are stored, and only accepted within bounds (N a power of two between 2^15 and 2^20, r = 8,
  p = 1, a 16-byte salt): a file left there can neither make the check cheap nor hang the engine. An HMAC of that key
  checks the password in constant time before the wrap is opened (itself authenticated). The password is never stored.
- `maestra-pc.json`: the same data key wrapped by a key derived (HKDF) from this PC's secret, the one Windows keeps
  sealed (DPAPI, `core\datos\clave2.enc`, opened by the vault at start: `src-tauri/vault/src/machine.rs`). So
  Orb starts and works without asking for the password; it is asked only for guarded actions and to link a phone. It
  also records, authenticated, that a password was made. Without the app (tests) that secret is `clave.bin`, as for approvals.
- **Which key.** Every wrap carries the id of the data key it holds (`keyId`, an HMAC of the key) in its additional
  data. A password only counts when it opens **the** data key: if this PC already has it open, the key from
  `maestra.json` must be the same (compared in constant time); if not (another PC), it must open the `secretos.json`
  that is there. So a `maestra.json` from another workspace, or made by someone else with their own password, opens
  nothing and gives no token; and a `maestra-pc.json` that does not open is never replaced by a new data key in silence.
- **A password is never made twice.** When `maestra.json` is gone but the vault or this PC's wrap say a password was
  made, `master.state` says `lost` and `master.create` refuses (`msg.master.lost`): it comes back from the copy outside
  core or a backup, or through «He olvidado la contraseña» / «Borrar secretos y empezar de cero».
- The data key is made at the first start of 3.8 (new workspace or one of 3.7), wrapped for this PC only; the
  password wraps it when it is made. From then on, the secrets of earlier versions move into the vault
  (`migrateSecrets`): `remote_keys` is deleted from the database with `secure_delete`, then `VACUUM` (older versions of
  the row in free pages go too) and an emptied journal; orb.json keeps a reference (`orb-secret:mcp/<connector>/<NAME>`)
  per connector key. A value is always looked up by its own connector and variable name, never by the reference text.
  The archive of 3.7 and the copies of its database are cleaned at the same time (`scrubVaultedSecrets`, section 36).
- **Connectors' keys are tied to their program**: the vault keeps a hash of each connector's command and arguments
  (`mcpbind/<connector>`), set when its keys are saved (`secrets.saveConnector`, or `config.save` with the window
  unlocked). A connector whose command or arguments changed without the password (orb.json edited by hand or by an
  agent) gets no keys at all (`resolveEnv`).
- `intentos.json`: wrong tries, per channel (`pc`: this PC's window; `pair`: phones linking; `recovery`: the backups'
  recovery code). After five in a row, 30 s of wait, doubled after each new one (15 min at most); kept across restarts
  and in the engine's memory too (the highest count wins); a right one resets the count. **Fail closed**: when the file
  cannot be written (read-only, a folder in its place) no password or code is checked at all (`msg.master.tries`); a
  damaged file counts as the most fails there can be. Every fifth wrong try in a row on a channel puts a notice in the
  window (`msg.master.failsNotice`).
- A copy of `maestra.json`, `maestra-pc.json` and `secretos.json` lives outside the workspace, next to the copy of
  `clave.enc` (`%APPDATA%\Orb.dev\claves\<workspace>-secretos`, passed by `main.mjs` as `keep`). Before the database
  opens, what is missing in core comes back from it. What it brings back proves nothing by itself (the key checks above).
  The agents' guard keeps that folder and the app's `Local State` closed to them, also when a command names them through
  `%APPDATA%`, `$env:APPDATA`, `${env:APPDATA}`, `$APPDATA` or `~` (`guard.mjs › expandEnv`).
- On another PC (or another Windows user) the PC's wrap does not open: the window shows «Escribe tu contraseña maestra»
  (`MasterLocked`), the phone access does not start, and a right password opens the data key and wraps it for this PC.

**Making it** (welcome after the folder; an Orb updated to 3.8 shows the same screen once and cannot skip it): at least
10 characters (12 or more advised, with a strength hint), typed twice, and a box to tick under «Orb no la guarda:
apúntala» with what that means (the recovery code, or starting from scratch). The first screen of the window is decided
by `src/ui/lib/startup.js` (core, the 3.7 migration, the password, a pending welcome, the folders); the welcome keeps
`setupPending` in orb.json until its last step, so one closed halfway resumes where it stopped, and the «updated to
3.8» wording shows only when the data came from 3.7 (`master.state().upgraded`).

**Guarded actions.** `needsUnlock` (`src/core/permissions.mjs`) lists them: restoring a backup, checking one
(`backup.verify`, which would otherwise test recovery codes for free; a code typed there also has the `recovery`
channel's waits), making a new recovery code (`backup.recovery`: the code opens every backup), deleting the data of Orb
3.7, unlinking a phone (`link.revoke`, `remote.revoke`), a connector's keys (`secrets.connector`,
`secrets.saveConnector`), and in `config.save` (compared with the settings in force): choosing the backups' folder,
writing a connector key in clear, changing a connector that has keys (its command, arguments or name, removing it or one
of its keys) and taking an entry off «Elementos protegidos»; 3.8.1: deleting a project with its folder
(`projects.deleteCheck`; its end, `projects.delete` / `projects.deleteAbort`, takes the one-off ticket the check returned). Opening core in the Explorer too (`main.mjs` asks the engine
`master.check` before `app:openPath` on core itself or on `core\secretos`, compared by real path; core's tool folders
open as before; 3.8.1: the engine's `guardedCore`, used by `app.openIn`, `app.runAction` and `app.openTerminal`, guards
everything inside core but `mcp`, `skills`, `preparacion`, `herramientas`, `bitacora` and `copias\aisladas`, so
`core\datos` too). The dispatcher refuses them without a fresh token: `master.unlock` (the password) gives one for 5
minutes, kept in the engine's memory and the window's (`unlockCore`, which asks with a dialog). It ends with
`master.lock`, called by `main.mjs` when Windows locks, the PC sleeps or shuts down; and with the window, which keeps it
in memory only. 3.8.1, **Orb's lock screen** (owner's decision 20): `master.lock` (Windows locked, the PC asleep,
«Bloquear ahora» in Ajustes › Datos, or `ui.lockMinutes` without a key, click, touch, wheel or pointer move in the
window: 15 by default, `src/ui/lib/idle-lock.js`) also sets the engine's `screenLocked` (memory only; `master.state`
says it) and emits `master:locked { screen: true }`: the window shows only the password screen (`MasterLocked`, also
after a reload: `lib/startup.js`) until `master.unlock` (or change, forgot, reset) clears it. The vault stays open:
agents, schedules and the phone keep working. A new start of Orb opens as before (this PC's key). Changing the password
asks for the current one. `backup.now` stays free. Some actions ask for the
password **every time** (`FRESH_UNLOCK` in `permissions.mjs`; 3.8.1: deleting a project): the window asks even with an
unlock in force (`unlockCore` skips it for `FRESH_ACTIONS`), `master.unlock({ purpose })` gives a token for that action
only, for 2 minutes and never kept, and the dispatcher accepts nothing else for it (an unlock of 5 minutes does not open
it, and its token opens nothing else).

**Change, forgot and starting from scratch.**
- `master.change` wraps the same data key with the new password: nothing else is encrypted again and linked phones stay.
- «He olvidado la contraseña» (`master.forgot`, explicit confirmation) needs the **backups' recovery code** of this PC
  (Ajustes › Datos; checked against its sealed copy, with the `recovery` channel's waits). It works where this PC's wrap
  opens the data key: a **new data key** is made, the secrets are encrypted again with it (old copies of `maestra.json`,
  in backups or old folders, no longer open anything current), this PC's keys for the phones are new (`remote_keys`
  dropped, made again when needed) and **every linked phone and browser is unlinked**. Without a recovery code on this
  PC the engine says so (`noRecovery`).
- Without the code (or on a PC that cannot open the secrets): «Borrar secretos y empezar de cero» (`master.reset`,
  explicit confirmation): the three sealed files go (here and in the copy outside core; backups are never touched), a
  new data key and an empty vault start with the new password, every phone is unlinked and the connectors' keys have to
  be typed again. The window says all of this before.
- On another PC, a backup is opened with this PC's key, the master password or the recovery code (section 36); the
  secrets inside stay sealed with the data key.

**Backups** carry `core\secretos` (never `intentos.json`): the database and orb.json no longer hold any secret in clear,
and the vault inside opens with the password (or the PC secret the backup also carries, as before for approvals).

**Magic Link with the password** (protocol 4, `src/core/link-payload.mjs`). The password never leaves the phone:
- When the password is made (or changed, forgotten, reset) the PC keeps a **verifier** in the vault: the public half of
  an X25519 key whose private half comes from the password (scrypt N = 2^16, r = 8, p = 1 with its own salt, then HKDF:
  `mobile-crypto.mjs › verifierFromSeed`). A password made before the verifier existed gets it the next time it is typed
  on the PC (`msg.link.noVerifier` meanwhile).
- `/api/pair` has two steps (`mobile-crypto.mjs › linkDevice` on the phone, `remote.mjs › pair` on the PC):
  1. `start`: the phone's public key and its proof sealed with the code's key (the QR's one-time code, or the short code
     stretched with scrypt and tied to the PC's key), as before. The PC checks the code, the clock, the protocol, the
     kind of device and the `pair` waits, and answers, sealed with that same code key, a session id and the verifier's
     salt and cost (the phone refuses a cost outside 2^15–2^18, so a fake PC cannot make its attack cheap).
  2. `finish`: both sides derive `K = HKDF(code ‖ ECDH(phone, PC) ‖ ECDH(password key, PC))`, bound to a hash of the
     whole exchange (`pakeTranscript`: the way in, both public keys, the session id, the salt and cost). The phone sends
     `HMAC(K, 'orb-pake:movil')`; the PC compares it in constant time (with the `pair` channel's waits). Right: the device
     is added and the PC answers `HMAC(K, 'orb-pake:pc:<id>')`, which the phone checks before keeping anything (only the
     real PC, with its private key and the verifier, can make it), plus the box sealed with the new session key.
- A wrong password fails at that key confirmation: 403 (`reason: 'password'`, tries left, no MAC of the PC) and does
  **not** use the code up; five wrong ones on one code cancel it (`reason: 'newCode'`); the `pair` channel's waits apply
  to all codes together (429) and the owner gets a notice after five. Each session id gives one try. Without a master
  password on the PC nobody links (`noMaster`).
- **What an observer learns.** A passive observer of the Wi-Fi, even one who photographed the QR (code and PC key),
  sees two public keys, a session id, sealed boxes and a MAC: without the phone's or the PC's private key there is no
  `ECDH(phone, PC)`, so they cannot check a single password guess against it (`test/contrasena-maestra.test.mjs`).
- **Residual risk.** Someone who impersonates the PC (a forged QR, or someone in the middle of a typed short code who
  also breaks that code) gets the phone's MAC: they cannot read the password, but they can try a dictionary against that
  MAC offline, each guess costing one scrypt (2^16). The defences are the length rule, the fingerprint check below and
  the QR itself (it carries the real PC's key). The proper fix is an augmented PAKE with an OPRF (**OPAQUE**, for
  example `@serenity-kit/opaque`, or an OPRF over ristretto255 from `@noble/curves`), where an impostor gets one online
  guess and nothing to attack offline: future work.
- **The fingerprint.** The phone works out the PC's fingerprint from the key it is about to use (never the other side's
  word) and shows it above the password field; with a typed short code it must be confirmed («Coincide con la del PC»)
  before the password can be typed. The PC shows the same one on its Magic Link screen.
- **Never over plain http.** The password is typed only in the Android app, over https (Tailscale) or on the Tailscale
  address / this device (`link-payload.mjs › passwordPageOk`). A browser page that came in plain http over the Wi-Fi
  shows «Por seguridad, la contraseña maestra no se escribe en una página sin cifrar» instead of asking, and the PC
  refuses its pairing anyway (`plainHttpBrowser`; the setting that allowed it before, `mobile.lanHttp`, is gone). The
  password field does not offer to save it (`autocomplete=off`, a random name).
- `PAIR_PROTOCOL = 4`: a pairing without `v >= 4` and the two steps (an app of 3.7, or one that sends the password)
  gets 426 «Actualiza la app» and the code stays. **Phones linked before 3.8** never proved the password: at the first
  start of 3.8 they are all unlinked once (`relink_38`) with the notice «Vuelve a enlazar tu móvil con Magic Link».
- The PC's keys for the phones are read from the vault when first needed (`remote.mjs › own`); `revokeAll` unlinks every
  device and forgets the cached keys (forgot, reset).

**What it does not protect against.** Code that runs as the same Windows user (malware, or an agent's shell bent on it)
can ask DPAPI to open `clave2.enc`, and from there `maestra-pc.json` and every secret: the master password
adds nothing against it. The agents' guard (section 28) keeps their tools away from core, the copies and the app's
`Local State`, but it is not a boundary. Real isolation would run the agents as another Windows user or in an
AppContainer (not done yet). Without the Windows profile (a copy of core, a backup), the barrier is the password's
strength (scrypt over `maestra.json`) or the recovery code.

Tests: `test/contrasena-maestra.test.mjs` (the round trip, `keyId` and a changed file; a planted, foreign or deleted
`maestra.json` and scrypt's bounds; waits that grow, survive a restart and a deleted file, fail closed when they cannot be
written, and the owner's notice; the token's 5 minutes and the lock; the copy outside core; connectors' references tied
to their command; what is guarded; the engine moving 3.7's secrets (with `VACUUM`), refusing guarded calls without a
fresh token, another PC locked until the password, and a backup with nothing in clear; linking: the password never on
the wire, a passive observer unable to check a guess, a wrong password failing at the key confirmation, five per code,
the global wait, an app of 3.7, a fake PC with the code; change, forgot with the recovery code (new data key), start
from scratch; phones of before 3.8 unlinked once; the guard with environment variables), `test/remote.test.mjs`,
`test/android.test.mjs`, `test/seguridad-351.test.mjs` and `test/copias.test.mjs`.
