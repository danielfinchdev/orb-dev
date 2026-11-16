# 4. Token-optimized briefs

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** Every brief the assistant writes is compact:
- exact paths, what to change, done criteria and what not to touch;
- it does not copy code or context the agent can read on its own;
- it does not repeat context between tasks: it uses `depends_on` and the next task receives the previous one's result.

**Files.**
- Assistant rules: `src/engine/orchestrator.mjs`, in `persona()` (`ENCARGOS COMPACTOS`).
- What each agent receives: `src/engine/scheduler/index.mjs`, in `promptFor()`. It includes:
  - the brief;
  - what was done before (at most `MAX_DEP_RESULT` characters per dependency);
  - the latest log notes (about 3000 characters);
  - where it works and how to report.
- Size limit: `MAX_DESCRIPTION` in `src/domain/tasks/board.mjs`.
