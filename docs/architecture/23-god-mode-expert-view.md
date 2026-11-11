# 23. God mode (expert view)

Part of [How Orb works](../ARCHITECTURE.md).

- File explorer and viewer, git changes with their diff, history, what is running, account usage, machine load and
  activity, around the chat. PC only.
- It is turned on in Settings › Advanced › God mode; the panels can only be ticked with the mode on.
- Files: `src/engine/host/expert.mjs` and `src/ui/views/expert.jsx`.
- **"Open in":** the project in Cursor or VS Code (only the installed ones) or in Explorer (`src/engine/host/editors.mjs`,
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
