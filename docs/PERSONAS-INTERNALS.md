# People (3.6): internals

How Orb knows who is calling and what they may see. This page is for people working on Orb's code; the user guide is
`docs/USERS.md` (in the interface the feature is called "Users" / "Usuarios"; the code keeps `persons`).

## Model

- Two roles: `owner` (manages the Orb; sees the names and usage numbers of the others, never their content) and `user`
  (their own things and what is shared with them). One owner per Orb (`persons_owner` unique index).
- Tables (`src/core/db.mjs`): `persons`, `person_settings`, `shares`, `account_loans`, `usage_ledger`, `bot_sessions`,
  `memory_log`, `link_seen`, `audit`. A `person_id` column on `PERSON_TABLES` (conversations, chat, tasks, sessions,
  schedules, projects, bots, bot_groups, bot_reminders, bot_requests, link_queue, events, devices).
- **A row with `person_id` NULL is the owner's.** Code that does not stamp a person yet keeps working; new code stamps
  `principal.person`.
- Migration (once per database, inside `BEGIN IMMEDIATE`, idempotent): copy of the old database to
  `<data>/orb-pre-3.6.db` (`VACUUM INTO`), the owner is created (name from `userName`), every row gets the owner,
  `bots.session_id/turns` are copied to `bot_sessions`, reminders get `local_at` + `tz`, `bots/memoria-global.md` moves to
  `bots/personas/<owner>/memoria-global.md`, and `accounts[]` / `mcpServers[]` in `orb.json` get `person: <owner>`. The
  flag is `settings.persons_migrated`.

## Persons (`src/core/persons.mjs`)

`ensureOwner(board)`, `ownerId(board)`, `getPerson`, `mustPerson`, `listPersons`, `personsCount`, `personName(board, id)`,
`createPerson(board, { name, language, tz, color, caps })`, `renamePerson`, `updatePerson`, `setCaps`,
`removePerson` (soft delete for now), `setPin(board, id, pin | null)`, `verifyPin(board, id, pin, { device })` →
`{ ok, ticket, until }` or `{ ok: false, reason: 'wrong' | 'locked', triesLeft?, lockedUntil? }`, `issueTicket`,
`checkTicket(ticket, person, device)` → end time or 0, `dropTickets(person)`, `overview(board)` (numbers only).
PINs are 4–12 digits, scrypt with a salt; 5 wrong tries lock it for 30 s, each further wrong try doubles the wait (max 1 h).
Tickets last 5 minutes, live in memory and are bound to one device.

Per-person settings: `personSetting(pid, key[, value])` in `src/core/context.mjs` (or `board.personSetting`). Keys:
`PERSON_KEYS`. For the owner, a key without a row reads its 3.5.1 place (`orb.json` or `settings`), so one person
behaves as before; writing through `personSetting` creates the row.

## Principal

Built **only** by entry points with `principalOf(board, { desktop, person } | { device } | { forwarded } | { control } |
{ agentToken } | { system })`, never from call parameters. Frozen:

```js
{ person, role: 'owner' | 'user', channel, device?, remote?, confirmed?, ceiling?, strongUntil?, via?,
  rights: { approve, dev, admin } }
// channel: desktop | phone | browser | orb | forward | control | agent | system
```

A device row without `person_id` is the owner's. A user never gets `rights.admin`.

## Authorization (`src/core/authz.mjs`)

- `authorize(board, principal, method, params)`: ceiling of the channel → the method's rule → rights on its resources →
  strong auth. Throws `AuthzError` (`status 403`, `userFacing`, `reason`) and writes an `audit` row (ids only).
- `ownerOf(board, { type, id })` → person id or null (no such thing). `rightOn(board, person, res)` → `'own' | 'edit' |
  'talk' | 'view' | null`, through shares of the resource or of its parent (task → project, group conversation → group,
  task session → task, schedule → project, reminder/request → bot). Owning the parent gives `edit` on the child.
- `can(board, principal, right, res)`, `must(...)` (throws + audit), `scopeSql(principal, type, alias)` →
  `{ where, args }` for lists (own rows, plus shared ones for bot, group, project, task, schedule, group conversations).
