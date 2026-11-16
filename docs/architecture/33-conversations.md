# 33. Conversations

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** Each conversation with the assistant is its own: it has a title, project, brain and status, shows up
in the side menu and can be resumed whenever you want. The assistant can reply in several at once, and each task
belongs to the conversation that asked for it: its report goes back there.

**Files.**
- Data: table `conversations` (`src/domain/data/db.mjs`); `chat.conversation_id` and `tasks.conversation_id`. Board
  (`src/domain/tasks/board.mjs`): `createConversation`, `updateConversation`, `setConversationDone`, `setConversationProject`,
  `conversationOfTask` (the task's own, or that of the task it comes from: subtask, review, merge) and `openTasksOf`.
  `addChat(role, body, meta, conversation)` infers the conversation from `meta.task` when not given.
- Engine: `src/engine/orchestrator.mjs`. `Orchestrator` keeps one `Lane` per conversation (queue, live process, live
  text); up to `orchestrator.parallel` (3 by default) reply at once and the rest wait their turn.
- Titles: `src/shared/titles.mjs` (a quick one taken from the first message) and `src/engine/titles.mjs` (the lightest
  model of the conversation's agent writes one of 2 to 5 words; not with the test agents).
- Project icons: `src/engine/project-icons.mjs` (the one chosen in Orb, stored in `core/iconos`; otherwise, the
  favicon or app icon found in the folder) and `src/ui/components/project-icon.jsx` (with no icon, its initials in a
  color fixed for that name).
- Interface: `src/ui/components/sidebar.jsx` (search box with filter, "To approve", Projects, Conversations and
  Completed, each conversation's bubble), `src/ui/views/chat.jsx` (`ChatView` by `route.id`, `BarTitle` and
  `BarHeading` in the middle of the bar) and `src/ui/views/session.jsx` (the same bar in direct conversations).

**Inside.**
- **Context:** each conversation stores the id of its agent's conversation (`session_id`), its turns and how full its
  context is. A conversation resumed after more than 6 h starts fresh with the usual summary (logs, project,
  whiteboard) and its last messages, without loading the whole long conversation: the logs are the memory. The process
  of an unused conversation is closed after 10 minutes and resumed when you type.
- **Orbe's tools:** its MCP server's grant names its conversation: its questions go to `pending_questions:<id>`, its tasks
  to that conversation, and `orb_set_project` sets that conversation's project (and the working folder for the next
  ones). A conversation without a project takes the one from its first task.
- **Reports:** `queueReport` waits for all of the conversation's tasks to finish and notifies in it. Whatever belongs to
  no conversation (old tasks or those of a scheduled task) goes to the last conversation of its project or to a
  new one. Pending notices keep their conversation (`orchestrator_pending`).
- **Completed:** a finished or cancelled task moves to "Completed" on its own (it can be brought back: `sidebar_kept`).
  A conversation is completed with the OK of its report if it has nothing left open, or after a day with no activity
  and nothing pending; a direct one, after a day with no activity. Typing in a completed one reopens it.
- **Search:** filters in the window itself by title, project and task number, and `conversations.search` also searches
  the messages (of both assistant and direct conversations).
- **Old data:** the first time (a database from before 3.2), the old chat is split at its "New conversation" markers into conversations (the earlier
  ones completed; the last one stays open with the assistant's live session) and the assistant's tasks are distributed
  by date.
