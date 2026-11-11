# 3. The chat with the assistant

Part of [How Orb works](../ARCHITECTURE.md).

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
- **Brain catalog** (`models.catalog`, `src/engine/usage/catalog.mjs`): installed agents with their models (the configured
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
