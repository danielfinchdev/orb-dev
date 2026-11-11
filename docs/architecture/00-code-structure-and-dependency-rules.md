# 0. Code structure and dependency rules

Part of [How Orb works](../ARCHITECTURE.md).

Since 3.8.3 the JavaScript code is split into layers. Each layer may import only the layers below it; the check is
automatic (`test/arquitectura.test.mjs` reads the import graph of `src` and also fails on any import cycle).

```
shared  ←  platform  ←  domain  ←  agents  ←  engine
   ↑                       ↑
   ui (shared only)        mcp (shared, platform, domain, agents; never engine)
src-tauri (Rust): independent; its contract with the engine is protocol.rs and the JSON messages
```

| Layer | Folder | What it holds | May import |
|---|---|---|---|
| shared | `src/shared/` | Pure code with no Node or React: translations and locales, product and folder names, appearance, attachment kinds, the phone link's payload and crypto, chat deltas, feed, music, notes, time zones, titles, slash commands, agent errors, text helpers (`text.mjs`), secret patterns (`secrets-scan.mjs`), the event catalog (`events.mjs`) | nothing |
| platform | `src/platform/` | Node with no business rules: `paths` (every path of a workspace), `config-file` (orb.json defaults and reading), `config` (saving and validating settings), `context` (the process's workspace and settings), `state` (the registry of the settings table's keys), `log` (Orb's own logs), `proc`, `proc-list`, `proc-win` (starting, listing and stopping programs), `git`, `fsx`, `keys`, `journal-files`, `dev-tools` | shared |
| domain | `src/domain/<area>/` | The rules, without long-lived processes: `tasks` (board, checkpoints), `security` (guard, channel permissions, approvals, master password, connector secrets, agent auth), `usage`, `projects`, `schedules`, `conversations`, `extensions`, `workspace` (creating it, the core folder), `data` (database, backups, `legacy/` for older versions' data), `journal` (the logs people read) | shared, platform |
| agents | `src/agents/` | One adapter per CLI (Claude, Codex, Cursor, ACP agents), the live process, login | shared, platform, domain |
| engine | `src/engine/` | The long-lived services: `engine.mjs` (entry point, started by the app by this path), `orchestrator.mjs`, `sessions.mjs`, `scheduler/` (the class in `index.mjs`, its parts beside it), `api/` (the window's methods), `transport/` (stdio, the phone server, Web Push), `browser/` (the agents' browser), `host/` (what starts this PC's programs and tools), `security/` (grants, secret requests), `usage/` (models and plans) | everything above |
| mcp | `src/mcp/` | Orb's MCP server for the agents and its launchers (separate processes) | shared, platform, domain, agents |
| ui | `src/ui/` | The window: `app/` (wiring such as the engine events hook), `lib/` (state in `state.js`, actions in `store.js`, bridges, pure helpers), `components/` (`conversation/` holds what the chat and an agent's conversation share), `views/` (`settings/` is one file per group of sections) | shared and itself |

One way to do each thing:

- **Paths**: `platform/paths.mjs › paths(home)`. The Rust side names a few of the same folders; `test/rutas-rust.test.mjs`
  checks they match.
- **User settings (orb.json)**: defaults and reading in `platform/config-file.mjs`, saving and validation in
  `platform/config.mjs › saveConfig`, the loaded copy in `platform/context.mjs › ctx.config`.
- **Internal state (the settings table of orb.db)**: every key or prefix is registered in `platform/state.mjs ›
  STATE_KEYS`; `test/estado-claves.test.mjs` fails on a key the code uses that is not there.
- **Orb's own logs**: `platform/log.mjs` (rotation, one line per call, secrets hidden). The logs people read are
  `domain/journal`.
- **Processes**: `platform/proc.mjs` (`cleanEnv`, `killTree`, `readOutput`, `IS_WIN`), `proc-list.mjs`, `proc-win.mjs`.
- **git**: `platform/git.mjs › git()` (never throws).
- **Events**: the names live in `shared/events.mjs`; `test/superficie.test.mjs` checks the engine sends exactly the
  listed ones and the window listens only to listed ones.
- **The public surface**: `test/superficie.test.mjs` compares the RPC methods with their channel and unlock rules, the
  events, the default settings, the database schema and the phone protocol numbers with
  `test/fixtures/superficie.json`. Changing any of them is a decision: regenerate the snapshot on purpose
  (`node test/superficie.test.mjs --write`) and say why in the commit.
