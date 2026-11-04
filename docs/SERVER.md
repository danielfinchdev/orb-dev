# Orb Server

Orb Server is the small Linux side of Orb: it keeps your **bots** running 24/7 (their chats, routines and reminders),
links with your phone and your Orb app, makes backups, and can do a short list of **server administration** actions that
you approve one by one. It does no programming: projects, tasks and coding agents stay in the Orb app on your PC.

- Download: about 46 MB (Node runtime + Orb Server; x64 and arm64).
- Memory: about 90 MB when idle (one Node process; measured on the development PC, see below).
- Claude and Codex are **not** in the download: Orb Server fetches them from the official npm packages the first time a
  bot or a sign-in needs them, checks them against the registry's sha512, and keeps them up to date within their line.
  They run only while a bot is thinking and close when it is idle.

## Install with one command

In the Orb app: **Magic Link › Añadir Orb Server**. It shows one command to paste in the server's terminal, like:

```
curl -fsSL <release>/install.sh -o /tmp/orb-install.sh && echo "<sha256>  /tmp/orb-install.sh" | sha256sum -c && bash /tmp/orb-install.sh --pair <code>@<app-address>#<app-key-fp>
```

Run it as your normal user (not root). It asks for your sudo password **once**.

Options of `install.sh`:

| Option | What it does |
| --- | --- |
| `--pair <code>@<address>#<fp>` | Links the server with the app that gave the command (a one-time code, valid 10 minutes, only for that app). Without it, the installer prints a short code to type in the app. |
| `--no-sudo` | Installs without sudo: no administration actions, and Orb Server only runs while you are logged in. |
| `--tarball <file>` | Uses a package you already downloaded (it is still checked). |

From the PC, over SSH (your SSH key must already work): `npm run servidor:instalar -- <ssh-host>`.

## What the installer does

1. Downloads the package for your processor from the official GitHub release and checks its SHA-256 and the SHA-256 of the
   Node inside it against the sums written into `install.sh` (which is itself signed: `install.sh.sig`).
2. Unpacks it into `~/orb-server/app/<version>` and points `~/orb-server/app/current` to it.
3. If you had an Orb Server from before 3.7 (`~/orb` and `~/orb-nucleo`), stops it, makes a backup, and moves everything to
   `~/orb-server` in place: your bots, the secret, your linked phones and Orbs stay as they were. `~/orb` and the old
   command keep working (as links) until the next minor version.
4. Installs the systemd user service `orb-server.service`: it starts when the server boots (also without anyone logged
   in), restarts when it fails or hangs (watchdog), and is limited to 512 MB of RAM. The old service is turned off.
5. With sudo, once: turns on *linger* (so the service runs without a session) and installs the **admin helper**
   (`/usr/local/libexec/orb-server-admin`, owned by root) with a sudoers rule that lets your user run that helper and
   nothing else (checked with `visudo -cf` before it is put in place).
6. Pairs with your Orb app.

### The folder

```
~/orb-server/
  app/<version>, app/current   the program (the previous version is kept for rollback)
  bots/                        the bots' memories and files
  browser/                     browser profiles (per person)
  data/                        database, secret, links, backups
  engines/                     Claude, Codex (downloaded on demand)
  logs/                        Orb Server's logs
```

### Administration actions

A bot can only **propose** a change; it runs after you approve its card in Orb. The helper accepts only:

| Action | Runs |
| --- | --- |
| `docker-restart <container>` | `docker restart` |
| `docker-pull <container>` | `docker pull` of the image the container runs |
| `systemctl-restart <unit>` | `systemctl restart`, only for units you list in `/etc/orb-server/units.allow` (one per line, root-owned) |
| `journal-vacuum <size>` | `journalctl --vacuum-size`, at most 2G |
| `apt-clean` | `apt-get clean` |

Every value is checked by Orb and again by the helper. Your user is not added to the `docker` group. Agents and bots can
never use sudo: the guard refuses it, and every agent (and Chromium) runs in its own systemd scope with `no_new_privs`, its
own memory limit, and a higher OOM score than Orb Server.

## Updates

Orb Server updates itself within its minor version (3.7.x) once a day: the release's `manifest.json` must carry a valid
signature from the release key (its public half is built into Orb Server) and each package must match its SHA-256. Before
switching, it makes a backup of your data. If the new version is not healthy within 60 seconds (or fails to start three
times), it goes back to the previous one by itself.

