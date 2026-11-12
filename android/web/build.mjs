// Bundles the mini-games for the Android app: android/web -> android/app/src/main/assets/web/games.
// The game sources stay in src/ui/games (untouched); small shims stand in for the desktop app's store, i18n and music.
// Node modules come from ORB_NODE_MODULES, ../../orb-dev/node_modules or ./node_modules (first one that has vite).
// Run: node android/web/build.mjs   (not part of Gradle: the built bundle is committed).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const candidates = [process.env.ORB_NODE_MODULES, path.join(repo, '..', 'orb-dev', 'node_modules'), path.join(repo, 'node_modules')].filter(Boolean);
const NM = candidates.map((c) => path.resolve(c)).find((c) => fs.existsSync(path.join(c, 'vite', 'package.json')));
if (!NM) throw new Error(`vite not found; set ORB_NODE_MODULES (tried ${candidates.join(', ')})`);

const req = createRequire(path.join(NM, 'noop.js'));
const load = async (name) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(NM, name, 'package.json'), 'utf8'));
  const exp = pkg.exports?.['.'];
  const rel = (typeof exp === 'string' ? exp : exp?.import?.default ?? exp?.import ?? exp?.default) ?? pkg.module ?? pkg.main;
  return import(pathToFileURL(path.join(NM, name, typeof rel === 'string' ? rel : rel.default)).href);
};
const { build } = await load('vite');
const react = (await load('@vitejs/plugin-react')).default;
const tailwind = (await load('@tailwindcss/vite')).default;

// Only the games.* texts of the Spanish dictionary go into the bundle.
const es = (await import(pathToFileURL(path.join(repo, 'src/shared/locales/es.mjs')).href)).default;
const gamesEs = Object.fromEntries(Object.entries(es).filter(([k]) => k.startsWith('games.')));

const out = path.join(repo, 'android/app/src/main/assets/web/games');
const gen = path.join(here, '.gen');
fs.mkdirSync(gen, { recursive: true });
const posix = (p) => p.split(path.sep).join('/');
fs.writeFileSync(path.join(gen, 'app.css'), [
  `@import "${posix(path.join(NM, 'tailwindcss', 'index.css'))}";`,
  `@import "${posix(path.join(repo, 'src/ui/tokens.css'))}";`,
  `@source "${posix(path.join(repo, 'src/ui/games'))}";`,
  `@source "${posix(here)}";`,
  `@import "${posix(path.join(here, 'style.css'))}";`
].join('\n'));

const shim = (f) => path.join(here, 'shims', f);
const virtual = () => ({
  name: 'orb-games-dict',
  resolveId: (id) => (id === 'virtual:games-es' ? '\0games-es' : null),
  load: (id) => (id === '\0games-es' ? `export default ${JSON.stringify(gamesEs)};` : null),
  // The chess pieces live in src/ui/public; the bundle serves its own copy next to the page.
  transform: (code, id) => (id.endsWith('chess-pieces.jsx') ? code.replace(/(['"])\/juegos\/ajedrez\/rhosgfx\1/, '"./rhosgfx"') : null)
});

await build({
  root: here,
  configFile: false,
  base: './',
  logLevel: 'warn',
  plugins: [react(), tailwind(), virtual()],
  resolve: {
    alias: [
      { find: '@/lib/i18n.js', replacement: shim('i18n.js') },
      { find: '@/lib/store.js', replacement: shim('store.js') },
      { find: '@/lib/music.js', replacement: shim('music.js') },
      { find: '@/lib/utils.js', replacement: shim('utils.js') },
      { find: '@/lib/audio-context.js', replacement: shim('audio-context.js') },
      { find: /^(react|react-dom|lucide-react|clsx|tailwind-merge)(\/.*)?$/, replacement: `${posix(NM)}/$1$2` }
    ]
  },
  build: { outDir: out, emptyOutDir: true, target: 'chrome100', sourcemap: false, assetsInlineLimit: 0, cssCodeSplit: false }
});

fs.cpSync(path.join(repo, 'src/ui/public/juegos/ajedrez/rhosgfx'), path.join(out, 'rhosgfx'), { recursive: true });
let size = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else size += fs.statSync(p).size; } };
walk(out);
console.log(`games bundle: ${(size / 1024).toFixed(0)} KB in ${path.relative(repo, out)}`);
