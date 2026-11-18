# 23. God mode (expert view)

Part of [How Orb works](../ARCHITECTURE.md).

- File explorer and viewer, git changes with their diff, history, what is running, account usage, machine load and
  activity, around the chat. PC only.
- It is turned on in Settings › Advanced › God mode; the panels can only be ticked with the mode on.
- Files: `src/engine/host/expert.mjs` and `src/ui/views/expert.jsx`.
- **"Open in":** the project in an editor (only the installed ones: VS Code, Cursor, JetBrains, Windsurf, Zed; the app checks the
  program's signature first, see section 28) or in Explorer (`src/engine/host/editors.mjs`,
  `app.openIn`; programs are launched directly, never through cmd.exe, and by the app — `host.openEditor`,
  `host.openTerminal`, `host.runAction`: the engine names the kind and the folder, the app picks the program by its
  absolute path — so they outlive Orb). core itself and `core\secretos` open in Explorer only with a fresh unlock of the
  master password.
- **Project actions:** each project's own commands (`actions:<project>` on the board, at most 20;
  `actions.list/save/remove`) with a name, a keyboard shortcut and an optional preview, which can only be a page on this
  PC. They are launched from "Actions" or with their shortcut (`ActionShortcuts`: the God mode project, or the working
  folder outside it) in their own terminal window (`app:runAction`: Windows Terminal or PowerShell; CMD if chosen in
  Settings). PC only: the phone cannot launch them.
- The God mode chat is a conversation of the chosen project (the last one opened, or a new one in it) and
  starting one does not leave God mode.
- **Git from God mode** (3.8.8; `src/engine/host/expert.mjs`, API in `src/engine/api/index.mjs`): the git panel
  (`src/ui/components/expert-git.jsx`) lists the local branches (`expert.branches`: name, current, date, remote branch and
  whether it is gone), shows the last commit and whether it can be undone (`expert.lastCommit`), switches to a branch or
  creates one (`expert.switchBranch`, `expert.createBranch`) and undoes the last save (`expert.undoCommit`). Each of the
  three that change something runs while no agent works in the project (`holding`) and is recorded in the activity log. The
  safeguards are in the engine, not in the panel:
  - **Switching** only from a clean tree, never over a file the other branch tracks that already exists here (ignored or
    not), never while a merge or rebase is half done, never leaving the commits of a detached head behind, never with files
    hidden from git by a flag, and never to a branch that is checked out in another worktree or that Orb itself made for
    an isolated task. The branch must exist as typed (`--no-guess`, and a name can never read as an option).
  - **Creating** a branch starts it at the current commit, so nothing in the tree changes; switching to it is checked as a
    switch.
  - **Undoing the last save** is `git reset --soft HEAD~1` (the changes stay staged), only for a commit that no remote
    branch has, that is not a merge and has a parent, on a branch (not a detached head), in the project's own repository
    (not one shared with others) and with no merge or rebase in progress. The window sends the hash it showed
    (`expect`) and the engine refuses if the last commit moved since.
  - **A new empty file** inside a registered project (`expert.createFile`, `createFile`): the name is checked and it never
    overwrites an existing one.
- **Terminal in God mode:** the same integrated terminal of section 27 (`src/ui/components/terminal-panel.jsx`), docked in
  God mode with one tab per terminal. It only writes to the shell when the user presses Enter: a command that Orb puts
  in the input line (a project action, a pasted block) is shown and waits. Its output is wiped when Orb locks.
