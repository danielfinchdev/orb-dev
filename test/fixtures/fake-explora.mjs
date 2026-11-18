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

export function fakeAdapter(id, real) {
  const adapter = base(id, real);
  const createLive = adapter.createLive;
  adapter.createLive = (o) => {
    const live = createLive(o);
    const send = live.send;
    // Orb takes its «before the turn» photo of the folder before calling send, so what is written here belongs to the turn.
    live.send = (message) => {
      const text = String(message?.text ?? '');
      const hit = PLAN.find((x) => x.when && text.includes(x.when));
      if (!hit) return send(message);
      const root = path.resolve(o.cwd);
      for (const [rel, body] of Object.entries(hit.files ?? {})) {
        const file = path.resolve(root, rel);
        // never outside the folder the chat works in
        if (!file.startsWith(root + path.sep)) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
      }
      return send(hit.append ? { ...message, text: `${text}\n${hit.append}` } : message);
    };
    return live;
  };
  return adapter;
}
