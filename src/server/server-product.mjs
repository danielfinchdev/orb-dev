// 3.7, Orb Server as a product of its own: only bots (and their browser), the links with phones and Orbs, backups,
// people, the agents' sign-in and the server's administration. No programming: no projects, tasks, conversations with
// the assistant, God mode, whiteboard, workspaces or development agents. This file says which API methods the server
// has and which modules it must never load (test/server-product.test.mjs checks the engine's import graph). No engine
// imports here: the packaging script and the tests read it too.
import { PHONE_SET, ORB_SET, CONSOLE_SET, CONTROL_SET, FORWARD_SET } from '../core/policy.mjs';

export const PRODUCT_SERVER = 'server';
// The subsystems the server engine starts (src/server/engine-server.mjs).
export const SERVER_SUBSYSTEMS = Object.freeze(['bots', 'link', 'remote', 'backup', 'server-admin', 'agents-login', 'engines', 'update']);

// What the server's API answers. Everything else is refused before it is looked up.
const SERVER_METHOD = /^(app\.(state|lockState)$|config\.save$|bots\.|inbox\.|link\.|remote\.|backup\.|persons\.|shares\.|templates\.|server\.|vault\.|replica\.(status|sync)$|accounts\.|usage\.(get|byPerson)$|agents\.(status|check|login|loginCode|loginCancel|loginState)$|data\.(moveExport|moveStatus|moveUndo|moveKeepBoth|exportPerson|deletePerson)$|taller\.|browser\.live\.)/;
export const serverAllows = (method) => SERVER_METHOD.test(String(method ?? ''));
// The programming methods (for the sets below and the tests): what a phone of a PC may call and the server never.
export const PROGRAMMING_METHOD = /^(chat|conversations|tasks|sessions|projects|whiteboard|schedules|logs|activity|expert|opti|actions|installer|github|mcp|android|net|images|models|mentions|approvals|sidebar|control|system|centro)\./;
export const stripProgramming = (set) => new Set([...set].filter((m) => serverAllows(m) && !PROGRAMMING_METHOD.test(m)));
// The ceilings of each channel on the server: the app's, without the programming methods (authz.ceilingFor takes a
// principal's own ceiling first).
export const SERVER_SETS = Object.freeze({
  phone: stripProgramming(PHONE_SET), browser: stripProgramming(PHONE_SET), terminal: stripProgramming(PHONE_SET),
  orb: stripProgramming(ORB_SET), console: stripProgramming(CONSOLE_SET), control: stripProgramming(CONTROL_SET),
  forward: stripProgramming(FORWARD_SET)
});
export function serverCeiling(principal) {
  const ch = principal?.channel;
  if (ch === 'desktop' || ch === 'system' || ch === 'agent') return null; // the engine itself: its own rules
  if (['phone', 'browser', 'terminal', 'orb'].includes(ch) && principal.rights?.admin) return SERVER_SETS.console;
  if (ch === 'orb') return principal.confirmed !== false ? SERVER_SETS.orb : SERVER_SETS.phone;
  return SERVER_SETS[ch] ?? null;
}

// Modules of the app the server engine never loads (directly or through others). engine/bots.mjs still takes a few
// helpers from sessions.mjs and orchestrator.mjs (answerOf, toolStep, agentToken): those load (with what they import),
// but nothing of them is started.
export const PROGRAMMING_MODULES = Object.freeze([
  'src/engine/api.mjs', 'src/engine/engine.mjs', 'src/engine/scheduler.mjs', 'src/engine/whiteboard.mjs', 'src/engine/github.mjs', 'src/engine/expert.mjs',
  'src/engine/bridge.mjs', 'src/engine/android.mjs', 'src/engine/dev-control.mjs', 'src/engine/mentions.mjs', 'src/engine/mcp-folder.mjs',
  'src/engine/project-icons.mjs', 'src/engine/titles.mjs', 'src/core/schedules.mjs', 'src/core/network.mjs', 'src/main/main.mjs'
]);
