# 12. Context and real usage

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** It is the middle ground between working and not burning tokens.
- **Context meter** in each conversation and in the chat. The fuller it is, the more each reply costs.
- **Real usage:** Claude and Codex report how much of their window (5 hours, week) you have used and when it resets.
  From `budget.stopAt` (92 %), new work waits or goes to another account.
- **Safety net:** 20 tasks per window and 6 with expensive models per account.
- Optional spend caps per task (`maxBudgetUsd`) and approval for high reasoning.

**Files.**
- `src/domain/usage/budget.mjs`:
  - `recordRate` and `realRate` (real usage);
  - `canLaunch` and `rankAccounts` (decision and order);
  - `startCooldown` (pause until the reset).
- Data source: the adapters' `rate` events, in `sessions.onRate` (`engine.mjs`) and the brain's
  (`orchestrator.onEvent`).
- Screens: Agents ("Usage per account") and Settings ("Quota usage limit (%)").

**The context ring and the usage panel.**
- Next to the send button, `ContextMeter` (`src/ui/views/session.jsx`) is a ring that fills up; clicking it,
  `UsagePanel` requests `usage.now` (`api.mjs`): the brain, the accounts with running sessions and the ones that
  reported recently.
- Each plan window is stored separately in `rates:<account>` (`recordRate` → `rateWindows`, shortest first). Single-model
  windows (`seven_day_opus`, `seven_day_fable`…) are only shown: they do not stop the account (`rate:<account>`).
- Claude only sends its usage near the limit: `planUsage` (`claude.mjs`) requests it after each turn, at most every
  90 s, with the SDK's experimental call. Codex sends its two windows (primary and secondary) in
  `account/rateLimits/updated`.

**Saving or power.** `budget.profile` (0 = max saving … 4 = max usage; `null` = manual). The slider in
Settings › Agents and usage (`SPEND_PRESETS` in `settings.jsx`) sets the limits, and `persona()` (`orchestrator.mjs`,
`SPEND`) tells the brain how cautious to be. "Advanced options" save with `profile: null`.

**Each agent's real models.** `discoverModels(agent)` (`src/agents/index.mjs`, one per adapter: Agent SDK
`supportedModels`, Codex `model/list`, `cursor-agent --list-models`, ACP `session/new`, `opencode models`) in its own
empty folder, one at a time, at startup (every 12 h), with "Check" and when the picker knows none
(`catalog.mjs`: `refreshModels`, `rememberModels`, which cleans up the names). `checkModel` accepts those models in
tasks, and `models.catalog` is cached for 5 s.

**Usage tab (3.8.11).** `usage.records` (remote RPC) returns the stored usage records for a period; older data without
the newer fields still reads. The tab (`src/ui/views/settings/usage-tab.jsx`) filters them, groups them by day and shows
cost, tokens or limits. `src/ui/lib/usage-data.js` does the grouping and totals, and `src/ui/components/usage-chart.jsx`
draws the line chart as hand-written SVG (no chart library). CSV export neutralises cells that start like a formula.
