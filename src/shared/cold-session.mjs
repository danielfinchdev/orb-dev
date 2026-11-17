// A Claude conversation that has been idle for a long while has lost its prompt cache: the next message has to read
// the whole history again, which costs a lot of usage in a long conversation. Past COLD_TOKENS of context and
// COLD_MINUTES without activity, Orb says so before the person writes. Pure: the window gives the numbers.
export const COLD_TOKENS = 100_000;
export const COLD_MINUTES = 70;

// → { cold: boolean, minutes: whole minutes idle (0 when unknown) }
export function coldSession({ agent, used, lastAt, now = Date.now(), busy = false }) {
  const last = typeof lastAt === 'number' ? lastAt : Date.parse(lastAt ?? '');
  if (!Number.isFinite(last)) return { cold: false, minutes: 0 };
  const minutes = Math.max(0, Math.floor((now - last) / 60_000));
  return { cold: agent === 'claude' && !busy && Number(used) > COLD_TOKENS && minutes >= COLD_MINUTES, minutes };
}

// «1 h 25 min» / «75 min» for the notice; hours when there is at least one.
export function idleText(minutes) {
  const m = Math.max(0, Math.floor(minutes));
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
