# 13. Limited tasks and continuity

Part of [How Orb works](../ARCHITECTURE.md).

- **Usage limit:**
  - if an account hits its limit, the task does not fail: it stays **"Waiting for quota"** (`limited`) with the reset
    time (`limited_until`);
  - it **continues on its own** when usage resets (`resumeLimited()` in the scheduler), in the same agent conversation;
  - meanwhile, new work goes to other accounts.
- **Closing the app:** tasks that were working continue when it is opened again (the `Scheduler` constructor). On a
  normal close, `shutdown()` sets `scheduler.closing` and `finish()` does not close those tasks: they stay `running` and
  are resumed.
- **Task closed by its agent with the process still alive** when the app crashes: at startup, `finish()` does what was
  left (automatic commit, changed files, log, report) and clears its `pid`, so its dependents can continue.
- Both can be turned off in Settings (`continuity.resumeAtReset` and `continuity.resumeAfterRestart`).