- `audienceOf(board, event, payload)` → `{ persons: Set } | { all: true } | { owner: true }`; `reaches(board, audience,
  person)`; `peopleWith(board, res)`.
- `shapeFor(principal, method, result)`: what goes back (no PIN data; WS2 adds per-channel shaping).

The engine's dispatcher (`src/engine/api.mjs`) calls `authorize` before every method and passes the principal on:
`api.call(method, params, principal)` → `fn(params, principal)`. A call without principal is the engine itself
(`system`). `api.desktopPrincipal()` is this PC's window (owner until `persons.switch`), `api.methodNames()` lists the
methods.

## Policy (`src/core/policy.mjs`)

Deny by default: a method without an entry is refused, and `test/authz.test.mjs` fails when a method has none.

```js
'chat.send':   { res: (p) => [{ type: 'conversation', id: p.conversation }], right: 'talk', create: 'conversation' },
'bots.update': { res: (p) => ({ type: 'bot', id: p.id }), right: 'edit' },
'persons.create': { ownerOnly: true },
'agents.status':  { public: true },
```

Fields: `public`, `ownerOnly`, `admin` (from afar only with «Puede administrar»), `desktop`, `res` (one resource or a
list; each may carry its own `right`; `id` null skips it), `right`, `create`, `list`, `strong(params)`,
`check(board, principal, params)`. A resource that does not exist passes for the owner (the method reports it as before)
and is refused for anyone else.

Ceilings: `CEILING` per channel (`'*'`, a Set, or `null` for agents), `ceilingFor(principal)` (a device with «Puede
administrar» gets `CONSOLE_SET`, a confirmed Orb `ORB_SET`), `PHONE_SET`, `ORB_SET`, `CONSOLE_SET`, `CENTRO_PHONE`,
`FORWARD_SET`, `CONTROL_SET`. `remote.mjs` keeps `allowedFor` on top of these sets.

Events: `EVENTS[event]` is `'all'`, `'owner'` or `(payload) => { type, id } | { person } | 'all' | 'owner'`. Prefix
rules end in `*` (`centro:*`). The test scans `src/` for every `emit('…')` and fails on one without a rule.

### Adding a method or an event

1. Write the method in its `src/engine/api-*.mjs` file; it gets `(params, principal)`.
2. Add its entry to **your workstream's section** of `POLICY` in `src/core/policy.mjs` (`GATEWAY`, `ORBMODE`, `BOTSP`,
   `DATA`, `UI`); lists filter with `scopeSql`, creates stamp `principal.person`.
3. A new event: its rule in your section of `EVENTS`, and ids in the payload (never rely on content to route).
4. Texts go in `src/core/locales/{es,en}/ws<n>.mjs` (already registered).

## Accounts, loans and caps (WS3)

`src/core/budget.mjs`. An account is its person's (`accounts[].person`; none = the owner's). A person adds their own
(`accounts.add`, folder `<home>/.orb/cuentas/<person>/<id>`) and signs it in from any channel (`agents.login*`; the
console only on this PC, for the owner). Another person spends it only through a loan (`account_loans`).

- `accountsFor(board, person, agent, { purpose: 'dev' | 'bot' | 'orbe', usable })`: own accounts first, then valid loans
  for that purpose (`loan.dev` for Orb mode and the assistant, `loan.bots` for bots). `mayUseAccount(board, person, id)`.
- `pickAccount(board, { person, agent, bot, preferred, purpose })`: the preferred one if that person may use it (else
  `null`: the caller refuses), else their first own usable account, else a lent one with room today.
- `checkSpend(board, { person, account, bot })` → `{ ok: true }` | `{ ok: false, reason: 'botCap' | 'noLoan' | 'expired' |
  'loanCap' | 'reserve', resetsAt }`. Bot caps (`bots.caps`) count that bot's turns/tokens/dollars of the day; a loan's
  caps count the borrower's on that account; the reserve blocks borrowers (never the lender) when the account's real
  usage is ≥ 100 − `reserve_pct` %. `spendText(check, { account })` says it in words.
