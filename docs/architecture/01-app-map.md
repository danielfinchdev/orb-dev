# 1. App map

Part of [How Orb works](../ARCHITECTURE.md).

```
Window (React, WebView2)  ──commands──►  App (Tauri 2, Rust)  ──JSON lines──►  Engine (bundled Node)
src/ui/** + tauri-bridge.js             src-tauri/src/*.rs               src/engine/engine.mjs
                                                                         ├─ api/             window actions
                                                                         ├─ sessions.mjs     live conversations
                                                                         ├─ scheduler/       tasks
                                                                         ├─ orchestrator.mjs the assistant
                                                                         └─ transport/       stdio, phone access (Magic Link)
Agents (processes)  ◄── adapters src/agents/*.mjs (live) ──┘
   └─ each agent loads Orb's MCP server: src/mcp/server.mjs (the shared board)
Data: <workspace>/core/datos/orb.db (SQLite, src/domain/data/db.mjs)
```

- **There is no web server for the window.** The window talks to the engine through the app's own commands (Tauri's
  IPC, only from Orb's window: `src-tauri/capabilities`, `lib.rs › only_main`), relayed over the engine's stdin/stdout. The
  only server is the phone access (section 22), which is off by default and only listens on the home network and
  Tailscale addresses.
- **The engine** is a separate process: the bundled `node.exe` (Node 24, `scripts/tauri-resources.mjs`) in a Job Object,
  speaking one JSON message per line on stdin/stdout (`ORB_ENGINE_STDIO=1`, `src/engine/transport/stdio.mjs`; console output goes
  to stderr; `src-tauri/src/engine.rs`, `pipes.rs`). If it crashes, the app restarts it, up to three times. It asks the app for
  what only the app can do — open a link or a folder, start a program that outlives Orb — with `host.*` messages
  (`src/engine/host/host.mjs`). Orb's own Node scripts for the agents run with `ORB_NODE` (the bundled `node.exe`) or the
  engine's runtime (`src/agents/common.mjs › nodeRuntime`). The Tauri installer installs per user
  (`%LOCALAPPDATA%\Programs`), a folder any program of the user can write: the agents' guard keeps it read-only for them
  (`guard.mjs › setAppRoots`, `workspace-layout.mjs › appInstallDir`), which does not stop other programs. A per-machine
  install (Program Files, writable only by administrators: NSIS `installMode: "perMachine"` or `"both"`) is the option for
  whoever wants that; it is not the default because it asks for administrator rights.
- **The agents** are the official programs the user already has (Claude Code, Codex, Cursor, Gemini CLI…), with their
  own session. Orb never sees credentials.
- **Layers**: `src/shared` (pure), `src/platform` (Node infrastructure), `src/domain` (the rules), `src/agents` (the
  adapters), `src/engine` (the services that put them together), `src/mcp` and `src/ui`; see section 0 for what each may
  import.
- **Only coding.** Orb coordinates coding agents and nothing else: what older versions had around it (the PC monitor,
  Opti Bot, the bots) is gone. For old data only: `domain/data/legacy/retired.mjs` archives Opti Bot's old conversation once and
  expires its waiting proposals, deleting nothing; `loadConfig` drops the old `monitor`, `bots` and `oce` settings; the
  3.8 migration archives the rest (section 35).
