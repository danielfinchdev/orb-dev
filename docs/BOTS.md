# Custom bots (3.5)

Orb ships nobody's bots. It ships the system so each user creates the ones they want (one, ten or none). The first time, only one empty bot appears, **"Asistente"** ("Assistant"), which can be renamed or deleted; once deleted, it does not come back.

## What a bot is
- A row in the `bots` table of `orb.db`: `name`, `icon`, `role_text` (its role, written by the user), brain (`agent`, `model`, `effort`: any installed agent, like Orbe), `tools` (tool groups), `accounts` (JSON: `{ "mcp": ["gmail-multi"], "account": "<account id>" }`), `exclusive` (topics only it handles, e.g. `["calendario"]`), `is_chief` (only one), `paused`.
- A live session of its own agent (closed after `bots.idleMinutes` idle and resumed later). It works in `<home>\bots\<id>\` read-only: no commands and no file edits.
- Its prompt is built only from what the user wrote: role, **golden rules** (`config.bots.rules`), its memory (`bots\<id>\memoria.md`), the global one (`bots\memoria-global.md`), the other bots (name, role, exclusives) and its tools.
- Its own conversation (a `conversations` row with `bot_id`) and **groups** (`bot_groups` + `bot_group_members`, a conversation with `group_id`): the user's message goes to the group and they answer one after another, **the chief first**; the others only if they have something to add.

## Tool groups (`tools`)
`internet` (the agent's WebSearch/WebFetch) · `recordatorios` (reminders: `bot_remind`, `bot_list_reminders`, `bot_cancel_reminder`) · `correo` and `calendario` (email and calendar: connectors from `accounts.mcp`) · `navegador` (browser: `orb_browser_*`) · `casa` (home: `ha_states`, `ha_call`) · `equipo` (computer, 3.7: `pc_health`, `pc_network`, `pc_android`, `pc_orb_check`, `pc_backup`; on Windows also `pc_startup`, `pc_security`, `pc_propose`) · `servidor` (server: `srv_status`, `srv_logs`, `srv_propose`) · `gestion` (management: `bot_create`, `bot_update`, `bot_pause`; the chief always has it).
Always: `bot_list`, `bot_send`, `bot_memory_read`, `bot_memory_write`, `bot_ask_user`, `bot_confirm`. A group that another active bot holds as exclusive is removed from the others.

## Rules enforced by the code
- Approval card always for: creating/changing/pausing bots, server changes, changes on the PC (`pc`), Home Assistant locks/alarm/blinds, and any connector tool that sends, buys, books, pays or deletes (`guard.decide` in bot mode). In the browser, clicking "buy", "pay", "send"… or submitting a form requires an approved `bot_confirm` (valid for 15 min).
- **Things nobody touches** (`orb.json › protected`, Settings › Bots): anything naming an entry of that list (paths, commands, containers, server actions, memory) is denied for every agent and bot, whatever the permission. By default it lists the common password managers and secret stores (Vaultwarden, Bitwarden, KeePass/KeePassXC and `.kdbx`, 1Password, LastPass, `.password-store`, `.gnupg`, `.ssh/id_*`); the user adds or removes entries (API `bots.protected.get` / `bots.protected.set`). Names match as whole words, without case.
- Memory rejects passwords, cards, IBAN and national ID numbers (`safety.looksPrivateText`).
- `bot_send` respects exclusives: a topic exclusive to another bot can only go to that bot. At most 6 messages in a row between bots.
- **«Equipo» / "Computer" (3.7)** replaces «Monitoreo del equipo» and Opti Bot (2.7–3.6), which are gone from the app: what Opti Bot did is now a tool group any bot can have. Reading is free (health, CPU/RAM/disks, Open Control Edge temperatures when it is open, network and devices, adb phones/TVs, startup programs, Defender status and recent threats, Orb's folder and backups; `pc_backup` makes a copy of Orb like Opti Bot did). Changes are `pc_propose` → a `pc` card, the same closed list as before: `defender_quick_scan`, `defender_update` (both ask for administrator rights with Windows' own prompt, for that action alone), `clean_temp` (files older than 2 days in the temp folder), `end_process` (never Windows, its antivirus or Orb), `disable_startup` (reversible from Task Manager). Code: `src/core/pc-health.mjs` (reports), `src/core/pc-actions.mjs` (`checkPcAction`, `runPcAction`). Processes, startup, security and `pc_propose` are only offered on Windows. Like `casa`/`servidor`, it is the owner's (`integration:pc`) unless shared. Optional template **«Mantenimiento del PC» / "PC maintenance"** (`src/core/templates/<lang>/mantenimiento.json`, one bot with `equipo` + `recordatorios` and a weekly check; offered in «Nuevo bot» when the bots live in this Orb).
- The server only runs a closed list, without sudo: `docker restart`, `docker compose pull` + `up -d`, `systemctl --user restart`, cleaning the user's journal and `apt-get clean` (if sudo is needed, it says so).
- Approving `total` from the phone is still forbidden (unchanged).

## API (`api.call(method, params)`)
| Method | Parameters | Returns |
|---|---|---|
| `bots.list` | — | `{ bots[], groups[], states[], tools[] }` (each bot with `effectiveTools`, `conversation`, `state`, `reminders`) |
| `bots.get` | `id` (number or name) | bot + `memory` + `reminderList` |
| `bots.create` / `bots.update` | bot fields (`update`: `id` + the changed ones) | bot |
| `bots.delete` | `id` | `true` |
| `bots.pause` | `id`, `paused` (default `true`) | bot |
| `bots.chat` | `id`, `limit?`, `before?` | `{ conversation, lines[], state }` |
| `bots.send` | `id`, `text` (`via` is set by the link: `phone` or `terminal`, and the bot gets a line so it can tailor its reply) | `{ conversation, bot }` |
| `bots.stop` | `id` | `true` |
| `bots.decide` | `item` (id of the card line), `decision` `allow`/`deny` | `{ ok, status, result }` |
| `bots.answer` | `item` (question card), `text` | `{ conversation, bot }` |
| `bots.groups.list` / `create` / `update` / `delete` | `name`, `icon`, `members[]` (ids or names), `id` | group `{ id, name, icon, members[] }` |
| `bots.groups.chat` / `bots.groups.send` | `id` (+ `text`) | `{ conversation, lines[] }` / `{ conversation, group, members }` |
| `bots.groups.get` / `bots.groups.members.add` / `bots.groups.members.remove` (3.6) | `id`, `bot` or `person` | group with `members[]`, `people[]`, `owner`. In `bots.groups.send`, `@Name` addresses only those bots (answer: `mentioned[]`); without @ the chief first. Lists, pins, unread: `inbox.*` (docs/PERSONAS-INTERNALS.md) |
| `bots.memory.get` / `bots.memory.set` | `id` (or `"global"`), `text` (replaces) | `{ id, text }` |
| `bots.rules.get` / `bots.rules.set` | `rules[]` | list of rules |
| `bots.reminders.list` / `create` / `cancel` | `id?` (bot), `all?` / `id`, `text`, `when` (`YYYY-MM-DDTHH:MM`), `every` (`once`, `daily`, `weekly`, `monthly`, `yearly`), `weekdays[]` / `id` (reminder) | reminders |
| `bots.ha.get` / `bots.ha.set` | `url`, `token` (the token goes to the database, never to `orb.json`) | `{ url, hasToken }` |
| `bots.ha.states` | — | `{ configured, states[] }` (`entity_id`, `state`, `name`, `unit`): the "Home" screen |
| `bots.srv.status` | — | the same as `srv_status`: the "Server" screen |
| `bots.decide` on a `pc` card (3.7) | `item`, `decision` | runs `runPcAction` once approved (the owner approves from afar only from a device that may manage, as `srv`) |
| `centro.<method>` | the method's own | on a workshop linked to a hub: the hub's bots (`centro.status` → `{ linked, id, name, online, lastSeen }`) |

**Where they live (3.5, the user chooses):** `config.bots.location` is `local` (default) or the id of a linked Orb that keeps bots (role `centro` or `todo`). When linking to one, Settings › Magic Link asks "Where do you want your bots?" (`bots.where` → `{ location, peer, peers[], localBots, ask }`) and `bots.moveTo({ location, bring })` saves it; with `bring`, "Bring my bots" creates each bot there (except an untouched "Asistente" with the same name), with its memory, its reminders and the global memory, and pauses it here and cancels its reminders. With the location on another Orb, the UI uses `centro.bots.*` (`centro.status` → `active: true`): it is forwarded with `link.call` and the other Orb accepts it from an `orb` device (`ORB_ALLOWED`: the phone's permissions plus creating, changing and deleting bots and groups, memories, rules and Home Assistant). `bot.*` events arrive as `centro:bot.*`. A linked device marked "Can manage" (`devices.admin`) gets `CONSOLE_ALLOWED` (all of the above plus `link.*`); being a browser is not enough.

From the phone (`remote.mjs › ALLOWED`): `list`, `get`, `chat`, `send`, `stop`, `decide`, `answer`, `pause`, `groups.list/chat/send`, `memory.get`, `rules.get`, `reminders.list/create/cancel`, `ha.states`, `srv.status`. Creating, changing or deleting bots, memories, rules and Home Assistant: only on the PC.

## Chat lines and events
- Lines (`board.chat(conversation)`): `role` `usuario` (user), `bot` (`meta: { bot, name, icon }`; `meta.kind`: `relay` = message between bots, `reminder`, `bot_question` with `questions[]` and `status`, `stopped`) and `system` (`meta.kind = 'bot_card'`, `card`: `admin` | `srv` | `pc` | `ha` | `confirm` | `tool`, `payload`, `status`: `pending` → `running` → `done` / `failed` / `denied` / `expired`, `result`).
- Events: `bot.message` `{ id, conversation, role, body, meta, updated? }`, `bot.state` `{ bot, busy, since, partial, tools[], queued, conversation }` (`tools`: the turn's steps, `{ name, target, at }`, for the chat's "in progress" line), `bot.updated` `{ id }`. Bot lines are not emitted as the assistant's `chat:new`. Phone notifications (replies, reminders, cards) go through Web Push with the bot's name.

## Pieces
`src/core/bots.mjs` (data, memories, groups, reminders, exclusives) · `src/engine/bots.mjs` (live sessions, groups, messages between bots, cards, reminders) · `src/mcp/bot.mjs` (each bot's tools, signed identity `bot:<id>`) · `src/core/server-admin.mjs` (server and Home Assistant) · `src/core/pc-health.mjs` + `src/core/pc-actions.mjs` (this computer, 3.7) · tests in `test/bots.test.mjs` and `test/equipo.test.mjs`.

## UI (3.5)
"Orb | Bots" switch at the top of the menu (on the phone, at the top of the screen); each mode remembers its last screen and the PC stores the mode in `ui.mode`. Screens in `src/ui/views/bots/` (chat, list and editor, groups, reminders, memory, home, server, settings), pure logic in `src/ui/lib/bots.js` (`test/bots-ui.test.mjs`). Magic Link in `src/ui/views/magic-link.jsx` (Settings › Magic Link on the PC; its own screen on the phone and in the browser). The workshop banner (`components/taller-banner.jsx`) shows on a phone linked to a hub. A desktop browser 1024 px or wider uses the PC layout. Screenshots: `node test/capturas.e2e.mjs` (PC) and `node test/mobile.e2e.mjs` (phone).
