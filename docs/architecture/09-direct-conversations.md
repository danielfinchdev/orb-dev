# 9. Direct conversations

Part of [How Orb works](../ARCHITECTURE.md).

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
