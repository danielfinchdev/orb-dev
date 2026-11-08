// 3.8.1 (H4c): the lists the window asks for on every refresh, as changes (src/core/feed.mjs). A call of one of these
// methods with `since` gets a feed reply; without it, the plain reply of before (older Orbs and phone apps).
// tasks.list goes compact in a feed: without the texts and fields no list shows (the brief and the result, the folders,
// the approval…); a task's screen reads them from tasks.get. The plain reply keeps every field.
import { Feed } from '../core/feed.mjs';

const TASK_DETAIL_ONLY = ['description', 'result', 'workdir', 'project_path', 'approved_by', 'run_account', 'schedule_id', 'claimed_session', 'depends_on', 'pid', 'launch', 'priority'];
export const compactTask = (task) => { for (const f of TASK_DETAIL_ONLY) delete task[f]; return task; };
// params: the parameters that change the list, normalised as the method reads them; any other is ignored, so stray or
// differently spelled parameters (limit 200 / "200", an unknown key) share one feed instead of filling the cache.
// None of these lists depends on who calls: callers of one kind (this PC, linked devices) share a feed. A list that one
// day filtered by device or permission would need the device in its feed id, or its `gone` and `order` would name rows
// (ids, project names) that device does not see (test/feed.test.mjs › «feeds: per kind of caller»).
const SPECS = {
  'tasks.list': { key: (r) => r.id, rows: (out) => out.map(compactTask), params: ({ limit }) => Math.min(Number(limit) || 150, 500) },
  'conversations.list': { key: (r) => r.id },
  'sessions.list': { key: (r) => r.id, params: ({ archived }) => Boolean(archived) },
  'projects.list': { key: (r) => r.name },
  // { zone, items, sections, unread, projects }: the items as rows, the rest (small) as one piece
  'inbox.list': { key: (r) => r.key, rows: (out) => out.items, meta: ({ items: _items, ...rest }) => rest, params: ({ zone }) => String(zone || 'orb') }
};

// One Feed per kind of caller, method and parameters. Linked devices (principal.channel phone / browser) have a small
// cache of their own: whatever they ask, they never push this PC's feeds out (which would send it whole lists again).
export function createFeeds({ max = 24, maxRemote = 8 } = {}) {
  const caches = { desktop: new Map(), remote: new Map() };
  return {
    reply(method, params, out, principal) {
      const spec = SPECS[method];
      if (!spec || !out || typeof out !== 'object') return out;
      const kind = principal?.channel ?? 'desktop';
      const local = kind === 'desktop';
      const cache = local ? caches.desktop : caches.remote;
      const id = `${kind} ${method} ${JSON.stringify(spec.params ? spec.params(params) : null)}`;
      let feed = cache.get(id);
      if (feed) cache.delete(id); else feed = new Feed({ key: spec.key });
      cache.set(id, feed); // the most recent last
      if (cache.size > (local ? max : maxRemote)) cache.delete(cache.keys().next().value);
      const rows = spec.rows ? spec.rows(out) : out;
      if (!Array.isArray(rows)) return out;
      return feed.reply(rows, params.since, spec.meta ? spec.meta(out) : undefined);
    },
    size: () => ({ desktop: caches.desktop.size, remote: caches.remote.size })
  };
}
