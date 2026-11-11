# 5. The task board

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** It stores tasks with:
- status: queued, awaiting approval, working, done, failed, blocked, cancelled or **waiting for quota** (`limited`);
- dependencies, agent, model, reasoning;
- where it works: in the project folder or in an isolated copy with its own branch;
- which task it is a subtask of (`parent_id`), which task it reviews (`review_of`) and which scheduled task it comes
  from (`schedule_id`).

**Files.**
- Logic: `src/domain/tasks/board.mjs`.
- Database: `src/domain/data/db.mjs` (tables `tasks`, `events`, `messages`, `chat`, `sessions`, `session_items`,
  `session_queue`, `schedules` and `settings`).
- Screen: `src/ui/views/tasks.jsx` (list, detail, actions and Task Review).

**Signed approvals.**
- A task waits for your approval when:
  - it contains risky words (publish, delete, credentials, payments);
  - it uses high reasoning;
  - or it was created by an agent without trusted delegation.
- Approving signs a hash of what you saw (`src/domain/security/approval.mjs`, HMAC with the encrypted key). If the task changes,
  the signature stops being valid and it asks for approval again (`revalidateQueued`).

**How to rework it.**
- A new status: `STATUSES` in `board.mjs`, plus `STATUS` in `src/ui/lib/labels.js` and the filter in `tasks.jsx`.
- A new column: `ADDED` in `db.mjs` (automatic migration).
