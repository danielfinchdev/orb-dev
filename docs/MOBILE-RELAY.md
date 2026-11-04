# Phone from anywhere: cloud relay (on hold)

**Status:** on hold. Decided on 9 October 2026: 2.3.3 keeps the phone on the home Wi-Fi and on Tailscale, all for
free; the relay is left for later.

## What it would solve

Today, using Orb away from home needs Tailscale on the PC and on the phone. With the relay, the phone would reach the PC
from any network without installing anything: the PC and the phone both connect **outwards** to a small server on the
internet that only passes messages along. No ports need to be opened on the router.

## How it would work

- **Where:** a Cloudflare Worker with one Durable Object per PC, on the user's free Cloudflare account, with the free
  `…workers.dev` address (no custom domain needed).
- **Connection:** the Orb engine opens a WebSocket to the relay when "From anywhere" is turned on. The phone opens the
  web app served by the relay (HTTPS) and another WebSocket; the relay pairs the two by the PC's identifier.
- **End-to-end encryption:** the same protocol as 2.3.3 (`src/core/mobile-crypto.mjs`): the PC's key in the QR, each
  phone's own key, messages sealed with XChaCha20-Poly1305. The relay only sees messages it cannot read, the PC's
  identifier and the traffic size.
- **The web app:** the relay serves the same phone UI (its files are signed by the PC, so the relay cannot change it
  without the phone noticing).
- **Notifications:** the same as 2.3.3 (Web Push sent by the PC). Since they go over HTTPS they always work, also on
  iPhone with the app on the home screen.
- **Installing the relay:** Orb deploys it to the user's Cloudflare account (Cloudflare sign-in in the browser, once).
  The account and the sign-in are done by the user; Orb never sees their password.

## Cost

| Usage | Cost |
|---|---|
| One person with their PC and phone | €0 (Cloudflare free plan: about 100,000 requests a day; WebSocket messages count 1 in 20 and an idle connection costs nothing) |
| Going over the free plan | The relay stops answering until the next day; nothing is charged |
| Many people using the same relay | Cloudflare paid plan from about USD 5 a month, or one relay per person (each on their own account) |

## What to decide before building it

1. Whether each person uses their own relay (their Cloudflare account) or there is a shared Orb relay.
2. How the PC signs the web app files the relay serves.
3. What the phone does when the PC is off (clear message and retry).
