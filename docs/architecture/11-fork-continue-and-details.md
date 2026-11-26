# 11. Fork, continue and details

Part of [How Orb works](../ARCHITECTURE.md).

- **Fork** copies the conversation from this point to try another idea. Claude and Codex carry their full history
  natively (`forkSession`, `thread/fork`). The others start with a summary. Code: `sessions.fork()` and the button with
  the fork icon.
- **Continue:** a conversation left halfway (the app closed) or at its usage limit shows "Continue" (`sessions.resume()`).
- **Details** ("i" icon): agent, account, permissions, folder, git branch and changes, pull requests, context, task,
  where it comes from and the id of the agent's conversation (`showDetails()` in `session.jsx`).
- **Paginated history:** the last 200 messages are loaded and "See earlier messages" brings more
  (`sessions.items({ before })`).

## Moving a chat to a separate copy mid-chat (3.8.12)

`src/engine/chat-copy.mjs` (`ChatCopy`) moves a chat between the project folder and its own git worktree during a
conversation, and back. UI: `src/ui/components/chat-copy.jsx`; the agent can propose it with `orb_copy_propose`
(`src/engine/host/copy-proposal.mjs`), which only shows a card, Orb never moves on its own. Projects without Git do not
offer it.

- **Photos per turn.** Every turn (automatic ones too) takes a «before» photo stored with its turn number
  (`src/domain/conversations/turns.mjs`, `snapshotBeforeTurn`, `turnPairs`). A chat that began without those pairs
  cannot move.
- **Attribution.** What belongs to the chat is the union, turn by turn, of «photo before → photo after»; never from one
  turn to the next, which would mix in the user's edits. Changes that are not the chat's stay in the folder; files
  changed by both are asked about; ignored and secret-looking files do not travel. A moved `HEAD` blocks the move.
- **Steps and rollback.** The state is written in the chat's `chatwt:` record: undo point of the folder, copy from the
  current commit, apply the chat's changes there, take those files out of the folder with a path-filtered
  `undoCheckpoint` (the index is not touched), switch `cwd`. A cut-short or failed move is finished or fully undone
  (folder, copy, branch, `cwd`, `cli_session`); a new move is refused while an earlier one is unresolved.
- **Same conversation.** Claude's session file is found by id in the account's config folder and copied to the new
  folder's name (`followClaudeSession`); Codex and ACP agents resume with the new folder; if not possible the chat
  continues with a summary.
- **Rewind.** Rewinding across the folder change is blocked in the engine (`rewind.mjs`, `rewindFiles`), not only in
  the UI.
- **Back.** «Unir» merges the copy into the folder with an undo point owned by the chat (`chatcp:`), shown as «Deshacer
  la unión»; conflicts are resolved by the agent inside the copy. Undoing keeps the user's edits and the chat's work.
  «Descartar» removes the copy and branch after confirmation.
