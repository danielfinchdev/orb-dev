// Bundles the web pages of the Android app into android/app/src/main/assets/web/:
//   games       the mini-games (committed)
//   whiteboard  the Pizarra, i.e. Excalidraw (committed while small; see android/.gitignore)
// The game sources stay in src/ui/games (untouched); small shims stand in for the desktop app's store, i18n and music.
// Node modules come from ORB_NODE_MODULES, ../../orb-dev/node_modules or ./node_modules (first one that has vite).
// Run: node android/web/build.mjs [games|whiteboard]   (not part of Gradle: the built bundles are committed).
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

const posix = (p) => p.split(path.sep).join('/');

async function buildGames() {
  // Only the games.* texts of the Spanish dictionary go into the bundle.
  const es = (await import(pathToFileURL(path.join(repo, 'src/shared/locales/es.mjs')).href)).default;
  const gamesEs = Object.fromEntries(Object.entries(es).filter(([k]) => k.startsWith('games.')));

  const out = path.join(repo, 'android/app/src/main/assets/web/games');
  const gen = path.join(here, '.gen');
  fs.mkdirSync(gen, { recursive: true });
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
}

const dirSize = (d) => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } return n; };

// Excalidraw works offline: its fonts are copied next to the page (EXCALIDRAW_ASSET_PATH points there). Xiaolai (12 MB)
// is only the fallback of CJK text, so it stays out: the phone's page has no network to fetch it from anyway.
const SKIP_FONTS = new Set(['Xiaolai']);
async function buildWhiteboard() {
  const out = path.join(repo, 'android/app/src/main/assets/web/whiteboard');
  await build({
    root: path.join(here, 'whiteboard'),
    configFile: false,
    base: './',
    logLevel: 'warn',
    plugins: [react()],
    define: { 'process.env.NODE_ENV': '"production"' },
    resolve: { alias: [{ find: '@excalidraw/excalidraw/index.css', replacement: `${posix(NM)}/@excalidraw/excalidraw/dist/prod/index.css` }, { find: /^(react|react-dom|@excalidraw\/excalidraw)(\/.*)?$/, replacement: `${posix(NM)}/$1$2` }] },
    build: { outDir: out, emptyOutDir: true, target: 'chrome100', sourcemap: false, assetsInlineLimit: 0, cssCodeSplit: false, chunkSizeWarningLimit: 4000 }
  });
  const fonts = path.join(NM, '@excalidraw/excalidraw/dist/prod/fonts');
  for (const family of fs.readdirSync(fonts)) {
    if (!SKIP_FONTS.has(family)) fs.cpSync(path.join(fonts, family), path.join(out, 'excalidraw', 'fonts', family), { recursive: true });
  }
  console.log(`whiteboard bundle: ${(dirSize(out) / 1048576).toFixed(2)} MB in ${path.relative(repo, out)}`);
}

const which = process.argv[2];
if (!which || which === 'games') await buildGames();
if (!which || which === 'whiteboard') await buildWhiteboard();
