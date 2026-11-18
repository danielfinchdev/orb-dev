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

**3.8.8.**
- **Monthly** (`every: 'monthly'`, `month_day` 1 to 31): a month without that day runs on its last one
  (`nextRun` and `nextLocalRun`).
- **Time zone:** a schedule may carry its own `tz` (an IANA name, checked by `validScheduleTz`); without one it uses the
  owner's, and the wall time stays right across daylight-saving changes. An older schedule has no `tz` and runs as before.
- **Editing and permission:** one dialog in `src/ui/views/schedules.jsx` creates and edits every field (`EDITABLE` in
  `schedules.mjs`), including the permission its runs have (`autonomy`) and whether the end of a run is pushed to the
  phone (`notify_mobile`). «Every N hours» and «same chat» sit under the dialog's «More options».
- **Only stricter from outside:** the phone, a linked browser and the agents may make a schedule stricter, never looser
  (`clampAutonomy`); dropping «ask» or «read only» is this PC's window alone. The task that joins an isolated run keeps its
  «ask», and the next run is worked out before a task is made.
