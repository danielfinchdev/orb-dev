// Correction rounds of one request. The limit stops the coordinator from looping fix -> verify without anyone watching.
//
// Definition (only what is stored): a request starts at the last chat line of the user in the conversation. The coordinator
// writes exactly one reply line (role 'orb') at the end of each of its turns, after its tools ran, so the tasks it created
// in one turn all sit between two 'orb' lines. Every such group is one round: the first is the original plan, each later
// one is a correction. Tasks of the scheduler (reviews, joins of copies — marked engine_task —, schedules) and subtasks are
// not the coordinator's rounds.
import { isRailOn } from '../rules/rails.mjs';

export const maxFixRounds = (config) => {
  const n = Number(config?.budget?.maxFixRounds);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
};

// What the coordinator's task creation asks: the limit applies only while the «rondas-correccion» rail is on.
export function fixRoundGate(board, conversation, config) {
  const max = maxFixRounds(config);
  return isRailOn('rondas-correccion') ? fixRoundCheck(board, conversation, max) : { allowed: true, rounds: 0, max };
}

// { allowed, rounds, max }: rounds = the correction rounds that would exist if a task were created now.
export function fixRoundCheck(board, conversation, max = 2, at = new Date().toISOString()) {
  const lines = board.all("SELECT role, at FROM chat WHERE conversation_id = ? AND role IN ('usuario', 'orb') ORDER BY id", conversation);
  let start = '';
  for (const l of lines) if (l.role === 'usuario') start = l.at;
  const replies = lines.filter((l) => l.role === 'orb' && l.at >= start).map((l) => l.at);
  const groupOf = (when) => replies.filter((r) => r < when).length;
  const tasks = board.all(`SELECT created_at FROM tasks WHERE conversation_id = ? AND created_by = 'orb' AND parent_id IS NULL AND review_of IS NULL
    AND schedule_id IS NULL AND created_at >= ? AND id NOT IN (SELECT CAST(substr(key, 13) AS INTEGER) FROM settings WHERE substr(key, 1, 12) = 'engine_task:')`, conversation, start);
  const groups = new Set(tasks.map((t) => groupOf(t.created_at)));
  groups.add(groupOf(at));
  const rounds = groups.size - 1;
  return { allowed: rounds <= max, rounds, max };
}
