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
// The product's name lives in src/core/product.mjs and package.json: both must say the same.
const { PRODUCT } = await import(new URL('../src/core/product.mjs', import.meta.url));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const mismatch = [['productName', pkg.productName, PRODUCT.name], ['build.productName', pkg.build?.productName, PRODUCT.name], ['build.appId', pkg.build?.appId, PRODUCT.appId]].filter(([, a, b]) => a !== b);
for (const [k, a, b] of mismatch) { failed++; console.error(`✖ package.json ${k} = ${a}, pero src/core/product.mjs dice ${b}`); }
if (!mismatch.length) console.log(`✔ nombre del producto: ${PRODUCT.name} (${PRODUCT.appId})`);
process.exit(failed ? 1 : 0);
