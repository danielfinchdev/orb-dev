// 3.8.1 (H4c): the lists the window asks for on every refresh, as changes (src/core/feed.mjs). A call of one of these
// methods with `since` gets a feed reply; without it, the plain reply of before (older Orbs and phone apps).
// tasks.list goes compact in a feed: without the texts and fields no list shows (the brief and the result, the folders,
// the approval…); a task's screen reads them from tasks.get. The plain reply keeps every field.
import { Feed } from '../core/feed.mjs';

const TASK_DETAIL_ONLY = ['description', 'result', 'workdir', 'project_path', 'approved_by', 'run_account', 'schedule_id', 'claimed_session', 'depends_on', 'pid', 'launch', 'priority'];
export const compactTask = (task) => { for (const f of TASK_DETAIL_ONLY) delete task[f]; return task; };
const SPECS = {
  'tasks.list': { key: (r) => r.id, rows: (out) => out.map(compactTask) },
  'conversations.list': { key: (r) => r.id },
  'sessions.list': { key: (r) => r.id },
  'projects.list': { key: (r) => r.name },
  // { zone, items, sections, unread, projects }: the items as rows, the rest (small) as one piece
  'inbox.list': { key: (r) => r.key, rows: (out) => out.items, meta: ({ items: _items, ...rest }) => rest }
};

// One Feed per method and parameters (the zone of inbox.list, archived of sessions.list, the limit of tasks.list…).
export function createFeeds({ max = 24 } = {}) {
  const feeds = new Map();
  return {
    reply(method, params, out) {
      const spec = SPECS[method];
      if (!spec || !out || typeof out !== 'object') return out;
      const id = `${method} ${JSON.stringify(Object.keys(params).filter((k) => k !== 'since').sort().map((k) => [k, params[k]]))}`;
      let feed = feeds.get(id);
      if (feed) feeds.delete(id); else feed = new Feed({ key: spec.key });
      feeds.set(id, feed); // the most recent last
      if (feeds.size > max) feeds.delete(feeds.keys().next().value);
      const rows = spec.rows ? spec.rows(out) : out;
      if (!Array.isArray(rows)) return out;
      return feed.reply(rows, params.since, spec.meta ? spec.meta(out) : undefined);
    }
  };
}
