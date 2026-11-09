// The items of a direct conversation as the view draws them (views/session.jsx). A tool call and its result become one
// block (the latest call with that id gets the result); a run of changed files, one block.
// 3.8.2: a subagent (Claude's Agent tool, Codex's spawnAgent) is one block of its own with the steps it took inside
// (the items whose `parent` is its call) and its state: running, done or failed; Codex tells its threads' state in the
// results of its later collab calls (states).
const DONE = { completed: 'done', shutdown: 'done', errored: 'failed', notFound: 'failed', interrupted: 'failed' };
export function toBlocks(items, t) {
  const blocks = []; const tools = new Map(); const agents = new Map(); const byThread = new Map();
  const place = (b, parent) => { const a = parent != null ? agents.get(parent) : null; if (a) a.steps.push(b); else blocks.push(b); };
  for (const it of items) {
    if (it.kind === 'tool') {
      const sub = it.body?.agent;
      const b = sub ? { type: 'subagent', key: it.id, call: it.body, result: null, steps: [], threadState: null } : { type: 'tool', key: it.id, call: it.body, result: null };
      if (it.body?.id) tools.set(it.body.id, b);
      if (sub && it.body?.id) { agents.set(it.body.id, b); for (const th of sub.threads ?? []) byThread.set(th, b); }
      place(b, it.body?.parent);
      continue;
    }
    if (it.kind === 'tool_result') {
      for (const [th, st] of Object.entries(it.body?.states ?? {})) { const a = byThread.get(th); if (a) a.threadState = st; }
      const b = it.body?.id ? tools.get(it.body.id) : null;
      if (b) b.result = it.body; else place({ type: 'tool', key: it.id, call: { name: t('session.result') }, result: it.body }, it.body?.parent);
      continue;
    }
    if (it.kind === 'file') { const last = blocks.at(-1); if (last?.type === 'files') last.files.push(it.body); else blocks.push({ type: 'files', key: it.id, files: [it.body] }); continue; }
    blocks.push({ type: 'item', key: it.id, item: it });
  }
  return blocks;
}

// running | done | failed. Claude's: its call's result. Codex's: its threads' latest state when told, else its call's.
export function subagentState(b) {
  if (b.threadState) return DONE[b.threadState] ?? (b.result?.error ? 'failed' : 'running');
  if (b.call?.agent?.threads?.length) return b.result?.error ? 'failed' : 'running';
  return !b.result ? 'running' : b.result.error ? 'failed' : 'done';
}
