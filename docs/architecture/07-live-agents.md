# 7. Live agents

Part of [How Orb works](../ARCHITECTURE.md).

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
2. Its id in `AGENT_IDS` and `DEFAULT_CONFIG.agents` in `src/platform/paths.mjs`.
3. Its icon in `src/ui/components/agent-icon.jsx`.
4. Its installer item in `src/engine/host/installer.mjs`.
