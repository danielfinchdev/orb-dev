# Learnings for 3.5 (two outside repositories)

The user asked to study two projects and apply to Orb whatever is worth it. They were read without running anything
(shallow clone, no `npm install` and no scripts). Both are **MIT** licensed; no code was copied: the ideas were
rewritten for Orb.

## 1. emilkowalski/skills (Emil Kowalski, MIT)

**What it is.** A pack of *skills* for coding agents (Claude Code `SKILL.md` format / `npx skills add`): 16 UI craft
guides, mostly about animation, written by a design engineer (Vercel, Linear, author of Sonner and Vaul). The most
useful for Orb: `emil-design-eng` (the main one), `review-animations/STANDARDS.md` (exact values), `mobile-native`
(making a website feel like an app on the phone), `break-ui` (testing with worst-case data), `remove-animations` and the
two cheat sheets (`ui-cheatsheet.md`, `performance-cheatsheet.md`). `write-swift`, `animate-expo` and `ask-sonner` do not
apply (Orb does not use Swift, React Native or Sonner).

**Ideas that work for Orb.**
- Should it animate? It depends on frequency: what happens hundreds of times a day (keyboard shortcuts), nothing; tens
  of times (hover, switching modes), little and fast; occasional (dialogs, menus), normal animation.
- Curves: **strong ease-out** for what appears or leaves (`cubic-bezier(0.23, 1, 0.32, 1)`), ease-in-out for what moves
  across the screen, never ease-in in the UI. UI under 300 ms.
- Nothing appears out of nowhere: from `scale(0.95–0.97)` and transparent. Menus grow from their button; dialogs, from
  the centre.
- Feedback on press (`scale(0.97)` on `:active`), not on release.
- No `transition: all`: specific properties, and only `transform`/`opacity` when possible.
- Reduced motion = less motion, not none: fades stay, slides and scaling go.
- Mobile: no grey tap flash, no sticky hover, `touch-action: manipulation`, 16 px inputs (otherwise iOS zooms),
  `viewport-fit=cover` + `env(safe-area-inset-*)`, `overscroll-behavior`, the right keyboard
  (`inputmode`, `autocorrect="off"`, `enterkeyhint`).
- Details: `tabular-nums` on changing numbers, visible feedback when copying, loading states on the button.

## 2. gabogabucho/hermes-alado (Gabriel Urrutia, MIT; includes MIT files from Nous Research)

**What it is.** "Alado", a phone PWA that talks to a Hermes Agent server (Nous Research): chats with bots, groups,
approvals, push notifications, voice, routines, a vault to sign in without the bot seeing the password, and the bot's
desktop live. It ships a server installer, a push plugin and a *skill* (`alado-companion`) that tells the bot it is
being talked to from a phone.

**Ideas that work for Orb.**
- **Calm chat**: while the bot works you see a single line ("Working…" → "Done · 4 steps"), not every tool call; it
  expands if you want the detail. Friendly labels per tool, never its internal name.
- **The bot knows where the user is**: if they write from the phone, short answers first, no wide tables; the user has
  no terminal, so the bot does not ask them to run commands.
- **Secrets never through the chat**: no passwords, codes or cards; for that, a secure form or the user does it
  themselves.
- Others, not applied for now: a secure form for secrets (the vault), viewing and taking control of the bot's screen,
  cron in words, reconnection with growing backoff, "system health" with proposed fixes.

## 3. What was applied (branch `orb-3.5-aprender`)

UI (`src/ui`):
- `app.css`: curves `--ease-out`, `--ease-in-out`, `--ease-drawer`; enter and exit animations (tw-animate-css) use the
  strong ease-out; press feedback on every button (`[data-slot=button]`, `.press`) and on the phone tabs; no tap flash;
  `touch-action: manipulation`; no selecting a button's text on long press; `overscroll-behavior: none`; 16 px inputs
  on touch screens. With reduced motion (the system's or Orb's "minimal") slides and scaling are removed and fades stay.
- `button.jsx`, `overlay.jsx`: no `transition-all` (specific properties, 150 ms, ease-out); the dropdown and the select
  grow from their button (`--radix-*-transform-origin`); the switch slides with ease-out.
- `mode-switch.jsx`: the "Orb | Bots" switch has a marker that slides to the chosen mode (200 ms, ease-out); with
  reduced motion it does not move.
- Magic Link (`magic-link.jsx`, `main.jsx`): the QR fades in; the copy button turns into a check mark ("Copied") for
  1.5 s; the create and link buttons show they are in progress; the code uses fixed-width digits; the code and address
  fields have no autocorrect and a "Go" key.
- `index.html`: `viewport-fit=cover`, so the safe areas the phone layout already used also work on iPhone.

Bots (engine and chat):
- `engine/bots.mjs`: the `bot.state` state carries `since` and `tools` (the turn's steps, like the assistant's chat). The
  bot's chat (`views/bots/chat.jsx`) shows the same calm line as the assistant ("Checking the reminders · 12 s",
  expandable with the steps). New labels for the bots' tools (`chat.act.reminder`, `memory`, `bots`, `confirm`,
  `manage`, `home`, `server`).
- "Where from": `bots.send` and `bots.groups.send` accept `via` (`phone` | `terminal`), which is set **only by the
  link** (`remote.mjs`, from the device type; whatever the device sends is ignored). The bot gets an "AVISO DEL
  SISTEMA: … te escribe desde el móvil…" (system notice: the user is writing from the phone) line before the message;
  the chat stores only what the user wrote.
- Persona: new rule "SECRETOS: nunca pidas por el chat contraseñas, códigos de un solo uso ni números de tarjeta…"
  (never ask for passwords, one-time codes or card numbers in the chat).

Tests: `test/aprendido.test.mjs` (bot steps, "where from", secrets rule) and a new case in `test/remote.test.mjs` (a
linked phone arrives as `phone` even if it sends something else).

## 4. What is left out (and why)

- **Installing skills from Orb** (e.g. `emilkowalski/skills` for Claude Code and Codex): useful, but it means pulling
  third-party content into the agents' configuration; it needs a review of what gets installed, where
  (`~/.claude/skills`, the project's, Codex's) and how it is removed. Next step: Settings › Agents › "Skills", with a
  source list (repo and commit), a `SKILL.md` preview, install per project or for everyone, and remove. Without running
  anything from the package.
- **Secure secrets form** and **taking control of the bot's browser** (Alado): Orb has no vault or live view of a bot's
  browser yet; for now the bot tells the user which page to open.
- **Summary when done** ("Completed · 4 steps" left in the chat): it needs the steps stored on the line; left for when it
  proves useful.
- `break-ui` as a fixed test (long names, 1,000 bots, empty lists): can be added to `capturas.e2e.mjs` later; the views
  already truncate with `truncate`/`min-w-0`.
- Springs, drag to dismiss and `@starting-style`: Orb has no draggable sheets; not needed.
