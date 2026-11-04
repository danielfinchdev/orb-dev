# Users (Orb 3.6)

One Orb can be used by several users: a household, a family or a small team. Each user has their own
conversations, bots, projects, reminders, scheduled tasks, memories and accounts. Nobody sees anybody else's things
unless they are shared with them.

**If only you use your Orb, none of this shows up.** There is no user menu, no PIN and nothing to set up: Orb works
exactly as before. Everything on this page appears once a second user is added.

How it works inside (for people working on Orb's code): [`PERSONAS-INTERNALS.md`](PERSONAS-INTERNALS.md).

## Two kinds of user

| | Owner | User |
|---|---|---|
| Who | The user who installed Orb and manages it. One per Orb. | Everyone else. |
| Their own things | Yes | Yes |
| What others share with them | Yes | Yes |
| Adds and removes users | Yes | No |
| Sees others' names, devices and usage numbers | Yes | No |
| Sees others' conversations, bots, memories or projects | **No** (only if shared) | No |
| Orb-wide settings (agents, connectors, Home Assistant, server, backups) | Yes | No |

There are no age levels and no guests: just these two.

## The welcome wizard

The first time Orb opens it asks:

1. Your name, language and time zone.
2. **Who will use this Orb?** "Only me" (nothing else changes) or "Several users" (you can add them now or later in
   **Settings › Users**).
3. **Templates (optional):** "My business", "My home", "Development" or "Start empty". Each one is a starting set of
   bots, reminders and settings. You can see what it makes and change anything (names, texts, times) before applying
   it; nothing is applied until you say so. They are generic: nothing in them is about anyone in particular.
4. **Reaching your Orb from outside:** a short guide to Tailscale. Your reminders only ring while this PC is on.
5. **Backups:** where they go, and your recovery code (write it down: it opens your backups on another computer).

To bring an Orb you already have on another computer: on the old one, **Settings › Data › Move** (or
`orb-nucleo mover exportar` on a server); on the new one, `orb-nucleo mover importar`. Importing from the desktop
wizard is not available yet: the wizard says so under "Bring my Orb from another PC".

## Who is at the PC

With two or more users, the top bar shows who is at the PC ("Ana ▾"). From that menu you can:

- **Switch user:** pick someone; if they have a PIN, they type it.
- **Lock:** nothing of anyone shows until someone unlocks it with their PIN. The lock is Orb's own, not just a cover
  over the window.
- Open **My profile**.

Five wrong PINs in a row block that PIN for a while, and the wait grows with each new mistake. The owner can reset a
forgotten PIN (Settings › Users, or `orb-nucleo pin-reset <usuario>` on a server). On a server, `orb-nucleo usuarios`
lists the users, `orb-nucleo usuario nuevo <nombre>` adds one and `orb-nucleo enlazar --usuario <nombre>` makes a QR for
them.

## Settings › Users (owner)

A list with each user's name, role, devices, when they were last seen, how many bots, projects, conversations and
reminders they have, and how much they used today. **Numbers only: never titles, texts or names of their things.**

From there the owner adds a user, renames them, chooses what they may do (program in Orb mode, use the home
integration, approve home actions), resets a PIN, pauses their bots, signs out their devices or removes them.
Removing a user offers to export their data first; their things go to a 30-day bin.

## Settings › My profile

Everyone has their own: name, language, time zone, PIN, what notifications show on a locked phone (everything, chat
only or nothing), their accounts (signing in without opening any console), their linked devices, and **Export my
data** / **Delete my data**.

## Linking a phone or a browser

Magic Link first asks **For which user?** (you, a user already in the Orb, or someone new) and then the kind of device and
what it may do. The device belongs to that user: it sees only their things, whatever it says about itself. Only the
owner makes links for other users. The list of linked devices is grouped by user.

The phone and the Android app show at the top who they are signed in as ("Signed in as Leo").

## Sharing

On a bot, a group or a project, **Share** lets you pick users and how much they get:

- **View:** see it (a bot's shared memory, a project's tasks, logs and whiteboard, a group's chat).
- **Talk:** also talk to it. With a shared bot, each user has their own private conversation and their own memory
  with it; with a group, everyone writes in the same chat and each line shows who wrote it; with a project, they can
  start conversations and tasks in it with their own (or a lent) account.
- **Edit:** also change its settings, its shared memory and its members, and approve its cards. Only the owner of the
  thing can delete it.

What is shared with you shows a badge ("Shared by Ana") and is listed under **Shared with me** in the side menu.
Conversations with Orbe are always private.

## Accounts and lending

Each user uses their own Claude or Codex account by default and signs in to it from Orb. Nobody spends another
user's subscription without a loan.

In **Agents › Accounts**, the owner of an account can **Lend to…** another user, with:

- daily caps (turns, tokens or dollars);
- a reserve: when the account's real usage reaches that level, borrowers stop and the owner keeps the rest;
- what it is for: bots, Orb mode or both;
- an end date.

**Check your plan's terms before lending:** personal subscriptions may not allow serving other people.

A borrowed account shows whose it is and what is left today ("from Ana · 34 turns left today"). When a cap is reached,
only the user who hit it gets a message. Bots can also have their own daily caps.

## Usage: who spent what

The owner sees, in Agents ("Who spent what"), each user's totals for today and the last 30 days. Totals only: never on what.

## Settings › Data

- **Backups:** encrypted, every day at 03:00 (the owner's time zone) and before every update. You choose the folder.
- **Recovery code:** opens your backups on another computer. Shown once: write it down and keep it away from this PC.
- **Restore** a backup (it is checked first and applied when Orb starts again).
- **Move:** take your whole Orb to another computer; the old one stops serving until you undo the move or keep both.

## The Android app

- Asks you to update when your Orb needs a newer app.
- Can lock with your PIN, or your fingerprint or face if the phone has one set up.
- Schedules notifications for your reminders of the next two days on the phone itself, so they ring even if the
  connection is down. What they show follows your choice in My profile (by default, bots' texts are hidden).

## Older Orbs and apps

Update every Orb, the Android app and the terminal to 3.6. Phones and terminals of 3.5 keep working; a linked Orb of
3.5 only carries the owner's requests and shows "Update …".