- `recordSpend(board, { person, account, bot, conversation, session, task, usage })`: one `usage_ledger` row per turn
  (`usage` as the agents report it), day in the spender's time zone (`tz.localDay`).
- Called before/after every turn by `Sessions.send` (direct conversations and tasks), the assistant's lane
  (`orchestrator.mjs`) and, for bots, `engine/bots.mjs` (WS4). The scheduler only offers a task the accounts its person
  may spend now. A refused turn: a line in that conversation, a notice and a push to that person only
  (`sessions.onBlocked`, `orchestrator.onBlocked`, `remote.push({ person })`).
- API: `accounts.lend { id, person, daily_turns?, daily_tokens?, daily_usd?, reserve_pct = 20, bots = true, dev = false,
  expires_at? }` and `accounts.unlend { id, person }` (the account's person only), `accounts.loans` (given and got, with
  what is left today), `usage.get` (own and borrowed accounts), `usage.byPerson` (owner: totals only).

## Orb mode per person (WS3)

- Lists filter with `scopeSql`: conversations, chat lines of no conversation, tasks, sessions, projects, schedules, logs,
  mentions, approvals, `app.state` counts. Creates stamp the caller (`createTask({ person })` defaults to its
  conversation's, parent task's or schedule's person). Each person has their active project and brain
  (`person_settings`), sidebar lists and general log (`general-<person>.md`; the owner keeps `GENERAL.md`).
- A9: Orb mode needs `caps.dev`, or a project shared to talk (then only there): `policy.mayDev`. A session of anyone
  but the owner is confined by the guard (`confineFor` / `confineCheck`): paths, patterns and commands must stay inside
  its folder, on the real path, never another project, Orb's folder or a secret.
- Sharing: `shares.set { type, id, person, right }`, `shares.remove`, `shares.list` (the resource's person, or «edit»
  to share to view or talk; never to oneself). Removing a project share stops that person's running sessions in it;
  `bots.unshared(res, person)` is called when present (WS4).
- MCP (`src/mcp/server.mjs`): the worker's token signs `{ agent, task, person }` (`agentToken(board, agent, task,
  person)`); the coordinator's conversation is signed with its key (`ORB_CONVERSATION_TOKEN`, `conversationSig`). Every
  tool checks the right with `authz.must` or filters with `scopeSql`; an unsigned agent works for nobody.

## The gateway (WS2)

- **Events.** `emit(event, payload, hint?)` in `src/engine/engine.mjs` goes to `src/engine/router.mjs`, which works out
  the audience once (`audienceOf`, or the hint: `{ person }` / `{ persons }`) and gives it to each sink: this PC's window
  (the person sitting at it; while locked only `persons:*`), every live stream of `remote.mjs` (`client.person`), its
  notifications, the centre of a workshop (`link.relay(event, payload, reaches)`: only the centre whose link belongs to
  that person here) and dev-control (owner). `board.changed(what, { person } | { res })` becomes a `board:changed` for
  those people only; without a hint, for everyone (table names, never content). A workshop's events arrive as
  `taller:<event>` for the person of that workshop's device; the centre's bots as `centro:<event>` for the person of the
  link.
- **Devices.** `devices.person_id` is set when pairing, from the QR («¿Para quién?»: `link.qr { person | newPerson }`),
  never from what the device says. A user makes QRs for themselves only; `newPerson`, a QR for someone else and
  «Puede administrar» are the owner's (and admin only for an owner's device). `link.devices`, `link.status`,
  `link.revoke`, `link.rename` are per person (the owner: everyone's devices). Pictures go to `adjuntos-movil/<person>/`.
  Notifications go to the devices of the audience with each person's `preview` (`personSetting(pid, 'preview')`).
  3.6 (M4): `remote.mjs › deliverNote` builds one note per person (`src/core/notes.mjs`: preview, mute, PIN) and sends
  it to the audience only: as a sealed `note` event to their open streams (the Android app shows it in the background)
  and as Web Push to their closed devices, with one-time action tokens for that device (`POST /api/note-action
  { token }`, run as that device's principal: same ceiling, `approverOf`, `guardCall`, authz; a sensitive card needs a
  strong ticket; no token is minted for a sensitive card or for a person with a PIN — the app lock — and a token used
  after a PIN was set is refused with reason `locked`). `/avatars/<shape>-<color>.png` and `/avatars/g/…` hold
  only shapes and colours.
- **Strong tickets from afar.** A call body may carry `ticket` (from `persons.verifyPin` on that device); `remote.mjs`
  turns it into `principal.strongUntil`. A refused call answers `{ ok: false, status: 403, reason }`.
- **Protocol 3** (`src/core/link.mjs`): `PROTOCOL = 3`, `MIN_PROTOCOL = 2` (phones), `FORWARD_MIN = 3`.
  Hello and `/api/me` carry `{ v, min, version, features }`, the person the link is for (`person`) and the Orb's identity
  (`orb: { orbId, incarnation, host }`, checked with `cloneVerdict`: a copy is refused, a move followed). `versionGap()`
  says who must update. Link records keep `person` (whose link here) and `remotePerson` (whom the other side counts it as).
- **Forwarding (A13, A12).** The centre forwards only to the person's own workshop (`remote.mjs › devTargetDevice(person)`,
  `mayForward`: audited); a workshop of protocol 2 gets the owner's calls only («Actualiza …»). `link:request` carries
  `principal` and `request_id`; the workshop (`src/engine/forward.mjs`) runs it as the person of its link only if the
  principal is the link's `remotePerson`, once per `request_id` (`link_seen`). No answer in time is `desconocido`
  (kept in `link_queue` with its `request_id`); `taller.retry { id }` sends the same request again. The queue is per
  person (`taller.queued`).
- **Shaping (B1/B2)** (`src/core/shape.mjs`, called by `shapeFor(principal, method, result, board)`): with more than one
  person, `app.state` keeps only the caller's approvals, conversations at work, counts and sidebar marks (someone other
  than the owner also gets the settings without others' accounts, connectors or paths), and every list drops what the
  caller has no right on.
- **This PC's window.** `api.desktop = { person, locked }`. `persons.lock` / `persons.unlock { id?, pin }` /
  `app.lockState`; while locked, `engine.mjs` refuses every call of the window but those (and a minimal `app.state`).
- **Orb Server.** `host.call(method, params, { as: 'control' })` runs as the owner on the control channel (ceiling
  `CONTROL_SET`, with `persons.list/create/setPin/overview`). Commands: `orb-server usuarios`, `usuario nuevo <nombre>`,
  `pin-reset <usuario>`, `enlazar --usuario <nombre> [--admin]` (the older `personas`, `persona nueva` and `--persona`
  still work).
- **Backups of a linked Orb.** Link op `backup.put` (`link.putBackup(id, file)` sends 1.5 MB pieces): only from a
  confirmed Orb of the owner, an `.orbbak` (magic checked), at most 2 GB; kept in `<backups>/de-otros-orbs/<device>/`, the
  last 3.

## Bots per person (WS4)

`src/core/bots.mjs` (data), `src/engine/bots.mjs` (lanes, cards), `src/mcp/bot.mjs` (the bots' tools), `src/engine/api-bots.mjs`.

- **Owned.** Bots, groups, reminders and requests carry `person_id` (creates stamp the caller). B6: a bot's name is unique
  per person (`getBot(board, name, { person })`: own first, then one shared to talk). Exclusives and the chief are among
  one person's bots. `listBots/listGroups({ principal })` filter with `scopeSql`; reminders are each person's own
  (`listReminders({ person })`), also on a shared bot.
- **Shared bot.** One conversation (`botConversation(board, bot, { person })`, always private) and one lane per bot and
  person: `bot_sessions(bot_id, person_id)` keeps each live session. Memory: `bots/<id>/memoria.md` (bot-wide: `view`
  reads it, `edit` writes it) and `bots/<id>/personas/<person>.md` (only in that person's turns). `memoryFile(id,
  { person, which: 'bot' | 'mine' })`; `'global'` is the person's `bots/personas/<person>/memoria-global.md`. The guard
  denies the other people's files of the bot (and patterns or searches that would sweep `personas\` while it holds one).
  A bot spends its person's account (`pickAccount({ person: bot's person, purpose: 'bot' })`, `checkSpend` before each turn
  with `bots.caps`, `recordSpend` after); a refused turn is told to the talker only. `bots.unshared(res, person)` stops
  that person's lanes at once and calls `bots.onRevoke` (the router's `revoke`).
