// Window actions of conversations, chat, images, attachments and the whiteboard.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { accounts as allAccounts } from '../../domain/usage/accounts.mjs';
import { brainOf } from '../orchestrator.mjs';
import { slashCommand } from '../../shared/slash.mjs';
import { oneLine, localStamp } from '../../shared/text.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { ATTACH_DIR } from '../sessions.mjs';
import { playableType } from '../../shared/attach-kind.mjs';
import { expandMentions } from '../mentions.mjs';
import { assistantName } from '../../domain/tasks/board.mjs';
import { modelCatalog, REASONING_LEVELS, levelsOf } from '../usage/catalog.mjs';
import { slug } from '../../platform/git.mjs';
import { PermissionError } from '../../domain/security/permissions.mjs';
import { phoneText } from '../transport/remote-calls.mjs';
import { fail, str, int, oneOf, images } from './common.mjs';
import { lastLaunch, lastLaunchId } from '../scheduler/run-id.mjs';
import { createDedupe, conversationKey } from './dedupe.mjs';
import { fold, snippet } from '../../domain/conversations/inbox.mjs';

export function chatMethods({ project, conversationId, accept, allowedImage, withAccepted, settleConversation, trash, wb, board, sessions, orchestrator, scheduler, emit, log }) {
  const methods = {
    // a conversation's lines (the last 160, or 120 more before a line).
    // Without a conversation: the lines of none (tasks made by hand or by a schedule), which the window shows as notices.
    'chat.list': ({ conversation, before }) => board.chat(conversation == null ? null : conversationId(conversation), before ? 120 : 160, { before: before ? int(before, 'mensaje') : null }).map(withAccepted),
    // A message to a conversation with the assistant; without one, it starts a new conversation (in the project given, or
    // the working folder). → { conversation }
    // brain ({ agent, model, reasoning }): a new conversation started from a phone with the brain chosen there (the
    // one new conversations start with is this PC's setting).
    // images: the files attached to the message (absolute paths, at most 10), checked and placed exactly as in sessions.send.
    'chat.send': ({ text, conversation, project: name, brain, images: files }, principal) => {
      const t = str(text, 'mensaje', 20000);
      const attachments = images(files);
      const id = conversation == null ? null : conversationId(conversation);
      if (id) trash.assertNotTrashed(id);
      const proj = name === undefined ? undefined : name ? project(name).name : null;
      if (brain !== undefined) {
        if (id || !brain || typeof brain !== 'object' || Array.isArray(brain)) fail(tr('msg.api.badParams'));
        const c = orchestrator.startConversation({ text: t, project: proj });
        const pick = Object.fromEntries(['agent', 'model', 'reasoning'].filter((k) => brain[k] !== undefined).map((k) => [k, brain[k]]));
        try { methods['chat.settings']({ conversation: c.id, ...pick }, principal); } catch (error) { board.run('DELETE FROM conversations WHERE id = ?', c.id); board.changed('conversations'); throw error; }
        return orchestrator.ask(t, expandMentions(board, sessions, t), { conversation: c.id, project: proj, attachments, fresh: true });
      }
      // «/compact» and «/clear» typed alone in an existing chat are Orb's commands (src/shared/slash.mjs).
      const command = id && !attachments.length ? slashCommand(t) : null;
      if (command) return command === 'compact' ? orchestrator.compact(id) : orchestrator.clear(id);
      if (!id && (brainOf().agent || 'claude') === 'cursor') fail(tr('msg.api.cursorNoCoordinate'));
      return orchestrator.ask(t, expandMentions(board, sessions, t), { conversation: id, project: proj, attachments });
    },
    // The messages written while the assistant works, waiting for their turn: → [{ id, text, at }] (id: a text; at: ms).
    // Only a message that has not started can be changed: text edits it, remove drops it (→ the queue left).
    'chat.queue': ({ conversation }) => orchestrator.queueOf(conversationId(conversation)),
    'chat.editQueued': ({ conversation, queueId, text, remove, expect }) => {
      const id = conversationId(conversation);
      trash.assertNotTrashed(id);
      const qid = str(queueId, 'mensaje', 64);
      // expect (optional): the text the phone showed; if the queued message changed meanwhile nothing is edited or removed.
      if (expect != null) {
        const now = orchestrator.queueOf(id).find((m) => String(m.id) === qid);
        // a phone gets the queue with the assistant folder cut out of each text (shapeResult), so it may send either form.
        if (now && now.text !== expect && phoneText(now.text) !== expect) fail(tr('msg.queue.changed'));
      }
      if (remove) return orchestrator.editQueued(id, qid, { remove: true });
      const t = str(text, 'mensaje', 20000);
      return orchestrator.editQueued(id, qid, { text: t, mentions: expandMentions(board, sessions, t) });
    },
    'chat.stop': ({ conversation }) => orchestrator.stop(conversationId(conversation)),
    // «Compactar»: the conversation's coordinator compacts its own context (or starts afresh with the briefing and
    // its last lines when its agent cannot). → { ok, how: 'compacted' | 'renewed' }
    'chat.compact': ({ conversation }) => orchestrator.compact(conversationId(conversation)),
    // rename, change the project of a conversation, mark it done or open it again.
    'conversations.update': ({ id, title, project: name, done, notes }) => {
      const c = conversationId(id);
      // the person's notes on the chat (its info panel); empty text clears them
      if (notes !== undefined) { board.updateConversation(c, { notes: str(notes, 'notas', 4000, { optional: true }) || null }); return { id: c, notes: board.conversationNotes(c) }; }
      if (title !== undefined) board.updateConversation(c, { title: oneLine(str(title, 'título', 80), 80), titled: true });
      if (name !== undefined) board.setConversationProject(c, name ? project(name).name : '', 'usuario', { asDefault: true });
      if (done !== undefined) board.setConversationDone(c, Boolean(done));
      return board.conversation(c);
    },
    // Pinned messages: a line of this conversation (the person's or the assistant's) is pinned or unpinned, and the pinned ones
    // are listed (the line list only holds the last ones, a pin may be older).
    'chat.pin': ({ conversation, id, pinned }) => {
      const row = board.pinChat(conversationId(conversation), int(id, 'mensaje'), pinned !== false);
      if (!row) fail(tr('msg.api.invalid', { name: 'mensaje' }));
      return { id: row.id, pinned: Boolean(row.pinned_at) };
    },
    'chat.notes': ({ conversation }) => ({ notes: board.conversationNotes(conversationId(conversation)) }),
    'chat.pinned': ({ conversation }) => board.pinnedChat(conversationId(conversation)),
    // Deleted with its lines (its tasks stay, in Tareas).
    'conversations.remove': ({ id }) => trash.removeConversation(conversationId(id)),
    // the search of the sidebar: conversations (with the assistant and direct) whose title or messages have the words.
    'conversations.search': ({ q }) => {
      const words = String(q ?? '').trim().toLowerCase().slice(0, 100);
      if (words.length < 2) return { conversations: [], sessions: [] };
      const like = `%${words.replace(/[%_!]/g, (m) => `!${m}`)}%`;
      // SQLite's LIKE ignores case only for ASCII: with accents or «ñ» the words are matched here, in JavaScript.
      if (/[^\x00-\x7f]/.test(words)) {
        const has = (s) => String(s ?? '').toLowerCase().includes(words);
        const conversations = board.all(`SELECT c.id, c.title, (SELECT group_concat(m.body, ' ') FROM chat m WHERE m.conversation_id = c.id AND m.role IN ('usuario', 'orb')) AS text FROM conversations c WHERE c.bot_id IS NULL AND c.group_id IS NULL AND c.trashed_at IS NULL`).filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        const found = board.all(`SELECT s.id, s.title, (SELECT group_concat(i.body, ' ') FROM session_items i WHERE i.session_id = s.id AND i.kind = 'text') AS text FROM sessions s WHERE s.kind = 'chat' AND s.trashed_at IS NULL`).filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        return { conversations, sessions: found };
      }
      const conversations = board.all(`SELECT DISTINCT c.id FROM conversations c LEFT JOIN chat m ON m.conversation_id = c.id AND m.role IN ('usuario', 'orb') WHERE c.bot_id IS NULL AND c.group_id IS NULL AND c.trashed_at IS NULL AND (lower(c.title) LIKE ? ESCAPE '!' OR lower(m.body) LIKE ? ESCAPE '!') LIMIT 100`, like, like).map((r) => r.id);
      const found = board.all(`SELECT DISTINCT s.id FROM sessions s LEFT JOIN session_items i ON i.session_id = s.id AND i.kind = 'text' WHERE s.kind = 'chat' AND s.trashed_at IS NULL AND (lower(s.title) LIKE ? ESCAPE '!' OR lower(i.body) LIKE ? ESCAPE '!') LIMIT 100`, like, like).map((r) => r.id);
      return { conversations, sessions: found };
    },
    // tasks by what they say (title, brief or result, without case or accents), for the sidebar's search and
    // Ctrl+K. The newest first. → [{ id, title, status, project, snippet }]
    'tasks.search': ({ q }) => {
      const words = oneLine(String(q ?? ''), 100).trim();
      if (words.length < 2) return [];
      const needle = fold(words); const out = [];
      for (const r of board.all('SELECT id, title, status, project, description, result FROM tasks ORDER BY id DESC LIMIT 5000')) {
        const where = [r.title, r.description, r.result].find((x) => fold(x).includes(needle));
        if (where == null) continue;
        out.push({ id: r.id, title: r.title, status: r.status, project: r.project, snippet: where === r.title ? '' : redactSecrets(snippet(where, words)) });
        if (out.length >= 30) break;
      }
      return out;
    },
    // pictures the agents make (Codex image_gen): shown in the conversation, a zone marked to change, saved in the
    // project. Read only from the agents' own picture folders, Orb's folder and the projects; written only into Orb's
    // folder (the marked copy) and <project>/imagenes.
    'images.read': ({ path: file }) => {
      const f = allowedImage(str(file, 'imagen', 1000));
      const ext = path.extname(f).slice(1).toLowerCase();
      return { dataUrl: `data:${ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'};base64,${fs.readFileSync(f).toString('base64')}` };
    },
    // a PDF attached to a direct conversation, for the window's viewer: only from that conversation's attachments
    // folder (.orb-adjuntos of its working folder), 25 MB at most.
    'attachments.read': ({ session, path: file }) => {
      const s = sessions.must(str(session, 'conversación', 64));
      const real = (p) => { try { return fs.realpathSync(p); } catch { return fail(tr('msg.api.badAttachment')); } };
      const dir = real(path.join(s.cwd, ATTACH_DIR)); const f = real(str(file, 'archivo', 1000));
      // the attachments folder itself, never a link or junction to another folder.
      if (path.relative(path.join(real(s.cwd), ATTACH_DIR), dir) !== '') fail(tr('msg.api.badAttachment'));
      const rel = path.relative(dir, f);
      // and the audio and video the window can play (the CSP lets media come only from blob: URLs).
      const mime = /\.pdf$/i.test(f) ? 'application/pdf' : playableType(f);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !mime || fs.statSync(f).size > 25 * 1024 * 1024) fail(tr('msg.api.badAttachment'));
      return { kind: mime === 'application/pdf' ? 'pdf' : mime.split('/')[0], mime, base64: fs.readFileSync(f).toString('base64') };
    },
    // A PNG made in the window, kept in Orb's folder to attach: the marked zone of a picture, or a window the user
    // captured from the composer.
    'images.mark': ({ dataUrl }) => {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
      if (!m || m[1].length > 34 * 1024 * 1024) fail(tr('msg.api.badImage'));
      const dir = path.join(ctx.paths.internal, 'imagenes'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `zona-${Date.now()}.png`); fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
      return { path: file };
    },
    'images.save': ({ path: file, project: name, title }) => {
      const f = allowedImage(str(file, 'imagen', 1000));
      const p = project(name);
      const dir = path.join(p.path, 'imagenes'); fs.mkdirSync(dir, { recursive: true });
      // a name people can read: the first words of what was asked for (or "imagen" and the date), not Codex's
      // internal "exec-6ac8e3e7-….png".
      const ext = path.extname(f).toLowerCase() || '.png';
      const words = slug(oneLine(str(title, 'título', 300, { optional: true }) ?? '', 300).split(/\s+/).slice(0, 6).join(' '));
      const own = path.basename(f, path.extname(f));
      const internal = /^(exec|ig|img|image)[-_]?[0-9a-f-]{8,}$/i.test(own) || /^[0-9a-f-]{16,}$/i.test(own);
      const stem = words && words !== 'tarea' ? words : internal ? `imagen-${localStamp()}` : own.replace(/[^\w.-]/g, '_');
      let base = `${stem}${ext}`;
      for (let i = 2; fs.existsSync(path.join(dir, base)); i++) base = `${stem}-${i}${ext}`;
      fs.copyFileSync(f, path.join(dir, base));
      return { path: path.join(dir, base), name: base };
    },
    // the Pizarra of each project (src/engine/whiteboard.mjs), saved in <project>/pizarra.
    'whiteboard.load': async ({ project }) => (await wb()).load({ project: str(project, 'proyecto', 200) }),
    'whiteboard.save': async ({ project, elements, appState, files, png }) => (await wb()).save({ project: str(project, 'proyecto', 200), elements, appState, files, png }),
    'whiteboard.attach': async ({ project, paths }) => (await wb()).attach({ project: str(project, 'proyecto', 200), paths }),
    'whiteboard.note': async ({ project, file, note }) => (await wb()).note({ project: str(project, 'proyecto', 200), file: str(file, 'archivo', 200), note }),
    'whiteboard.canvasNote': async ({ project, note }) => (await wb()).canvasNote({ project: str(project, 'proyecto', 200), note: str(note, 'nota', 2000, { optional: true }) ?? '' }),
    'whiteboard.remove': async ({ project, file }) => (await wb()).remove({ project: str(project, 'proyecto', 200), file: str(file, 'archivo', 200) }),
    'whiteboard.folder': async ({ project }) => (await wb()).folder({ project: str(project, 'proyecto', 200) }),
    // the answer to a question card (orb_ask): the options picked and/or own words, or skipped. The card keeps it and
    // the assistant gets it as the user's next message, in the conversation of the question.
    'chat.answer': ({ id, choices, other, skip }) => {
      const row = board.chatRow(int(id, 'mensaje'));
      if (row?.meta?.kind !== 'question' || row.meta.status !== 'pending' || !row.conversation_id || !board.conversation(row.conversation_id)) fail(tr('msg.api.questionGone'));
      const labels = new Set(row.meta.options.map((o) => o.label));
      const picked = (Array.isArray(choices) ? choices : []).map((c) => String(c)).filter((c) => labels.has(c)).slice(0, row.meta.multi ? 4 : 1);
      const own = other === undefined ? '' : oneLine(str(other, 'respuesta', 2000, { optional: true }) ?? '', 2000).trim();
      if (!skip && !picked.length && !own) fail(tr('msg.api.answerEmpty'));
      const answer = skip ? '' : [...picked, ...(own ? [own] : [])].join(' · ');
      board.patchChatMeta(row.id, { ...row.meta, status: skip ? 'skipped' : 'answered', answer });
      const text = skip ? tr('msg.api.questionSkipped', { question: row.meta.question }) : tr('msg.api.questionAnswer', { question: row.meta.question, answer });
      // the question and its options are the assistant's words: only what the user typed counts
      // as the user asking for something («Auto» publishes or deletes on the user's own words, board.currentRequest).
      return orchestrator.ask(text, '', { conversation: row.conversation_id, meta: { answer: true, own: skip ? '' : own } });
    },
    'chat.accept': ({ id }, principal) => {
      const row = board.chatRow(int(id, 'mensaje'));
      if (row?.meta?.kind !== 'report') fail(tr('msg.api.notReport'));
      // the OK to the report also settles the tasks of that request Orb held «for your review» (a read-only check
      // that changed build files, for instance), which the report already explained: left alone, they would stay blocked for ever.
      // Only the PC window settles them: a phone or browser must not release held tasks through the report, as «tasks.accept» refuses.
      const held = row.conversation_id && principal?.channel === 'desktop' ? board.all("SELECT id FROM tasks WHERE conversation_id = ? AND status = 'blocked' AND updated_at <= ?", row.conversation_id, row.at)
        .map((r) => r.id).filter((tid) => board.heldInfo(board.task(tid))) : [];
      // Only the run the report shows: a task launched again after the report is not covered by its OK. Reports written
      // before `runs` was stored are judged by the time of the task's last launch.
      const shown = (row.meta.tasks ?? []).filter((tid) => {
        const run = row.meta.runs?.[tid];
        if (Number.isInteger(run)) return run === lastLaunchId(board, tid);
        const launched = Date.parse(lastLaunch(board, tid)?.at);
        return !(launched > Date.parse(row.at));
      });
      if (row.meta.tasks?.length && !shown.length) fail(tr('msg.api.reportRerun'));
      // only after the check: a refused OK must not leave the held tasks settled
      for (const tid of held) board.patch(tid, { status: 'done' }, 'usuario', 'task.review_accepted');
      const out = accept([...shown, ...held], row.meta.project);
      // the OK closes the conversation when nothing of it is still open (written in again, it opens).
      settleConversation(row.conversation_id);
      return out;
    },
    // The assistant's brain (any installed agent and model, with its reasoning and account). Of a conversation
    // (conversation given) and, always, the one new conversations start with; orchestrate: whether a new conversation is
    // with the assistant (on) or directly with the agent chosen (off: the user hands out the work).
    // a linked phone or browser changes only that conversation's brain; the one new conversations start with (and
    // «orchestrate») is a setting of this PC.
    'chat.settings': ({ conversation, agent, model, reasoning, orchestrate, account: acc }, principal) => {
      const remote = principal?.channel !== 'desktop';
      if (remote && (conversation == null || orchestrate !== undefined)) throw new PermissionError('config.save');
      const o = brainOf();
      const conv = conversation == null ? null : board.conversation(conversationId(conversation));
      const base = conv ? { agent: conv.agent, account: conv.account, model: conv.model, reasoning: conv.reasoning } : o;
      const patch = {};
      if (agent !== undefined) {
        if (!modelCatalog(board).some((a) => a.id === agent)) fail(tr('msg.api.agentUnavailable', { agent: String(agent).slice(0, 40) }));
        patch.agent = agent;
      }
      const brain = patch.agent ?? base.agent ?? 'claude';
      if (acc !== undefined) { patch.account = str(acc, 'cuenta', 40); if (patch.account && !allAccounts().some((a) => a.id === patch.account)) fail(tr('msg.api.noAccount')); }
      else if (patch.agent && patch.agent !== (base.agent ?? 'claude')) patch.account = brain; // another agent: its own account
      if (model !== undefined) {
        const m = String(model ?? '');
        if (brain === 'claude' && m && !o.models.some((x) => x.id === m) && !/^(sonnet|opus|haiku)$/.test(m)) {
          // a model Claude Code itself offers (discovered) joins the assistant's models, so the settings stay valid.
          const offered = (board.settingJson('models:claude') ?? []).find((x) => x.id === m);
          if (!offered || !/^[\w.:-]{1,80}$/.test(m)) fail(tr('msg.api.modelUnavailable'));
          if (!remote) patch.models = [...o.models, { id: m, label: offered.label }];
        }
        if (m && !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(m)) fail(tr('msg.api.modelUnavailable'));
        patch.model = m || (brain === 'claude' ? 'claude-sonnet-5-5' : '');
      } else if (patch.agent && patch.agent !== (base.agent ?? 'claude')) patch.model = brain === 'claude' ? 'claude-sonnet-5-5' : '';
      if (reasoning !== undefined) patch.reasoning = oneOf(reasoning, REASONING_LEVELS, 'razonamiento');
      // «Extra» (xhigh) only with a model that takes it; changing to a model without it leaves «Alto».
      if ((patch.reasoning ?? base.reasoning) === 'xhigh' && (reasoning !== undefined || patch.model !== undefined || patch.agent !== undefined)) {
        if (!levelsOf(modelCatalog(board), brain, patch.model ?? base.model, patch.account ?? base.account).includes('xhigh')) {
          if (reasoning === 'xhigh') fail(tr('msg.api.reasoningUnavailable'));
          patch.reasoning = 'high';
        }
      }
      if (orchestrate !== undefined && !conv) patch.orchestrate = Boolean(orchestrate);
      // Cursor's command line cannot take Orb's tools (MCP): it can talk directly, not coordinate the agents.
      if (brain === 'cursor' && (conv || (patch.orchestrate ?? o.orchestrate !== false))) fail(tr('msg.api.cursorNoCoordinate'));
      const before = { ...base };
      if (conv) {
        const fields = {};
        for (const k of ['agent', 'account', 'model', 'reasoning']) if (patch[k] !== undefined) fields[k] = patch[k] || null;
        board.updateConversation(conv.id, fields);
        // Another agent, or another account (its conversation lives in that account's folder): this conversation goes on
        // afresh with the logs instead of failing to resume.
        if ((patch.agent && patch.agent !== before.agent) || (patch.account !== undefined && patch.account !== before.account)) orchestrator.forget(conv.id);
      }
      // On this PC the choice is also the one the next new conversation starts with.
      if (!remote) { const c = saveConfig({ orchestrator: patch }); emit('config:changed', c); }
      const info = orchestrator.info(conv?.id ?? null);
      const level = { low: tr('msg.api.reasoningLow'), medium: tr('msg.api.reasoningMedium'), high: tr('msg.api.reasoningHigh'), xhigh: tr('msg.api.reasoningXhigh') }[info.reasoning] ?? info.reasoning;
      if ((patch.model !== undefined && patch.model !== before.model) || (patch.agent && patch.agent !== (before.agent ?? 'claude')) || (patch.reasoning && patch.reasoning !== before.reasoning)) board.notice(tr('msg.api.assistantBrain', { name: assistantName(), agent: info.agentLabel, label: info.modelLabel, reasoning: level }), 'info');
      return info;
    },
  };
  // clientId: a retry of the same message (same conversation) gets the first answer instead of a second message.
  const sent = createDedupe();
  const send = methods['chat.send'];
  methods['chat.send'] = (params, principal) => (params == null ? send(params, principal) : sent.once(`chat:${principal?.device ?? 'desktop'}:${conversationKey(params.conversation)}`, params.clientId, () => send(params, principal)));
  return methods;
}
