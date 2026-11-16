// Parts (src/domain/security/guard/): shell-text, roots, core-access, project-writes, protected-files, risks, describe.
// The guard of the live sessions: for every action an agent wants to take, allow it, ask the user or deny it.
// A plain deny list on the command line would stop useful work too.
// The balance: normal work flows without questions, risky actions wait for a click (Permitir / Denegar) and only
// what can never be right (touching the assistant's own data) is denied.
//
// Permission modes of a conversation or task:
//   leer       look only: reading and searching; anything that changes something is denied
//   editar     (default) edit files and run commands in its folder; risky commands ask first
//   preguntar  edit files; every command asks first (for when you want to watch closely)
//   auto       (the default) work without questions inside the project folder (its folder, core\preparacion and the
//              system's temporary folders): editing, deleting, wiping build folders, rewriting git history there, since the
//              task's checkpoint undoes it. Still asks for what leaves the folder or the PC: publishing (unless the user's own
//              message asked for it: userAsked), sending data, writing outside the project, the system, other processes.
//              Wiping a disk is denied.
//   total      no questions (asked once when chosen; never from the phone). In a chat without a project it is
//              «Acceso total al PC» (the master password, dropped when Orb locks: src/engine/security/grants.mjs). Whatever the
//              chat, «total» still goes through this guard: its boundary is the protected set (core but its open folders,
//              the folders kept outside it, the folder Orb is installed in, «Elementos protegidos» and raising privileges),
//              which is denied as in every other mode.
import { translate } from '../../shared/i18n.mjs';
import { ctx } from '../../platform/context.mjs';
import { isRailOn, riskRailOn } from '../rules/rails.mjs';
import { expandEnv, pathWords, unquoted } from './guard/shell-text.mjs';
import { personalRoots } from './guard/roots.mjs';
import { deletesProjectOrGit, insideProject, isGitRunsFile, projectRoots, resolveTarget, writesGitRunsFile, writesOutside, writesProjectFile } from './guard/project-writes.mjs';
import { copiesClosedParent, linkIntoCore, runsSkillScript, searchesClosedParent, touchesInternal } from './guard/core-access.mjs';
import { aliasesDrive, cleansIgnored, escalates, readsCredentialStore, risksOf, runsAdb } from './guard/risks.mjs';
import { AGENT_CONFIG_IN, isAgentConfig, otherSecret, protectedHitRail } from './guard/protected-files.mjs';
export { risksOf, riskOf, riskCategories, readsCredentialStore, escalates, aliasesDrive, runsAdb, pidKills } from './guard/risks.mjs';
export { localPath, setGuardedRoots, guardedRootsNow, setAppRoots, appRootsNow, defaultPersonalRoots, setPersonalRoots, personalRootsNow, isOrbData } from './guard/roots.mjs';
export { expandEnv, winPath, workDirs, unwrapShell, statements } from './guard/shell-text.mjs';
export { isAgentConfig, protectedList, protectedHit, protectedHitRail, touchesProtected, isSecretFile } from './guard/protected-files.mjs';
export { writesProjectFile, projectRoots, resolveTarget, insideProject, writesOutside, isGitRunsFile } from './guard/project-writes.mjs';
export { makesLink } from './guard/core-access.mjs';
export { plainAction, deleteTarget, looksEnglish, describeAction } from './guard/describe.mjs';

