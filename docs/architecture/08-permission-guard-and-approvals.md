# 8. Permission guard and approvals

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** It balances being able to do things with safety. For each agent action it decides:
- **allow** the normal stuff: reading, editing in its folder and ordinary commands;
- **ask** about risky things with an Allow, Always allow or Deny card: push, `gh`, publishing packages, download and
  run, sending data, deleting folders, changing the system, killing processes, ssh, rewriting git or Docker;
- **deny** what is never OK: touching the assistant's internal data (all of `core`, but the isolated copies).

**Permission modes.**

| Mode | What it can do |
|---|---|
| `leer` | Only look |
| `probar` | Read and run (tests, builds, a dev server); no file changes. Reviews and verifications |
| `auto` | 3.8.3, the default («Auto»). Works without questions inside the project (its folder or isolated copy, `core\preparacion` and the temporary folders): edits, deletes folders, rewrites git history there, since the task's checkpoint undoes it. Asks before publishing (unless the user's own message asked: `userAsked`), sending data, writing outside the project, the system, other processes, Docker. Wiping a disk is denied |
| `editar` | «Preguntar». Edits and runs inside the project; risky things and writing outside the project ask |
| `preguntar` | «Preguntar todo». Asks before every command |
| `total` | Almost the whole PC. Master password (5-minute unlock), dropped when Orb locks |

**3.8.3: «Auto».** The chat's switch (`src/ui/components/autonomy-switch.jsx`: «Auto» / «Preguntar», «⋯» for the rest) and
the global level (`orb.json › permissions.mode`, Ajustes › Agentes, `permissions.setMode`, also from the phone) decide a
chat's and a task's permission (`guard.mjs › globalAutonomy`, `autonomyOf`, `permissionOfAutonomy`). Inside/outside is
decided by resolved path (`projectRoots`, `resolveTarget`, `insideProject`, `writesOutside`: links, junctions, 8.3 names,
UNC paths to this PC, `..` and case). Always denied, in every mode: Orb's data (core but its open folders), the owner's
personal credentials (`defaultPersonalRoots`: SSH keys, browser profiles, the agents' logins, Windows' credential store,
Orb's app data), another project's secrets (`isSecretFile` outside the project) and raising privileges. Tasks: in «Auto»
keyword tags for credentials and deletions, high reasoning and same-project subtasks no longer wait (`board.mjs ›
createTask`); payments, emails, publishing not asked for, moved folders and other projects' tasks still do. A task's level
and what the user asked for are columns (`tasks.autonomy`, `tasks.user_asked`) and enter its signature only when set
(`approval.mjs › contentHash`). After a folder task, `scheduler/safety.mjs › deletionHold` holds it for review when it
deleted more than 50 files or more than 25 % of the project («Preguntar»: 10), without generated folders. The assistant
(Orbe) has only `mcp__orb` pre-allowed, works in its own folder outside core (`orchestrator.mjs › assistantDir`) and
never gets an extra folder that holds core (`safeAddDirs`).

**Files.**
- Decision: `src/domain/security/guard.mjs` (`decide`, `RISKY` and `riskOf`).
- Each adapter calls it at its permission point: `canUseTool` in Claude, `requestApproval` in Codex and
  `request_permission` in ACP.
- Cards:
  - in conversations, `ApprovalCard` in `src/ui/views/session.jsx`;
  - in the chat, `ChatApproval` in `chat.jsx` (the tasks' ones);
  - in the sidebar, "To approve".
- Engine: `sessions.respond()`, `approvals.list` and `chat.approve`.

**How to rework it.**
- Adding or removing risky commands: the `RISKY` list in `guard.mjs`, one line per rule with its reason.
- A task waiting for permission also notifies in the chat (`sessions.onApproval` in `engine.mjs`).
