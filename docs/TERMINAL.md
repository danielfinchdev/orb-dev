# Orb in the terminal (3.5)

The fourth way to use Orb, next to the PC app, the phone and the browser: the `orb` command. It talks to your Orb (the laptop's or the server's) from any terminal: Windows Terminal, PowerShell or a Linux console over SSH.

## Linking

Like a phone, with Magic Link:

1. On the Orb you want to reach: Settings › Magic Link › "Link device" (choose "A terminal"). On a headless server: `orb-server enlazar --tipo terminal` (it draws the QR in the terminal and gives the short code, the address and the fingerprint; it waits until someone links). After linking, `orb enlazar` prints the other Orb's fingerprint: it must match.

On the server itself (3.5.1): `orb-server dispositivos` lists the linked devices, `orb-server quitar <id>` closes one's link (a lost phone) and `orb-server enlazar --admin` links a new device that may administer the server even if another one already does.
2. In the terminal: `orb enlazar ABCD-EFGH 100.64.1.2:3131` (the code and the address, in any order) or `orb enlazar "<QR link>"`.

The terminal shows up in "Linked devices" as `terminal`, with the same permissions as a browser (those of `remote.mjs › ALLOWED`), and can be closed from there. It only works on your Wi-Fi, on Tailscale or on the same machine.

## Usage

| Command | What it does |
|---|---|
| `orb` | The chat with Orbe, with the reply streamed live. Commands: `/bots`, `/bot <name>`, `/orb`, `/nueva` (new), `/tareas` (tasks), `/aprobar` (approve), `/aprobar <n> si\|no\|siempre` (yes/no/always), `/taller` (workshop), `/despertar` (wake), `/estado` (status), `/dispositivos` (devices), `/limpiar` (clear), `/ayuda` (help), `/salir` (quit) |
| `orb "message"` | One message to Orbe; prints the reply and exits (`--bot <name>` for a bot) |
| `orb estado` · `orb dispositivos` · `orb enlaces` | The Orb's status, its devices, the Orbs linked here |
| `orb olvidar [name]` | Closes the link |
| `--orb <name>` · `--json` | Pick an Orb if there are several · output for scripts |

Ctrl+C stops a reply; twice, or Ctrl+D, quits. Exit codes: 0 ok, 1 error, 2 the Orb does not answer, 3 the link is closed, 4 no links.

With a "centro" (hub) server, `/taller` says whether the PC behind it is on and `/despertar` turns it on (Wake-on-LAN).

## Where it is stored

`~/.orb-terminal/` (or `ORB_TERMINAL_HOME`): `clave.bin` (32 random bytes, 0600) and `enlaces.json` (each link's keys, encrypted with that key, 0600). No colours with `NO_COLOR=1`; English with `ORB_LANG=en`.

## Packages

- On the server it comes inside Orb Server: `~/orb-nucleo/current/bin/orb` (with its own Node).
- Client only: `npm run dist:terminal` → `dist/orb-terminal-<version>.zip` (Windows) and `.tar.gz` (Linux), under 1 MB; needs Node 22 or newer.
- In the repo: `bin/orb`, `bin/orb.cmd` or `npm run terminal`.

## Pieces

`src/terminal/` (`orb-cli.mjs` commands, `tui.mjs` interactive mode, `client.mjs` calls and live replies, `views.mjs`, `render.mjs`, `store.mjs`) · `src/core/qr.mjs` (dependency-free QR) · `src/core/link-payload.mjs` (QR formats, shared with the app) · `src/server/control.mjs` (the local door `orb-server enlazar` uses while the service is running) · `scripts/dist-terminal.mjs` · tests in `test/terminal.test.mjs`. Strings: `term.*` in `src/core/locales/{es,en}/term.mjs`.
