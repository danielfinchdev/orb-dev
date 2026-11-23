# How Orb works, feature by feature

This document explains each feature on its own: what it does, how it is used, which files implement it and how it works
inside. It is meant for reworking **one specific feature** without touching the rest. Each section says which files to
change and which other features it connects to.

> **Orb's idea does not change:** a chat with an assistant that, when you tell it about a project, writes token-optimized
> briefs and splits them among several AI agents from different providers, which work at the same time and in a
> coordinated way. Then it reviews what they did and asks for your OK.

## Sections

Each section is its own file in [`architecture/`](architecture/). Open only the one for the feature you are changing;
section numbers (§N) used across the docs and code comments match the file prefix.

| § | Section | What it covers |
| --- | --- | --- |
| 0 | [Code structure and dependency rules](architecture/00-code-structure-and-dependency-rules.md) | Layers of `src`, what each may import and the test that enforces it. |
| 1 | [App map](architecture/01-app-map.md) | How the window (React), the app (Tauri/Rust) and the engine (Node) talk, and where each lives in the code. |
| 2 | [First launch and the assistant folder](architecture/02-first-launch-and-the-assistant-folder.md) | First launch, the welcome and how the workspace folders (categories, core, tools, older folders) are laid out. |
| 3 | [The chat with the assistant](architecture/03-the-chat-with-the-assistant.md) | The main chat: how a request becomes tasks, the orchestrator and its tools. |
| 4 | [Token-optimized briefs](architecture/04-token-optimized-briefs.md) | How the assistant writes compact briefs for agents. |
| 5 | [The task board](architecture/05-the-task-board.md) | The task board: task fields, states and storage. |
| 6 | [The scheduler](architecture/06-the-scheduler.md) | Who runs each task and when: slots, limits, models and the scheduler loop. |
| 7 | [Live agents](architecture/07-live-agents.md) | Agent adapters (Claude, Codex, Cursor, ACP…) and their live processes. |
| 8 | [Permission guard and approvals](architecture/08-permission-guard-and-approvals.md) | The command/permission guard, its levels and the approval cards. |
| 9 | [Direct conversations](architecture/09-direct-conversations.md) | Talking straight to one agent in a project folder. |
| 10 | [Queue and live steering](architecture/10-queue-and-live-steering.md) | Queued messages and steering an agent while it works. |
| 11 | [Fork, continue and details](architecture/11-fork-continue-and-details.md) | Forking, continuing a conversation and the details panel. |
| 12 | [Context and real usage](architecture/12-context-and-real-usage.md) | Context size, compaction and real plan usage without burning tokens. |
| 13 | [Limited tasks and continuity](architecture/13-limited-tasks-and-continuity.md) | Usage limits, paused tasks and how work continues after a limit. |
| 14 | [Delegation between agents](architecture/14-delegation-between-agents.md) | An agent handing part of its task to another agent or model. |
| 15 | [Task Review](architecture/15-task-review.md) | Read-only review of a task by another model (CORRECT / WITH ISSUES). |
| 16 | [Scheduled tasks](architecture/16-scheduled-tasks.md) | Recurring tasks: schedules and how they run. |
| 17 | ["@" to attach context](architecture/17-to-attach-context.md) | Typing `@` to attach tasks, conversations and logs as context. |
| 18 | [Report, OK and undo](architecture/18-report-ok-and-undo.md) | The final report, the OK, exact undo of a request and its preview. |
| 19 | [Logs](architecture/19-logs.md) | The assistant's logs (bitácoras): general and per project. |
| 20 | [GitHub](architecture/20-github.md) | GitHub integration through the `gh` CLI. |
| 21 | [The agents' browser](architecture/21-the-agents-browser.md) | Orb's own browser for agents (`orb_browser_*`) and the mini window. |
| 22 | [Mobile](architecture/22-mobile.md) | Phone and remote browser: Magic Link pairing, linked devices, encryption and notifications. |
| 23 | [God mode (expert view)](architecture/23-god-mode-expert-view.md) | Expert view: files, git, processes, usage and machine load. |
| 24 | [Installer and session detection](architecture/24-installer-and-session-detection.md) | Detecting and installing agents and existing sessions. |
| 25 | [Skills and MCP servers](architecture/25-skills-and-mcp-servers.md) | Skills and MCP servers in `core`: install, expose and permissions. |
| 26 | [Languages](architecture/26-languages.md) | Spanish/English UI and how texts are translated. |
| 27 | [Interface](architecture/27-interface.md) | Sidebar, inbox, Orb UI 2.0 tokens and themes, "More options", performance, tutorials, Settings and the whiteboard fonts. |
| 28 | [Security](architecture/28-security.md) | Security measures: window hardening, approval key, connectors, agent identity and what the phone never sees. |
| 29 | [Packaging, versions and CI](architecture/29-packaging-versions-and-ci.md) | WebView2, the Windows installer, releases, the updater and CI. |
| 30 | [Tests](architecture/30-tests.md) | Test commands and what each one covers. |
| 31 | [How to rework a feature](architecture/31-how-to-rework-a-feature.md) | Checklist for changing one feature without breaking the rest. |
| 32 | [The CORE](architecture/32-the-core.md) | The CORE pipeline: request → plan → parallel agents → merge → verification → report. |
| 33 | [Conversations](architecture/33-conversations.md) | Assistant conversations: title, project, brain, status and lists. |
| 34 | [Permissions](architecture/34-permissions.md) | Who may do what (`permissions.mjs`): this PC, a linked phone or browser, and agents. |
| 35 | [From 3.7 to 3.8 (migration)](architecture/35-from-37-to-38-migration.md) | The one-time migration of 3.5–3.7 data folders to the 3.8 format. |
| 36 | [The workspace and core](architecture/36-the-workspace-and-core.md) | The workspace (`C:\Orb`): its folders, moving it, backups, a missing `core` and its protection. |
| 37 | [The master password and Magic Link](architecture/37-the-master-password-and-magic-link.md) | The master password, the vault, Magic Link sign-in, Windows Hello, the recovery code and the link code. |
