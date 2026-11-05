# Users (Orb 3.6)

One Orb can be used by several users: a household, a family or a small team. Each user has their own
conversations, bots, projects, reminders, scheduled tasks, memories and accounts. Nobody sees anybody else's things
unless they are shared with them.

**If only you use your Orb, none of this shows up.** There is no user menu, no PIN and nothing to set up: Orb works
exactly as before. Everything on this page appears once a second user is added.

How it works inside (for people working on Orb's code): [`PERSONAS-INTERNALS.md`](PERSONAS-INTERNALS.md).

## Two kinds of user

| | Admin | User |
|---|---|---|
| Who | The user who installed Orb and manages it. One per Orb. | Everyone else. |
| Their own things | Yes | Yes |
| What others share with them | Yes | Yes |
| Adds and removes users | Yes | No |
| Sees others' names, devices and usage numbers | Yes | No |
| Sees others' conversations, bots, memories or projects | **No** (only if shared) | No |
| Orb-wide settings (agents, connectors, Home Assistant, server, backups) | Yes | No |

There are no age levels and no guests: just these two.

## The first run

The first time Orb opens it shows the same welcome as 3.5.1, on one screen: **What would you like to call me?** (the
assistant's name, "Orbe" by default), **And what should I call you?** (optional) and **Where would you like me to create
my folder?**. On Windows, **Preparing your PC** follows: it installs any missing agents and tools with their official
installers, and then you sign in to each one.

Nothing is asked about people or uses: whoever sets Orb up is its admin, with this PC's language and time zone (change
them later in **Settings**). Add more users in **Settings › Magic Link › Users**. Starting sets of bots ("Business",
"Home", "Coding") are in **New bot › Start from a template** (optional); they are generic: nothing in them is about anyone
in particular.

Then Orb opens. The rest appears where it is needed:

- **Backups** are on from the first day, encrypted with this PC's key. A few days later Orb suggests, once, creating a
  **recovery code** in **Settings › Data** (it opens your backups on another computer).
- **Using Orb away from home** (Tailscale) is explained in **Magic Link** when you link a phone. Your reminders only
  ring while this PC is on.
- To bring an Orb you already have on another computer: on the old one, **Settings › Data › Move** (or
  `orb-server mover exportar` on a server); on the new one, `orb-server mover importar`.

## Who is at the PC

With two or more users, the bottom of the sidebar shows who is at the PC (their initial and name). Clicking it opens:

- **My profile.**
- **Switch user:** the lock screen opens with the users to choose from; whoever has a PIN types it.
- **Lock:** nothing of anyone shows until someone unlocks it with their PIN. The lock is Orb's own, not just a cover
  over the window.

On a phone, the same is at the top of **More** (a phone belongs to one user: it has **My profile** and, with a PIN,
**Lock**).

Five wrong PINs in a row block that PIN for a while, and the wait grows with each new mistake. The admin can reset a
forgotten PIN (Settings › Magic Link › Users, or `orb-server pin-reset <usuario>` on a server). On a server, `orb-server usuarios`
lists the users, `orb-server usuario nuevo <nombre>` adds one and `orb-server enlazar --usuario <nombre>` makes a QR for
them.

## Settings › Magic Link › Users (admin)

A list with each user's name, the Admin badge, their devices, when they were last seen and how many bots, chats and
projects they have. **Numbers only: never titles, texts or names of their things.** The actions are in each row's menu.

From there the admin adds a user, renames them, chooses what they may do (program in Orb mode, use the home
integration, approve home actions), resets a PIN, pauses their bots, signs out their devices or removes them.
Removing a user offers to export their data first; their things go to a 30-day bin.

## My profile (user menu)

Everyone has their own: name, language, time zone, PIN, what notifications show on a locked phone (everything, chat
only or nothing), their accounts (signing in without opening any console), their linked devices, and **Export my
data** / **Delete my data**.

## Linking a phone or a browser

Magic Link first asks **For which user?** (you, a user already in the Orb, or someone new) and then the kind of device and
what it may do. The device belongs to that user: it sees only their things, whatever it says about itself. Only the
admin makes links for other users. The list of linked devices is grouped by user.

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

The admin sees, in Agents ("Who spent what"), each user's totals for today and the last 30 days. Totals only: never on what.

## Settings › Data

- **Backups:** encrypted, every day at 03:00 (the admin's time zone) and before every update. You choose the folder.
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
3.5 only carries the admin's requests and shows "Update …".
