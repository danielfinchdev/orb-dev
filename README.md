<p align="center"><img src="docs/portada.png" alt="Orb·e, your pocket director" /></p>

# Orb·e: Your pocket director

**Orb** is a desktop app for Windows (Linux is planned) to build software with the AI coding agents you already pay for. You
tell it what you need and its assistant, **Orb·e**, plans the work, splits it between Claude Code, Codex, Cursor,
Gemini CLI, OpenCode, Qwen Code and GitHub Copilot, picks the right model for each task and reviews the result before
asking for your OK. An Android app links to it so you can follow and approve the work from your phone.

Everything runs on your PC, with your own accounts: Orb has no cloud server and never sees your agents' passwords.
One PC has one owner: you.

This repository is **Orb.dev**, the app's source code. How it works, in detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
What's new in each version: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Three ways to work

- **Orchestrator** (turn it on with the switch in the chat): Orb·e coordinates the other agents for you. It plans,
  writes a short, clear brief for each task, delegates, supervises and brings back checked results. Good if you do not
  want to think about which agent does what.
- **Manual** (orchestrator off): you choose the agent, the model and the reasoning for each conversation and coordinate
  them yourself, in as many conversations as you like.
- **God mode** (Settings › Advanced): a view close to VS Code around the chat, with files, git changes, history,
  activity and a terminal in the project's folder (Ctrl+J), for those who also want to code by hand.

## Supported agents

Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Qwen Code and GitHub Copilot, each with its own official program and
your own subscription. You can add several accounts per agent: work is spread across the ones with usage left. On
Windows, Orb installs any missing agent (and Git, Node.js, GitHub CLI, Tailscale) with the official installers, for
your user only.

**Cursor:** its free plan does not allow using the agent from other apps. If a task fails for that reason, Orb says so,
pauses Cursor for a day and, if the task was for "any agent", assigns it to another one.

## Download and install

From [**Releases → latest**](https://github.com/danielfinchdev/orb-dev/releases/latest):

- **`Orb-<version>-instalador.exe`**: the app. It installs for your user, without administrator rights, and updates
  itself (each update is signed and checked before it installs). Installed over Orb 3.8.0, it replaces it and keeps
  your data.
- **`Orb-<version>-android.apk`**: the Android app. How to install and link it: [`docs/ANDROID.md`](docs/ANDROID.md).

Windows 10 and 11, with Microsoft Edge WebView2 (already part of Windows 11 and of up-to-date Windows 10). Since the app
is not signed yet, SmartScreen warns you the first time: "More info" → "Run anyway".

**Linux:** planned for a later version. Orb 3.7's Linux builds remain on its release page ([`docs/LINUX.md`](docs/LINUX.md)).

How a version is published: when `version` changes in `package.json` on `main`, CI tests it and builds the installer
(`.github/workflows/release.yml`, which holds no keys); the owner signs it and publishes the release from his PC
(`npm run release:firmar`). The APK is built and signed on the owner's PC and attached to the same release.

## Getting started

1. Open Orb from the Start menu (or `npm start` if you run it from source).
2. Choose its name, what it calls you and where its workspace goes: `C:\Orb` unless you pick another place.
3. If that folder already has things in it (for example an older Orb), Orb shows what it would move into `core` and
   moves nothing of yours until you choose.
4. Create your **master password** (at least 10 characters). It protects Orb's secrets and is what your phone asks
   for when you link it. **It cannot be recovered**: if you forget it, you need the backups' recovery code, or you
   start the secrets from scratch.
5. In **Agents**, check which agents it finds and that they are signed in. If you already signed in to their program
   (for example Codex with your ChatGPT account), nothing else is needed; if not, the button opens the official login.
6. Create a project from the chat (project button under the text box) and ask it for something.

## The workspace

```
C:\Orb\                   (by default; you can pick another folder)
  core\                   Orb's own folder, hidden: settings, database, logs, skills, MCP servers, tools (adb), sealed secrets
  windows\ linux\ ios\ android\ web\
                          categories: each folder inside one of them is a project
                          (the ones the app creates and the ones you create in Explorer)
  multi\<project>\        a multiplatform project: one repository, a folder per platform and compartido\
```

Orb does not let the agents into `core`, and opening it from the app asks for the master password. If `core` is
deleted, Orb brings back what is missing from the latest backup.

## Master password and secrets

The master password wraps a random data key that seals Orb's secrets (the connectors' keys, this PC's keys for your
phones) in `core\secretos`. The password itself is never stored. On this PC Orb opens the secrets on its own (the key
is also sealed by Windows for your user); on another PC, or another Windows user, Orb asks for the password. After 5
wrong attempts in a row Orb waits before accepting another, longer each time.

