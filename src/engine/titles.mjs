// 3.2: the title of a new conversation, written by Orb. The quick one from the first message (core/titles.mjs) shows at
// once; then the lightest model of the conversation's own agent (its account, read-only, no tools) writes a concise one in
// a few seconds. If it cannot, the quick one stays.
import { ctx } from '../core/context.mjs';
import { account, defaultAccount, accountEnv } from '../core/accounts.mjs';
import { cleanTitle } from '../core/titles.mjs';
import { adapter, executable, installed } from '../agents/index.mjs';
import { chooseModel } from './catalog.mjs';

const TIMEOUT_MS = 60_000;

export async function autoTitle(board, { agent, account: accountId, text }) {
  // The test agents answer anything: the quick title stays (and no process starts for it).
  if (process.env.ORB_FAKE_AGENTS) return '';
  if (!installed(agent)) return '';
  const chosen = account(accountId);
  const acc = (chosen?.agent === agent ? chosen : null) ?? defaultAccount(agent) ?? { id: agent, agent };
  const light = agent === 'cursor' ? { model: null } : chooseModel(board, agent, 'simple', acc.id);
  const lang = ctx.config.language === 'en' ? 'English' : 'español';
  const prompt = `Escribe solo un título de 2 a 5 palabras, en ${lang}, para una conversación que empieza con este mensaje. Sin comillas, sin punto final y sin explicar nada.\n\nMensaje:\n${String(text).slice(0, 1200)}`;
  let live = null; let timer = null;
  try {
    live = adapter(agent).createLive({
      exe: executable(agent), cwd: ctx.paths.runs, model: light.model || (agent === 'claude' ? 'haiku' : null), reasoning: 'low', permission: 'leer',
      mcpServers: {}, env: { ...accountEnv(acc), ORB_HOME: ctx.home }, internalDir: ctx.paths.internal, lang: ctx.config.language,
      ...(agent === 'claude' ? { tools: { allowed: [], disallowed: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Task', 'Skill', 'Read', 'Glob', 'Grep'] } } : {}),
      onEvent: () => {}
    });
    const result = await Promise.race([live.send({ text: prompt }), new Promise((resolve) => { timer = setTimeout(() => resolve({ isError: true }), TIMEOUT_MS); })]);
    return result?.isError ? '' : cleanTitle(result.final || result.text);
  } catch { return ''; } finally { clearTimeout(timer); try { live?.close(); } catch { /* gone */ } }
}
