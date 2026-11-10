// Syntax check of every source file (node --check), without running anything.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.(mjs|cjs|js)$/.test(e.name)) files.push(f); } };
walk('src'); walk('test'); walk('scripts');
let failed = 0;
for (const f of files) {
  // package.json says "type": "module", so .js files are checked as ES modules (Node 24 dropped --experimental-default-type).
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`✖ ${f}\n${r.stderr}`); }
}
console.log(failed ? `${failed} archivo(s) con errores` : `✔ ${files.length} archivos sin errores de sintaxis`);
// The product's name lives in src/shared/product.mjs, package.json and src-tauri/tauri.conf.json: all must say the same.
const { PRODUCT } = await import(new URL('../src/shared/product.mjs', import.meta.url));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const mismatch = [['package.json productName', pkg.productName, PRODUCT.name], ['tauri.conf.json productName', tauri.productName, PRODUCT.name], ['tauri.conf.json identifier', tauri.identifier, PRODUCT.appId]].filter(([, a, b]) => a !== b);
for (const [k, a, b] of mismatch) { failed++; console.error(`✖ ${k} = ${a}, pero src/shared/product.mjs dice ${b}`); }
if (!mismatch.length) console.log(`✔ nombre del producto: ${PRODUCT.name} (${PRODUCT.appId})`);
process.exit(failed ? 1 : 0);