## Your phone: Magic Link

Settings › Magic Link shows a QR code (or a short code). Scan it with the Android app, check that the fingerprint
matches the one on the PC and type your master password: the phone proves it knows the password without ever sending
it. The phone reaches the PC over your home Wi-Fi or with Tailscale (from anywhere), always end-to-end encrypted, and
it needs the PC on. From the phone you can chat, approve, start tasks and follow them; settings, accounts, backups and
`core` stay on the PC. A phone browser can link too, over the secure Tailscale address.

## Backups

Orb backs up its data every day, outside the workspace (`%LOCALAPPDATA%\Orb\copias` by default, or a folder you choose
in Settings › Data), sealed with this PC's key. A **recovery code** opens them on another PC: that is also how you move
Orb to a new computer.

### Going back to the previous key

If you chose «Empezar con una clave nueva» (start with a new key) and Windows can open the previous key again,
Settings › Data offers to go back to it. Switching applies the next time Orb starts, and the other key is kept aside so
you can switch back later. After switching:

- Backups, approvals and linked devices made with the key you switch to work again; those made with the other key stop
  working.
- Backups made with the other key only open with their recovery code.
- A recovery code created with the other key no longer works on this PC: create a new one afterwards.

## Highlights

- **Tasks under control.** Sensitive actions (publishing, deleting, credentials, payments, high reasoning) wait for your
  approval. Every task can be undone, run in an isolated copy with its own branch and end with an "OK" / "Request
  changes" report. Orb never pushes or publishes without you.
- **The right model for each task.** A fast model for simple things and the most capable one only when needed,
  according to the spending level you set.
- **Independent review.** Task Review asks another model, from another provider when possible, to audit the work;
  Security Review looks for vulnerabilities and exposed secrets across the whole project.
- **Per project:** a whiteboard to draw and attach references, memories, logbooks and scheduled tasks.
- **GitHub integration** through `gh`: publish projects, push branches and create pull requests.
- **In Spanish and English**, with themes, light and dark mode, and skills and MCP servers to extend the agents (Settings › Skills and MCP).

## Run it from source (for development)

1. Install [Git](https://git-scm.com/), [Node.js 22.13 or later](https://nodejs.org/), [Rust](https://rustup.rs/) and the
   Visual Studio C++ Build Tools (what [Tauri](https://tauri.app/start/prerequisites/) needs on Windows).
2. Clone and start it:
   ```bash
   git clone https://github.com/danielfinchdev/orb-dev.git
   cd orb-dev
   npm install
   npm start
   ```
3. To get the latest version: `git pull` and `npm install` before `npm start`.

```bash
npm start               # builds the UI and opens the app (tauri dev)
npm test                # engine tests (fake agents, no accounts)
cd src-tauri && cargo test --lib   # the app's own tests (Rust)
npm run tauri:build:e2e # the test build (its window can stay hidden), then:
npm run test:app        # the whole app with fake agents, on that build
node test/smoke.e2e.mjs # the packaged app (the test build; a release build only in CI)
npm run test:movil      # the mobile web app at phone size
npm run tauri:build     # the installer in src-tauri\target\release\bundle\nsis
npm run android:build   # the Android app in dist\ (see docs/ANDROID.md)
npm run icon            # renders every app icon (Windows, favicon, Android) from build/icon-src/*.svg
```

| Folder | Contents |
|---|---|
| `src-tauri/` | The app (Tauri 2, Rust). Desktop: window, secure bridge, engine startup, sealed keys, the agents' browser with its mini window, notices, updates and the installer. Android: `gen/android` (the Kotlin plugin: keystore, share, QR, dictation, notifications) |
| `src/engine/` | Engine (separate process): API, live sessions, scheduler, orchestrator, logbooks, GitHub, phone access, installer, God mode |
| `src/core/` | Board, permissions, guard, master password and secrets, workspace and core, backups, usage, undo |
| `src/agents/` | One adapter per agent: detect it, launch it and parse its events |
| `src/mcp/` | MCP server used by the agents and the assistant |
| `src/ui/` | UI (React + shadcn/ui components + Tailwind), shared by the PC and the phone |
| `docs/` | All the documentation: index in [`docs/README.md`](docs/README.md) |

## License

[MIT](LICENSE)
