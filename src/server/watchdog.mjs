// 3.7: systemd's watchdog for Orb Server (orb-server.service: WatchdogSec, NotifyAccess=all). While the engine answers,
// «WATCHDOG=1» goes to systemd at half the interval; an engine that hangs stops answering, and systemd kills the service
// and starts it again (Restart=always). Node cannot write to the notify socket itself (no unix datagrams), so
// systemd-notify does it. Nothing happens outside systemd (no NOTIFY_SOCKET / WATCHDOG_USEC).
import { spawn } from 'node:child_process';

export function watchdogInterval(env = process.env, pid = process.pid) {
  if (!env.NOTIFY_SOCKET || !env.WATCHDOG_USEC) return null;
  if (env.WATCHDOG_PID && Number(env.WATCHDOG_PID) !== pid) return null;
  const usec = Number(env.WATCHDOG_USEC);
  return Number.isFinite(usec) && usec > 0 ? Math.max(1000, Math.floor(usec / 2000)) : null;
}

// healthy(): resolves true while the engine answers. notify(state): how the message is sent (tests).
export function startWatchdog({ env = process.env, healthy = async () => true, log = () => {}, notify = null } = {}) {
  const every = watchdogInterval(env);
  if (!every) return { stop() {}, every: null };
  const send = notify ?? ((state) => { try { const c = spawn('systemd-notify', [`--pid=${process.pid}`, state], { stdio: 'ignore', windowsHide: true }); c.on('error', () => {}); c.unref(); } catch { /* not there */ } });
  let busy = false;
  const beat = async () => {
    if (busy) return; busy = true;
    try {
      const ok = await Promise.race([Promise.resolve(healthy()).catch(() => false), new Promise((r) => setTimeout(() => r(false), Math.max(500, every - 500)))]);
      if (ok) send('WATCHDOG=1'); else log('el motor no contesta: no se avisa al vigilante de systemd');
    } finally { busy = false; }
  };
  send('READY=1');
  const timer = setInterval(beat, every); timer.unref?.();
  beat();
  return { stop() { clearInterval(timer); }, every };
}
