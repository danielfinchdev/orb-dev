# Orb 3.5.0 plan — "Orb" and "Bot"

Status: **proposal, no code changed**. Written on 2026-11-04 by Claude (Opus 5.5) starting from the published 3.2.1 (tag `v3.2.1` = `origin/main`).

## 1. What we want

1. **Orb is the only app.** The user installs Claude Code and Codex on the PC, but never opens their apps, desktop or web: everything is done from Orb.
2. **Two modes with a switch at the top**, like Chat/Code in Claude:
   - **Orb**: the usual (programming and development) on the main PC.
   - **Bot**: a personal assistant in the style of Grok Bot. It helps with daily life (reminders, email, calendar, web search, checking Amazon, booking appointments) and also runs the home server and home automation.
3. **The Bot lives on an always-on PC** (for example a home server) and is on 24/7. From the PC's Orb and from the phone you only talk to it. Nothing is built or programmed on the server.

## 1b. The structure in one sentence

**One Orb of your own and many windows.** Each thing works where it fits best. Orb is generic: "laptop + Linux server + phone" is just an example, and everything below is chosen by the user in Settings › Magic Link, with defaults that ask nothing of someone with a single PC.

- **Role of each Orb** (`orb.json › role`, on any Orb, also on a Windows PC): **Everything on this Orb** (default: hub and workshop at once), **Hub** (`centro`, always on: keeps the bots, their memory, the reminders and receives the devices) or **Workshop** (`taller`: programs, builds and runs the heavy agents). Orb Núcleo starts a new folder as a hub. An Orb having no window (Orb Núcleo) is a separate thing (`headless`): only that removes God mode, the expert view, Opti and isolated copies.
- **Where the bots live** (`bots.location`: `local` or a linked Orb that keeps bots): when linking to one, Orb asks "Where do you want your bots?" and, if they go there and there are bots here, offers "Bring my bots" (they are copied with their memory and reminders and paused here) or "Leave them here". Nothing is hidden without warning.
- **Orb for programming** (`devTarget`): the Orb mode of a phone or terminal goes to the Orb that programs (workshop or everything); if there are several, the user picks one. If it is off, wake it and queue (`taller.*`).
- **Windows**: the Windows app, the Android app, the browser and the terminal (`orb`). All of them link through Magic Link. A linked device only manages (bots and links) if marked **Can manage**; `orb-nucleo enlazar` grants it to the first one, because a headless server needs it.
- Example (one possible setup): a home server is "Hub", the laptop "Workshop" with the bots on the server, and the phone programs on the laptop through the server. With a single PC, everything stays on "Everything on this Orb" without touching anything.

## 2. What already exists (3.2.1)

| Piece | Status | Where |
|---|---|---|
| Claude Code | **Already uses the Agent SDK** (`@anthropic-ai/claude-agent-sdk`): streaming, resume, steer, permissions and limits | `src/agents/claude.mjs` |
| Codex | Works with `codex app-server` (JSON-RPC), the official programmatic interface. It is more complete than `@openai/codex-sdk`, which wraps `codex exec` and has no approvals or steer | `src/agents/codex.mjs` |
| Engine | Plain Node, no Electron. Tests already start it without a window | `src/engine/engine.mjs` |
| Remote access | HTTP server with QR pairing, end-to-end encryption (X25519 + XChaCha20), SSE, Web Push and Tailscale | `src/engine/remote.mjs`, `src/core/mobile-crypto.mjs` |
| Remote client | `window.orb` over HTTP, but only in the browser | `src/ui/lib/web-bridge.js` |
| System agent | Opti Bot: read-only tools and "proposal → card → approve". It is all Windows/PowerShell | `src/mcp/opti.mjs` |
| Scheduled | `schedules` table and the Scheduled view | `src/engine/scheduler.mjs` |
| Email | Own gmail-multi MCP | `mcp-servers/gmail-multi-mcp` |

