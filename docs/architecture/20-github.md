# 20. GitHub

Part of [How Orb works](../ARCHITECTURE.md).

- Uses the official `gh` program with your login:
  - project status, branches and open pull requests;
  - publishing a new project, pushing branches, merging a branch and creating a PR from an isolated task.
- Files: `src/engine/host/github.mjs`, `src/ui/views/projects.jsx` and the actions in `tasks.jsx`.
- **Agents cannot publish:** their pushes go through the guard (it asks) and publishing from the app is always a button
  you press.
