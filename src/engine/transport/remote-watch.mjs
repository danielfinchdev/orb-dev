// Keeps the phone entries open without restarting what already works. Every tick is cheap (an in-process look at the
// network adapters); the expensive checks (`tailscale status`, `tailscale serve status`) only run when something points
// to a problem, after a long enough pause, or after the clock jumped (the PC slept or hibernated).
export const WATCH_MS = 15_000;
const SERVE_CHECK_MS = 60_000; // how often an open https entry is checked against `tailscale serve`
const RETRY_MS = 60_000; // pause between failed attempts to open Tailscale while its adapter is up

export function createLinkWatcher(d) {
  const every = d.every ?? WATCH_MS;
  const now = d.now ?? Date.now;
  let last = now();
  let busy = false;
  let serveAt = 0; let triedAt = 0;

  async function tick() {
    if (busy) return;
    busy = true;
    const t = now();
    const jumped = t - last > every * 2;
    last = t;
    try {
      if (jumped) d.log('móvil: el reloj ha saltado (suspensión); compruebo las entradas');
      if (d.wifiOn() && d.lanKey() !== d.openedLan()) {
        d.log('móvil: ha cambiado la red; vuelvo a abrir la entrada de Wi-Fi');
        await d.reopenWifi();
      } else if (d.wifiOn()) d.seen('wifi');
      if (d.tailscaleOn()) {
        if (!d.tsOpen()) {
          // cheap first: with no Tailscale adapter there is nothing to ask
          if ((jumped || d.tsAdapter()) && (jumped || t - triedAt >= RETRY_MS)) {
            triedAt = t;
            await d.openTailscale();
          }
        } else if (!d.tsServed()) {
          if (d.tsAdapter()) d.seen('tailscale');
        } else if (jumped || t - serveAt >= SERVE_CHECK_MS) {
          serveAt = t;
          const alive = await d.tsServeAlive();
          if (alive === false) {
            d.log('móvil: tailscale serve se ha perdido; lo vuelvo a activar');
            await d.reserve();
          } else if (alive) d.seen('tailscale');
        }
      }
    } catch (error) { d.log(`móvil: vigilante: ${error?.message ?? error}`); }
    finally { busy = false; }
  }
  return { tick };
}
