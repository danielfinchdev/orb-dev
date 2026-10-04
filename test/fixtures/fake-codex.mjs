#!/usr/bin/env node
// Fake Codex CLI for tests (exec --json events).
import fs from 'node:fs';
const require_fs = () => fs;
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.0.0-falso'); process.exit(0); }
let input = ''; process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  // Leaves the CODEX_HOME it got in its working folder (the agent's environment is cleaned, so tests read it from there).
  require_fs().appendFileSync('.fake-codex-home', `${process.env.CODEX_HOME ?? '(sin CODEX_HOME)'}\n`);
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const resume = args[1] === 'resume';
  out({ type: 'thread.started', thread_id: resume ? args[args.length - 2] : '11111111-2222-3333-4444-555555555555' });
  out({ type: 'turn.started' });
  out({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress' } });
  out({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'bash -lc ls', aggregated_output: 'a.txt\n', exit_code: 0, status: 'completed' } });
  out({ type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'a.txt', kind: 'update' }], status: 'completed' } });
  out({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: `Codex ${resume ? 'sigue' : 'empieza'}: ${input.split('\n')[0].slice(0, 60)}` } });
  out({ type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 7 } });
});
