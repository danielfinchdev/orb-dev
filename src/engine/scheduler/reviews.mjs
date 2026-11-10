// Task Review and project reviews, and the isolated branches a user discards or merges.
// Part of the Scheduler (index.mjs adds these methods to it).
import { ctx, tr } from '../../platform/context.mjs';
import { enabledAgents } from '../../platform/config.mjs';
import { git } from '../../platform/git.mjs';
import { rankAccounts } from '../../domain/usage/budget.mjs';
import { installed } from '../../agents/index.mjs';
import { usableAccounts } from '../../domain/usage/accounts.mjs';
import { oneLine } from '../../shared/text.mjs';
import { label } from './common.mjs';

export class ReviewsPart {
  // Task Review: another model audits finished work, read-only, and gives a verdict (correct / with problems + the list).
  // It goes to a different provider when one is installed and has room (Claude's work is reviewed by Codex, Gemini…), else
  // to the same agent with a different model. scope: a task ({ task }) or a whole project ({ project }).
  reviewer(exclude = []) {
    const order = [...new Set([...(ctx.config.agentOrder ?? []), ...enabledAgents()])].filter((a) => enabledAgents().includes(a) && installed(a));
    const ranked = order.map((a) => ({ a, ok: usableAccounts(a).some((acc) => rankAccounts(this.board, [acc], null)[0]?.check.ok) }));
    return ranked.find((r) => r.ok && !exclude.includes(r.a))?.a ?? ranked.find((r) => r.ok)?.a ?? order[0] ?? null;
  }

  createReview(task, { actor = 'orb', agent: wanted = null, focus = '' } = {}) {
    const agent = wanted || this.reviewer([task.assigned_to ?? task.agent]);
    if (!agent) throw new Error(tr('msg.scheduler.noReviewer'));
    // Same agent: another model, so it is a second pair of eyes and not the same one twice.
    const models = ctx.config.agents[agent]?.models ?? [];
    // A task without a model ran with the agent's default one (Sonnet for Claude): that is the model to avoid. 2.7: with
    // Orb choosing models the task may have run with another one, so neither of them reviews it.
    const avoid = new Set([task.model, ctx.config.agents[agent]?.defaultModel].filter(Boolean));
    const model = agent === task.assigned_to ? models.find((m) => !avoid.has(m)) ?? null : null;
    const review = this.board.createTask({ project: task.project, title: tr('msg.scheduler.reviewTitle', { id: task.id, title: oneLine(task.title, 80) }), agent, model, readonly: true, mode: task.mode, depends_on: [task.id], review_of: task.id,
      description: `Eres el revisor (Task Review) del trabajo de la tarea #${task.id} «${oneLine(task.title)}», hecho por ${task.assigned_to ?? task.agent}${task.model ? ` (${task.model})` : ''}.
Encargo original: ${oneLine(task.description, 1500)}
Resultado que dejó: ${oneLine(task.result, 1500)}
${task.branch ? `Está en la rama ${task.branch}.` : 'Los cambios están en la carpeta del proyecto.'}${focus ? `\nFíjate sobre todo en: ${oneLine(focus, 500)}` : ''}
Comprueba que hace lo que se pedía, busca fallos, casos sin cubrir, riesgos de seguridad y código mejorable. Pruébalo de verdad: ejecuta las pruebas si las hay y, si es algo que se puede arrancar (una web, una app, un script), arráncalo; una web, ábrela con orb_browser_open y úsala. Puedes ejecutar comandos, pero NO cambies ningún archivo.
En result pon, en este orden: VEREDICTO: CORRECTO o CON FALLOS; después la lista de problemas concretos (archivo y qué falla) por gravedad; y al final qué arreglarías primero.` }, actor);
    this.board.notice(tr('msg.scheduler.reviewing', { agent: label(agent), model: model ? ` (${model})` : '', id: task.id, review: review.id }), 'info');
    return review;
  }

  // Task Review of a whole project: the latest changes (or the whole code if it is small), read-only, by another provider.
  // The project and who reviews it: the one asked for, or another provider than those of its last work (not its reviews).
  reviewerFor(projectName, wanted) {
    const project = this.board.project(projectName); if (!project) throw new Error(tr('msg.scheduler.noProject', { projectName }));
    const last = this.board.tasks({ project: project.name, status: 'done', limit: 5 }).filter((t) => !t.review_of);
    const agent = wanted || this.reviewer([...new Set(last.map((t) => t.assigned_to).filter(Boolean))]);
    if (!agent) throw new Error(tr('msg.scheduler.noReviewer'));
    return { project, last, agent };
  }