//   probar     (read-only tasks: reviews, verification) read and run commands (tests, the build, a dev server to
//              open in the browser), but change no file; risky commands ask first
export const PERMISSIONS = ['leer', 'probar', 'editar', 'preguntar', 'auto', 'total'];
// the two levels of the chat's switch (the others stay under «más opciones»): «Auto» and «Preguntar» (editar).
export const AUTONOMY = ['auto', 'preguntar'];
export const permissionOfAutonomy = (mode) => (mode === 'preguntar' ? 'editar' : 'auto');
// What a tool does, whatever the agent calls it (Claude tool names, Codex items, ACP kinds).
const READ = /^(read|glob|grep|ls|search|find|view|notebookread|webfetch|websearch|fetch|think|todowrite|todoread|task|agent|exitplanmode|skill|toolsearch|listmcpresources|readmcpresource|bashoutput|monitor)$/i;
const EDIT = /^(edit|write|multiedit|notebookedit|filechange|applypatch|edit_file|write_file|replace|move|delete|create)$/i;
const EXEC = /^(bash|shell|execute|commandexecution|command|run_shell_command|powershell|killshell|killbash|terminal)$/i;
export function toolClass(tool, kind) {
  const k = String(kind ?? '').toLowerCase();
  if (k === 'read' || k === 'search' || k === 'think' || k === 'fetch') return 'read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'edit';
  if (k === 'execute') return 'exec';
  const name = String(tool ?? '').replace(/^mcp__[^_]+__/, '');
  if (/^mcp__orb__|^orb[:_]/.test(String(tool))) return 'orb';
  if (/^mcp__/.test(String(tool))) return 'mcp';
  if (READ.test(name)) return 'read';
  if (EDIT.test(name)) return 'edit';
  if (EXEC.test(name)) return 'exec';
  return 'other';
}
// decide's answer when «Auto» lets through something «Preguntar» would have asked: auto: true, so the chat says so.
const autoAllow = (reason) => ({ decision: 'allow', reason, auto: true });
// Whether what an action names is one of the owner's personal credentials (only to word the reason).
function namesPersonal({ command, paths, patterns, cwd }) {
  const t = expandEnv(unquoted(command)).replace(/\//g, '\\').toLowerCase();
  if (personalRoots.some((r) => t.includes(r))) return true;
  return [...paths, ...patterns, ...pathWords(expandEnv(command))].some((w) => { const f = resolveTarget(w, cwd); return Boolean(f) && personalRoots.some((r) => f === r || f.startsWith(`${r}\\`)); });
}
// decide({ permission, tool, kind, command, paths, patterns, internalDir, cwd, lang, android, projectDir, userAsked })
// projectDir: the project's folder (the chat's or the task's, or its isolated copy; null in a chat without a
// project; not given: cwd). userAsked: what the user's own message for this turn or task asked for in so many words
// (['publish']: «súbelo», «haz push»), never taken from an agent's text (src/domain/security/approval.mjs › askedByUser).
export function decide({ permission = 'editar', tool, kind, command = '', paths = [], patterns = [], internalDir, cwd, lang = 'es', android = false, projectDir, userAsked = [] }) {
  const T = (k) => translate(lang, `msg.guard.${k}`);
  const cls = toolClass(tool, kind);
  const text = [command, ...paths, ...patterns].join(' ');
  const auto = permission === 'auto';
  // a paused rail lifts only its own block (the permission level still decides the rest).
  const protectedNow = (t) => protectedHitRail(t, isRailOn('rutas-protegidas'));
  if (linkIntoCore(command, internalDir, cwd)) return { decision: 'deny', reason: T('internalLink') };
  if (touchesInternal({ command, paths, patterns, internalDir, cwd, read: cls === 'read' })) {
    // the owner's personal credentials (keys, browsers, the agents' logins): their own reason.
    if (namesPersonal({ command, paths, patterns, cwd })) return { decision: 'deny', reason: T('credentials') };
    // only the general log in core (what a reading tool may see): the reason says how to write to it.
    const logsOnly = cls !== 'read' && !touchesInternal({ command, paths, patterns, internalDir, cwd, read: ['bitacora'] });
    // only the skills of core: a command (one of their scripts) asks first; changing them, never (an agent makes a
    // new version with orb_create_skill, which the user approves). «Auto» runs it (the user turned the skill on).
    const skillsOnly = cls !== 'read' && !logsOnly && !touchesInternal({ command, paths, patterns, internalDir, cwd, read: ['skills'] });
    if (skillsOnly && cls === 'exec' && permission !== 'leer' && !escalates(command) && !protectedNow(text) && runsSkillScript(command, internalDir, cwd)) return auto ? autoAllow(T('internalSkillsRun')) : { decision: 'ask', reason: T('internalSkillsRun') };
    return { decision: 'deny', reason: T(logsOnly ? 'internalLogs' : skillsOnly ? 'internalSkills' : 'internal') };
  }
  if (escalates(command)) return { decision: 'deny', reason: T('sudo') };
  if (readsCredentialStore(command)) return { decision: 'deny', reason: T('credentials') };
  if (cls !== 'read' && aliasesDrive(command)) return { decision: 'deny', reason: T('driveAlias') };
  if (cls !== 'read' && copiesClosedParent(command, internalDir, cwd)) return { decision: 'deny', reason: T('copyParent') };
  if (searchesClosedParent({ tool, cls, command, paths, cwd, internalDir })) return { decision: 'deny', reason: T('searchParent') };
  const hit = protectedNow(text);
  if (hit) return { decision: 'deny', reason: translate(lang, 'msg.guard.protected', { name: hit }) };
  const project = projectDir === undefined ? cwd : projectDir;
  const roots = projectRoots({ projectDir: project, internalDir });
  // another project's .env, keys or certificates: never (in every mode).
  const names = /^(glob|ls)$/i.test(String(tool ?? '').replace(/^mcp__[^_]+__/, ''));
  if (cls !== 'orb' && cls !== 'mcp' && otherSecret({ command, paths, patterns, cwd, roots, names })) return { decision: 'deny', reason: T('otherSecret') };
  // Android's adb by hand only with «Acceso total» and «Usar mi móvil Android» (android): otherwise the agent has
  // Orb's own tools (orb_android_*), which check the grant on every call.
  if (cls !== 'read' && cls !== 'orb' && isRailOn('usar-adb') && runsAdb(command) && !(permission === 'total' && android)) return { decision: 'deny', reason: T('adb') };
  // A paused risk rail only relaxes «Auto». «Preguntar» (editar), «Preguntar todo», «probar», «leer» and «total» keep
  // every risk (the first two ask anyway). Pausing «formatear-disco» never goes below asking, so that risk stays in the
  // list either way.
  const railsRelax = permission === 'auto';
  const allRisks = cls === 'exec' ? risksOf(command, lang) : [];
  const risks = allRisks.filter((r) => !railsRelax || r.category === 'diskWipe' || riskRailOn(r.category));
  if (cls === 'exec' && !risks.some((r) => r.category === 'gitRuns') && writesGitRunsFile(command, cwd)) risks.push({ category: 'gitRuns', reason: T('gitRuns') });
  const wipe = risks.find((r) => r.category === 'diskWipe');
  // wiping a disk: denied in «Auto», asked in the others (also «total»).
  if (wipe && permission !== 'leer') return auto && riskRailOn('diskWipe') ? { decision: 'deny', reason: wipe.reason } : { decision: 'ask', reason: wipe.reason };
  if (permission === 'total') return { decision: 'allow', reason: T('full') };
  if (cls === 'read' || cls === 'orb') return { decision: 'allow', reason: T('readOnlyTool') };
  if (permission === 'leer') return { decision: 'deny', reason: T('readOnlyChat') };
  if (permission === 'probar' && cls === 'edit') return { decision: 'deny', reason: T('testOnly') };
  if (cls === 'edit' && paths.some(isAgentConfig)) return { decision: 'ask', reason: T('agentConfig') };
  if (cls === 'edit' && paths.some((p) => isGitRunsFile(p, cwd))) return { decision: 'ask', reason: T('gitRuns') };
  // writing outside the project asks first in «Auto», «Preguntar» and «Preguntar todo».
  const outsideReason = (what) => translate(lang, 'msg.guard.outside', { what: String(what).slice(0, 120) });
  if (cls === 'edit') {
    const away = isRailOn('fuera-del-proyecto') ? paths.find((p) => !insideProject(p, cwd, roots)) : undefined;
    if (away !== undefined) return { decision: 'ask', reason: outsideReason(away) };
    return { decision: 'allow', reason: T('edits') };
  }
  if (cls === 'exec') {
    const away = permission === 'probar' ? null : writesOutside(command, cwd, roots);
    // «away» also keeps folder deletes and git rewrites inside the project in «Auto», so only the question is gated.
    const askAway = isRailOn('fuera-del-proyecto') ? away : null;
    if (auto) {
      // «Auto»: inside the project, deleting folders and rewriting git history go ahead (the checkpoint undoes them);
      // publishing only when the user's own message asked for it; the rest of the risky commands ask as before.
      const passes = (r) => ((r.category === 'deleteFolders' || r.category === 'gitRewrite') ? Boolean(roots) && !away
        : r.category === 'publish' ? (userAsked ?? []).includes('publish') : false);
      const asking = risks.find((r) => !passes(r));
      if (asking) return { decision: 'ask', reason: asking.reason };
      // what the checkpoint cannot bring back still asks: the project folder itself or its .git
      // (where the snapshots live), and git clean -x (ignored files, .env among them, are never in the snapshot).
      // Moving or renaming them too (`mv .git x` leaves no repository to undo from), whatever the command's risks.
      if (deletesProjectOrGit(command, cwd, project)) return { decision: 'ask', reason: T('checkpoint') };
      // (checked on the unfiltered risks: pausing «reescribir-git» must not drop this question)
      if (allRisks.some((r) => r.category === 'gitRewrite') && cleansIgnored(command)) return { decision: 'ask', reason: T('ignoredFiles') };
      if (AGENT_CONFIG_IN.test(command)) return { decision: 'ask', reason: T('agentConfig') };
      if (askAway) return { decision: 'ask', reason: outsideReason(askAway.what) };
      if (risks.length) return autoAllow(risks[0].category === 'publish' ? T('publishAsked') : risks[0].reason);
      return { decision: 'allow', reason: T('normalCommand') };
    }
    if (risks.length) return { decision: 'ask', reason: risks[0].reason };
    if (AGENT_CONFIG_IN.test(command)) return { decision: 'ask', reason: T('agentConfig') };
    // a read-only task must not write files. Running the tests or the build is fine, but a command that redirects
    // into a project file (echo >> BITACORA.md, Set-Content, Out-File…) outside a build folder asks first: with nobody to
    // answer, a task's permission times out and is denied, so the write never happens.
    if (permission === 'probar' && writesProjectFile(command)) return { decision: 'ask', reason: T('testWrite') };
    if (permission === 'preguntar') return { decision: 'ask', reason: T('runs') };
    if (askAway) return { decision: 'ask', reason: outsideReason(askAway.what) };
    return { decision: 'allow', reason: T('normalCommand') };
  }
  if (cls === 'mcp') return { decision: 'allow', reason: T('connector') };
  return { decision: permission === 'preguntar' ? 'ask' : 'allow', reason: T('otherTool') };
}
// the permission level everyone gets unless a chat or a task says otherwise (Ajustes › Agentes, orb.json
// permissions.mode): «auto» by default, «preguntar» when the owner chose it. A task without its own level takes this one.
export const globalAutonomy = () => (ctx.config?.permissions?.mode === 'preguntar' ? 'preguntar' : 'auto');
export const autonomyOf = (task) => (AUTONOMY.includes(task?.autonomy) ? task.autonomy : globalAutonomy());
