#!/usr/bin/env node
// Fake Claude Code for tests (started by the real Claude Agent SDK, src/agents/claude.mjs): writes how it was started
// (its arguments and environment) to FAKE_ARGS_FILE and quits, so a test can check what any process of the user could
// read on its command line.
import fs from 'node:fs';

if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({ args: process.argv.slice(2), env: process.env }));
process.exit(0);
