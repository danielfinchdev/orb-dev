## Download

- **`Orb-3.8.2-instalador.exe`** (the Windows app): installs for your user, without administrator rights, and updates
  itself. It needs Microsoft Edge WebView2, which Windows 11 and an up-to-date Windows 10 already have (if it is
  missing, the installer gets it).
- **`Orb-3.8.2-android.apk`**: the Orb app for Android. Link it to your PC with Magic Link.

Windows 10/11. Since it isn't signed yet, SmartScreen warns you the first time: "More info" → "Run anyway".

## What's new in 3.8.2

**Full PC access, with your password.** In a chat without a project, the permission selector offers «Acceso total al
PC»: the agent can work outside `C:\Orb`, use the terminal and Orb's browser. It asks for the master password, lasts
until you set the chat back to «Solo lectura» and goes away when Orb locks. Orb's data, its secrets and your protected
items stay closed. «Acceso total» in project chats now works the same way.

**Test Android apps from Orb.** Orb brings its own adb (downloaded and checked the first time it is needed). Pair your
phone over wireless debugging with a QR code in Settings › Android, or start an emulator already installed on the PC.
In a chat with «Usar mi móvil Android», agents can install an APK, take screenshots, tap and type, read logcat and open
the app.

**Attach any file.** «Adjuntar» takes pictures, videos, PDFs, documents and more (up to 10 files of 100 MB each), and
every agent can use them: videos arrive as frames, documents as their text. «Capturar ventana» attaches a picture of
any window, and attached PDFs and pictures open inside Orb.

**Dictation.** A microphone next to «Enviar» opens Windows voice typing.

**Usage.** Reload your plans' usage from the usage panel, and open the new «Uso» page: cost and tokens by day, agent and
model for the last 7, 30 or 90 days, and each plan's limits with an even-pace mark.

**Chats.** Snooze a chat until a time, rename it from the list's ⋯ menu, continue a direct conversation with another
agent, and type `/clear` or `/compact`. The chat bar keeps the bell and pause, and everything else moves to its ⋯ menu.
Messages show their time on hover and the cost line can be hidden (Settings › Appearance). Formulas and Mermaid
diagrams render in messages, and Claude and Codex subagents show as folding rows.

**Tasks and schedules.** A finished task lists the files it changed, each with its diff. Schedules can run once at a
date and time, or always in the same chat.

**Search and Ctrl+K.** The sidebar search also finds tasks by what they say, and Ctrl+K opens a palette to jump to
chats, tasks, projects and Orb's screens.

**A terminal under the chat.** A direct conversation's ⋯ menu docks your own terminal under it, in its folder. Command
blocks in the chat get «Pegar en el terminal», which fills the line and never runs it for you. Ctrl+J still opens your
usual terminal.

**The agents' browser.** Point at an element of the page to add it to your message, and record what the agent does as a
video saved with the chat's attachments. Every agent, Codex included, uses Orb's browser, which keeps away from your
protected sites; Claude in Chrome is no longer started.

**Secrets on a private card.** An agent can ask for a token or a password. You type it on a card that only this PC
shows; it reaches one command and never the chat, the logs or your phone, and you can keep it in the vault. Orb never
asks for your master password there and refuses it if you type it.

**«Cristal» theme and music.** A new glass theme built on Profesional, with no animations. On Windows, optional
background music for studying or coding and music in each mini-game, off by default and downloaded the first time you
press play.

**Settings.** Clearer, shorter texts everywhere. GitHub, the version and the licence are back at the foot of the
settings list. Linking a device now chooses phone or browser and Tailscale or local network inside the QR dialog.

**Smaller things.** F5 reloads Orb. The first-run welcome opens maximised and without scroll bars. Dragging and resizing
the window is smoother. Linked phones say «El PC necesita atención» when updating Orb's data failed on the PC instead of
showing it offline. Tooltips stay whole at the window's edge, and chat avatars with four or more agents fit.

**Fixes.** No more «(2)» copies of project logs, and a `BITACORA.md` that a project brings is merged once into its Orb
log. Stronger permission guard (local network shares, drive aliases, elevation and copies of a protected folder's
parent are blocked) and adb checked before every use.

## What's new in 3.8.1

3.8.1 is the first public release of Orb 3.8: it includes everything listed under 3.8.0 below, compared with 3.7.

**Breaking changes.**
- **Backups made before 3.8.1 can't be restored**, including those made by Orb 3.7. Make a new backup after installing.
- Key files from Orb 3.8.0 test builds are not opened: Orb offers «Empezar con una clave nueva» and deletes nothing.
- **A clean install is recommended**: install 3.8.1, create your master password and link your phone again.

**A lighter desktop app.** Orb no longer runs on Electron: it is built with Tauri 2 and uses Windows' own WebView2.
The download is smaller and the agents' browser runs in hidden WebView2 pages.

**The Android app, rebuilt.** Built with Tauri 2 as well, about half the size. From a notification you can reply,
approve or reject without opening the app, also when it is closed (only with the phone unlocked). Links open in the
phone's browser.

**Secrets guarded by Orb itself.** The master password, Orb's secrets and this PC's key are opened in a separate,
locked-down vault inside the Orb program, not in the engine that runs your agents. Connector keys go straight to the
connector that needs them, and the phone's link check happens in the vault too.

**Lock when idle.** Orb locks its window after a time without use (5, 10, 15, 30 or 60 minutes; 15 by default, in
Settings › Data) or with «Bloquear ahora», and asks for the master password to come back. Agents, schedules and the
phone keep working, and notifications hide the agents' text while Orb is locked.

**Core data guarded by the master password.** Agents can't read or change `core` (including its data) or your
`personal` folder without your password; only the tool folders stay open to them.

