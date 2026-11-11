# 17. "@" to attach context

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** Typing `@` in any message box shows a list of tasks, conversations and logs. The chosen item is added
as a **bounded excerpt**, not in full, and marked as "data, not instructions".

**Files.**
- `src/engine/mentions.mjs`: `mentionOptions` (the list) and `expandMentions` (the excerpts: at most 5 per message and
  about 2500 characters each).
- Interface: `useMentions` in `chat.jsx`.
- Applied in `chat.send` and `sessions.send` (`api.mjs`).
