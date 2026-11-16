# 32. The CORE

Part of [How Orb works](../ARCHITECTURE.md).

The CORE is Orb's heart: request → Orbe plans → tasks → agents working at the same time → pieces merged → verification
→ report → OK. It is built so that agents do not wait for each other, an unanswered permission does not run out the clock, an agent
that is not installed is never assigned and every agent can close its task.

- **Only available agents** (`Scheduler.refreshAvailable` → setting `agents_available`; `Board.checkAvailable`): Orbe,
  the `orb_*` tools, the app and scheduled tasks only offer and accept agents that are enabled, installed and have an
  account. A queued task for an agent that disappears moves to any agent (except sensitive ones).
- **Accounts and plans** (`engine/usage/plans.mjs`): each account's plan is read from the agent itself (Claude:
  `.credentials.json`, only `subscriptionType`/`rateLimitTier`; Codex: `account/read`; Cursor: `about`). `budget.mjs`
  scales task limits by plan (`PLAN_FACTOR`); the real usage Claude and Codex report still rules. Tasks that write code
  never get a light model (`chooseModel({ writes })`).
- **At the same time** (`Scheduler.tick` → `launch({ isolate })`): if another task is already writing in the folder,
  the new one works in its own copy (worktree) and when it finishes Orb merges it into the folder (`integratePending` →
  `workspace.integrateInto`: three-way merge with `git merge-tree`, all or nothing, without touching branches or the
  index; with a snapshot for undo). If they conflict, a merge task resolves it by hand. Dependents wait for the merge
  (`Board.depsDone`). "One task at a time" (`oneAtATime`) turns it off. Subtasks of an isolated task work in their
  parent's copy.
- **Orb in the middle:** messages between agents delivered mid-run (`deliverMessages`: Claude and Codex get them on their
  next step; those addressed to "orb" reach Orbe as a notice). Cursor gets Orb's tools through a temporary
  `.cursor/mcp.json` (the keys go in an `envFile` outside the project) and the guard rules as `deny` rules in
  `.cursor/cli.json` (`cursorRules`), only during its turn. Each brief carries the files each dependency changed and
  which other tasks are working at the same time.
- **Nothing stalled with the clock running** (`Sessions.watchRun`): the time limit counts only work, not permission
  waits; a permission unanswered within `approvalWaitMinutes` (10 by default) is denied and the agent carries on; a task
  that runs over time is blocked "for review" with its work; an agent that closes its task and does not end its program
  is released (`releaseClosed`); after 10 min of silence it is asked. A task that goes back to the queue continues its
  own conversation. Failed notices to Orbe are retried and the report is never lost.
- **Reviewing is testing:** read-only tasks use the `probar` permission (commands yes, changing files no) and
  verification starts the project and opens the website with `orb_browser_*`.
- **Clear notices:** permissions are explained in plain words (`guard.plainAction`) with the command collapsed, and the
  end of each task is one line with what it did collapsed underneath.
- **Tests:** `test/core-orb.test.mjs` (fake agents) and the real test `test-results/core-real.mjs` with real agents,
  measured with `test-results/informe-core.mjs`.
- **Development control line** (`engine/dev-control.mjs`, `scripts/orb-dev.mjs`): only in unpackaged Orb.dev and with
  `ORB_DEV_CONTROL=1` (`npm run start:control`). It lets you watch and drive the app from the terminal (status, watch,
  approve, allow, send, reply). Local, with a key; the installed Orb never opens it.
