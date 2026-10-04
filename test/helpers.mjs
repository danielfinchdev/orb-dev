// Test helpers: a throwaway assistant folder with the fake agents configured.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome, loadConfig, writeJson, merge } from '../src/core/home.mjs';
import { useHome } from '../src/core/context.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fake = (name) => path.join(ROOT, 'test', 'fixtures', name);

export function tempHome(patch = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-test-'));
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Ana' });
  const config = merge(loadConfig(home), merge({ agents: { claude: { path: fake('fake-claude.mjs') }, codex: { path: fake('fake-codex.mjs') }, cursor: { enabled: false } } }, patch));
  writeJson(path.join(home, 'orb.json'), config);
  useHome(home);
  return { base, home, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(100); }
  throw new Error(`timeout: ${what}`);
}