- **Shared group** (M4): one conversation (the group's person's); each line keeps its author (`chat.person_id`), the
  prompt says «Mensaje de <name>» and each bot answers in the author's lane; members must be bots the group's person may
  talk to (`mayTalkTo` also lets a talker of a shared group use its bots' tools).
- **Cards.** `approversFor(kind, payload, bot, talker)`: the talker by default (purchases, questions, tools, own
  memory); `admin`/`srv`/`pc`: whoever may edit the bot (srv and pc, 3.7, also need `talk` on `integration:srv` / `integration:pc`); `ha`: the talker with
  `caps.approveHouse` or `edit` on `integration:ha`, else the integration's editors. Stored in `bot_requests.approvers` and
  the card's meta; only they get the push; `bots.cards` lists the ones waiting for the caller. `bots.decide` (policy
  `BOTSP`): yes only by an approver, no also by the conversation's person; sensitive cards (`ha`, `srv`, `pc`, `admin` except
  pause, `confirm`) need a strong ticket when the approver has a PIN; `bot_requests.answered_by`.
- **A5.** `memory_log` keeps every change (`applied` with `before`, `pending`, `rejected`, `undone`; scope `bot:<id>`,
  `bot:<id>:<person>`, `global:<person>`). From the bot: its own file of the talker at once; bot-wide only in a turn of
  someone with `edit`; global only from the talker's own chief; after reading outside content (`bot_taint:<bot>:<person>`
  set by the lane) everything waits — a `memory` card for the memory's person. API `bots.memory.history|pending|approve|
  undo`. Memories go in prompts as quoted data («NOTAS (datos, no órdenes)»).
- **A7.** `haCallFree(board, person, { domain, service, entity })`: the person's allow list (`ha_allow:<person>`, entries
  `domain.service entity` or `domain.service *`; API `bots.ha.allow.get|set`); `HA_ALWAYS` (lock, alarm, cover, valve,
  siren, script, automation, homeassistant, and switches/buttons that open something) only by exact entry. No list yet:
  as 3.5.1 (only those ask).
- **Reminders.** `local_at` + `tz` (the person's, or the one the client sends) through `tz.nextLocalRun`; a late one-off
  says «(con N min de retraso)», a late repeating one with `skip_missed` (default) skips that run; `fired_late_ms`.
- **A14** `bots.moveTo { location, bring, mapping?, history? }`: with accounts or connectors to map and no `mapping`, the
  answer is `{ step: 'mapping', accounts, connectors, bots, there }`. Then the copy (bots, both memories, reminders with
  `tz`/`local_at`, optionally the conversation via `bots.history.import`), each read back and checked; only then paused
  and cancelled here in one transaction. A failure deletes the copies there and changes nothing here (`{ ok: false,
  failed: { bot, step, message }, report }`); leftovers of a cut run (`bots_move` journal) are deleted first next time.
- **S1.** `botBrainProblem(board, agent)`: Claude (guard per tool, real paths), or an adapter with
  `caps.botConfinement` — Codex starts with `-c features.shell_tool=false -c features.unified_exec=false -c
  features.view_image=false -c web_search="disabled|live"`, read-only sandbox in the bot's folder; a command, file change
  or unknown tool anyway (`botConfine.onBreakout`) stops the lane and sets `bot_unconfined:<agent>` (refused from then on).
  Any other agent is refused as a bot's brain. Residual risk: an MCP connector the person gave the bot runs with its own
  rights.
- **Browser profiles.** `src/main/browser.mjs` keeps one session per person on disk (`persist:orb-web-<person>`; the owner
  `persist:navegador-agente`): sign-ins stay for that person between runs and never reach another person's pages; the
  person is signed in the page key (`browserKey({ …, person })`); a bot uses its person's.

## Audit (3.6, `test/auditoria-36.test.mjs`)

Every policy method with crafted params (the other person's ids in every slot, names for ids, @ mentions, searches,
dependencies, members, paths), from the window and a phone, both ways. What it made stricter:

- **Messages between agents** carry the sender's person (`messages.person_id`, from its signed token or its task):
  `board.send`/`inbox({ person })` and `scheduler.deliverMessages` only reach that person's agents; a line «to the user»
  is that person's.
- **The assistant reads files** (Read/Glob/Grep) confined like a session: someone other than the owner from
  `<runs>/personas/<person>` with only their visible projects (`confineFor`); the owner's with `{ exclude, cwd }`: other
  people's project folders and assistants' folders. Grep/Glob without a path check the working folder; a command's
  relative path that climbs out (`..`) is checked too (`confineCheck`).
- **Folders and names.** `addProject` refuses a folder inside (or around) another person's project; a dependency must be
  a task its person may see; a project name, folder or multiplatform group of someone else answers
  `msg.projects.nameUnavailable` (never whose or where).
- **Files from the window** (`whiteboard.attach`, `projects.setIcon`, pictures of `sessions.send`/`tasks.followup`,
  `images.read`/`save`): never inside someone else's project (and, for a user, nothing else of Orb's folder).
- `bots.where`/`bots.moveTo` see and use only the caller's links; a person's export takes only their reminders; a
  forwarded call's `request_id` is kept per link (`link_seen`); the owner's assistant notices go to the conversation's
  person.
- Left as designed: backups (owner only) and the 30-day trash of a removed person hold everyone's data; the owner's
  sessions with write access and this PC's account can read the disk.

## Messaging lists (3.6, `src/engine/api-inbox.mjs`, `src/core/inbox.mjs`)

Each person's own chat lists. Tables `inbox_items (person_id, kind, item_id, pinned, pin_order, section_id, muted,
last_read)` and `inbox_sections (id, person_id, zone, name, position)`; where a person starts counting unread lines:
settings `inbox_since:<person>`. A chat is `{ kind: 'bot' | 'group' | 'conversation', id }`; a method that names one
needs «view» on it (policy `INBOX`), sections are only the caller's own.

- `inbox.list { zone: 'bots' | 'orb' }` → `{ zone, items[], sections[], unread, projects? }`. Item: `key, kind, id,
  conversation, title, avatar ({ type: 'bot', id, icon } | { type: 'group', members[] } | { type: 'project' } |
  { type: 'orbe' }), pinned, pinOrder, section, muted, unread, state ('working' | 'paused' | 'idle'), at, lastMessage
  { id, text (short, plain), at, kind (text | card | question | reminder | report | system), from { type: 'user' |
  'bot' | 'bot-to-bot' | 'orbe' | 'system', name, toName? } }`, `sharedBy?`. Sorted: pinned (pinOrder), sections
  (position), the rest by recency. Zone orb adds `projects[] { project, at, items[keys], unread, working }`.
- `inbox.pin`, `inbox.unpin` (back to its section), `inbox.reorderPins { zone, order[] }`, `inbox.mute { muted }`
  (3.6 M4: no notification at all, cards and questions included; only the person's reminders still ring), `inbox.markRead { upTo? }`.
- `inbox.sections.list|create|rename|delete|reorder`, `inbox.sections.move { kind, id, section | null }`.
- `inbox.search { q, zone }` → `{ items[], messages[{ key, kind, id, conversation, title, line }] }` (no case, no accents).
- Event `inbox:changed { person, kind?, id?, conversation?, zone? }` to that person only: every new line of a conversation
  (to each person who sees it; the author's own line marks it read for them), and every change of their marks.
- Groups: `bots.groups.create { people[] }` (shared to talk, the rules of `shares.set`), `bots.groups.get`,
  `bots.groups.members.add|remove { id, bot | person }` («edit»; anyone may leave). In a group message, `@Name` (no case or
  accents, several, whole names) addresses only those members, in that order (`B.mentionedMembers`); without @, the chief
  first as before. `bots.groups.send` answers `{ members, mentioned }`.
