# 6. The scheduler

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** Every 1.5 s, and as soon as the board changes:
1. Launches the ready tasks (approved and with their dependencies done).
2. Picks agent and account.
3. Prepares where they work.
4. When each one finishes: saves the result, runs the safety checks, writes to the log and notifies.

**Files.** `src/engine/scheduler/index.mjs`:
- `tick`: each round.
- `launch`: launching a task.
- `finishNow`: closing a task.
- `promptFor`: the brief the agent receives.
- `explainFailed`: explaining a failure.
- `queueReport`: the final report.

**Assignment.**
- Candidates: only **enabled and installed** agents (`installed()` in `src/agents/index.mjs`) and their accounts with quota left.
- Order: by each account's real usage (section 12) and, if there is no real data, by tasks launched.
- `maxParallel` tasks at once and `perAgent` per account.
- In the project folder, only one writing task at a time. Read-only tasks and isolated copies run in parallel; a
  subtask does not wait for its parent task.

**Work modes.**
- `carpeta`: works in the project folder. A "snapshot" is taken first (`takeCheckpoint`) so it can be undone. A
  repository with no commits (just `git init`) also works: the snapshot is a first commit with no parent.
- `aislada`: its own branch and copy (`prepareWorkdir`, git worktree). When it finishes an automatic commit is made,
  which is blocked if there are files that look like secrets.
  Once the user joins it («Unir», `projects.merge`) or discards it (`tasks.discardBranch`), its copy and branch are
  removed and the task's `branch` is emptied (`dropCopy`), so copies do not pile up and Tasks stops offering them.

**Failures explained.** `src/shared/agent-errors.mjs` translates the failure:
- plan without access, not signed in (including "API key is missing"), model not available, no network or missing program.
- If the task was for "any agent", it moves to another one.