By hand: `orb-server actualizar --comprobar` (check) or `orb-server actualizar` (update now).

## Useful commands

- `systemctl --user status orb-server` and `journalctl --user -u orb-server -f`
- `orb-server estado` · `orb-server motores` · `orb-server enlazar` · `orb-server dispositivos` · `orb-server copia ahora`

## Uninstall

```
systemctl --user disable --now orb-server
rm ~/.config/systemd/user/orb-server.service ~/.local/bin/orb-server ~/.local/bin/orb
sudo rm -f /etc/sudoers.d/orb-server /usr/local/libexec/orb-server-admin
sudo rm -rf /etc/orb-server
sudo loginctl disable-linger "$USER"     # only if nothing else of yours needs it
```

Your data stays in `~/orb-server` until you delete it (make a backup first: `orb-server copia ahora`).

## For maintainers

### Building and signing a release

1. `npm run dist:server` (alias `dist:servidor`) builds `dist/orb-server-<version>-linux-x64.tar.gz`, `…-linux-arm64.tar.gz`
   and `dist/install.sh` (from `scripts/install.sh.tmpl`, with the packages' and Node's sums). It fails if a package is
   over 50 MB.
2. `npm run release:sign` writes `dist/manifest.json` and signs it and `install.sh` (`*.sig`, ed25519). The private key is
   read from `ORB_RELEASE_KEY` or `%USERPROFILE%\.orb-release\release.key` — always outside the repository (the script
   refuses a path inside it). It has no passphrase so signing can run unattended: keep that folder out of untrusted sync
   or backups.
3. Once, before the first signed release: `npm run release:keygen` creates the key pair there (never overwrites one) and
   writes the public key into `src/server/release-key.mjs` (commit that file). Until then Orb Server refuses to update
   itself.

### Memory (measured)

On the development PC (Windows, Node 24, test agents, idle after start): the engine inside the host process
(**in-process**, the default) used about **93 MB**; the host and the engine as two processes (**fork**) about **137 MB**
(62 + 75). Two processes exceed the 110 MB limit, so Orb Server runs in one process; a crash ends the process and systemd
restarts it, and a hang stops the watchdog heartbeat (`WatchdogSec`), so systemd restarts it too. `ORB_SERVER_MODE=fork`
brings back the two-process mode. Measure on the real server with `orb-server estado` / `server.status` (memory.rss).

### Manual checks on Linux (not covered by the automated tests on Windows)

Run these on a real server (or an Ubuntu 24.04 VM) before a release:

1. **Fresh install survives a reboot**: install, `sudo reboot`, then without logging in check from another machine that the
   phone reaches Orb Server; after login `systemctl --user status orb-server` is `active` and `loginctl show-user $USER -p Linger` says `yes`.
2. **Crash restart**: `kill -9 $(systemctl --user show -p MainPID --value orb-server)` → active again within ~5 s.
3. **Hang restart**: `kill -STOP <MainPID>` → systemd restarts it after `WatchdogSec` (180 s).
4. **Memory limits**: `systemctl --user show orb-server -p MemoryMax` is 536870912; while a bot thinks,
   `systemd-cgls --user` shows the agent in its own `run-*.scope` with `MemoryMax=1G`; a memory hog inside the agent's scope
   is killed without touching Orb Server.
5. **No sudo from agents**: inside a bot's agent process, `grep NoNewPrivs /proc/self/status` shows `1` and
   `sudo -n /usr/local/libexec/orb-server-admin apt-clean` fails; the same command from Orb Server after a card works.
6. **Helper**: `sudo -n /usr/local/libexec/orb-server-admin systemctl-restart sshd` is refused unless `sshd` is in
   `/etc/orb-server/units.allow`; `ls -l /etc/sudoers.d/orb-server` is `-r--r----- root root`.
7. **Migration from 3.6**: on a server with the old install, run the new `install.sh`: the phone stays linked, bots and
   memories are there, `~/orb` is a link to `~/orb-server`, the old service is disabled.
8. **Update rollback**: publish a test 3.7.x whose engine fails to start → the server returns to the previous version
   within about a minute.
9. **Package size and idle RSS**: both packages ≤ 50 MB; `ps -o rss= -p <MainPID>` after 5 minutes idle (target 80 MB,
   blocker 110 MB).
