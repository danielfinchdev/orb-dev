// The board's messages between agents, the conversations with the assistant and the assistant's chat.
// Part of the Board class (board.mjs adds these methods to it).
import { tr } from '../../platform/context.mjs';
import { AGENT_LABELS } from '../../platform/config-file.mjs';
import { oneLine } from '../../shared/text.mjs';
import { AGENTS, now, conversationRow, assistantName } from './board-common.mjs';

export class BoardConversations {
  // ---- messages between agents, the assistant and the user
  // from_task: the sender's own task (a worker); task_id: the task the message is about or for.
  send({ from, to, body, task_id, from_task = null }) {
    if (!body) throw new Error(tr('sys.board.bodyRequired'));
    if (![...AGENTS, 'all', 'usuario', 'orb'].includes(to)) throw new Error(tr('sys.board.badRecipient', { to, list: AGENTS.join(', ') }));
    body = String(body).slice(0, 8000);
    // 3.2.1: the agent by its name («Cursor», not «cursor»).
    const who = from === 'orb' ? assistantName() : AGENT_LABELS[from] ?? from;
    if (to === 'usuario') this.addChat('system', `💬 ${who}${task_id ? tr('msg.board.taskRef', { id: task_id }) : ''}: ${body}`, task_id ? { task: Number(task_id) } : null);
    const { lastInsertRowid } = this.run('INSERT INTO messages (from_agent, to_agent, task_id, from_task, body, at) VALUES (?, ?, ?, ?, ?, ?)', String(from), to, task_id ?? null, from_task ?? null, body, now());
    this.changed('messages');
    return { id: Number(lastInsertRowid), from, to, task_id: task_id ?? null };
  }

  // visible(m): which of them this reader may see (an agent's MCP: only its own tasks' and conversation's); only those
  // are returned and marked as read. 3.8: reader, whose read marks they are (a worker's are its task's, «claude#3», so two
  // tasks of one agent do not take each other's messages); mine(m), a message it sent itself (left out).
  inbox(agent, markRead = true, visible = () => true, { reader = agent, mine = (m) => m.from_agent === agent } = {}) {
    const rows = this.all(`SELECT m.* FROM messages m WHERE (m.to_agent = ? OR m.to_agent = 'all')
      AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.agent = ?) ORDER BY m.id LIMIT 1000`, agent, reader).filter((m) => !mine(m) && visible(m)).slice(0, 100);
    if (markRead) for (const m of rows) this.run('INSERT OR IGNORE INTO message_reads (message_id, agent) VALUES (?, ?)', m.id, reader);
    return rows;
  }

