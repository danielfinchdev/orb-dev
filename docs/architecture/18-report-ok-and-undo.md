# 18. Report, OK and undo

Part of [How Orb works](../ARCHITECTURE.md).

- When all the tasks of a request in a project finish, the assistant reviews them together (`queueReport`) and gives you
  a report with the **OK** and **Request changes** buttons.
- The OK marks the tasks as accepted and writes it to the log (`accept()` in `api.mjs`).
- **Undo this task** restores only the files the task changed and keeps what you touched afterwards (`undoCheckpoint`
  in `src/domain/tasks/checkpoints.mjs`). Each file goes back to how it was on disk (`git cat-file --filters`: `core.autocrlf`
  line endings, Git LFS); only the files the task created are deleted, and one that cannot be read is left in place with
  a warning.
- Snapshots are taken once per task (follow-ups reuse the first one). At startup `pruneCheckpoints()` deletes those of
  tasks finished more than 30 days ago (copy or refs `refs/orb/t<id>-*`) and copies no task uses.
- Safety warnings on finish: if it looks like a push, if it deleted 10 or more files, or if a read-only task changed
  something (`afterFolderTask`).