**Conclusion:** point 1 (using Orb instead of the apps) is almost done. What is missing are details: the login, which today opens a CLI console, and installing and updating the agents. What is really new is **Bot mode** and the **server Orb**.

## 3. The server (a typical example)

- An always-on Linux home server: a few cores and **about 8 GB of RAM**, part of it already used by other services.
- It already runs several Docker services (home automation, photos, a password manager…) and Tailscale. **It may have no Node**, so Orb carries its own.
- The Bot's RAM budget: Node engine about 120 MB, plus a Claude Code session about 250-350 MB while thinking. The headless browser (for Amazon or appointments) adds 300-500 MB and only opens on demand. **Hard cap: 1 GB** with systemd's `MemoryMax`.
- Recommendation: on a server with little free RAM, add memory if the browser will be used often.

## 4. Design

### 4.1 Server Orb (no window)
- New `src/server/host.mjs`: does in Node what `main.mjs` does today with Electron. It starts `engine.mjs` with `child_process.fork`, sends it `{type:'start', home, version, profile:'bot'}` and restarts it if it crashes.
- **`bot` profile** in the engine. It turns off the development parts (projects, isolated copies, God mode, Windows Opti) and turns on the assistant's. Everything that only works on Windows (`pc-health`, `taskkill`, `openConsole`, `bridge.mjs`, mstsc, UAC) goes behind `process.platform === 'win32'`.
- On Linux the secret key goes in a `clave.bin` file with 600 permissions (that fallback already exists).
- **Packaging:** `npm run dist:servidor` runs on the main PC and produces `orb-servidor-3.5.0-linux-x64.tar.gz`. It carries portable Node 22, `src/` and production `node_modules` with the Agent SDK's Linux binaries. **Nothing is built on the server**: it is only unpacked.
- **Installation:** from Orb › Bot › "Install on the server", over SSH (with an SSH key the user already has for the server). It copies the tar to `~/orb-servidor`, creates a `systemd --user` service (`orb-bot.service`, `Restart=always`, `MemoryMax=1G`) and `loginctl enable-linger`, which needs sudo once and is asked of the user. Updating is the same with the new tar; the data is backed up first.
- Alternative ruled out for now: a Docker container. It fits the rest of the server, but administering the host from inside would require mounting the Docker socket, which is equivalent to being root. With systemd the Bot is a normal user and the permissions are clearer.

### 4.2 Custom bots (total freedom)

**Principle: Orb ships no ready-made bots.** It ships the system so each user creates the ones they want: one, ten or none. None of anybody's bots go in the code. The code only ships an empty starter bot, "Asistente", which the user renames or deletes.

