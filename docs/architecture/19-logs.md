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
