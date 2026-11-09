// Shared steps of the e2e scripts (test/*.e2e.mjs only; the unit tests never load this). 3.8:
// - sandboxEnv: what keeps a launched Orb (test/fixtures/launch-orb.mjs) away from this PC's real folders.
// - throughStart: every screen between the welcome (or the start of an updated Orb) and the app itself: «Ordenar
//   carpetas» (views/layout.jsx, only when there is something to move), «Crea tu contraseña maestra» (views/master.jsx,
//   mandatory) and, on Windows after the welcome, «Preparando tu PC» (views/setup.jsx › Prepare).
// - createMaster: the master password screen: both fields, the box «Si la olvidas…», continue.
// - pairBrowser: a phone's or a computer's browser opened from the QR: the PC's master password before it links
//   (main.jsx › BrowserPair; the two-step /api/pair of src/shared/mobile-crypto.mjs › linkDevice).
// Works with any Playwright Page (Orb's window over CDP, a headless browser).
import assert from 'node:assert/strict';
import path from 'node:path';
import { TEST_MASTER } from './phone-client.mjs';

export { TEST_MASTER };

// The backups (%LOCALAPPDATA%\Orb\copias), the 3.7 bridge folder (%LOCALAPPDATA%\OrbPuente) and adb stay out of the test.
export const sandboxEnv = (tmp) => ({ ORB_NO_ADB: '1', ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente') });

const SCREENS = { layout: '[data-testid=layout-review]', master: '[data-testid=master-create]', prepare: '[data-testid=setup-prepare]' };

// thorough: also the strength meter, a repeat that does not match and the button waiting for the box.
export async function createMaster(page, { password = TEST_MASTER, thorough = false } = {}) {
  assert.ok([...password].length >= 10, 'MASTER_MIN: at least 10 characters');
  await page.waitForSelector(SCREENS.master);
  const ok = page.locator('[data-testid=master-create-ok]');
  if (thorough) {
    await page.fill('[data-testid=master-new]', 'corta');
    await page.locator('[data-testid=master-strength]').waitFor();
    assert.ok(await ok.isDisabled(), 'a short password cannot be created');
  }
  await page.fill('[data-testid=master-new]', password);
  if (thorough) {
    await page.fill('[data-testid=master-again]', `${password}x`);
    await page.locator('[data-testid=master-create] [role=alert]').waitFor();
    assert.ok(await ok.isDisabled(), 'the repeat must match');
  }
  await page.fill('[data-testid=master-again]', password);
  assert.ok(await ok.isDisabled(), 'not without ticking «Entiendo que Orb no puede mostrármela si la olvido»');
  await page.click('[data-testid=master-ack]');
  assert.equal(await page.getAttribute('[data-testid=master-ack]', 'data-state'), 'checked');
  await ok.click();
  await page.locator(SCREENS.master).waitFor({ state: 'detached', timeout: 20000 });
}

// ready: the selector of the app itself. onScreen(name, page): before each screen is passed (e.g. a screenshot); name is
// 'layout', 'master' or 'prepare'. layout: 'apply' (the choices it proposes) or 'keep' («Dejar todo como está»).
// → the screens seen, in order.
export async function throughStart(page, { ready = '[data-testid=sidebar-home]', password = TEST_MASTER, onScreen = null, layout = 'apply', thorough = false, timeout = 60000 } = {}) {
  const seen = [];
  const any = page.locator([ready, ...Object.values(SCREENS)].join(', ')).first();
  const end = Date.now() + timeout;
  for (;;) {
    if (Date.now() > end) throw new Error(`no llegó la app (pantallas: ${seen.join(' → ') || 'ninguna'})`);
    await any.waitFor({ timeout: Math.max(1000, end - Date.now()) });
    let name = null;
    for (const [k, sel] of Object.entries(SCREENS)) if (await page.locator(sel).isVisible().catch(() => false)) { name = k; break; }
    if (!name) {
      if (await page.locator(ready).first().isVisible().catch(() => false)) return seen;
      await page.waitForTimeout(200); continue; // between two screens (a reload)
    }
    if (seen.at(-1) === name) { await page.waitForTimeout(200); continue; } // still closing
    seen.push(name);
    if (onScreen) await onScreen(name, page);
    if (name === 'layout') {
      await page.click(layout === 'keep' ? '[data-testid=layout-keep-all]' : '[data-testid=layout-apply]');
      await page.locator(SCREENS.layout).waitFor({ state: 'detached', timeout: 20000 });
    } else if (name === 'master') {
      await createMaster(page, { password, thorough });
    } else {
      await page.click('[data-testid=setup-continue]');
      await page.locator(SCREENS.prepare).waitFor({ state: 'detached', timeout: 20000 });
    }
  }
}

// url: the QR's link opened on this page's own server. fp: the PC's fingerprint (link.qr / remote.pair › pc), checked
// against what the page shows. With the QR there is nothing to confirm; only a typed short code (the Android app) asks
// for «Coincide con la del PC» first, and that box is ticked here too if it shows. ready: the app's selector after the
// link (the page reloads itself).
export async function pairBrowser(page, url, { password = TEST_MASTER, fp = null, ready = null, onScreen = null, wrongFirst = false } = {}) {
  await page.goto(url);
  await page.waitForSelector('[data-testid=browser-pair] [data-testid=pair-password-input]', { timeout: 20000 });
  assert.equal(await page.locator('[data-testid=pair-http]').count(), 0, 'loopback is not plain http over the Wi-Fi');
  if (fp) assert.ok((await page.textContent('[data-testid=pair-fp]')).toLowerCase().includes(String(fp).toLowerCase()), 'the fingerprint of the PC on screen');
  if (onScreen) await onScreen('pair', page);
  if (await page.locator('[data-testid=pair-fp-ok]').count()) await page.click('[data-testid=pair-fp-ok]');
  const input = page.locator('[data-testid=pair-password-input]');
  if (wrongFirst) {
    // A wrong password does not use the code up (five per code): it says so and the same screen stays.
    await input.fill('esta no es la contraseña');
    await input.press('Enter');
    await page.locator('[data-testid=pair-password] [role=alert]').waitFor({ timeout: 20000 });
  }
  await input.fill(password);
  await input.press('Enter');
  if (ready) await page.waitForSelector(ready, { timeout: 30000 });
}
