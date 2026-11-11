# 34. Permissions

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** One PC, one owner. Who may do what is decided in one place, `src/domain/security/permissions.mjs`, for three
kinds of caller:
- **This PC** (its Orb window, dev-control and the engine itself): every method.
- **A linked phone or browser** (Magic Link): only the methods the table `METHODS` marks `'remote'` (view chats, tasks
  and projects, send messages, approve or reject, start and stop tasks, read the status…). Settings, accounts, backups,
  Magic Link, this PC's tools and anything that deletes outside a conversation are `'pc'`.
- **An agent** (its MCP tools, `src/mcp/server.mjs`): no API method. Its tools act only on what Orb signed it for
  (`ownsTask`): the coordinator, the tasks of its own conversation (signed with that conversation's key); a worker, its
  task and the subtasks it delegated; a direct conversation with an agent, only the manual task that conversation
  claimed (`orb_claim_next`, offered to direct conversations only; `tasks.claimed_session`). An agent Orb did not sign,
  a signature that ended (its process closed, its conversation deleted), a coordinator without a conversation or with
  another conversation's key gets every tool refused. The lists (`orb_board`, `orb_list_tasks`) show a worker its own
  tasks and a coordinator its conversation's and its projects'; messages are read and delivered only inside the
  conversation of the task they are about (a message to another agent must name one of the sender's tasks); the
  coordinator reads and writes the logs of its conversation's projects and the general one; only the coordinator
  registers projects.

A phone or a browser changes the brain of one conversation only (`chat.settings` with `conversation`; a new one
from the phone takes its brain in `chat.send › brain`): the brain new conversations start with and «Orquestador» are
this PC's (`config.orchestrator`). The state it gets (`app.state`, `remote.mjs › shapeResult`) has no folder of this PC
(`home`, `paths`, the working project's path), and its notifications and their buttons follow the same rule as its
calls (`validDevice`: a phone or a browser, used in the last 30 days, the owner's).

**Files.** `src/domain/security/permissions.mjs` (the table, `principalOf`, `authorize`, `ownsTask`); `src/engine/api/index.mjs ›
call` checks every call before the method runs and refuses one that does not say who makes it (the engine and
dev-control pass `DESKTOP`; the methods get the principal as their second argument); `src/engine/transport/remote.mjs` builds a device's principal and also checks
`REMOTE_METHODS` itself (`guardCall`, with the pictures and the full-access rules); `src/mcp/server.mjs` builds the
agent's `WHO` from its signature (`identity()`, `stillSigned()`).

**Inside.** A method without a line in `METHODS` is refused everywhere: `test/permisos.test.mjs` walks every API method
against the table, checks that a phone or a browser is refused every PC-only method before anything runs, and that an
unsigned or forged agent sees nothing while a signed one stays within its own conversation or task. A phone or a browser
is served only while it has no person: a device with a `person_id` (a 3.7 database) never is, and the phone access
does not open on a database the 3.8 migration (§35) could not finish.
