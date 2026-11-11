# 16. Scheduled tasks

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** Tasks that repeat on their own: every hour, every N hours, every day or on certain weekdays at a set
time. For example, "every Monday at 9, check the dependencies".
- Each run creates a normal task, with the same approvals and the same usage limit.
- If the previous one is still open, it waits: they do not pile up.
- The ones the assistant creates (`orb_schedule`) need your approval once.

**Files.**
- `src/domain/schedules/schedules.mjs`: `nextRun`, `createSchedule`, `runDue` (called on each `tick`) and `runSchedule`.
- Table `schedules`.
- Screen: `src/ui/views/schedules.jsx`.
- API: `schedules.*`.
