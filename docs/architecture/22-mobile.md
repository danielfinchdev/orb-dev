# 22. Mobile

Part of [How Orb works](../ARCHITECTURE.md).

**What it does.** The phone (or a browser on another computer) uses the Orb of this PC: the same interface as a web app
with no store, or the Android app ([`ANDROID.md`](../ANDROID.md)). Orb has one owner, so a linked device is the owner away
from the PC. It is turned on in Settings › Magic Link, with two routes that are switched on separately:

| Route | Address | What it allows |
|---|---|---|
| **Home wifi** | `http://<PC local IP>:3131/` | Using it at home with the Android app (a browser page over plain http cannot link, below) |
| **Tailscale** | `https://<pc>.<tailnet>.ts.net:3131/` (with `tailscale serve`) or `http://<Tailscale IP>:3131/` if the tailnet has no HTTPS | Using it away from home; with HTTPS it installs as an app and gets notifications |

- From the phone you can chat and approve, answer permissions, edit the queue, continue and fork, request Task Review,
  manage scheduled tasks and give the OK: the methods `src/domain/security/permissions.mjs` marks `'remote'` (section 34).
  Settings, accounts, backups, Magic Link, full access and this PC's files are PC only.
- On the phone, the menu has **"This phone"**: how to install it as an app and the **notifications** switch.

**Linking: Magic Link** (Settings › Magic Link, `src/ui/views/magic-link.jsx`; API in `src/engine/api/link.mjs`, PC
only):
- `link.qr({ kind, device })` turns the access on if it was off and makes a one-time code for 5 minutes, for one route
  (`kind`: `wifi` or `tailscale`) and one kind of device chosen here by the owner, never by the device (`device`:
  `phone` or `browser`). The QR is `<url>#vincular=<code>&pc=<PC key>&v=4&n=<Orb name>&a=<other addresses>` (after `#`,
  the browser does not send it to any server; the other addresses include `<computer>.local`, for when the wifi address
  changes). `link.qr` also returns `payload` (`{ v, urls, pc, code, name, expiresAt }`), the PC fingerprint and a
  **short code** of 8 letters and digits (`ABCD-EFGH`) to type along with the address. Parsing what the phone scans or
  types: `src/shared/link-payload.mjs` (pure, shared by the page and the Android app).
