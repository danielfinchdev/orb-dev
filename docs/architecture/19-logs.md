# 19. Logs

Part of [How Orb works](../ARCHITECTURE.md).

- They are the assistant's memory: one general log and one per project, in `<folder>/bitacora` (the only logs folder),
  outside git.
- **Append-only** at the end, signed and with secrets masked (`redactSecrets`).
- Written by the assistant (`orb_write_log`) and by the scheduler when each task closes (`logTask`).
- 3.8.2, **one log system, Orb's**: `core\bitacora\GENERAL.md` (the user may keep their index, rules and annexes at its
  top; Orb's entries are appended at its end) and `core\bitacora\proyectos\<project>.md` (a deleted project's log ends
  in ` eliminado.md`). Orb never writes a `BITACORA.md` in a project folder nor a `bitacora_project.md`: agents are told
  not to (scheduler brief) and a `BITACORA.md` a project brings when it is added is merged once at the end of its log
  (`board.mergeRootLog`), whole, and removed from the folder only after the log is read back holding it (one git tracks
  stays). A log that changes name (rename, finish, reopen, delete) is merged into a log that already has the new name
  (`board.moveProjectLog`), never left beside it; the header-only `name (2).md` copies earlier builds left are removed at
  start (`home.mjs › tidyProjectLogs`). «Memorias» shows the end of each log (the newest entries) and scrolls to them.
- Files: `src/domain/journal/journal.mjs` and the screen `src/ui/views/logs.jsx`.
- **Activity in plain words** (3.8.8): the activity list (`src/ui/views/activity.jsx`) never shows the engine's internal
  names or JSON. Every kind of event has its label (`src/ui/lib/activity.js › activityLabel`, locale keys
  `activity.kind.<kind with dots as underscores>`), the tools and the states in a detail are said like the rest of the
  interface (`activityDetail`, the labels of the Tareas view), and the raw line stays on hover and when copied.
  `test/actividad-etiquetas-388.test.mjs` fails when a new kind of event is written by the engine without a label in
  both languages, so a new event must bring its words. `activity.list` can also return the totals of each source and level
  for the filters in force.

**One search and quick filters (3.8.11).** The Journal has a single search with "In this one / In all" scopes;
`src/ui/lib/mark-matches.js` highlights hits in the text without touching React's nodes. Activity has the All / You /
Agents / Problems tabs and one row of filters, built by `src/ui/lib/activity-filters.js` (the counts come from the engine).
