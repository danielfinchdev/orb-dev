# 15. Task Review

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** Another model audits the work read-only and gives its verdict: **CORRECT** or **WITH ISSUES**, with
the list of problems and what to fix first.
- It goes to **another provider** when there is one: Claude's work is reviewed by Codex, Gemini… Otherwise, the same
  agent with another model.
- It is requested from a finished task or for a whole project.
- The verdict shows up next to the reviewed task.
- **Automatic Task Review** (Settings) reviews every finished task before the report.

**Files.**
- `src/engine/scheduler/index.mjs`:
  - `reviewer()` picks the reviewer;
  - `createReview()` reviews a task;
  - `reviewProject()` reviews a project;
  - `finishNow()` stores the verdict in `review:<id>`.
- API: `tasks.review` and `projects.review`.
- Interface: `askReview()` in `tasks.jsx` and the button in `projects.jsx`.