**Smoother and lighter.** The robot only floats when something is happening, the animated backgrounds cost much less
GPU (the «orb» clouds run at 30 fps, Vaporwave's floor moves on the compositor), live task bars stop polling when the
window is hidden, and screens with many chats, tasks and projects are faster. Chat avatars show the agents working in
them.

**Fixes.** Restoring a backup on another PC keeps your recovery code working; starting with a new key never deletes
an unused key file; the agents' browser blocks Orb's own ports whatever host name points to this PC; skills and MCP
servers are checked before they are used; deleting a project is safer.

**Gone for now.** Orb Light (the portable version) and the Linux desktop app. Linux will come back in a later version.

## What's new in 3.8.0

**Orb is a multi-agent coding app again.** 3.8 goes back to what Orb is for: one app on your PC that coordinates the
AI coding agents of your own subscriptions (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Qwen Code, GitHub
Copilot), with the orchestrator, manual mode and God mode. One PC has one owner, and your phone links straight to it.

**Removed.** These features are gone: bots, bot groups and their memories, reminders, Casa (Home Assistant),
Optimus and the Open Control Edge bridge, Orb Server (and its browser, password vault and administration), links
between Orbs, Orb Terminal, bot replicas, the Connections panel, several users per Orb (Admin / Users, PINs and the
phone lock), lending accounts, sharing projects, «Mover a otro PC» and the «Orb | Bots» switch. The God mode terminal
(Ctrl+J) stays. To move to a new PC, restore a backup there with your recovery code.

**What happens to your 3.7 data.** The first time 3.8 opens, before changing anything, Orb makes a full copy of the
3.7 database (`core\datos\orb-pre-3.8.db`) and an archive you can read (`core\archivo-3.7\`): your bots with their
conversations, memories and reminders, and each other user with their conversations, tasks, projects and devices.
Then it removes them from the live data. Your own chats, tasks, projects, schedules and accounts stay as they were.
If the update cannot finish, Orb does not run on half-updated data: it shows what happened, where the copy is, and a
«Reintentar» button. Other users' signed-in agent sessions are deleted (they sign in again on their own Orb); the
archive and the copy are included in your backups. Settings › Data › «Datos de Orb 3.7» shows how much they take and
deletes them when you no longer need them. If you used Home Assistant, revoke the token you gave Orb.

**A new workspace: `C:\Orb` with `core`.**
- The workspace is `C:\Orb` by default: a hidden `core\` folder with everything Orb needs (settings, database, logs,
  MCP servers, tools such as adb, sealed secrets) and the categories `windows`, `linux`, `ios`, `android`, `web` and
  the new **`multi`**: a multiplatform project in one repository, with a folder per platform and `compartido\`.
- Updating from 3.7, Orb's own data (`.orb`, `orb.json`) moves into `core` by itself. For your folders (`bitacora`,
  `android\adb-tools`, each folder of `mcp-servers`) a new «Ordenar carpetas» screen shows what it would do and moves
  nothing until you choose; an MCP server you wrote becomes a project, never part of `core`.
- Agents are kept out of `core` (a `bitacora` moved there can still be read by them). If it is deleted, Orb restores what is missing from the latest backup (only `core`,
  never your projects); if there is no backup, a screen explains your options.
- Backups now live outside the workspace, in `%LOCALAPPDATA%\Orb\copias` (or a folder you choose, never inside the
  workspace). The ones 3.7 made are moved there.

**Master password.**
- New installs create one in the welcome; an updated Orb asks for it once. At least 10 characters, with a strength
  meter and a clear warning: **it cannot be recovered**.
- It seals Orb's secrets (MCP connectors' keys, the keys for your phones) in `core\secretos`; they no longer sit in
  clear in `orb.json` or the database. On this PC they open on their own; on another PC or Windows user, Orb asks for
  the password.
- Opening `core`, restoring a backup, making a new recovery code, signing a device out and changing protected settings
  ask for it. Settings › Data › «Contraseña maestra» changes it; «He olvidado la contraseña» needs your backups'
  recovery code, or starts the secrets from scratch (your backups are not touched).
- Wrong attempts make Orb wait longer each time, and the app tells you after 5 in a row.

**Magic Link, phone only.**
- Magic Link links your phone (the Android app, or a phone browser over Tailscale's secure address) with this PC and
  nothing else. The phone checks the PC's fingerprint and asks for your master password; it proves it knows it without
  ever sending it, and the PC proves it is really your PC.
- **Re-link your phones:** phones linked in 3.7 are unlinked once when 3.8 starts. The 3.7 Android app cannot link
  with 3.8 («Actualiza la app»): install the 3.8 APK, then link again.
- The password is never typed on a page without encryption: a phone browser over plain home Wi-Fi does not link (use
  the Android app or Tailscale).

**On the phone.**
- The status bar no longer covers the top of the screen, the tab bar no longer hides the end of lists, and it hides
  while the keyboard is up.
- The Android back button works: it closes sheets and menus, goes back to the list and, on Chats, leaves after a
  second press.
- When your PC is off or unreachable, the app says so, shows when it last connected and retries on its own; a saved
  screen that no longer exists opens the chats instead of a blank page.
- Tasks and projects read better at phone size: filters that wrap, two-line titles, details on their own screen and no
  Windows paths.

**Security.**
- A single, small permissions module for one owner: the PC window can do everything; the phone has a closed list of
  actions (no settings, accounts, backups or `core`); agents act only on their own conversation and tasks.
- Each agent process gets its identity from the engine by a one-use ticket over a local pipe. Agents never see Orb's
  keys or the connectors' keys in their command line, environment or logs.
- Project settings can no longer weaken the guard: Claude ignores a project's permission rules and its hooks, risky
  `.claude/settings*.json` keys mean Claude starts without them (with a notice), and writing those files asks you
  first. Cursor's project hooks and allow lists are paused during Orb's turns.
- Connectors launched through Orb on Windows get their arguments exactly as written (no `cmd.exe` quoting tricks).
- The phone never receives paths of your PC.

**Other.**
- Projects: linked folders that no longer exist drop off the list, and same-name projects in two categories read
  «name (web)» instead of «name (2)».
- «Cosas que nadie toca» asks before removing a default entry and can restore the defaults.

**Upgrading from 3.7.**
1. Update the PC app as usual (Orb makes a backup first). On first start it migrates your data and may show
   «Ordenar carpetas»; then create your master password.
2. Install the 3.8 Android app and link your phone again with Magic Link.
3. Optional, later: delete the Orb 3.7 data from Settings › Data once you have checked everything.
4. If you ran Orb Server or Orb Terminal, uninstall them: 3.8 does not use them.

## What's new in 3.7.0

**Orb Server.** The always-on side of Orb is now **Orb Server**: a small, separate Linux product that keeps your bots running around
the clock, while projects and coding agents stay in the app on your PC. How it works: `docs/SERVER.md`.

- **Add it with one command:** Magic Link › «Añadir Orb Server» shows one line to paste in the server's terminal. It
  checks what it downloads, installs a service that starts with the machine, and links the server with your app. A guide
  then walks you through the rest: the server's Claude or ChatGPT sign-in, where each bot runs, who is who, passwords and
  the browser.
- **Small and on demand:** a ~50 MB download and one process when idle. Claude and Codex are fetched from their official
  packages the first time a bot needs them, and the browser only while a bot is using it.
- **Upgrading from 3.6 or earlier:** the installer makes a backup and moves everything to `~/orb-server` in place; your bots,
  linked phones and Orbs stay as they were.
- **One home per bot:** every bot lives either on your PC or on the Server, with a read-only live copy on the other
  side. «Pasar al PC» / «Pasar al Server» moves it with its memory, routines and reminders. If the Server is off, the PC
  can take over and catches up when it is back.
- **Phones follow the Server:** once the Server is linked, your phones talk to it directly and come back to the PC if
  you unlink it. Unlinking asks what to do with the bots that live there.
- **The Server's browser:** bots on the Server can browse with a real browser, one profile per user. «Ver navegador del
  Server» shows it live, and when a page needs a person (a CAPTCHA, a code) the bot asks you with «Necesito que lo
  hagas tú». Bots browse at a human pace and ask before repeating the same risky action many times. Password and
  one-time-code fields never reach the AI.
- **Password vault:** connect a Bitwarden or Vaultwarden account made for Orb (Magic Link › Orb Server ›
  Contraseñas). Bots with the «Contraseñas» tool sign in to websites without ever seeing a password: Orb Server types
  it only into the matching site and asks you the first time.
- **Server administration:** a short list of actions (restart a container or service, clean logs or the package cache)
  that bots can only propose and run after you approve the card.
- **Self-updates:** Orb Server updates itself within 3.7.x from signed releases, with a backup first and an automatic
  return to the previous version if the new one is not healthy.

**Everything else.**

- **Conexiones:** one list of everything linked to your Orb (Server, other Orbs, phones, browsers, terminals, SSH tunnels,
  Android over Wi-Fi, the vault, Tailscale, accounts and live browser views), each with a status dot and actions.
- **Orb for Linux desktops:** the same app as on Windows, as an AppImage (updates itself) or a `.deb` (tells you about
  new versions), for x64 and arm64. Ctrl+J opens your system's terminal or the one you choose, and «Abrir en» finds
  Cursor and VS Code. How to install, update and uninstall: `docs/LINUX.md`.
- **PC Monitoring and Opti Bot are now a bot's tools:** the "Monitoring" screen is gone. Give any bot the new
  "Computer" tools (or create one from the "PC maintenance" template) to check the PC's health, temperatures, network,
  startup programs, antivirus and Orb's backups; scans, cleaning, closing a program or removing it from startup are
  still proposed on a card and only run if you approve (Windows asks for administrator rights for that action alone).
  Opti Bot's old conversation stays, archived.
- **Open Control Edge and Optimus:** if Open Control Edge is installed on a Windows PC, Orb creates the «Optimus» bot
  once, with read-only access to its readings on every linked PC and alerts when a limit is crossed. Delete it and it
  doesn't come back; turn it off in Settings › Advanced › Tools.
- **The 3.5.1 welcome is back:** the assistant's name, what to call you, the install folder and «Preparando tu PC»
  with each agent's official installer. Templates ("My business", "My home", "Development", "PC maintenance") move to
  «Nuevo bot».
- **Security:** linked Orbs only touch the bots of the users they serve; a shared bot browses with the profile of the
  person talking to it and only its owner's passwords can fill it; agents on Linux run without the ability to gain
  privileges.

**Before the first signed release:** the release key must exist (`npm run release:keygen`, once, on the maintainer's
PC). Until it is built into Orb Server, Orb Server doesn't update itself: update it with the app's install command or
`npm run servidor:instalar`.

## What's new in 3.6.0

**Users.** One Orb for the whole household or a small team: each user has their own conversations, bots, projects,
reminders and accounts, and sees only their own things and what others share with them. If only you use your Orb,
nothing changes and there is nothing to set up.

- **Two kinds of user:** the **Admin** (manages the Orb) and **Users**. The admin sees everyone's name and how much
  they used, never what they wrote or what their bots do.
- **Welcome wizard:** three questions, one per screen: your name, whether anyone else will use it, and what for
  ("Coding", "Business", "Home" or "Later", each with its starting bots). Backups are on from the start; the recovery
  code is suggested later in the app, and using Orb away from home is explained when linking a phone.
- **Switch user and lock:** with two or more users, the bottom of the sidebar shows who is at the PC (on the phone,
  the top of "More"). Switching asks for that user's PIN, and you can lock the window. The phone and the Android app can ask for the PIN too (or the fingerprint).
- **Settings › Magic Link › Users** (admin): add users, rename them, choose what they may do, reset a PIN, pause their
  bots, sign out their devices. **My profile** (from the user menu): name, language, time zone, PIN, what notifications
  show, your accounts, your devices, and exporting or deleting your data.
- **Simpler Settings:** six sections — General (with Appearance and Updates), Magic Link (Users, Devices, Linked Orbs),
  Agents and usage, Data, Advanced (Tools, God mode, Monitoring) and About.
- **Message box:** the project picker with one suggestion next to it at a time ("Compact" when the conversation is
  getting full, "Start test" on the day's first new chat); the reasoning is a brain button (Low, Medium, High and, for
  models that support it, Extra), and the orchestrator is an icon with a small switch. On the phone it fits on one line.
- **Compact:** a long conversation can be summarised to continue with more room, with the agent's own compaction
  (Claude Code and Codex); the history in Orb is kept.
- **Magic Link asks "For which user?"**: a phone or browser is linked to one user, and the list of devices is grouped
  by user.
- **Sharing:** share a bot, a group or a project with someone to view, to talk or to edit. What others share with you is
  under "Shared with me".
- **Own accounts:** each user signs in to their own Claude or Codex account by default. The owner of an account can
  lend it to someone with daily caps, a reserve, an end date, and for bots, Orb mode or both. Personal subscriptions
  may not allow serving other people: check your plan's terms before lending.
- **Usage:** "Who spent what" shows the admin each user's totals for today and the last 30 days.
- **Settings › Data:** encrypted backups every day (and before every update), the recovery code, restoring a backup,
  and moving your Orb to another computer.
- **Time zones:** reminders and scheduled tasks ring at the wall-clock time of each user's zone, also across summer
  time changes; a late one says how late it is.
- **Android app:** speaks the new protocol and asks you to update when the Orb needs a newer app, shows who it is
  signed in as, can lock with your PIN or fingerprint, and schedules notifications for your upcoming reminders on the
  phone itself.
- **Security:** every request is checked against the user who makes it, on every channel (window, phone, browser,
  terminal, linked Orbs and agents' tools); notifications and live updates reach only the users they are for.
  Update every Orb, the Android app and the terminal: older ones keep working only for the admin.

## What's new in 3.5.1

A security update. Update every Orb, the Android app and the terminal.

- **Security hardening of linking, approvals and bot tools.** When you make a link code you now choose what it is for
  (your phone, a browser, another Orb of yours or a terminal) and whether that device may approve what the bots ask
  for. Each card shows who answered it.
- Linking by short code shows the Orb's fingerprint on both screens. For browsers, use the Tailscale (https) address;
  plain Wi-Fi is for the Android app and the terminal unless you allow it in Settings.
- If you had linked another Orb before, confirm it once in Settings › Magic Link.
- On the server: `orb-nucleo dispositivos`, `orb-nucleo quitar <id>` and `orb-nucleo enlazar --admin`.
- Deleting a bot also removes its memory. Notifications can hide their text on the lock screen (by default, the bots').

## What's new in 3.5.0

One Orb of your own and many windows: the laptop writes code, the home server runs your bots around the clock, and the
phone or terminal lets you talk to all of it from anywhere.

- **Bots mode:** at the top of the menu you choose between **Orb** (coding) and **Bots** (your daily life). Create as
  many bots as you like, each with its own role, brain (the agent and model you choose), tools, routines and memory. You
  can mark one as the boss so it shares out the work among the others, and set up groups. Orb ships no ready-made bots:
  you create them.
- **Nothing is sent, bought or booked without your OK:** bots prepare, and you approve with a card. You write the golden
  rules yourself in Bot settings.
- **Reminders, email, calendar, web, home (Home Assistant) and server:** tools you turn on per bot.
- **Magic Link:** link your phone, another computer, the terminal or another Orb by scanning a QR code, like WhatsApp
  Web. Everything is end-to-end encrypted over your home network or Tailscale, with no cloud. In "Linked devices" you see
  each one and can sign it out.
- **Orb on the server (Orb Núcleo, Orb Core):** windowless Orb for Linux, installed with one command and always on.
  From the laptop, Bots mode uses the server's bots. From the phone you also see your laptop, and if it's off you can
  wake it up or queue the job for it.
- **Android app:** linking with the camera, voice dictation and "Share with Orb" from other apps.
- **Orb in the terminal:** `orb` to talk to Orbe or your bots, approve cards and see tasks from any linked terminal.
- **Just Orb:** sign in to Claude and Codex without opening consoles or their apps, and install or update them with one
  button.
## What's new in 3.2.1

A bug-fix release after a full day of testing as a user, with real agents.

- **No message gets lost:** if you write to Orbe while it's replying, your message is added to the previous one and both
  are handled. Clicking "New chat" right after sending no longer puts the next message in the previous conversation.
- **Commits without secrets:** "Save changes", copy merges and publishing scan the content for keys and passwords before
  saving or uploading anything. New projects ignore `*.env` and `dist/`.
- **Fairer limits:** if a specific model runs out (for example, another provider's model inside Cursor), only that model
  is set aside and the agent keeps working. The pause ends at the actual time the plan states, a task that succeeds lifts
  it, and you can clear it by hand in Agents › Usage per account. The picker dims models with no usage left.
- **Everything a task starts is closed with it:** test servers, the agents' browser tabs, isolated copies and the agent
  itself. Stopping a program that the same task started no longer asks for permission.
- **Truly read-only:** reviews and verifications can't write files, not even logs.
- **After Orb closes abruptly,** a resumed task is no longer marked finished without having done anything.
- **The agents' browser** accepts or dismisses page dialogs and reads the page console, so verifications check those
  parts too.
- **Tasks:** "Undo" marks the task as undone; "Reject" is announced in the conversation; you can approve or reject right
  from the chat notice; the OK on the report resolves whatever was waiting for review. A single rule for deletions: if
  you name what gets deleted, it doesn't need separate approval.
- **Projects:** they can now be renamed, and names with characters a folder doesn't allow are flagged as you type them.
- **Clearer:** commands and tools with readable names, Activity in plain words and in your language, account names
  (Codex Go, Codex Pro) in notices, local times in copies and the whiteboard, up-to-date tutorials and no truncated text.
- **Codex images:** one per request, saved with a readable name, and the link to the edited image opens it.
- **Opti Bot, God mode and whiteboard:** rejecting a card no longer causes an internal error; God mode follows the chosen
  project and shows images; the whiteboard ships its own fonts without fetching anything from the internet.

## What's new in 3.2

- **Conversations of their own:** each "New chat" is a conversation with its title (set by Orb), its project and its
  status. They're all in the menu and you can go back to any of them; Orbe remembers what was said and, if you pick it up
  days later, carries on from the logs. Your old chat is split into conversations without losing anything.
- **Several at once:** Orbe replies in several conversations at the same time (3 by default, adjustable in Settings ›
  Tasks and usage). Each task belongs to the conversation that asked for it, and its report goes back there.
- **You're in charge:** with "Orchestrator" off, the new conversation is directly with the agent you choose, in the
  chosen project, and you can open as many at once as you like.
- **New side menu:** search (also inside messages) with filters by type, status and agent; "To approve"; Projects, each
  with its conversations and active tasks; Conversations; and Completed, where only finished items go. Hovering over a
  conversation shows its project, who's replying, the branch, how its tasks are going and its latest activity.
- **Project icons:** each project shows its favicon or its app icon and, if it has none, its initials in a color of its
  own.
- **Top bar:** the conversation title and its project in the center, between the clock and the buttons.
- **Notifications:** a bell with the history and a dot when there are new ones. Only one on-screen notice at a time, and
  no duplicates.
- **Fairer usage warning:** the "Careful" bubble only appears when the account's real usage is high, lasts a few seconds
  and doesn't repeat for a while.
- **Compact menu footer:** Settings, Agents, Memories and Tutorials as icons (they expand with the arrow), with
  "Send feedback" and the Orb version close at hand.
- **Memories:** Logs and Activity, together on one screen.
- **Orbe does what you ask, no more, no less:** it doesn't add features nobody asked for (they used up usage and asked
  for too many permissions).
- **Visual polish in every theme:** centered menu logo, clock with tabular figures and no box on hover, and everything
  new styled to match each theme.
- **Plans:** Codex's Pro Lite plan is recognized.

## What's new in 3.1

Orb's core (from request to report) has been rebuilt so agents work at the same time, without bottlenecks and with a
verified result.

- **Real parallel work:** if a task is already writing to the project folder, the next one works in its own copy and Orb
  merges both pieces of work at the end. If both change the same thing, a task merges them by hand. If you prefer the
  previous mode, there's "One task at a time" in Settings › Tasks and usage.
- **Better planning:** for something small, one task and its verification. For something big, a short groundwork with the
  contract between pieces, then several pieces at once with different agents or accounts. It always ends with a
  verification that starts the project and tests it in the browser.
- **Only available agents:** Orb never assigns work to an agent that isn't installed or has no account. If one
  disappears, its pending tasks move to another.
- **Your plan, your usage:** Orb reads each account's plan (Claude, Codex and Cursor) and adjusts how much work it gives
  it while it doesn't know its real usage. Tasks that write code never use the lightest model.
- **No task stalls without you knowing:**
  - The time limit only counts work, not time a task spends waiting for your permission.
  - An unanswered permission is denied after 10 minutes (adjustable) and the agent takes another route.
  - A task that runs out of time keeps its work and is left for review.
  - If an agent goes quiet, Orb asks it. If it closes its task and its program doesn't exit, Orb frees it.
  - When a task finishes, the test servers it left running are stopped.
- **Orb connects the agents:** messages between agents reach them while they work, and those addressed to Orbe reach it
  as a notice. Each job includes which files the previous tasks changed and who is working at the same time.
- **Cursor, fully integrated:** it uses Orb's tools (reports on its task, messages, browser) and follows Orb's safety
  rules during its turn.
- **Reviews that test:** reviews and verifications can run tests, start the project and open the website, without being
  able to change files.
- **Clear notices in the chat:** permission requests explain in plain words what the agent wants to do, with the command
  under "See details". Each finished task takes one line, with what it did folded underneath, plus its time and usage.
- **Reports that don't get lost:** if Orbe can't review finished work (for example, on hitting the usage limit), it tries
  again and, if it still can't, leaves you the summary with the OK buttons.
- **Multiple accounts in the picker:** with two accounts for one agent (Codex Go and Codex Pro), each appears separately
  with its models.
- **Security:** finer checks so it doesn't ask permission for testing an API on your own machine, detects encoded
  commands in any of their forms, and doesn't ask again for approval of what you requested in your own words (only for
  deleting, and only in your current request).
- **Tables in the chat:** replies with tables, strikethrough and checkbox lists display properly.
- **Usage, not quota:** the app's text talks about each account's usage.
## What's new in 3.0

- **A single "New chat":** "Orbe" is gone from the menu. "New chat" opens a clean conversation with Orbe, with no
  folder, and the folder is chosen in the message box. To go back to the ongoing conversation, click the robot at the
  top left. Earlier ones aren't lost: "See previous conversation", above the chat. Also fixed: since 2.7, the old
  messages were still visible after restarting the conversation.
- **New task (you're in charge):** with the Orchestrator off, the button splits into "New chat" and "New task". In
  "New task" each message is a task for the agent and model you choose, and you can launch several at once; each shows
  its progress, status and result. It's also available from the "New task" button on the Tasks screen.
- **Security Review** in every project, next to Task Review: an agent looks for vulnerabilities and exposed secrets
  without touching anything and delivers the findings by severity. Both buttons explain what they do in a tooltip.
- **Start test:** the first time you open Orb each day, above the folder picker, a button asks Orbe (with the
  Orchestrator) for a test website built with several models and opens it so you can try it. It's always in Settings ›
  General.
- **The corner robot** stays hidden until you move the mouse near it, and never overlaps the notification robot.
- **Each account, its own models:** with two subscriptions to the same agent (Codex Go and Codex Pro), each sees and uses
  its own models; before, they got mixed up and a task could get a model its account doesn't have.
- **Safer accounts:** the same session folder can't be added twice, an account whose folder has disappeared stops
  receiving work, "Find and add" compares all accounts and doesn't add on its own a folder Codex couldn't verify, and
  switching the assistant to another account starts a new conversation instead of failing.
- **Open Control Edge bridge:** turning it off cuts the data in both directions, it only writes when OCE is open, shares
  each account's shortest usage window (5 h) with its short name and when it was measured, and never shows made-up VRAM.
- **Faster and lighter:** the live reply no longer redraws the whole window on every word, each part of the window
  updates only when its own content changes, nothing refreshes while the window is minimized, task lists weigh much
  less, there are new database indexes and logs no longer write every word to disk.
- **Fixes:** a task report Orbe was writing is no longer lost when starting a new chat or clicking "Stop"; a very active
  phone no longer unlinks itself; the "OK" on a report also works in earlier conversations; a task canceled while
  starting no longer becomes "blocked"; Security Review is also available from the phone.
- **Cleanup:** removed code, text and features that were no longer used.

## What's new in 2.7.3

- **Orb Light:** the portable becomes a lightweight version with the essentials, like the phone one: no minigames, God
  mode, PC Status or themes (always the default theme). The installer is still the full app, which updates itself. The
  zip, which duplicated the portable, is gone.
- **Old notices leave the chat:** the gray "Working folder" lines (and the mode, brain or new-conversation ones) saved
  before 2.7 become notices, like the new ones, which show briefly in green.
- **A non-installed copy knows it:** Orb Light, or the program folder copied elsewhere, announces new versions and opens
  the download instead of trying to install itself.

## What's new in 2.7.2

- **The Open Control Edge bridge never stops:** if a PC reading doesn't respond, it's retried a few seconds later and the
  failure is logged only once.
- **Tests no longer touch your bridge data:** a copy of Orb opened by the tests doesn't write to
  `%LOCALAPPDATA%\OrbPuente`, so Open Control Edge only sees your real Orb.

## What's new in 2.7.1

- **Text reviewed across the whole app**, in Spanish and English: clearer, shorter and with the same names on every
  screen (for example, "Settings › Tasks and usage"). Whiteboard notes use the name you gave the assistant.
- **18-step guided tour with no repetition:** "The chat with me" and "Write to me here" were the same step and are now
  one; "New chat" no longer repeats the Orchestrator part, and there's a new step for the Whiteboard.
- **New tutorials:** Whiteboard and PC Status; they also explain multi-platform projects and automatic model selection.
  The "Orb" theme now appears as "Default".

## What's new in 2.7

- **Orb picks each task's model:** you no longer need to know what Haiku, Sonnet or Opus are. Orbe says whether a task
  is simple, normal or hard, and Orb gives it the most efficient model and reasoning for your spending level: the fast
  one for simple things, the balanced one for everyday work and the most powerful only for the hard stuff. Each task's
  history records which model was chosen and why. In Settings › Tasks and usage, a guide shows what Orb uses for what.
- **Whiteboard:** each project has its own, like Excalidraw: draw screens and flows, write, connect with arrows and attach
  photos, videos and documents with a note. It saves itself in the project folder and Orbe reads it when planning. If you
  ask for something very big, it suggests defining it on the whiteboard first.
- **PC Status:** turned on in Settings. Opti Bot, with the brain you choose, checks the PC's health, what starts with
  Windows, the antivirus, that Orb is fine and its backups. It only looks: whatever it wants to change it proposes on a
  card, and if administrator rights are needed, Windows asks you at that moment.
- **Network:** Wi-Fi and its security, nearby networks, the devices on your network (with the names you give them),
  Remote Desktop or SSH to other computers, and the status of your phones and Android TV via adb.
- **Open Control Edge and Orb understand each other:** if you have Open Control Edge 2.3, the two apps share their real
  PC data within the machine itself (temperatures, GPU, AI usage). If one isn't open, nothing made-up is shown.
- **Multi-platform projects:** when creating a project you choose Windows, iOS, Android or Web. With several, Orb creates
  one per platform, linked together and with a shared folder for the API, design and copy. You can also ask Orbe for it
  in the chat.
- **Images:** images Codex creates show up in the conversation. Mark an area with the mouse to change just that part,
  and save them to the project folder.
- **In the chat:** a line shows live what Orbe is doing ("Reading app.jsx · 1 min 3 s"). When you need to choose, it
  asks you with options you tick with a click. Purely informational notices appear as a notification and no longer fill
  up the chat. The greeting changes every time.
- **Clock and calendar:** on hover, the clock shows seconds; a click opens the month's calendar.
- **Accounts without folders:** "Add another account" only asks for a name and opens the sign-in. "Find and add" finds
  the sessions you already have on the PC, without repeating the same account. Each agent's settings are collapsible.
- **GitHub:** under your account, in Projects, your contribution graph for the last year.
- **The phone, simpler:** tabs at the bottom (Orbe, Chats, Tasks, Projects and More), without what only makes sense on
  the PC.
- **Themes:** "Orb" is renamed "Default" and each theme is chosen from an accurate thumbnail. Expert mode is now called
  God mode.
- **Fixes:** chess can no longer freeze the window; the phone receives all images from the app; the project name is no
  longer cut off in the menu.

## What's new in 2.6

- **Orbe:** the assistant is now called Orbe (if you gave it another name, yours stays). At the top of the menu you see it
  with its ORB·E logo, drawn to match each theme.
- **A window of its own:** no title bar or Windows buttons. Minimize, maximize and close belong to Orb and are styled
  like the rest of the theme. You move the window by dragging the top area, and a double click maximizes it.
- **New chat, no pop-ups:** "New chat" opens a clean chat. Below the message you choose the project (or "No folder"),
  the brain, the reasoning and, if you're talking directly to an agent, the permissions. With the "Orchestrator" switch,
  Orbe coordinates the agents; without it, you talk to the chosen agent.
- **Any brain, with its real models:** Orbe no longer depends on Claude. Choose any installed agent and its model: Orb
  asks each agent which models it has (without using up usage) and shows them by name, grouped and collapsed, with
  "Recommended" at the top.
- **Context and usage of your plans:** next to the send button, a circle fills up with the conversation's context.
  Clicking it shows the tokens used and the real usage of each account that's working: session limit, weekly and weekly
  per model, with when each one resets.
- **Saving or power:** in Settings › Tasks and usage, a slider goes from "Max. saving" to "Max. use". It sets all the
  limits at once and how cautious Orbe is when spending. The parameters are still in "Advanced options" for anyone who
  wants to tweak them.
- **Usage warning:** when you choose high reasoning, one of the hungriest models or an account with little usage left, a
  bubble warns you that it may use up usage quickly.
- **Clean top bar:** date and time on the left and only icons on the right (pause tasks, restart conversation and
  minigames), with tooltips explaining what each one does. Every chat message shows its time.
- **Projects in the menu:** a click on a project opens a new chat in it; a double click expands it with its tasks and
  conversations. Hover over one and mark it as completed: it goes to "Completed", collapsed at the end of the menu. Drag
  the menu's edge to adjust its width, and a button collapses it completely.
- **Minigames while you wait:** Snake, Tetris, Chess against the computer, Jumper (Geometry Dash style), 2048, Bricks,
  Space Invaders and Pac-Man, in easy, normal or hard, with high scores and 8-bit sounds that take up no space. When Orbe
  hands out the work, it offers you a game right from the chat.
- **Robot notifications:** when the report is ready or something needs your attention, the robot appears with a bubble,
  smaller and only when needed. Without animations (or in the Professional theme), the notice shows at the top: green
  if everything went well and orange if you need to look at something.
- **Refreshed themes:** Candy (formerly Cloud) with 3D sweets, Vaporwave with Win95 stickers by day and a synthwave sunset
  by night, and Retro with the 70s by day and arcade space invaders by night. The background blurs behind messages so
  they're easy to read, stays still when the window is in the background, and each theme brings its own font.
- **Custom tooltips** throughout the app, instead of the Windows ones, and tidier Settings: the "Model" section is gone
  because everything is chosen in the chat.
- **Assistant reports are no longer lost** if you close the app while it's preparing one: they come back when you open
  it.
- **More security:** internal keys no longer travel in plain sight on the command line, model names sent by agents are
  sanitized before reaching the assistant, and a brain in coordinator mode can never change anything.
- **Guided tour:** the first time the app opens, the robot walks you through it step by step (the chat, the brain, the
  Orchestrator, projects, tasks, agents, logs, settings…), pointing at each control with a bubble. Skip it whenever you
  like (Esc) and it won't show up on its own again.
- **Tutorials:** a new screen in the menu explaining how each part of the app works, keyboard shortcuts and FAQs, with
  search and buttons that take you to each screen. The guided tour can be replayed from there.

## What's new in 2.5

The stable release: more reliable in everyday use.

- **Stop and continue:** if you stop Orb·e and write to it right away, your message waits for it to finish stopping and
  gets answered. Before, you could get "can't reply: the agent is still working".
- **The phone doesn't unlink because of the clock:** if the phone's clock is fast or slow, Orb uses the PC's time and
  everything keeps working. Before, the phone got unlinked and you had to scan the QR code again.
- **More security between agents:** each agent identifies itself to Orb with a signature only Orb issues. An agent can't
  impersonate another or close a task that isn't its own.
- **Logs in your language:** new logs and their entries are written in the Settings language (Spanish or English). When
  you change language, the ones that are still empty change too.
- **Closing Orb with tasks running:** when you reopen it, they carry on where they were. Before, on a normal close, some
  were left half-done but marked "done".
- **Nothing gets stuck after a crash:** if Orb closes abruptly just as an agent finishes its task, it's completed when
  Orb comes back (changes saved, log and report) and the tasks that depended on it start.
- **"Undo this task", safer:** it restores each file exactly as it was (including Windows line endings) and, if one can't
  be recovered, leaves it as is and tells you; it never deletes it.
- **Freshly created git projects:** a folder with `git init` and no commits now works (before, all its tasks got
  blocked).
- **Less disk space:** copies for "Undo" are no longer duplicated on every follow-up, and they delete themselves 30 days
  after the task finishes.
- **"Restart and update":** if the downloaded installer is no longer there (for example, the antivirus removed it), Orb
  keeps working and offers to download it again.
- **More fixes:** phone conversations no longer lose messages when opened; Cursor no longer leaves
  `orb-encargo-*.md` files in the project; a manually deleted isolated copy is recreated; an ACP agent stopped while
  starting doesn't go on to do the job; "Stop" in the chat no longer drops reports from finished tasks; and a follow-up
  whose images no longer exist is sent without them instead of blocking the task.

## What's new in 2.4.2

- **Finds your agents wherever they are:** if you moved programs from `C:` to another drive to free up space (for example
  to `D:\ComputerApps\AppData`), Orb finds Claude Code, Codex, Cursor and the other agents there, even if the Windows
  PATH still points to the old folder. It doesn't reinstall them.

## What's new in 2.4.1

- **Uses your Orb folder:** when installing Orb on a PC that already has an Orb folder (for example `D:\Orb`), it detects
  it and uses it as is, skipping the welcome screen and without creating or overwriting anything.
- **More reliable agent installation:** it no longer opens a separate PowerShell window, which on some PCs closed without
  installing anything. Installation runs in the background and Orb shows the progress.
- **Orb icon in the taskbar** instead of Electron's.
- **First launch:** if a program is already on the PC but doesn't respond at that moment, it no longer shows as
  "Not installed"; and when installing Codex or another npm agent, Node.js isn't reinstalled if it was already there.
- **Contribute → "Capture the window":** the screenshot shows the app, not the Settings window itself.
- **Settings in narrow windows:** sections are no longer cut off on the right (terminal picker, long Tools paths, More
  apps buttons).

## What's new in 2.4.0

### Orb·e: Your pocket director

- **The robot is called Orb·e.** It plans your project in phases, prepares precise instructions for each agent and
  optimizes token usage. It delivers verified results to you. If you had given it another name, it keeps it.
- **The program is called Orb** (`Orb.exe`) in the window, the installer, shortcuts and Windows notifications.
  Updating from 2.3.3 loses nothing: same folder, same settings, same projects.
- **Text reviewed** across the whole app, in Spanish and English: clearer, shorter and more professional.

### Settings, renewed

- **Settings opens as a window** over the app, with its sections on the left: General, Appearance, Model, Tasks and
  usage, Phone, Tools, Expert mode, Updates, Contribute and More apps.
- **Appearance:** light, dark or system mode; five themes (Orb, Vaporwave, Retro arcade, Professional and Candy);
  interface and code fonts; and colors for code in the chat and in expert mode. The Professional theme doesn't show the
  robot or its animations and sounds.
- **Windows menu bar hidden** by default. Show it from Appearance or, temporarily, with Alt.
- **Contribute:** support development with PayPal and send feedback, with window screenshots, no account needed.
- **More apps:** Open Control Edge, with its latest version and the button to download it.

### Tasks and first launch

- **Task filters:** In progress (working or queued), To approve, Completed, Issues and All. The side menu separates what's
  waiting for your approval from issues.
- **Getting your PC ready:** agent installation shows a progress bar.

## What's new in 2.3.3

### Orb gets a new look

- **The new robot** is all over the app: a lively head with animated eyes and gestures, and four full-body poses
  (waving, thinking, pointing, standing). It looks worried when something fails and falls asleep when there's nothing to
  do.
- **Robot sounds:** short beeps when it talks, finishes something or you pat its head (never while you're typing). Turn
  them on, mute them and adjust the volume in Settings.
- **Animated robot:** in Settings you can keep full animations or just the minimal ones (blinking and changing faces).
- **New app icon**, taken from the same design.

### The phone, without Tailscale and end-to-end encrypted

- **Over your home Wi-Fi:** turn on "Phone" in Settings, click "Link over Wi-Fi" and scan the QR code with the phone
  connected to the same Wi-Fi. Nothing needs to be installed on the phone.
- **Via Tailscale, also away from home:** if your Tailscale has HTTPS, Orb uses it automatically. That way the website
  installs on the phone as a real app.
- **Everything end-to-end encrypted:** when you scan the QR code, the phone creates its own key. From then on everything
  the phone and the PC say to each other is encrypted: neither the Wi-Fi nor anyone along the way can read or change it.
  A copied QR code doesn't work, and removing the phone in Settings disconnects it instantly.
- **Phone notifications:** in the phone menu, "This phone" → "Notifications on this phone". It notifies you of tasks
  waiting for your approval, finished or failed ones, and Orb's replies when you don't have the app open. Requires the
  secure connection (Tailscale with HTTPS); on iPhone, with Orb added to the home screen. Free: your own PC sends them.
- Phones linked with 2.3.2 or earlier need to be **linked again** (once).

## What's new in 2.3.2

### Orb updates itself

- On launch and every 4 hours, Orb checks GitHub for a new version. If there is one, a card appears at the top right:
  **Update** downloads it in the background and **Restart and update** installs it and reopens Orb.
- "Later": it installs itself the next time you close Orb. If tasks are running, it warns you before restarting.
- **Changelog** opens the release notes for that version.
- In **Settings → Updates** you see the installed version and can **Check for updates** whenever you want.
- The portable version can't replace itself: it still notifies you, and its button opens the download page.
- Works from this version on: 2.3.1 didn't have the notice, so 2.3.2 has to be installed by hand one last time.

## What's new in 2.3.1

### The Orb folder, the same for everyone

Whatever folder you choose on first launch, Orb creates `Orb` inside it with the same structure:

```
<chosen folder>\Orb\
  windows\  ios\  android\  web\   your projects, each in its category
  bitacora\                          Orb configuration: the logs (a single folder)
  mcp-servers\                       Orb configuration: the MCP servers
```

- **Projects by category:** when creating or cloning a project you choose Windows, iOS, Android or Web, and the Projects
  list is grouped that way. Folders you create by hand inside a category appear automatically.
- **`bitacora` and `mcp-servers` belong to Orb:** they don't show up as projects and can't be linked. MCP servers are
  managed only from Settings, which lists the ones in the folder and enables them with a click.
- **Android ready:** Orb downloads Google's adb and fastboot to `android\adb-tools` the first time and makes them
  available to the agents. The status is shown in Settings → Android.
- **A single logs folder:** if you came from 2.3.0, `bitacoras` becomes `bitacora` automatically without losing anything,
  and the categories and configuration folders that slipped in as projects disappear from the list.
- **Installer:** besides the portable, an installer that puts Orb in the Start menu, on the desktop and in search.

## What's new in 2.3.0

The same idea as always: you tell Orb what you want and it writes optimized jobs, hands them out among agents from
several providers working at the same time, reviews what they do and asks for your OK. 2.3 rebuilds how it talks to agents.

### Live agents

- **One live process per conversation** instead of one per message:
  - Claude Code with the official Claude Agent SDK;
  - Codex with `codex app-server`;
  - Cursor with its streaming CLI.
  - Replies arrive **as they're being written** and the second message takes seconds.
- **More agents** with the ACP standard: **Gemini CLI, OpenCode, Qwen Code and GitHub Copilot**.
- **Uses your sessions:** if you've already signed in to an agent's program (for example Codex with ChatGPT), there's
  nothing more to do in the app.
- **Correct on the fly** (Enter while it works) or **queue** (Ctrl+Enter). The queue can be edited, reordered and
  cleared.
- **Fork** a conversation to try another idea without losing the original.
- **Continue** what was left half-done, **details** of each conversation (folder, git, PR, task…), **context meter**
  and paginated history.

### More work, fewer brakes (and without burning tokens)

- **Balanced permissions:** normal actions go through on their own; risky ones (push, download and run, delete folders…)
  ask you with an **Allow / Always allow / Deny** card, in the conversation, the chat, the inbox and on the phone.
  There's a new mode, "Ask first", for keeping a close eye.
- **Real usage:** Claude and Codex report how much of your usage you've used and when it resets. Orb stops at 92 %
  (adjustable) and spreads the work across accounts. The fixed caps go up to 20 tasks and 6 with expensive models per
  window, only as a safety net.
- **Tasks that wait for usage:** when the limit is reached, the task doesn't fail; it waits and **resumes on its own**
  when usage resets.
- **They carry on after closing the app.**
- **The assistant renews itself based on how full its context is**, not by message count, and reads the project to write
  more precise, shorter jobs.

### Agent team

- **Delegation:** an agent can hand part of its task to another agent or model and wait for the result. Subtasks hang
  from their task.
- **Task Review:** another model, from another provider if available, audits the work read-only and gives its verdict:
  correct or with issues, plus the list of problems. It can be requested for a task or a whole project, or turned on
  automatically.
- **Scheduled tasks:** "every Monday at 9, check the dependencies".
- **"@"** in any message box to attach another task, conversation or log as context (an excerpt, not the whole thing).

### Interface

- **Inbox** in the sidebar: "Waiting for you" and "Working".
- Real agent logos.
- Checkboxes visible in night mode.
- No more cut-off robot on first launch.
- Sharp icon in the `.exe` and the taskbar.
- **Spanish (Spain) and English.**

### For developers

- 79 tests that also pass on Windows, and test CI on Windows and Linux.
- `docs/ARCHITECTURE.md` explains each feature and which files to touch.

## What's new in 2.1.0

- **Checkboxes and switches that didn't respond**: the floating robot covered the ones on the right and stole the click.
  Now it doesn't appear over Settings or conversations, switches apply instantly (before they waited for "Save") and the
  whole row is clickable.
- **Interface size**: Settings → Interface (Small / Normal / Large) or `Ctrl +`, `Ctrl -`, `Ctrl 0` and `Ctrl` +
  scroll wheel. "Normal" is larger than before.
- **`Ctrl J` opens a terminal** in the project folder: Warp if you have it; otherwise Windows Terminal or PowerShell.
- **Folder menu**: each project is a collapsible folder with the tasks you've sent it.
- **Live tasks**: time, steps, what it's doing now and the percentage, in Tasks and above the chat. A warning if a task
  goes 10 minutes without a sign of life.
- **Failures explained**: if an agent can't work (for example Cursor on the free plan, or with no session), the task
  says why and what to do, and if it was for "any agent" it moves to another.
- The assistant's folder is named whatever you call it (or "Orb"), and the start screen shows exactly that path.
- Cleanup: removed every trace of the old name; security audit with no private data or keys in the code.
