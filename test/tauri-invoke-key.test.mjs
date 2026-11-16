// Threat-model guard (docs/architecture/28-security.md): pages served from the `orbpage` scheme count as a local origin for
// Tauri, so the only thing keeping an agent's HTML page from calling window commands is that the invoke key is injected
// into the main frame only. This fails if Tauri is bumped without re-checking that, or if the crate no longer does it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

// The Tauri version whose manager/webview.rs was read and found to inject the invoke key for the main frame only.
const REVIEWED = '2.12.4';

const read = (...f) => fs.readFileSync(path.join(ROOT, ...f), 'utf8');

test('the Tauri pin is the version reviewed for the invoke-key barrier', () => {
  const pin = /^tauri = \{ version = "=([^"]+)"/m.exec(read('src-tauri', 'Cargo.toml'))?.[1];
  assert.equal(pin, REVIEWED, 'Tauri changed: re-check that the invoke-key init script is main-frame-only, then update REVIEWED and the note in docs/architecture/28-security.md');
  assert.match(read('src-tauri', 'Cargo.lock'), new RegExp(`name = "tauri"\r?\nversion = "${REVIEWED.replace(/\./g, '\\.')}"`));
});

test('the orbpage scheme is the one the threat-model note describes', () => {
  assert.match(read('src-tauri', 'src', 'pages.rs'), /pub const SCHEME: &str = "orbpage";/);
  assert.match(read('docs', 'architecture', '28-security.md'), /`orbpage` is a "local" origin/);
});

function tauriSource() {
  const homes = [process.env.CARGO_HOME, path.join(ROOT, '..', 'herramientas', 'cargo'), path.join(ROOT, 'herramientas', 'cargo'), path.join(os.homedir(), '.cargo')].filter(Boolean);
  for (const h of homes) {
    const reg = path.join(h, 'registry', 'src');
    if (!fs.existsSync(reg)) continue;
    for (const d of fs.readdirSync(reg)) {
      const f = path.join(reg, d, `tauri-${REVIEWED}`, 'src', 'manager', 'webview.rs');
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    }
  }
  return null;
}

test('Tauri injects the invoke key into the main frame only', (t) => {
  const src = tauriSource();
  if (!src) return t.skip('Tauri sources are not on disk');
  assert.match(src, /for_main_frame_only: true/);
  assert.match(src, /main_frame_script\(self\.invoke_initialization_script\.clone\(\)\)/);
  // The invoke key must never reach an init script that runs in every frame.
  assert.doesNotMatch(src, /for_main_frame_only: false/);
  assert.doesNotMatch(src, /InitializationScript \{\s*script: self\.invoke_initialization_script/);
});