  // ---- 3.2: the conversations with the assistant (each with its title, project, brain and its agent's conversation id)
  conversation(id) {
    const r = id == null ? null : this.one('SELECT * FROM conversations WHERE id = ?', Number(id));
    return r ? conversationRow(r) : null;
  }
  conversations({ limit = 300 } = {}) {
    return this.all('SELECT * FROM conversations WHERE bot_id IS NULL AND group_id IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?', Math.min(Math.max(Number(limit) || 300, 1), 2000)).map(conversationRow);
  }
  createConversation({ title = '', project = null, agent = 'claude', account = null, model = null, reasoning = 'medium' } = {}) {
    if (project && !this.project(project)) throw new Error(tr('sys.board.unknownProject', { name: project }));
    const at = now();
    const { lastInsertRowid } = this.run('INSERT INTO conversations (title, titled, project, agent, account, model, reasoning, created_at, updated_at) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)',
      oneLine(title || tr('msg.board.newConversation'), 80), project ? this.project(project).name : null, agent, account || null, model || null, reasoning || 'medium', at, at);
    this.changed('conversations');
    return this.conversation(Number(lastInsertRowid));
  }
  updateConversation(id, fields) {
    const allowed = ['title', 'titled', 'project', 'agent', 'account', 'model', 'reasoning', 'session_id', 'turns', 'context', 'status', 'done_at', 'updated_at'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.conversation(id);
    const value = (k) => (k === 'context' ? (fields[k] == null ? null : JSON.stringify(fields[k])) : k === 'titled' ? Number(Boolean(fields[k])) : k === 'title' ? oneLine(String(fields[k]), 80) : fields[k] ?? null);
    this.run(`UPDATE conversations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(value), Number(id));
    this.changed('conversations');
    return this.conversation(id);
  }
  // Done (the user gave the OK and nothing of it is still open, or put away by hand) or open again.
  setConversationDone(id, done = true) {
    const c = this.conversation(id); if (!c) return null;
    if ((c.status === 'done') === Boolean(done)) return c;
    // Opened again counts as activity: the day-long quiet before it would complete it again at once.
    return this.updateConversation(c.id, { status: done ? 'done' : 'open', done_at: done ? now() : null, ...(done ? {} : { updated_at: now() }) });
  }
  // The project of a conversation. 3.2: when the user chooses it (asDefault), also the default for the next new
  // conversation (the global working folder). 3.8.3: the assistant choosing a project for its conversation (a task, a
  // new project, orb_set_project) no longer moves the user's working folder too: a test project ended up as the
  // «Proyecto de trabajo» of every new chat.
  setConversationProject(id, name, actor, { asDefault = false } = {}) {
    const c = this.conversation(id); if (!c) throw new Error(tr('msg.board.noConversation'));
    const project = name ? this.project(name) : null;
    if (name && !project) throw new Error(tr('sys.board.unknownProject', { name }));
    if ((c.project ?? null) !== (project?.name ?? null)) this.updateConversation(c.id, { project: project?.name ?? null });
    if (asDefault) this.setActiveProject(project?.name ?? '', actor);
    return project;
  }
  // The conversation a task belongs to: its own, or the one of the task it comes from (a subtask, a review, a join).
  conversationOfTask(taskId) {
    let task = this.task(taskId);
    for (let i = 0; task && i < 8; i++) {
      if (task.conversation_id) return task.conversation_id;
      const from = task.parent_id ?? task.review_of ?? null;
      task = from ? this.task(from) : null;
    }
    return null;
  }
  // The tasks of a conversation that are not over yet (they keep it open).
  openTasksOf(conversationId) {
    return this.one("SELECT COUNT(*) AS n FROM tasks WHERE conversation_id = ? AND status IN ('queued', 'awaiting_approval', 'running', 'limited')", Number(conversationId)).n;
  }

  // ---- the assistant's chat and the activity feed
  // meta: extra data of a chat line, e.g. { kind: 'report', tasks: [ids] } for the assistant's report that waits for the user's OK.
  // 3.2: conversation: the one the line belongs to; when not given, the one of the task the line is about (meta.task).
  addChat(role, body, meta = null, conversation = undefined) {
    const conv = conversation !== undefined ? conversation : meta?.task ? this.conversationOfTask(meta.task) : null;
    const at = now();
    const { lastInsertRowid } = this.run('INSERT INTO chat (role, body, meta, at, conversation_id) VALUES (?, ?, ?, ?, ?)', role, String(body), meta ? JSON.stringify(meta) : null, at, conv ?? null);
    if (conv && role !== 'notice') this.run('UPDATE conversations SET updated_at = ? WHERE id = ?', at, Number(conv));
    // 3.6 (messaging lists): which conversation got which line (the lists count unread lines).
    this.changed('chat', conv != null && role !== 'notice' ? { conversation: Number(conv), line: Number(lastInsertRowid), role } : null);
    return { id: Number(lastInsertRowid), conversation: conv ?? null };
  }
  // 2.7: a notice that only informs (the working folder changed, the brain in use, a schedule created…): the window shows
  // it as a passing notification instead of a grey line in the chat. tone: info | success | warning. Kept in the table
  // (role 'notice') so the engine sees it whichever process wrote it, but left out of the chat.
  notice(body, tone = 'info') { return this.addChat('notice', body, { tone }); }
  // Changes the extra data of a chat message (e.g. an approval card that was answered).
  patchChatMeta(id, meta) { this.run('UPDATE chat SET meta = ? WHERE id = ?', JSON.stringify(meta), Number(id)); this.changed('chat'); }
  // The chat lines of a conversation (not the notices), oldest first: the last `limit`, or only those before a line id.
  // conversation null: the lines of no conversation (about tasks made outside one: by hand, by a schedule).
  chat(conversation, limit = 200, { before = null } = {}) {
    const where = conversation == null ? 'conversation_id IS NULL' : 'conversation_id = ?';
    return this.all(`SELECT * FROM (SELECT * FROM chat WHERE role != 'notice' AND ${where}${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ?) ORDER BY id`, ...(conversation == null ? [] : [Number(conversation)]), ...(before ? [Number(before)] : []), limit)
      .map((r) => { let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* ignore */ } return { ...r, meta }; });
  }
  // One chat line by its id (any conversation), with its extra data.
  chatRow(id) {
    const r = this.one('SELECT * FROM chat WHERE id = ?', Number(id)); if (!r) return null;
    let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* ignore */ }
    return { ...r, meta };
  }
}
