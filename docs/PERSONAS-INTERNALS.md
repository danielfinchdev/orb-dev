# People (3.6): internals

How Orb knows who is calling and what they may see. This page is for people working on Orb's code; the user guide is
`docs/PERSONAS.md`.

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
// channel: desktop | phone | browser | terminal | orb | forward | control | agent | system
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
