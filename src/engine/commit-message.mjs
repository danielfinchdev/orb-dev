// The message of «Hacer commit…», written by the lightest model of the assistant's own agent (read-only, no tools), in the
// style chosen in Ajustes › Agentes. When no model can answer (none installed, a timeout, test agents) the message is
// guessed from the file names, so the dialog always has something to edit. It never commits: the user does.
import { ctx } from '../platform/context.mjs';
import { account, defaultAccount, accountEnv } from '../domain/usage/accounts.mjs';
import { adapter, executable, installed } from '../agents/index.mjs';
import { chooseModel } from './usage/catalog.mjs';
import { redactSecrets } from '../shared/secrets-scan.mjs';
import { cleanCommitMessage, commitPrompt, fallbackMessage, COMMIT_STYLES } from '../shared/commit-message.mjs';

const TIMEOUT_MS = 60_000;

async function viaAgent(board, prompt) {
  const brain = ctx.config.orchestrator ?? {};
  const agent = brain.agent || 'claude';
  if (!installed(agent)) return '';
  const chosen = account(brain.account);
  const acc = (chosen?.agent === agent ? chosen : null) ?? defaultAccount(agent) ?? { id: agent, agent };
  const light = agent === 'cursor' ? { model: null } : chooseModel(board, agent, 'simple', acc.id);
  let live = null; let timer = null;
  try {
    live = adapter(agent).createLive({
      exe: executable(agent), cwd: ctx.paths.runs, model: light.model || (agent === 'claude' ? 'haiku' : null), reasoning: 'low', permission: 'leer',
      mcpServers: {}, env: accountEnv(acc), internalDir: ctx.paths.internal, lang: ctx.config.language,
      ...(agent === 'claude' ? { tools: { allowed: [], disallowed: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Task', 'Skill', 'Read', 'Glob', 'Grep'] } } : {}),
      onEvent: () => {}
    });
    const result = await Promise.race([live.send({ text: prompt }), new Promise((resolve) => { timer = setTimeout(() => resolve({ isError: true }), TIMEOUT_MS); })]);
    return result?.isError ? '' : String(result.final || result.text || '');
  } catch { return ''; } finally { clearTimeout(timer); try { live?.close(); } catch { /* gone */ } }
}

// files: [{ path, status, risky }] as github.mjs › changedFiles; context: github.mjs › commitContext. ask(prompt) → text
// is a seam for tests (a simulated agent).
export async function suggestCommitMessage(board, { files, context, ask = null }) {
  const cfg = ctx.config.git ?? {};
  const style = COMMIT_STYLES.includes(cfg.commitStyle) ? cfg.commitStyle : 'conventional';
  const usable = (files ?? []).filter((f) => !f.risky);
  const fallback = fallbackMessage(usable, style);
  if (!usable.length) return { message: '', source: 'none', style };
  const prompt = commitPrompt({ style, instructions: cfg.commitInstructions, recent: context?.recent ?? [], names: context?.names ?? usable.map((f) => f.path), stat: context?.stat, diff: context?.diff, lang: 'English' });
  let raw = '';
  try { raw = ask ? await ask(prompt) : (process.env.ORB_FAKE_AGENTS ? '' : await viaAgent(board, prompt)); } catch { raw = ''; }
  const message = cleanCommitMessage(redactSecrets(raw));
  return message ? { message, source: 'model', style } : { message: fallback, source: 'guess', style };
}
