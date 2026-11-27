// The assistant's reasoning level is stored so that Orb 3.8.9 can still read and save the file: the old field holds one of the
// four levels it knows, the real one lives in orchestrator.reasoningLevel.
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { saveConfig } from '../src/platform/config.mjs';
import { loadConfig } from '../src/platform/config-file.mjs';

const t = tempHome();
after(() => t.cleanup());
const OLD_VALIDATOR = ['low', 'medium', 'high', 'xhigh']; // orchestrator.reasoning check of src/platform/config.mjs in 3.8.9
const onDisk = () => JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8')).orchestrator;

test('minimal and max are stored as the nearest level 3.8.9 accepts', () => {
  for (const [level, old] of [['minimal', 'low'], ['max', 'xhigh'], ['high', 'high']]) {
    saveConfig({ orchestrator: { reasoning: level } });
    const o = onDisk();
    assert.ok(OLD_VALIDATOR.includes(o.reasoning), `${level} -> ${o.reasoning}`);
    assert.equal(o.reasoning, old);
    assert.equal(o.reasoningLevel, level);
    assert.equal(loadConfig(ctx.home).orchestrator.reasoning, level, 'read back as the real level');
    assert.equal(loadConfig(ctx.home).orchestrator.reasoningLevel, undefined);
  }
});

test('a stale real level left by 3.8.9 is ignored', () => {
  saveConfig({ orchestrator: { reasoning: 'max' } });
  const raw = JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8'));
  raw.orchestrator.reasoning = 'low'; // 3.8.9 saved a different choice
  fs.writeFileSync(ctx.paths.config, JSON.stringify(raw));
  assert.equal(loadConfig(ctx.home).orchestrator.reasoning, 'low');
});