- With the short code, the phone requests `GET /api/hello` (the PC's public key, fingerprint, name and addresses; only
  while a code is on screen) and stretches the code with scrypt, tied to the PC's key (`mobile-crypto.mjs ›
  shortSecret`). It works out the fingerprint itself and asks to confirm it against the PC's screen before the password.
- Linking needs the PC's **master password**, typed on the phone and never sent: `/api/pair` has two steps (`start`
  with the code, `finish` with a password-authenticated key exchange against the PC's verifier) and the device is added
  only at the end. The protocol, the wrong-password rules and what an observer learns are in section 37. Without a
  master password on the PC nothing links.
- Each code is used once; 10 failed attempts from one address in 10 min are refused (429) and 20 in total void the
  code on screen.
- **Linked devices** (table `devices`: `kind` `phone` or `browser`, `route`, `ip`, `meta` with the device's protocol):
  `link.devices`, `link.rename`, `link.revoke` (asks for the master password; cuts its live feed and its calls
  immediately). Another Orb is never linked (`kindForPairing`).
- **Browsers over plain http:** pairing from a browser's page that came over the home wifi in plain http is refused
  (`plainHttpBrowser`): the password would be typed in a page that could have been changed on the way. The Android app,
  https (Tailscale), the Tailscale address and this PC are fine.
- **Home network only:** any connection not coming from 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10 or the Tailscale
  IPv6 is rejected (`privateSource`), as are those arriving through Tailscale Funnel.

**Encryption** (`src/shared/mobile-crypto.mjs`, the same code on the PC and on the phone):
- The PC has a fixed X25519 key (kept in the master password's vault, section 37); its public part goes in the QR.
- The phone creates its own key and sends only its public part and a proof sealed with a key derived from the code.
  **The code never travels**: a photographed or copied QR is useless once used, and a link without the phone is
  worthless. The PC's reply is sealed too: the phone checks it is talking to the PC from the QR.
- After that, every request, response, live event and image is encrypted with XChaCha20-Poly1305 under a key that only
  that phone and the PC have. Each message states what it is for and which phone it is from (additional data), and
  carries the time and a nonce: the PC rejects replays, old messages (more than 5 minutes off) and tampered ones.
- **Phone with the wrong time:** if a request's time is more than 5 minutes off the PC's, the PC answers 409 with its
  time (only after opening the request with the phone's key, or the code's when pairing). The phone adopts it and
  retries once.
- It also works over http (wifi), where the browser does not offer its crypto: it uses the `@noble/*` libraries.
- **PC off or out of reach:** every request of the phone has its own time limit (`src/ui/lib/net.js`: quick checks
  8 s, calls 45 s, uploads 60 s, the live stream only until its headers). No answer moves to the PC's next address; a
  call or an upload that ran out of time is not sent again elsewhere (the PC may have done it). When no address answers,
  the app opens on «Tu PC está apagado o no se puede alcanzar» and keeps trying in one loop (`retryLoop`: never two
  tries at once, 3 s, 6 s… up to 30 s, none while the app is hidden, and at once when the phone comes back to the app or
  to a network); «Vincular con otro PC» asks before forgetting the phone's keys. A drop while the app is open shows a
  thin line at the top (`link:offline` / `link:online`): the PC writes a ping on the live stream every 25 s, and a stream
  silent for `TIMEOUTS.eventsIdle` (60 s) is dropped and connected again, as it is when any request reaches the PC again.
  If Orb cannot start on the phone, its error screen offers «Reintentar» and «Vincular con otro PC».
- **Notifications offered at the right time:** right after linking, the phone offers them once (`NotifyOffer` in
  `main.jsx`), saying what they do: in the Android app only while it stays alive in the background (no push service:
  `push.whenClosed()` is false), in a browser with Web Push also with the page closed.
- **Navigation on the phone (`src/ui/lib/phone-nav.js`):** the app opens on its chat list unless it was left in a chat
  that still exists or on one of its tabs; routes of screens that are gone (such as the bots of 3.7) fall back to the
  chats; a screen that fails to draw forgets the saved route (`ErrorBoundary`). Android's back (handed over by
  `OrbNativePlugin`) and a phone browser's back close what is open, then go up one level (a task opened from a chat
  back to that chat: its route keeps `from`), and only leave from the chats (twice; the app goes to the background).
  While linking the app, back goes from the password to scanning and closes «Enlazar sin cámara». `OrbNativePlugin`
  replaces the launch intent only after a share, so a notification's action that starts the app reaches the
  notifications plugin.
- Removing a device deletes its key: it is locked out immediately. Devices linked before 3.8 never proved the master
  password and are unlinked once at the first start of 3.8 (`relink_38`, section 37); phones from 2.3.2 or earlier (no
  own key) are dropped at start.

**Notifications** (`src/engine/transport/webpush.mjs`): HTTPS only (Tailscale with HTTPS) for a browser. The phone subscribes from
"This phone" and the PC sends notifications directly to the browser's push service (Google, Apple, Mozilla) with Web
Push: encrypted for that phone (RFC 8291) and signed with the PC's VAPID key (RFC 8292). No servers of our own and no
cost. It notifies each new message in the Orb chat (replies, tasks waiting for approval, finished or failed) when that
phone does not have the app open. On iPhone they work with Orb added to the home screen. `mobile.preview` (`all`,
`chat` by default, `none`; `remote.configure`) sets what a notification shows on a locked phone
(`src/shared/notes.mjs › buildNote`). The Android app shows its own notifications ([`ANDROID.md`](../ANDROID.md)).

**Inside** (`src/engine/transport/remote.mjs`):
- One http server per address: each private local IP (no virtual adapters) and the Tailscale one, or 127.0.0.1 behind
  `tailscale serve --https=<port>`. Turning access off removes that `tailscale serve` configuration.
- It only answers to its own names (against DNS rebinding) and its own origin, plus the Android app's page
  (`http://localhost`, with CORS).
- Every call goes through `guardCall` (`REMOTE_METHODS`, pictures, full-access rules) and every answer through
  `withoutPaths` (no PC folders on the phone, section 28).
- Every minute it checks whether the network changed (another wifi, another IP) and reopens access.
- The first time it listens on the local network, Windows may ask about the firewall: private networks must be
  allowed. Ajustes does not warn about it in advance (3.8.2): when a device cannot reach any local-network address
  while linking, its error says so (`app.linkOfflineWifi`, `src/ui/lib/web-bridge.js`). If the PC's local IP changes, a phone linked over wifi falls back to `<computer>.local` or the other
  addresses from its QR; a fixed IP on the router avoids it.
- Files: `src/engine/transport/remote.mjs`, `src/engine/api/link.mjs`, `src/engine/transport/webpush.mjs`, `src/shared/mobile-crypto.mjs`,
  `src/shared/link-payload.mjs`, `src/ui/lib/web-bridge.js`, `src/ui/views/magic-link.jsx` and the "Magic Link" and "This
  phone" cards in `src/ui/views/settings/index.jsx`. Tests: `test/remote.test.mjs`, `test/webpush.test.mjs`,
  `test/link-ui.test.mjs`, `test/movil-ui.test.mjs`, `test/android.test.mjs`, `test/contrasena-maestra.test.mjs` and
  `test/mobile.e2e.mjs`.
- Pending, on hold: using it from anywhere without Tailscale through our own relay on Cloudflare
  ([`MOBILE-RELAY.md`](../MOBILE-RELAY.md)).

## Tailscale discovery and resuming (3.8.10)

- Settings › Devices has a Tailscale card (`src/engine/transport/tailscale-status.mjs`, `tailscale.status` and
  `tailscale.login`, PC only): install with winget, sign in and list the tailnet marking Orb phones. `GET /api/discover`
  (`{ orb, v, name }`) lets the Android "Find my PC on Tailscale" fill in the address once the user types the PC's name;
  it answers only through the Tailscale interface and pairing still needs the link code.
- The phone web resumes the event stream with `Last-Event-ID` (`?since=` from the app), asks for a `resync` like Android
  and resends a lost `call` once with the same sealed request, which the PC answers from its stored result. A newly linked
  phone never gets events from before its link. `scripts/aguante.mjs` is the endurance test of the link.
