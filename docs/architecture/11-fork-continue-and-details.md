# 11. Fork, continue and details

Part of [How Orb works](../ARCHITECTURE.md).

- **Fork** copies the conversation from this point to try another idea. Claude and Codex carry their full history
  natively (`forkSession`, `thread/fork`). The others start with a summary. Code: `sessions.fork()` and the button with
  the fork icon.
- **Continue:** a conversation left halfway (the app closed) or at its usage limit shows "Continue" (`sessions.resume()`).
- **Details** ("i" icon): agent, account, permissions, folder, git branch and changes, pull requests, context, task,
  where it comes from and the id of the agent's conversation (`showDetails()` in `session.jsx`).
- **Paginated history:** the last 200 messages are loaded and "See earlier messages" brings more
  (`sessions.items({ before })`).
