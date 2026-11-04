# How Orb 2.4 works, feature by feature

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
22. [Mobile](#22-mobile)
23. [Expert mode](#23-expert-mode)
24. [Installer and session detection](#24-installer-and-session-detection)
25. [MCP connectors](#25-mcp-connectors)
26. [Languages](#26-languages)
27. [Interface: sidebar, inbox, theme, size and robot](#27-interface)
28. [Security](#28-security)
29. [Packaging, versions and CI](#29-packaging-versions-and-ci)
30. [Tests](#30-tests)
31. [How to rework a feature without breaking the rest](#31-how-to-rework-a-feature)
32. [The CORE: from request to report (3.1)](#32-the-core)
33. [Conversations (3.2)](#33-conversations-32)

---

## 1. App map

```
Window (React)  ──messages──►  Main process (Electron)  ──messages──►  Engine (separate process)
src/ui/**                      src/main/main.mjs + preload.cjs         src/engine/engine.mjs
                                                                         ├─ api.mjs          window actions
                                                                         ├─ sessions.mjs     live conversations
                                                                         ├─ scheduler.mjs    tasks
                                                                         ├─ orchestrator.mjs the assistant
                                                                         └─ remote.mjs       mobile web
Agents (processes)  ◄── adapters src/agents/*.mjs (live) ──┘
   └─ each agent loads Orb's MCP server: src/mcp/server.mjs (the shared board)
Data: <assistant folder>/.orb/datos/orb.db (SQLite, src/core/db.mjs)
```

- **There is no web server on the PC.** The window talks to the engine through Electron's internal messages. The only
  server is the mobile one, which is off by default and only listens on the Tailscale address.
- **The engine** is a separate process (`utilityProcess`). If it crashes, the main process restarts it, up to three times.
- **The agents** are the official programs the user already has (Claude Code, Codex, Cursor, Gemini CLI…), with their
  own session. Orb never sees credentials.
- **Layers** (bottom to top):
  1. `src/core` is the pure logic: board, approvals, usage, guard, folders and scheduled tasks.
  2. `src/agents` are the adapters.
  3. `src/engine` puts the pieces together.
  4. `src/ui` is the interface.
- **The PC's own health (3.7)** has no screen of its own any more: «Monitoreo del equipo» and Opti Bot (2.7–3.6) were
  removed, and what they did is the bots' **«Equipo» / "Computer"** tool group (docs/BOTS.md): `src/core/pc-health.mjs`
  and `src/core/network.mjs` read (fixed PowerShell, Windows parts behind `process.platform === 'win32'`),
  `src/core/pc-actions.mjs` runs an approved `pc` card (same closed list; UAC only for that action), `src/mcp/bot.mjs`
  offers `pc_*`. Sharing with Open Control Edge (`engine/bridge.mjs`) is `orb.json › oce.share` (it was
  `monitor.shareWithOce`; `loadConfig` and `engine/retired.mjs` move it once, archive Opti Bot's old conversation and
  expire its waiting proposals, deleting nothing).

## 2. First launch and the assistant folder

**What it does.** It introduces itself ("Hi, I'm Orb·e", with the title "Your pocket director") and asks for the
assistant's name (Orb·e by default), what to call you and where to create its folder. The folder is always
`<chosen folder>\Orb` (or the chosen one, if it is already called Orb), whatever the assistant is called, and it has the
same structure for everyone:

> **Existing folder (2.4.1).** If no location is saved (new install), the installed app looks for an Orb folder that
> already exists (`<drive>:\Orb`, `Documents\Orb` or `<user>\Orb`, the most recently used) and uses it as is, without the
> welcome (`findExistingHome` in `src/main/main.mjs`). It does not do this when running from source or in tests
> (`ORB_USER_DATA`).

> **Names.** The program is **Orb** (`Orb.exe`); its robot, **Orb·e**; **Orb.dev** is only the development build (this
> repository). They live in `src/core/product.mjs`. Up to 2.3.3 the program was called "Orb.dev": that is why its Windows
> data (where the folder is, interface size) is still in `%APPDATA%\Orb.dev` and an updated install is still in
> `%LOCALAPPDATA%\Programs\Orb.dev`. Anyone who had the default name "Orb" becomes Orb·e when updating
> (`loadConfig`, `version` 4); a name chosen by hand stays.

```
D:\Orb\                   (always <chosen folder>\Orb, the same for everyone)
  orb.json                settings
  windows\ ios\ android\ web\
                          categories: each folder inside one of them is a project
                          (the ones the app creates and the ones you create in Explorer)
  android\adb-tools\      Google's adb and fastboot, downloaded by the app (not a project)
  bitacora\               Orb configuration: GENERAL.md (general memory) and proyectos\ (one per project), in the
                          Settings language; when it changes, the ones with no entries yet change their header
  mcp-servers\            Orb configuration: the MCP servers; not shown as a project, managed in Settings
  .orb\                   app data (hidden): database, encrypted key, logs, undo copies
```

- **Categories** (`windows`, `ios`, `android`, `web`): projects are their subfolders. When creating or cloning a project
  you pick the category (web by default); the assistant sets it in `orb_create_project`.
- **Orb configuration** (`bitacora`, `mcp-servers`, `.orb`): never projects, and cannot be linked as such.
- **adb**: at startup, if `android\adb-tools\adb.exe` is missing, the engine downloads Google's platform-tools there
  (`src/engine/android.mjs`) and puts that folder first in the agents' PATH. Settings → Android shows the status.
- **2.3.0 folders**: `ensureLayout` creates whatever is missing and moves `bitacoras\` to `bitacora\` (if a file exists
  in both, the old entries are appended at the end). It only discards the empty logs that 2.3.0 created for the
  categories and configuration folders it mistook for projects; those "projects" go away on their own (`syncProjects`).

On Windows, it then offers to install whatever is missing (section 24).

**Files.**
- Interface: `src/ui/views/setup.jsx`.
- Creating and organizing the folder: `src/core/home.mjs` (`createHome`, `homeFor`, `ensureLayout`, `categoryOf`, `DEFAULT_CONFIG`, `loadConfig`).
- Projects by category: `src/core/projects.mjs` (`createProject`, `syncProjects`).
- Remembering where it is: `src/main/main.mjs` (`ubicacion.json` in the app data).

**Inside.**
- `loadConfig` merges `orb.json` with the defaults. It adds new things to an old folder on its own:
  - accounts for new agents;
  - in version 3, the new usage caps (section 12).
- `ORB_USER_DATA` lets you separate the app data (another copy or the tests). `ORB_LIGHT=1` opens Orb Light from source.

## 3. The chat with the assistant

**What it does.** It is the main screen. You tell it what you want and the assistant turns it into tasks, assigns them,
watches them and reports back. Each "New chat" is its own conversation (section 33). The "Orchestrator" checkbox decides
who a new conversation is with:

- **Orchestrator** (default): with the assistant, which:
  - only coordinates;
  - can **read** the project (Read, Grep, Glob) to write better briefs;
  - does not edit or run anything.
- **Without Orchestrator (3.2):** directly with the agent chosen under the box (a direct session, section 4), in the
  working project. The user splits the work and can open as many at once as they like. It replaces the assistant's old
  "free mode" and "New task".

**Files.**
- Interface: `src/ui/views/chat.jsx` (includes the `Composer`, the message box used across the app).
- Engine: `src/engine/orchestrator.mjs`.
  - `persona()`: its coordinator instructions.
  - `Orchestrator`: the conversations; `Lane`: one conversation with its live session.

**Inside (2.3).**
- The assistant is **a live Claude session** (Claude Agent SDK with the user's Claude Code) that stays open between
  messages. The reply streams in (`chat:state.partial`).
- **Any brain (2.6):** `orchestrator.agent` can be any installed agent with an account (`chat.settings` with `agent`,
  `model`, `reasoning`, `account`). Claude gets the persona as its system prompt; the others get it when the
  conversation starts, and as coordinator they run read-only. Switching agents starts a new conversation.
- **Brain catalog** (`models.catalog`, `src/engine/catalog.mjs`): installed agents with their models (the configured
  ones and the ones the agent itself reports: Codex's `model/list` and the ACP model option, stored in
  `models:<agent>`), which ones cost more (`heavyModels` or known families) and the real usage of each account. The
  interface (`src/ui/components/brain-picker.jsx`) warns with a bubble if reasoning is high, the model is an expensive
  one or the account is over 75 %.
- **New chat** (3.2): opens the screen for a new conversation (route `{ view: 'chat' }` without `id`). The first message
  creates it: with "Orchestrator", `chat.send` without `conversation` (returns its id and the screen switches to that
  conversation); without it, a direct session (`sessions.create` + `sessions.send`) with the chosen agent, model,
  reasoning and project.
- A dialog requested again while it is open does not open on top of itself (`open()` in `dialogs.jsx`).
- **Chat bar (2.6):** no name or model; only icons with `BubbleTip` (`overlay.jsx`): pause or resume, restart and
  mini-games. The top bars (`.topbar`) are styled by the theme in `themes.css` (decoration in `::before`, which stops
  before the window buttons) and `--titlebar-color` gives those buttons their color; with a dialog open they darken with
  the page (`title-bar.js`).
- **Theme scenes (2.6):** `.theme-band` (menu header `.side-band` and top bars) and `.theme-scene` (background of
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
- **deny** what is never OK: touching the assistant's internal data (`.orb/datos`, `.orb/copias`).

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
  - in the chat, `ChatApproval` in `chat.jsx` (the assistant's in free mode and the tasks' ones);
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
- **Safety net:** 20 tasks per window and 6 with expensive models per account. They used to be 6 and 2, far too few.
- Optional spend caps per task (`maxBudgetUsd`) and approval for high reasoning.

**Files.**
- `src/core/budget.mjs`:
  - `recordRate` and `realRate` (real usage);
  - `canLaunch` and `rankAccounts` (decision and order);
  - `startCooldown` (pause until the reset).
- Data source: the adapters' `rate` events, in `sessions.onRate` (`engine.mjs`) and, since 2.6, also the brain's
  (`orchestrator.onEvent`).
- Screens: Agents ("Usage per account") and Settings ("Quota usage limit (%)").

**2.6: the context ring and the usage panel.**
- Next to the send button, `ContextMeter` (`src/ui/views/session.jsx`) is a ring that fills up; clicking it,
  `UsagePanel` requests `usage.now` (`api.mjs`): the brain, the accounts with running sessions and the ones that
  reported recently.
- Each plan window is stored separately in `rates:<account>` (`recordRate` → `rateWindows`, shortest first). Single-model
  windows (`seven_day_opus`, `seven_day_fable`…) are only shown: they do not stop the account (`rate:<account>`).
- Claude only sends its usage near the limit: `planUsage` (`claude.mjs`) requests it after each turn, at most every
  90 s, with the SDK's experimental call. Codex sends its two windows (primary and secondary) in
  `account/rateLimits/updated`.

**2.6: saving or power.** `budget.profile` (0 = max saving … 4 = max usage; `null` = manual). The slider in
Settings › Agents and usage (`SPEND_PRESETS` in `settings.jsx`) sets the limits, and `persona()` (`orchestrator.mjs`,
`SPEND`) tells the brain how cautious to be. "Advanced options" save with `profile: null`.

**2.6: each agent's real models.** `discoverModels(agent)` (`src/agents/index.mjs`, one per adapter: Agent SDK
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
  are resumed (2.5).
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
  - `src/main/browser.mjs` (hidden pages, the mini window and the per-conversation keyed pipe);
  - the tools in `src/mcp/server.mjs`;
  - `src/core/browser-key.mjs`.

## 22. Mobile

**What it does.** The same interface as a web app on the phone, with no store apps. It is turned on in Settings →
Mobile, with two routes that are switched on separately:

| Route | Address | What it allows |
|---|---|---|
| **Home wifi** | `http://<PC local IP>:3131/` | Using it at home without installing anything on the phone |
| **Tailscale** | `https://<pc>.<tailnet>.ts.net:3131/` (with `tailscale serve`) or `http://<Tailscale IP>:3131/` if the tailnet has no HTTPS | Using it away from home; with HTTPS it installs as an app and gets notifications |

- From the phone you can chat and approve, answer permissions, edit the queue, continue and fork, request Task Review,
  manage scheduled tasks and give the OK. Sensitive things (settings, accounts, installing, full access, PC files) only
  from the PC (`ALLOWED` in `remote.mjs`).
- On the phone, the menu has **"This phone"**: how to install it as an app and the **notifications** switch.

**Pairing and encryption** (`src/core/mobile-crypto.mjs`, the same code on the PC and on the phone):
- The PC has a fixed X25519 key; its public part goes in the QR along with a one-time code that expires after 5
  minutes: `#vincular=<code>&pc=<key>` (after `#`, the browser does not send it to any server).
- The phone creates its own key and sends only its public part and a proof sealed with a key derived from the code.
  **The code never travels**: a photographed or copied QR is useless once used, and a link without the phone is worthless.
- The PC's reply is sealed with the session key: the phone checks it is talking to the PC from the QR (the PC
  fingerprint shows in the QR and on the phone).
- After that, every request, response, live event and image is encrypted with XChaCha20-Poly1305 under a key that only
  that phone and the PC have. Each message states what it is for and which phone it is from (additional data), and
  carries the time and a nonce: the PC rejects replays, old messages (more than 5 minutes off) and tampered ones.
- **Phone with the wrong time (2.5):** if a request's time is more than 5 minutes off the PC's, the PC answers 409 with
  its time (only after opening the request with the phone's key, or the QR's when pairing). The phone web app adopts it
  and retries once. Before, it answered 401 and the phone unpaired itself.
- It also works over http (wifi), where the browser does not offer its crypto: it uses the `@noble/*` libraries.
- Removing a phone in Settings deletes its key: it is locked out immediately. Phones from 2.3.2 or earlier (no own key)
  have to be paired again.

**Notifications** (`src/engine/webpush.mjs`): HTTPS only (Tailscale with HTTPS). The phone subscribes from "This phone"
and the PC sends notifications directly to the browser's service (Google, Apple, Mozilla) with Web Push: encrypted for
that phone (RFC 8291) and signed with the PC's VAPID key (RFC 8292). No servers of our own and no cost. It notifies each
new message in the Orb chat (replies, tasks waiting for approval, finished or failed) when that phone does not have the
app open. On iPhone they work with Orb added to the home screen.

**Inside** (`src/engine/remote.mjs`):
- One http server per address: each private local IP (no virtual adapters) and the Tailscale one, or 127.0.0.1 behind
  `tailscale serve --https=<port>`. Turning access off removes that `tailscale serve` configuration.
- It only answers to its own names (against DNS rebinding) and its own origin.
- Every minute it checks whether the network changed (another wifi, another IP) and reopens access.
- The first time it listens on the local network, Windows may ask about the firewall: private networks must be
  allowed. If the PC's local IP changes, a phone paired over wifi has to pair again (its app stores the old address); a
  fixed IP on the router avoids this.
- Files: `src/engine/remote.mjs`, `src/engine/webpush.mjs`, `src/core/mobile-crypto.mjs`, `src/ui/lib/web-bridge.js`,
  the "Mobile" and "This phone" cards in `src/ui/views/settings.jsx`. Tests: `test/remote.test.mjs`,
  `test/webpush.test.mjs` and `test/mobile.e2e.mjs`.
- Pending, on hold: using it from anywhere without Tailscale through our own relay on Cloudflare
  ([`MOBILE-RELAY.md`](MOBILE-RELAY.md)).

**3.5, Magic Link** (Settings › Magic Link; the same server and the same endpoints, phones already paired keep working):
- **QR v2:** `<url>#vincular=<code>&pc=<key>&v=2&n=<Orb name>&r=<role>&a=<other addresses>` (v1 ones only read
  `vincular` and `pc`). `link.qr` also returns `payload` (`{ v, urls, pc, code, name, role, expiresAt }`) and a **short
  code** of 8 letters and digits (`ABCD-EFGH`) to type along with the address. With the short code, the other side
  requests `GET /api/hello` (public key, name, role; only while a code is on screen) and seals its proof with
  `corto:<code>` (`via: 'code'` in `/api/pair`). Single use; 10 failed attempts per address in 10 min and 20 in total
  void the code.
- **Linked devices** (`devices.kind`: `phone`, `browser` or `orb`; `role`, `ip` and `meta` with hostname, MAC and
  version of an Orb): `link.devices`, `link.rename`, `link.revoke` (cuts its live feed and its calls immediately).
- **Orb with Orb** (`src/core/link.mjs`, `web-bridge.js` ported to Node): `link.connect({ qr } | { code, address })`,
  `link.peers`, `link.disconnect`. The keys are in `.orb/datos/enlaces.json`, sealed with a key derived from the app
  secret. Live feed with reconnection (1 s … 30 s) and address switching if one does not answer.
- **Roles** (`orb.json › role`, chosen by the user in Settings › Magic Link on any Orb): `todo` (hub and workshop at
  once; the default when unset), `centro` (keeps the bots) or `taller` (codes). Orb Núcleo (Orb Core) writes `centro`
  only if the folder has no role (`--papel` changes it on purpose). What a windowless server lacks (God mode, expert
  view, isolated copies, console) depends on `ctx.headless` (`ORB_NUCLEO=1`), never on the role. A coding Orb
  linked to a bot-keeping one tells it who it is on connect (`POST /api/link`, `op: 'hello'`, with its MACs for
  Wake-on-LAN; the reply says whether it wants its events), runs the calls the other passes it over its live feed
  (`link:request` → `op: 'reply'`) with the same checks as a phone (`guardCall`), and sends it its events
  (`op: 'events'`), which phones receive as `taller:<event>` and under their usual name.
- **Orb for coding** (`orb.json › devTarget`: `''` only, `local` or the id of a linked Orb): where the Orb mode of phones
  and terminals goes. If unset, to this Orb if it codes; otherwise, to the linked Orb that codes. When it goes to another
  one, the engine forwards only the Orb mode calls (`devForwards`: what is in `ALLOWED` minus `bots.*` and `app.state`).
- **Can administer** (`devices.admin`, `link.setAdmin`): a marked device manages bots and links from outside
  (`CONSOLE_ALLOWED`); being a browser is not enough. `link.qr({ admin: 'first' })` (used by `orb-nucleo enlazar`) only
  grants it on a windowless server and to the first one; `link.qr({ admin: true })` (`orb-nucleo enlazar --admin`, run on
  the server itself) grants it anyway, to replace a lost device. A device's `app.state` carries
  `access: { admin, bots, links, approve }`.
- **Rights chosen when making the QR (3.5.1):** `link.qr({ device, approve, dev })`: what the code is for (`phone`,
  `browser`, `orb`, `terminal`), whether the device may answer the bots' cards (`devices.approve`, `link.setApprove`) and,
  for an Orb, whether it may code for this one (`devices.dev_ok`). The device's own description never changes them; a
  code made for an Orb only links an Orb and the other way round. Orbs linked before 3.5.1 are asked again
  (`devices.kind_ok = 0`, `link.confirm({ id, what: 'orb' | 'taller' })`). Only confirmed Orbs count as workshops.
- **Short code (3.5.1):** `GET /api/hello` says `short: 3`; both sides stretch the code with scrypt, tied to the Orb's
  public key (`mobile-crypto.mjs › shortSecret`), and the pairing answer carries a second box sealed with that key
  (`confirm`), so the device knows the other side had the code. The fingerprint is shown on both screens.
- **Browsers over plain http (3.5.1):** pairing from a browser's page over the home Wi-Fi (http) is refused unless
  `mobile.lanHttp` is on (Settings › Phone access); the Android app, the terminal, loopback (Tailscale https) and the
  Tailscale address are not affected.
- **Notifications (3.5.1):** `mobile.preview` (`all`, `chat` by default, `none`): what a notification shows on a locked
  phone (`remote.mjs › pushContent`).
- **To another Orb:** `taller.<method>` (or `{ method, target: 'taller' }`) is forwarded to the coding Orb if it is in
  `ALLOWED` (no settings, accounts, full access or images). If the workshop is off: error with `offline: true`,
  `lastSeen` and `canWake`; `taller.status`, `taller.wake` (UDP magic packet to the stored MACs, `src/core/wol.mjs`),
  `taller.queue({ method, params })` (table `link_queue`, delivered when it comes back) and `taller.queued`.
  `link.status` sums up who is on.
- **Home network only:** any connection not coming from 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10 or the Tailscale
  IPv6 is rejected, as are those arriving through Tailscale Funnel. Tests: `test/magiclink.test.mjs`.

## 23. Expert mode

- File explorer and viewer, git changes with their diff, history, what is running, account usage, machine load and
  activity, around the chat. PC only.
- It is turned on in Settings; the panels can only be ticked with the mode on.
- Files: `src/engine/expert.mjs` and `src/ui/views/expert.jsx`.
- **3.2, "Open in":** the project in Cursor or VS Code (only the installed ones) or in Explorer (`src/main/editors.mjs`,
  `app:openIn`; programs are launched directly, never through cmd.exe).
- **3.2, project actions:** each project's own commands (`actions:<project>` on the board, at most 20;
  `actions.list/save/remove`) with a name, a keyboard shortcut and an optional preview, which can only be a page on this
  PC. They are launched from "Actions" or with their shortcut (`ActionShortcuts`: the God mode project, or the working
  folder outside it) in their own terminal window (`app:runAction`: Windows Terminal or PowerShell; CMD if chosen in
  Settings). PC only: the phone cannot launch them.
- **3.2:** the God mode chat is a conversation of the chosen project (the last one opened, or a new one in it) and
  starting one does not leave God mode.

## 24. Installer and session detection

**What it does.** On first launch, and in Agents, it detects what you have and installs what is missing with the
official installers. Since 2.4.1, PowerShell runs hidden (a separate window closed without doing anything on some
Windows 11 machines) and the app shows the progress; its output stays in
`.orb/ejecuciones/instalacion/progreso-*-salida.txt`. At startup the engine notes in `motor.log` which agents it finds
(`agentes: claude=… · codex=…`). Since 2.4.2 it also looks for them in `AppData` copies moved to another drive
(`appDataDirs()` and `npmPrefixes()` in `src/agents/common.mjs`: `<drive>:\AppData` or up to two folders below, like
`D:\ComputerApps\AppData`), even if PATH still points to `C:`. It installs:
- tools: Git, Node.js, GitHub CLI and Tailscale;
- agents: Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode and Qwen.

**If you are already signed in** to an agent (for example Codex with your ChatGPT account), Orb uses that session as is:
there is no need to sign in inside the app. Otherwise, "Sign in" opens the program's official login.

**3.5, "Orb only": no console.** Claude Code and Codex sign in without a window (`src/agents/login.mjs`). The CLI is
launched hidden, with its output read by Orb, and it stores the session in the account's folder (`CLAUDE_CONFIG_DIR` /
`CODEX_HOME`) as always; Orb never sees a token.
- Claude: `claude auth login --claudeai`. Orb reads the link ("If the browser didn't open, visit: …"). On a PC, Claude
  opens the browser itself, with a localhost callback. If the page shows a code ("code#state", on another device or on
  the server), it is pasted into Orb and reaches it via stdin (`agents.loginCode`). It ends with "Login successful.",
  exit 0 and `.credentials.json`.
- Codex: `codex app-server` → `account/login/start` with `chatgpt` (`authUrl`, which Orb opens with
  `shell.openExternal`) or `chatgptDeviceCode` (`verificationUrl` + `userCode`; the default on the hub). It ends with
  `account/login/completed`, which is checked with `account/read`. A Codex without that method falls back to
  `codex login --device-auth`, whose output provides the link and the code.
- API: `agents.login({ account, mode?, console? })` → `{ id, url, code, opened, needsCode, mode }`, plus
  `agents.loginCode`, `agents.loginCancel` and `agents.loginState`. `agents:login` events (waiting, done, error,
  cancelled). When it succeeds, the "not signed in" pause is lifted and models and plan are requested again.
  `console: true` opens the old console (Windows only, "Open console" button). Cursor and the ACP agents keep their
  console.
- On the hub (server), `agents.login` is no longer blocked and the linked phone can use those four methods
  (`CENTRO_PHONE` in `remote.mjs`). From the terminal: `orb-nucleo entrar claude|codex|<account>`.
- Installing or updating from Agents (`agents.install`, `agents.installState`, `agents:install` events): Claude with its
  native installer (`install.ps1` / `install.sh`, into `~/.local/bin`) and Codex with
  `npm install -g @openai/codex@latest` (on Windows, the user's npm folder; on Linux and macOS, `--prefix ~/.local`). It
  runs hidden, without admin rights and for at most 15 minutes.

**Files.**
- `src/engine/installer.mjs`: `ITEMS`, `check()` and the PowerShell script.
- Each adapter's `detect()` and `loginState()` (for example, the Codex session is in `~/.codex/auth.json`).
- `src/core/accounts.mjs`: several accounts per agent; each one has its login folder and its usage.

## 25. MCP connectors

- Extra tools for the agents (databases, Figma…), in Settings.
- Your own servers go in `<folder>/mcp-servers`: it is Orb configuration, not shown as a project. Settings lists its
  subfolders with the command that starts them (`src/engine/mcp-folder.mjs`: `bin`/`main` from package.json or typical
  files like `src/server.js` or `server.py`) and adds them with one click ("Use").
- They are passed to the chosen agents along with Orb's MCP (`mcpServersFor` in `sessions.mjs`).
- Claude uses `--strict-mcp-config`, so it only loads the ones Orb passes and not all of the user's. This saves tokens.

## 26. Languages

- The app is in Spain Spanish and English (Settings → Language, applied immediately).
- Files:
  - base: `src/core/i18n.mjs` (`translate`, `createT`, `localeOf`);
  - dictionaries: 1148 keys, one file per area in `src/core/locales/es/` and `en/` (chat, session, tasks, agents,
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

### Tutorials and guided tour (2.6)

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

### Settings (2.4)

- **Window over the app** (`SettingsDialog` in `src/ui/views/settings.jsx`), with sections on the left (`SECTIONS`) and,
  at the bottom, the developer's GitHub and the version. It opens with `openSettings(section)` from
  `src/ui/lib/store.js`; `go('settings')` opens it too. On the phone there is no Settings ("This phone").
- **Appearance** (`src/core/appearance.mjs`): `ui.skin` (orb, vaporwave, retro, profesional, nube), `ui.font`,
  `ui.codeFont` and `ui.codeTheme`. `applyAppearance()` puts them on `<html>` as `data-skin`, `data-font`,
  `data-code-font` and `data-code-theme`, and the CSS reads them: `src/ui/themes.css` (themes; "professional" removes
  the robot in `robot.jsx`, the floating robot, decorative animations and sounds), `src/ui/fonts.css` (typefaces, latin
  and latin-ext only) and `src/ui/code.css` (code colors). Highlighting (`src/ui/lib/highlight.js`, highlight.js with
  common languages) is loaded the first time it is needed (`use-highlight.js`).
- **Window without the Windows title bar (2.6):** `titleBarStyle: 'hidden'` with `titleBarOverlay` (56 px). Minimize,
  maximize and close are the Windows buttons drawn inside the app, top right (with Snap Layouts).
  `src/ui/lib/title-bar.js` passes them the color of the bar they sit on (`app:titleBar`) whenever the theme, light or
  dark mode or width changes. **2.6:** they are no longer the Windows ones (no `titleBarOverlay`): they are drawn by
  `src/ui/components/window-controls.jsx` (IPC `app:window` and the `app:window-state` event in
  `main.mjs`/`preload.cjs`), styled per theme in `themes.css` (`.win-control`); `--wco-inset` is their fixed width with
  `html.has-win-controls`. The top bars (`.app-titlebar` in `app.css`) move the window
  (double-click: maximize) and leave room for the buttons (`--wco-inset`, `.wco-pad`). Without the Windows bar there is
  no menu bar: the `ui.menuBar` setting goes away and the menu remains only for its shortcuts (zoom, Ctrl+J, F11).
- **Windows menu bar (up to 2.5):** `ui.menuBar` (false by default); `applyMenuBar()` in `src/main/main.mjs` shows or
  hides it at startup and on every `config:changed`. When hidden, Alt opens it.
- **Contribute and More apps** (`src/main/feedback.mjs`, in the main process because the window does not go out to the
  internet): the developer's PayPal; feedback via FormSubmit (the same inbox as Open Control Edge) with up to 3 PNG/JPEG
  screenshots of the window or from files; and the other apps with their latest version from GitHub Releases.

## 28. Security

- **Window:** `sandbox` and context isolation, CSP without `eval`, Markdown is rendered without HTML and every call is
  checked in the main process.
- **Approval key:** encrypted by Windows (DPAPI). The engine receives it only in memory and the MCP never has it.
- **Coordinator identity:** its key goes only to its own MCP process (through the SDK, in memory). Only its hash stays in
  the database. With Codex as the brain (2.6), the key and tokens do not go in its arguments (any process could see
  them): they travel in Codex's environment and it passes them by name to the MCP (`env_vars`, `mcpSecrets` in
  `codex.mjs`). In coordinator mode Codex uses `untrusted` + `read-only`, so every command goes through the guard, which
  denies it in `leer`.
- **Pending assistant notices (2.6):** `orchestrator_pending` stores the engine notices not yet answered
  (`keep`/`resume` in `orchestrator.mjs`); when the app closes, the one in progress is repeated when it is reopened, and
  "New chat" does not discard them.
- **Worker identity (2.5):** each agent's MCP process carries `ORB_AGENT_TOKEN`, Orb's signature of who it is and which
  task it works on (HMAC with a key that only exists in the engine's memory and changes on every start; the database
  keeps the hash, `agent_id:*`). The MCP takes agent and task from the signature, not from `ORB_AGENT` or `ORB_TASK_ID`:
  an agent that starts the MCP on its own cannot impersonate another or close someone else's task (`agentToken()` in
  `sessions.mjs`, `identity()` in `src/mcp/server.mjs`).
- **Agents:** clean environment (without the app's secret variables), permission guard, internal data off limits and
  warnings for pushes or mass deletions.
- **Agent text:** when it goes back to the assistant it is marked as "data, not instructions".
- More detail in `docs/historico/AUDITORIA-v2.md` and `docs/historico/AUDITORIA-v2-segunda.md`.

## 29. Packaging, versions and CI

- **Windows installer and Orb Light (portable):** `npm run dist`, or CI when `version` changes on `main` (`.github/workflows/release.yml`).
- The Claude SDK and `zod` go in `app.asar.unpacked`, next to the engine (`build.asarUnpack`).
- The SDK's copy of Claude Code (238 MB) **is not packaged**: the user's is used.
- `build/icon.ico` holds 10 sizes (`npm run icon:ico`).
- **Tests on every push and PR**, on Windows and Linux: `.github/workflows/pruebas.yml`.
- **Installer** (NSIS, per user, no admin): desktop and Start menu shortcut. The release also publishes `latest.yml` and
  the `.blockmap` files, which the updater uses.

**Updates** (`src/main/updater.mjs`, `src/ui/components/update-card.jsx`):
- The installed app uses `electron-updater` with GitHub Releases (`build.publish` in `package.json`; public repository,
  no token). It checks on open (after 15 s) and every 4 h; it downloads nothing until the user clicks **Update**.
- States the window receives (`app:update` event): `checking`, `available`, `downloading` (with `percent`), `downloaded`,
  `none`, `error`, `off`. A card at the top right (below the header: it does not cover the menu or the text box) and an "Updates" card in Settings.
- **Restart and update** (`app:updateInstall`): if tasks are running it asks first; then it stops the engine and calls
  `quitAndInstall` (silent install and Orb reopens). With "Later" it installs when the app closes.
- **Not installed** (Orb Light with `PORTABLE_EXECUTABLE_FILE`, or the program folder without `Uninstall Orb.exe` next to it): it queries the GitHub API (`releases/latest`) and the button opens the download.
- Running from source there are no updates (`off`). `ORB_NO_UPDATE=1` turns them off; `ORB_FAKE_UPDATE=<version>`
  simulates a new version without network (tests); `ORB_UPDATE_URL=http://127.0.0.1:<port>/` uses a local server to
  test an update before publishing it.

## 30. Tests

| Command | What it covers |
|---|---|
| `npm test` | 84 tests (including that the es/en dictionaries match and that the English has no Spanish) of the engine with fake agents (`test/fixtures/fake-live.mjs` via `ORB_FAKE_AGENTS`), the real protocols against fake servers (ACP, codex app-server, Cursor CLI), the guard, sessions, tasks, delegation, Task Review, usage and migrations |
| `npm run test:app` | The whole app with Electron |
| `node test/explora.e2e.mjs` | Walkthrough with screenshots in `test-results/explora/`: first launch ("Preparing your PC", with the folder dialog mocked), every view and Settings section in day and night, the five themes, narrow window. With `ORB_LANG=en`, the same in English (`explora-en/`). Notes go to `notas.txt` |
| `node test/real.e2e.mjs claude,codex,cursor` | **Real agents**: conversations, assistant task, report, undo, approval, steering, queue, fork, Task Review and scheduled tasks |
| `ORB_E2E_EXE=dist/win-unpacked/Orb.exe node test/packaged-live.e2e.mjs` | The packaged app with real Claude |

## 31. How to rework a feature

1. Find the feature in this document and open only its files.
2. Respect the contracts between layers:
   - the live session interface (`live.mjs`);
   - the API actions (`api.mjs`: name and parameters);
   - the events (`session:item`, `session:delta`, `session:queue`, `approval:changed`, `chat:state`, `board:changed`);
   - the `db.mjs` tables (add columns with `ADDED`, never delete them).
3. If the phone uses the action, add it to `ALLOWED` in `remote.mjs`.
4. New strings with `t()` in both languages.
5. A test in `test/` with the fake agent (`fake-live.mjs` recognizes keywords like `LIMITE`, `PIDE_PERMISO`,
   `DELEGA`, `DUERME`…).
6. `npm run check` and `npm test` green before pushing.

## 32. The CORE

The CORE is Orb's heart: request → Orbe plans → tasks → agents working at the same time → pieces merged → verification
→ report → OK. It was rebuilt in 3.1 after a real test that took 2 h 23 min (agents waited for each other, an unanswered
permission ran out the clock, an agent that was not installed got assigned and Cursor could not close its task).

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
- **Orb as the hub:** messages between agents delivered mid-run (`deliverMessages`: Claude and Codex get them on their
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

## 33. Conversations (3.2)

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
- Project icons: `src/engine/project-icons.mjs` (the one chosen in Orb, stored in `.orb/datos/iconos`; otherwise, the
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
- **Orbe's tools:** its MCP server receives `ORB_CONVERSATION`: its questions go to `pending_questions:<id>`, its tasks
  to that conversation, and `orb_set_project` sets that conversation's project (and the working folder for the next
  ones). A conversation without a project takes the one from its first task.
- **Reports:** `queueReport` waits for all of the conversation's tasks to finish and notifies in it. Whatever belongs to
  no conversation (tasks from before 3.2 or from a scheduled task) goes to the last conversation of its project or to a
  new one. Pending notices keep their conversation (`orchestrator_pending`).
- **Completed:** a finished or cancelled task moves to "Completed" on its own (it can be brought back: `sidebar_kept`).
  A conversation is completed with the OK of its report if it has nothing left open, or after a day with no activity
  and nothing pending; a direct one, after a day with no activity. Typing in a completed one reopens it.
- **Search:** filters in the window itself by title, project and task number, and `conversations.search` also searches
  the messages (of both assistant and direct conversations).
- **Migration:** the first time, the old chat is split at its "New conversation" markers into conversations (the earlier
  ones completed; the last one stays open with the assistant's live session) and the assistant's tasks are distributed
  by date.

## 34. Users (3.6)

**What it does.** Several users share one Orb: an owner, who manages it, and the other users. Each one has their own
conversations, bots, projects, reminders, schedules, memories, accounts and devices, and sees only those and what is
shared with them. With a single user all of it is hidden and Orb behaves as 3.5.1. User guide:
[`USERS.md`](USERS.md); the details of the model, authorization, events and loans:
[`PERSONAS-INTERNALS.md`](PERSONAS-INTERNALS.md).

**Files.**
- Data and rules: `src/core/db.mjs` (tables `persons`, `person_settings`, `shares`, `account_loans`, `usage_ledger`,
  `bot_sessions`, `memory_log`, `link_seen`, `audit`; `person_id` on the person-owned tables), `src/core/persons.mjs`
  (people, PINs, strong tickets), `src/core/authz.mjs` + `src/core/policy.mjs` (who may call what; deny by default),
  `src/core/shape.mjs` (what each caller gets back), `src/core/budget.mjs` (own accounts, loans, caps, the ledger),
  `src/core/tz.mjs` (wall-clock times per zone), `src/core/backup.mjs` and `src/core/export.mjs` (backups, export,
  delete, move), `src/core/templates.mjs` (the wizard's templates).
- Engine: `src/engine/api-persons.mjs`, `api-gateway.mjs` (window lock), `api-accounts.mjs`, `api-data.mjs`,
  `router.mjs` (each event only to its audience), `forward.mjs` (workshop calls run as the person of the link).
- Interface: the wizard (`src/ui/views/setup.jsx`), the user menu and the lock screen (`src/ui/components/`), Settings
  › Users / My profile / Data, the share dialog, "Lend to…" in Agents. `state.me` in the store (`persons.me`), read
  again on `persons:switched`; the engine is the authority, the interface only hides.
- Phone and Android: `src/ui/lib/web-bridge.js` sends its protocol (3) on `/api/me` and shows an update screen when the
  Orb needs a newer one; `src/ui/lib/app-bridge.js` adds the fingerprint lock (`appLock`, `OrbNativePlugin.java`,
  Android's BiometricPrompt) and schedules the next 48 h of reminders as local notifications
  (`src/ui/lib/reminder-notes.js`).

**Inside.** Every entry point (window, linked device, workshop link, Orb Núcleo's socket, agents' tools) builds a
principal; `api.call` authorizes it before the method runs. A row without `person_id` is the owner's, so data from
before 3.6 needs nothing. Tests: `personas-modelo`, `authz`, `migracion-36`, `personas-superficies`, `enlace-36`,
`personas-orb`, `prestamos`, `copias`, `exportar-borrar`, `mover-orb`, `zona-horaria`, `plantillas`, `android-36`,
`personas-ui` and the e2e `personas.e2e.mjs`.
