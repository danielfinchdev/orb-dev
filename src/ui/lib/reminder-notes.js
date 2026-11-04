// 3.6, the Android app: the bots' reminders due soon become notifications scheduled on the phone itself, so they sound
// even when the app is closed or the connection with the Orb is down (src/ui/lib/app-bridge.js schedules them). Pure:
// no plugin here, only which reminders, when and with what words.
export const REMINDER_IDS = { first: 50_000, size: 1000 }; // apart from the chat notifications (1..1000)
export const HORIZON_MS = 48 * 3_600_000;

// reminders: what bots.reminders.list returns ({ id, bot_id, text, next_run, enabled }). preview: the person's choice
// for the lock screen ('all' shows the text; anything else hides it, as the bots' notifications are hidden by default).
// titleFor(r): the title when the text may show (the bot's name); hidden: { title, body } when it may not.
export function upcomingReminderNotes(reminders, now = Date.now(), { preview = 'chat', horizonMs = HORIZON_MS, titleFor = () => '', hidden = { title: 'Recordatorio', body: '' } } = {}) {
  const out = [];
  for (const r of Array.isArray(reminders) ? reminders : []) {
    if (!r || r.enabled === false || r.enabled === 0 || !r.next_run) continue;
    const at = Date.parse(r.next_run);
    if (!Number.isFinite(at) || at <= now || at > now + horizonMs) continue;
    const show = preview === 'all';
    out.push({
      id: REMINDER_IDS.first + (Math.abs(Number(r.id) || 0) % REMINDER_IDS.size),
      title: show ? String(titleFor(r) || hidden.title) : hidden.title,
      body: show ? String(r.text ?? '').slice(0, 200) : hidden.body,
      at,
      group: 'orb-reminders'
    });
  }
  // One per id (two reminders falling on the same id: the sooner one), sorted by time.
  const seen = new Set();
  return out.sort((a, b) => a.at - b.at).filter((n) => (seen.has(n.id) ? false : seen.add(n.id)));
}

// The ids this helper may have scheduled before (cancelled before scheduling again).
export const allReminderIds = () => Array.from({ length: REMINDER_IDS.size }, (_, i) => REMINDER_IDS.first + i);
