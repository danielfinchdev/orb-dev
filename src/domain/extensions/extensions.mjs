// skills and MCP servers live in core (the owner's definition: core\skills holds every skill, core\mcp every MCP
// server, the ones Orb installs and the ones the user writes). No engine imports: the engine, the agents' MCP server
// (src/mcp/server.mjs), «Ordenar carpetas» (core-folder.mjs) and the tests use it.
//   - What is there: listExtensions (Ajustes › Skills y MCP): each skill (its SKILL.md: name, description) and each server
//     folder (the command that starts it), with where it came from and whether it is on. orb.json keeps the state:
//     `skills` ([{ name, enabled, source }]) and `mcpServers` (the connectors, as before, with `source`). A folder with no
//     entry is off.
//   - How agents get the skills on (exposeSkills): core\skills\.activas is a Claude Code plugin made by Orb
//     (.claude-plugin\plugin.json + skills\<name>, a copy of core\skills\<name> for each skill that is on, never a junction,
//     its SKILL.md with a frontmatter Orb writes: only name and description). Claude gets it as a plugin (SDK `plugins`), Codex as an extra root of skills (app-server
//     `skills/extraRoots/set`); the other agents get the list (name, description, path of its SKILL.md) in their brief.
//     Agents read core\skills (src/domain/security/guard.mjs); nobody but Orb writes there.
//   - Bringing one in (importExtension): from a folder (copied) or a git repository (cloned, https only), checked
//     (checkSkill / checkMcp: SKILL.md with a valid name and description, or a server Orb knows how to start; no links
//     out, a size limit), always off until the user turns it on.
//   - Made by an agent (requests): orb_create_skill / orb_create_mcp give it a folder in core\preparacion (the only part of
//     core agents may write), it writes the files there and asks for it to be turned on (orb_request_activation): Orb
//     copies it then into a quarantine agents cannot write (core\datos\cuarentena\<id>), file by file, never following a
//     link, without dependencies, caches or the package managers' settings; the fingerprint and the list the user sees are
//     made from that copy, and «Activar» moves exactly that copy into core (its dependencies installed by Orb, with no
//     install scripts) and turns it on.
//   - Nothing runs while it comes in: no install scripts, no git hooks, no package manager settings of the folder.
//     Dependencies are installed only when the user turns a server on (npm with --ignore-scripts).
//   - Improving a server of core: editInProject copies it to a project folder (work there with any agent), applyEdit
//     puts it back (the version before stays in core\mcp\.anterior\<name>; a skill replaced by an agent's request, in
//     core\skills\.anterior\<name>).

export {
  SKILL_FILE, LIVE_DIR, OLD_DIR, REQUESTS, EDITS, PLUGIN_NAME, QUARANTINE, SKILL_NAME, MCP_NAME, DEP_DIRS, ExtensionError, extensionPaths, startCommand, isMcpProject, mcpDescription, skillMeta, needsDeps, localDep, linkOut, runProcess, installDeps,
} from './basics.mjs';
export {
  scanTree, copyTree, skillAsks, orbSkillText, checkSkill, checkMcp, kindOf, mcpNameOf, fingerprint, fileList, secretTest, gitignored, privateTest, holdsKeys, cleanGitConfig,
} from './checks.mjs';
export {
  listExtensions, skillsWith, mcpWith, connectorSafe, exposeSkills, skillsBrief, fetchInto, importExtension, removeExtension,
} from './catalog.mjs';
export {
  draftExtension, allowDraft, requestActivation, activateRequest, STALE_DAYS, cleanExtensionLeftovers, OPEN_PER_CONVERSATION, openRequestsOf, discardRequest, refreshStart, installFor, editInProject, compareTrees, prepareApply, applyEdit,
} from './drafts.mjs';