  reviewProject(projectName, { actor = 'usuario', agent: wanted = null, focus = '' } = {}) {
    const { project, last, agent } = this.reviewerFor(projectName, wanted);
    const review = this.board.createTask({ project: project.name, title: tr('msg.scheduler.reviewProjectTitle', { name: project.name }), agent, readonly: true, mode: 'carpeta',
      description: `Eres el revisor (Task Review) del proyecto ${project.name} (${project.path}).
${last.length ? `Últimas tareas hechas:\n${last.map((t) => `- #${t.id} ${oneLine(t.title)} (${t.assigned_to}): ${oneLine(t.result, 300)}`).join('\n')}` : 'Revisa el código del proyecto.'}${focus ? `\nFíjate sobre todo en: ${oneLine(focus, 500)}` : ''}
Audita con ojo crítico: errores, casos sin cubrir, seguridad, rendimiento, coherencia y calidad del código. Ejecuta las pruebas si las hay y, si se puede arrancar, arráncalo y pruébalo (una web, con orb_browser_open). Puedes ejecutar comandos, pero NO cambies ningún archivo.
En result pon, en este orden: VEREDICTO: CORRECTO o CON FALLOS; la lista de problemas concretos (archivo y qué falla) por gravedad; y qué arreglarías primero.` }, actor);
    this.board.notice(tr('msg.scheduler.reviewProjectChat', { name: project.name, agent: label(agent), review: review.id }), 'info');
    return review;
  }

  // 3.0: Security Review: a security audit of the whole project, read-only, by an agent with quota (another provider than
  // the one that did the last work, when there is one). It reports; it never changes or "fixes" anything.
  securityReview(projectName, { actor = 'usuario', agent: wanted = null } = {}) {
    const { project, agent } = this.reviewerFor(projectName, wanted);
    const review = this.board.createTask({ project: project.name, title: tr('msg.scheduler.securityTitle', { name: project.name }), agent, readonly: true, mode: 'carpeta', fixedBrief: true,
      description: `Eres el auditor de seguridad (Security Review) del proyecto ${project.name} (${project.path}).
Revisa todo el código y la configuración buscando vulnerabilidades reales y explotables, no estilo:
- secretos y credenciales en el código, en el historial de git o en archivos de configuración;
- inyección (SQL, comandos del sistema, rutas de archivo, plantillas), XSS y CSRF;
- autenticación, sesiones y permisos (quién puede hacer qué, comprobaciones que faltan);
- datos del usuario sin validar, deserialización insegura, eval y código dinámico;
- dependencias con vulnerabilidades conocidas (npm audit, pip-audit o lo que use el proyecto, sin instalar nada nuevo);
- cifrado débil, aleatoriedad predecible, cabeceras y CORS, registros que guardan datos sensibles.
NO cambies ningún archivo ni ejecutes nada que modifique el proyecto o el sistema.
En result pon, en este orden: VEREDICTO: SEGURO o CON RIESGOS; los hallazgos por gravedad (crítica, alta, media, baja), cada uno con archivo y línea, cómo se explotaría y cómo arreglarlo; y qué arreglarías primero.` }, actor);
    this.board.notice(tr('msg.scheduler.securityChat', { name: project.name, agent: label(agent), review: review.id }), 'info');
    return review;
  }

  // Deletes the isolated copy and branch of a finished task (the user decided not to keep it). 3.8.1: through dropCopy,
  // which also empties the task's branch, so Tareas stops offering «Unir / PR / Descartar» for a branch that is gone.
  discardBranch(taskId) {
    const task = this.board.task(taskId); if (!task?.branch) throw new Error(tr('msg.scheduler.noBranch'));
    if (this.running.has(task.id)) throw new Error(tr('msg.scheduler.taskRunning'));
    const project = this.board.project(task.project);
    this.board.event(task.id, 'usuario', 'branch.discarded', task.branch);
    this.dropCopy(task, project);
    return { ok: true };
  }
  // 3.8.1: a task's branch joined into its project's folder («Unir»): its copy and branch are not needed any more (they
  // used to stay for good, one per isolated task joined).
  branchMerged(projectName, branch) {
    const project = this.board.project(projectName);
    const row = project && this.board.one('SELECT id FROM tasks WHERE project = ? AND branch = ? ORDER BY id DESC LIMIT 1', project.name, branch);
    if (!row || this.running.has(row.id)) return;
    const task = this.board.task(row.id);
    this.board.event(task.id, 'usuario', 'branch.merged', branch);
    this.dropCopy(task, project);
  }
}
