// Fake agents for the screenshot tour (test/explora.e2e.mjs): fake-live.mjs plus what a tour needs to look like real work.
// ORB_FAKE_AGENTS=<this file> replaces every agent like fake-live.mjs does; on top of it, ORB_EXPLORA_PLAN=<file.json>
// ([{ "when": "text", "files": { "rel/path": "content" }, "append": "KEYWORDS" }]) lets a message that contains «when»
//   - write those files into the chat's folder (so the «Cambió N archivos» card and the Cambios panel have a diff), and
//   - reach fake-live with extra keywords (DUERME = keep working, PIDE_PERMISO = wait for an approval, FALLA, …)
// without those keywords showing in the user's own message, which Orb has already stored as typed.
// The natural replies still come from ORB_FAKE_SCRIPT (fake-live.mjs), keyed by the same «when».
import fs from 'node:fs';
import path from 'node:path';
import { fakeAdapter as base } from './fake-live.mjs';

const PLAN = (() => { try { return process.env.ORB_EXPLORA_PLAN ? JSON.parse(fs.readFileSync(process.env.ORB_EXPLORA_PLAN, 'utf8')) : []; } catch { return []; } })();

// The natural answers (ORB_FAKE_SCRIPT, the same file fake-live.mjs reads): their «when» also takes part in choosing the turn.
const SCRIPT = (() => { try { return process.env.ORB_FAKE_SCRIPT ? JSON.parse(fs.readFileSync(process.env.ORB_FAKE_SCRIPT, 'utf8')) : []; } catch { return []; } })();

// A task's prompt carries, after its own instructions, the project's recent notes, which can quote the text of an earlier chat turn:
// the turn that is meant is the one inside the task's own section («## Tarea #N: …»), not whichever the notes mention.
function turnOf(text) {
  const head = text.indexOf('## Tarea #');
  const end = head < 0 ? -1 : text.indexOf('\n## ', head + 3);
  const own = head < 0 ? text : text.slice(head, end < 0 ? undefined : end);
  let best = null;
  for (const x of [...PLAN, ...SCRIPT]) {
    const at = x.when ? own.lastIndexOf(x.when) : -1;
    if (at >= 0 && (!best || at > best.at || (at === best.at && x.when.length > best.when.length))) best = { at, when: x.when };
  }
  return best?.when ?? null;
}

// ORB_EXPLORA_USAGE=1: before each turn the fake Claude and Codex report part of their windows used (the same rate events
// the real agents send), so the account cards of Uso show percentages. The weekly one goes first: the 5 h one is the last word.
const HOUR = 3_600_000;
const RATES = { claude: [['seven_day', 0.31, 96 * HOUR], ['5h', 0.54, 2.5 * HOUR]], codex: [['seven_day', 0.18, 120 * HOUR], ['5h', 0.42, 1.5 * HOUR]] };
const USAGE = process.env.ORB_EXPLORA_USAGE === '1';

export function fakeAdapter(id, real) {
  const adapter = base(id, real);
  const createLive = adapter.createLive;
  adapter.createLive = (o) => {
    const live = createLive(o);
    const send = live.send;
    // Orb takes its «before the turn» photo of the folder before calling send, so what is written here belongs to the turn.
    live.send = (message) => {
      if (USAGE) for (const [window, utilization, ms] of RATES[id] ?? []) o.onEvent?.({ type: 'rate', status: 'allowed', resetAt: Date.now() + ms, utilization, window });
      const text = String(message?.text ?? '');
      const when = turnOf(text);
      const hit = when ? PLAN.find((x) => x.when === when) : null;
      // without the quoted context, fake-live finds its own answer for the turn
      if (when && !hit) return send({ ...message, text: when });
      if (!hit) return send(message);
      // «stop»: Orb ends this task's turn itself. The same event the guard's stop sends (src/agents/codex.mjs), so the
      // conversation that ordered the task gets its «Orb ha parado el turno» card. Only in a task's own turn.
      if (hit.stop && text.includes('## Tarea #')) o.onEvent?.({ type: 'item', role: 'system', kind: 'status', body: hit.stop.body, stop: { cause: hit.stop.cause, why: hit.stop.why } });
      const root = path.resolve(o.cwd);
      for (const [rel, body] of Object.entries(hit.files ?? {})) {
        const file = path.resolve(root, rel);
        // never outside the folder the chat works in
        if (!file.startsWith(root + path.sep)) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
      }
      return send({ ...message, text: hit.append ? `${hit.when}\n${hit.append}` : hit.when });
    };
    return live;
  };
  return adapter;
}
