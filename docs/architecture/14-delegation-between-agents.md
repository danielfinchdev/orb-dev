# 14. Delegation between agents

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** An agent working on a task can hand part of it to another agent or model and wait for the result.
- `orb_delegate` creates a subtask; `orb_wait_tasks` waits up to 15 min and returns the results.
- Subtasks hang from their parent task and show up in the task detail.
- **Trusted delegation** (Settings): if the parent task was created by the assistant or by you, and the subtask has
  nothing risky, it goes straight to the queue, at most `delegation.maxPerTask` (4). Otherwise it waits for your approval.

**Files.**
- `src/mcp/server.mjs`: `delegate()` and `waitTasks()`, available only with `ORB_TASK_ID`.
- `src/domain/tasks/board.mjs`: `createTask` with `parent_id` and the trust rule.
- Codex raises its MCP tool timeout to 960 s so the wait fits.