**What a bot is** (`bots` table in `orb.db`, all editable from the app or by asking another bot):
- **Name, icon and role** written by the user (for example "calendar and agenda", "shopping", "health").
- **Brain**: any installed agent and model and its reasoning level, as chosen today for Orbe or for a task. Each bot can have a different one.
- **Allowed tools**: checkboxes from the list below and specific accounts (for example "only this Gmail").
- **Exclusives**: "only this bot touches the calendar". The others pass the dates to it.
- **Routines**: on top of `schedules` (daily, weekly, yearly, once). Each has its bot and its notification.
- **Its own chat** and **its own memory** (the bot's `memoria.md`).

**Chief bot (optional):** the user marks one as chief. The chief receives what is asked, hands it out to other bots with `bot_send`, follows up and reports. It can **create, change or pause bots** with `bot_create` and `bot_update`, always with an approval card. So "create a bot to check my email" works just by talking.

**Groups:** chats with several bots and the user (for example "Personal" or "Business").

**Global memory:** `memoria-global.md`, maintained by the chief and read by all. It never stores passwords, cards, IBAN or national ID numbers (`safety.looksSecretText`).

**Golden rules:** the list is written by the user in Settings › Bots, for example "nothing is sent, bought or booked without my OK" or "group the questions". It is injected into every bot. By default it only has **do not send, buy or book without approval**.

**Tools available to assign to each bot** (new MCP `src/mcp/bot.mjs` plus the agent's own):

| Group | Tools | Permission |
|---|---|---|
| Internet | WebSearch, WebFetch | free |
| Reminders | `bot_remind` and `bot_list_reminders` on top of `schedules`, with a Web Push notification to the phone and the PC | free |
| Email | gmail-multi MCP: read, search and drafts | **send = approval card** |
| Calendar | Google Calendar (MCP): view and propose | **create/delete = approval** |
| Browser | current `orb_browser_*`, with headless Chromium on demand (Amazon, appointments, price comparison) | **buy, book, pay or submit forms = approval, always** |
| Home | Home Assistant API (long-lived token): states, on and off, automations | free / locks and alarm with approval |
| Server | `srv_status` (CPU, RAM, disk, `docker ps`, `systemctl`), `srv_logs`, `srv_propose` (restart container, update image, clean disk). Same pattern as Opti Bot: it proposes, a card appears and what is approved runs | reading free / changes with approval |

- **Never, even if asked in the chat:** touch what the user protected ("Things nobody touches": password managers and secret stores by default) or its data, delete without the Recycle Bin, pay without an approved card, or approve `total`-level actions from the phone (as today).
- **Long tasks** (for example "find cheap flights to Rome in March"): the Bot creates a background task, works even if the user closes Orb and notifies the phone when it finishes.

### 4.3 The triangle and Magic Link

**One Orb, three roles.** It is the same code packaged three ways, so three programs do not have to be maintained.

| Device | What is installed | Role | Footprint |
|---|---|---|---|
| **Server** (Linux tower, 24/7) | **Orb Núcleo** (Orb Core): just the Node engine, no Electron and no window | **Hub**: the Bot, the message inbox, reminders, phone notifications and the entry door for the others | about 150 MB on disk and 120 MB of RAM idle |
| **Laptop** (Windows) | **Full Orb** (Electron, as now) | **Workshop**: building, programming, heavy tasks, Claude Code and Codex | as always |
| **Phone** (Android) | **Orb app**: the same React UI packaged with Capacitor | **Window**: talk, approve and get notifications | that of an app |

**Magic Link** (like WhatsApp Web):
- Any Orb shows a QR in Settings › Magic Link › "Link device". The QR carries its Tailscale address, its public key and a one-time code that expires in 5 min.
- The other device scans it and becomes **linked**, with its own key.
- "Linked devices" shows each one (name, last used) and lets you **sign it out remotely**.
- The groundwork already exists in 3.2.1: `remote.mjs` and `mobile-crypto.mjs` (QR, X25519, XChaCha20-Poly1305, no replays). What is new is the name, the devices screen and that **Orbs can link to each other** too, not only browsers.

**How the triangle links (one QR per device):**
1. The laptop scans the server's QR and is linked as the server's **workshop**.
2. The phone scans the server's QR. With that it sees the Bot and also the laptop's Orb, because the server forwards development requests to the laptop.
3. If the laptop is off or asleep, the phone says so ("The laptop is off") and offers to **wake it** with Wake-on-LAN from the server, or to queue the request until it turns on.

**All local:** the network is **Tailscale**, installed on the server, the laptop and the phone. Devices talk to each other directly and encrypted, with no Orb cloud and no ports open on the router; the data never leaves home. The Cloudflare relay of `docs/MOBILE-RELAY.md` stays as plan B for a phone without Tailscale. Since it is end-to-end encrypted, the relay would only see noise.

**New pieces:**
- `src/core/link.mjs`: the Magic Link client in Node, which is `web-bridge.js` brought to Node.
- Roles `centro`, `taller` and `ventana` in `orb.json`.
- Forwarding of calls from the hub to the workshop, with a list of allowed methods per role.
- Wake-on-LAN (the laptop's MAC is saved when linking).

### 4.3b Android app
- The React UI already works on the phone (phone views, `test:movil`). It is packaged with **Capacitor** as a native app: scanning the QR with the camera, native push notifications, microphone for dictation and "Share with Orb" from other apps.
- It is built on the laptop (Android SDK) and installed on the phone from the APK; no Play Store needed.
- Meanwhile, the current PWA can be installed from the phone's browser.

### 4.4 UI
- **Switch at the top of the sidebar: `Orb | Bot`**. Remembered in `interfaz.json`. On the phone they are two tabs.
- In Bot mode the menu changes completely:
  - **Chat**: an ongoing conversation with the Bot, with the approval cards inside.
  - **Reminders**: list and calendar.
  - **Tasks**: what it is doing in the background.
  - **Home**: Home Assistant summary.
  - **Server**: health and containers.
  - **Memory**: what the Bot knows about you, editable and deletable.
  - **Bot settings**: model, connected accounts, server and installation.
- If the server does not answer, Bot mode says so in words ("The Bot is not answering: the server is off or offline") and offers to retry.
- Steps: views in `src/ui/views/bot/*.jsx`, registration in `VIEWS` (`main.jsx`), `NavItem` per mode in `sidebar.jsx`, `bot.*` strings in `locales/es` and `en`, and the new methods in `api.mjs` and in `remote.mjs › ALLOWED`.

### 4.5 "Only Orb" (without opening the Claude or Codex apps)
- Claude and Codex login without a console window. The CLI login runs in the background, the URL is captured, opened in Orb's browser and its completion detected.
- Settings › Agents: install and update Claude Code and Codex with one button (`installer.mjs`).
- Codex stays on `app-server`. **Do not migrate to `@openai/codex-sdk`**, because approvals, steer and limits would be lost. To be reviewed if its SDK ever exposes them.

## 5. Phases

| Phase | Content | Exit test |
|---|---|---|
| 0 | `orb-3.5` branch from `origin/main`, plus the CI fix 9baab63. Clean up the 4 old worktrees | `npm test` green |
| 1 | `host.mjs`, `bot` profile and the Windows parts guarded. Engine starting on Linux (CI ubuntu) | new test `servidor.test.mjs` with fake agents |
| 2 | Custom bots: `bots` table, brain per bot, tools, exclusives, routines, chief with `bot_send`, `bot_create` and `bot_update`, groups, memories and golden rules. MCP `bot.mjs` | tests: create 3 bots, chief delegates, routine, exclusive respected and approval |
| 3 | Magic Link: `link.mjs`, hub/workshop/window roles, forwarding to the workshop, linked devices and Wake-on-LAN | e2e with three engines on loopback (hub, workshop and a browser) |
| 4 | UI: Orb/Bot switch and Bot views | `test:app` with screenshots and `test:movil` |
| 5 | `dist:servidor`, SSH install, systemd and updating | real install on a Linux server (with the user: sudo once) |
| 6 | Email, calendar and browser (Amazon, appointments) with approval | guided real test |
| 7 | Android app with Capacitor (camera QR, push, mic, share) | APK installed on a real phone |
| 8 | Console-free login and installing agents from Orb. CHANGELOG and release 3.5.0 | CI Linux + Windows, PR |

## 6. Risks
- **Server RAM**: the 1 GB cap and the on-demand-only browser contain it. If the other services grow, the Bot may be slow.
- **Subscription usage**: what the Bot spends counts towards your Claude or Codex limits. There will be its own daily cap in `budget`.
- **Purchases and bookings**: always with an approved card. The Bot never stores payment details (the browser or the website enters them).
- **Security**: the Bot can touch the server, so it only goes over Tailscale, with approval for any change and no access to what the user protected.

## 7. Decisions
1. **Model**: chosen per bot, among the installed agents (for example Claude Opus 5.5 with medium or high reasoning).
2. **Channel**: first, the own **Android app**. Telegram and WhatsApp remain optional connectors for later. Nothing paid during development (the Telegram Bot API is free; official WhatsApp is not).
3. **No fixed bots in the code**: each user creates their own (chief plus specialists) from the app, and their configuration stays in their `orb.db`.
4. Pending: the mode's product name ("Bot", "Bots", …) and the accounts the user connects (from the app).
