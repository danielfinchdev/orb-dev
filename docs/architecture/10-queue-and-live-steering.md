# 10. Queue and live steering

Part of [How Orb works](../ARCHITECTURE.md).

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
