// 3.8 (F4): the phone's interface on an Android phone drawn edge to edge (Galaxy S23 Ultra review): where the app opens
// and where «back» goes, routes of screens that are gone, the PC switched off, requests that never wait forever, the
// status bar's room and the floating tab bar. The logic is pure (src/ui/lib/phone-nav.js, net.js); the rest is checked
// in the sources and the built CSS (no window is opened).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { cleanRoute, restoreRoute, backStep, keyboardOpen, PHONE_TABS } from '../src/ui/lib/phone-nav.js';
import { timedFetch, fetchWithin, isOffline, retryDelay, TIMEOUTS } from '../src/ui/lib/net.js';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PHONE_VIEWS = ['chat', 'session', 'tasks', 'projects', 'logs', 'activity', 'schedules', 'phone', 'tutorials', 'chats', 'more', 'board'];
const PC_VIEWS = ['chat', 'session', 'tasks', 'projects', 'agents', 'logs', 'activity', 'schedules', 'phone', 'tutorials', 'board', 'expert'];

test('rutas de pantallas que ya no existen (bots de 3.7, Orb Server…) van a los chats, nunca a una pantalla rota', () => {
  for (const view of ['bots', 'bot', 'bot-chat', 'bot-group', 'bot-server', 'server', 'connections', 'link', 'profile', 'persons']) {
    assert.deepEqual(cleanRoute({ view, id: 7 }, { views: PHONE_VIEWS, phone: true }), { view: 'chats' }, view);
    assert.deepEqual(cleanRoute({ view, id: 7 }, { views: PC_VIEWS, phone: false }), { view: 'chat' }, `${view} en el PC: un chat nuevo, sin el id del bot`);
  }
  assert.deepEqual(cleanRoute('bots', { views: PHONE_VIEWS, phone: true }), { view: 'chats' });
  assert.equal(cleanRoute({ view: 'inventada' }, { views: PHONE_VIEWS }), null);
  assert.equal(cleanRoute({ view: 'expert' }, { views: PHONE_VIEWS, phone: true }), null, 'el modo experto no existe en el móvil');
  assert.equal(cleanRoute(null), null); assert.equal(cleanRoute({ id: 3 }), null); assert.equal(cleanRoute(42), null);
  assert.deepEqual(cleanRoute({ view: 'tasks', id: 3 }, { views: PHONE_VIEWS }), { view: 'tasks', id: 3 });
  assert.deepEqual(cleanRoute({ view: 'settings', section: 'datos' }, { views: PC_VIEWS }), { view: 'settings', section: 'datos' }, 'Ajustes es una ventana, no una pantalla');
  // go() uses it (and an old notification goes through go()).
  assert.match(read('src/ui/lib/store.js'), /cleanRoute\(route, \{ views, phone: phoneLayout\(\) \}\)/);
  assert.match(read('src/ui/lib/notes.js'), /go\(route\)/);
});

test('al abrir: el móvil empieza en sus chats salvo un chat que sigue existiendo o una de sus pestañas', () => {
  const known = { views: PHONE_VIEWS, phone: true, sessions: [{ id: 's1' }], conversations: [{ id: 4 }] };
  assert.deepEqual(restoreRoute(null, known), { view: 'chats' });
  assert.deepEqual(restoreRoute('{"roto', known), { view: 'chats' });
  assert.deepEqual(restoreRoute({ view: 'chat', id: 4 }, known), { view: 'chat', id: 4 });
  assert.deepEqual(restoreRoute({ view: 'chat', id: 99 }, known), { view: 'chats' }, 'un chat borrado no atrapa');
  assert.deepEqual(restoreRoute({ view: 'chat' }, known), { view: 'chats' });
  assert.deepEqual(restoreRoute({ view: 'session', id: 's1' }, known), { view: 'session', id: 's1' });
  assert.deepEqual(restoreRoute({ view: 'session', id: 'nada' }, known), { view: 'chats' });
  assert.deepEqual(restoreRoute({ view: 'bot-chat', id: 3 }, known), { view: 'chats' }, 'el chat de un bot de 3.7');
  assert.deepEqual(restoreRoute({ view: 'bots' }, known), { view: 'chats' });
  for (const tab of PHONE_TABS) assert.deepEqual(restoreRoute({ view: tab, id: 5, name: 'x' }, known), { view: tab });
  assert.deepEqual(restoreRoute({ view: 'logs' }, known), { view: 'chats' });
  assert.deepEqual(restoreRoute({ view: 'settings' }, known), { view: 'chats' });
  // The PC reopens the last screen that still exists.
  const pc = { views: PC_VIEWS, phone: false, sessions: [], conversations: [{ id: 4 }] };
  assert.deepEqual(restoreRoute({ view: 'agents' }, pc), { view: 'agents' });
  assert.deepEqual(restoreRoute({ view: 'chat', id: 4 }, pc), { view: 'chat', id: 4 });
  assert.deepEqual(restoreRoute({ view: 'chat', id: 5 }, pc), { view: 'chat' });
  assert.deepEqual(restoreRoute({ view: 'server' }, pc), { view: 'chat' });
  assert.deepEqual(restoreRoute({ view: 'nada' }, pc), { view: 'chat' });
  // main.jsx uses it, and a screen that fails to draw forgets the saved route (components/error-boundary.jsx).
  const main = read('src/ui/main.jsx');
  assert.match(main, /restoreRoute\(saved, \{ views: Object\.keys\(VIEWS\), phone: phoneLayout\(\), sessions, conversations \}\)/);
  assert.equal((main.match(/<ErrorBoundary key=\{routeKey\(route\)\} onHome=\{resetRoute\}>/g) ?? []).length, 2, 'cada pantalla, en el móvil y en el PC');
  assert.match(main, /<ErrorBoundary onHome=\{\(\) => \{ resetRoute\(\); location\.reload\(\); \}\}><Root \/><\/ErrorBoundary>/, 'y la ventana entera');
  const boundary = read('src/ui/components/error-boundary.jsx');
  assert.match(boundary, /componentDidCatch[\s\S]*localStorage\.removeItem\('orb\.route'\)/);
  assert.match(boundary, /app\.crashHome/);
});

test('«atrás» de Android: cierra lo abierto, sube un nivel y solo sale desde los chats', () => {
  assert.deepEqual(backStep({ route: { view: 'chat', id: 3 }, overlay: true }), { close: true }, 'primero la hoja, el menú ☰ o el diálogo');
  assert.deepEqual(backStep({ route: { view: 'chat', id: 3 } }), { go: { view: 'chats' } });
  assert.deepEqual(backStep({ route: { view: 'session', id: 's' } }), { go: { view: 'chats' } });
  assert.deepEqual(backStep({ route: { view: 'tasks', id: 8 } }), { go: { view: 'tasks' } });
  assert.deepEqual(backStep({ route: { view: 'tasks', id: 8, project: 'web' } }), { go: { view: 'tasks', project: 'web' } });
  assert.deepEqual(backStep({ route: { view: 'tasks', project: 'web' } }), { go: { view: 'projects', name: 'web' } });
  assert.deepEqual(backStep({ route: { view: 'projects', name: 'web' } }), { go: { view: 'projects' } });
  for (const view of ['tasks', 'projects', 'logs', 'schedules', 'tutorials', 'phone', 'more']) assert.deepEqual(backStep({ route: { view } }), { go: { view: 'chats' } }, view);
  assert.deepEqual(backStep({ route: { view: 'chats' } }), { exit: true });
  assert.equal(backStep({ route: { view: 'tasks' }, phone: false }), null, 'el PC no tiene botón atrás');
  // The app hands Android's back to the page (OrbNativePlugin) and goes to the background on the first screen.
  const java = read('android-app/android/app/src/main/java/dev/orb/app/OrbNativePlugin.java');
  assert.match(java, /getOnBackPressedDispatcher\(\)\.addCallback\(getActivity\(\), new OnBackPressedCallback\(true\)/);
  assert.match(java, /if \(hasListeners\("back"\)\) \{\s*notifyListeners\("back", new JSObject\(\), false\);/);
  assert.match(java, /public void minimize\(PluginCall call\)[\s\S]*moveTaskToBack\(true\)/);
  // F5b (A3): the launch intent is replaced only after a share: a notification's action with the app closed reaches
  // the notifications plugin.
  assert.match(java, /if \(pending != null\) getActivity\(\)\.setIntent\(/);
  assert.equal(java.match(/setIntent\(/g).length, 1);
  const app = read('src/ui/lib/app-bridge.js');
  assert.match(app, /orb\.onBack = /); assert.match(app, /n\.addListener\('back'/); assert.match(app, /\.minimize\(\)/);
  const main = read('src/ui/main.jsx');
  assert.match(main, /bridge\.onBack\(\(\) => \{ if \(back\(\) === 'exit'\) bridge\.minimize\?\.\(\); \}\)/);
  assert.match(main, /app\.backExit/, '«Pulsa otra vez para salir»');
  assert.match(main, /window\.addEventListener\('popstate', pop\)/, 'el navegador del móvil también');
});

test('el teclado esconde la barra de pestañas flotante', () => {
  assert.equal(keyboardOpen({ editing: false, height: 400, fullHeight: 900 }), false);
  assert.equal(keyboardOpen({ editing: true, height: 500, fullHeight: 900 }), true);
  assert.equal(keyboardOpen({ editing: true, height: 880, fullHeight: 900 }), false, 'un campo con el foco y el teclado ya cerrado');
  assert.equal(keyboardOpen({ editing: true }), true);
  assert.match(read('src/ui/main.jsx'), /\{fullChat \|\| keyboard \? null : <MobileTabs \/>\}/);
});

test('peticiones del móvil con tiempo límite: un PC que no contesta es «sin conexión», no una espera de minutos', async () => {
  const never = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t0 = Date.now();
  const late = await timedFetch('http://pc/api/me', {}, 60, never).catch((e) => e);
  assert.ok(isOffline(late) && late.timeout === true, 'sin respuesta a tiempo');
  assert.ok(Date.now() - t0 < 2000);
  const refused = await timedFetch('http://pc/api/me', {}, 1000, async () => { throw new TypeError('Failed to fetch'); }).catch((e) => e);
  assert.ok(isOffline(refused) && refused.timeout === false, 'no conecta');
  assert.equal(await timedFetch('http://pc/api/me', {}, 1000, async (u, init) => ({ ok: true, url: u, signal: init.signal })).then((r) => r.ok), true);
  // The caller's own stop is not «offline»; once the headers are in, the limit no longer cuts the stream.
  const ctrl = new AbortController();
  const p = timedFetch('http://pc/api/events', { signal: ctrl.signal }, 5000, never);
  ctrl.abort(new Error('mine'));
  const mine = await p.catch((e) => e);
  assert.ok(!isOffline(mine) && mine.message === 'mine');
  const ctrl2 = new AbortController();
  const res = await timedFetch('http://pc/api/events', { signal: ctrl2.signal }, 30, async (u, init) => ({ signal: init.signal }));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(res.signal.aborted, false, 'el tiempo límite es solo hasta las cabeceras');
  ctrl2.abort();
  assert.equal(res.signal.aborted, true, 'pero quien lee el flujo lo puede cortar');
  assert.ok(isOffline(await fetchWithin(40, never)('http://pc/api/pair', {}).catch((e) => e)));
  assert.deepEqual([0, 1, 2, 3, 10].map(retryDelay), [3000, 6000, 12000, 24000, 30000]);
  assert.ok(TIMEOUTS.call >= 30_000 && TIMEOUTS.me <= 10_000 && TIMEOUTS.upload >= 60_000);
  // Every request of the phone's bridge goes through them (no bare fetch left), and linking too.
  const web = read('src/ui/lib/web-bridge.js');
  assert.doesNotMatch(web.replace(/timedFetch\(/g, '').replace(/fetchWithin\(/g, ''), /\bfetch\(/, 'ningún fetch sin tiempo límite');
  assert.match(web, /C\.linkDevice\(\{[^}]*fetch: fetchWithin\(TIMEOUTS\.pair\)/);
  assert.match(web, /TIMEOUTS\.events/); assert.match(web, /TIMEOUTS\.upload, \{ once: true \}/);
  assert.match(web, /\{ once: kind !== 'me' \}/, 'una llamada que cambia algo no se repite en otra dirección');
});

test('PC apagado: pantalla tranquila que reintenta, nunca «No se pudo iniciar Orb»', () => {
  const web = read('src/ui/lib/web-bridge.js');
  assert.match(web, /if \(isOffline\(e\)\) return \{ mobile: true, needsSetup: false, offline: true, pcName: saved\?\.name \?\? null/);
  assert.match(web, /fire\(ok \? 'link:online' : 'link:offline', \{\}\)/);
  const main = read('src/ui/main.jsx');
  assert.match(main, /if \(info\.offline\) return alive && setPhase\('offline'\)/);
  assert.match(main, /if \(bridge\.mobile && isOffline\(e\)\)/, 'también si se cae mientras arranca');
  assert.match(main, /<PcOffline info=/);
  assert.match(main, /retryDelay\(tries\.current\+\+\)/);
  assert.match(main, /window\.addEventListener\('online', soon\)/);
  assert.match(main, /data-testid="link-down"/, 'y un aviso fino si se cae con la app abierta');
});

test('la barra de estado: el hueco lo deja la página, no cada cabecera; nada pulsable debajo', () => {
  const css = fs.readdirSync(path.join(ROOT, 'src/renderer/assets')).filter((f) => f.endsWith('.css')).map((f) => read(`src/renderer/assets/${f}`)).join('\n');
  assert.match(css, /#root\{[^}]*padding-top:env\(safe-area-inset-top,0px\)/, 'en el CSS compilado');
  // glass.css (Android only) no longer overrides a bar's own top padding with less than the status bar…
  const glass = read('src/ui/glass.css');
  assert.doesNotMatch(glass, /topbar[^{]*\{[^}]*padding-top/);
  // …because no bar adds it twice.
  for (const f of ['src/ui/components/page.jsx', 'src/ui/components/chat-bar.jsx']) assert.doesNotMatch(read(f), /safe-area-inset-top/, f);
  // The invisible strip that moves the PC's window is not on a phone (it took the taps at the top).
  assert.match(read('src/ui/main.jsx'), /const strip = bridge\.mobile \? null :/);
  assert.doesNotMatch(read('src/ui/components/update-needed.jsx'), /app-titlebar fixed/);
  // Notifications below the status bar; sheets never reach it.
  assert.match(read('src/ui/main.jsx'), /mobileOffset=\{\{ top: 'calc\(env\(safe-area-inset-top, 0px\) \+ 64px\)' \}\}/);
  assert.match(glass, /max-height: min\(90dvh, calc\(100dvh - env\(safe-area-inset-top, 0px\) - 12px\)\)/);
  // The menu ☰ and the full sheets keep clear of it themselves (they are outside #root).
  assert.match(read('src/ui/components/mobile-menu.jsx'), /pt-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\]/);
});

test('la barra de pestañas flotante va en el flujo: ninguna lista acaba debajo de ella', () => {
  const glass = read('src/ui/glass.css');
  const tabs = glass.match(/html\.glass \.mobile-tabs \{([^}]*)\}/)[1];
  assert.match(tabs, /position: relative/); assert.doesNotMatch(tabs, /position: absolute/);
  assert.doesNotMatch(glass, /--dock-space/, 'sin el relleno «mágico» que dependía de una clase');
  assert.match(glass, /\.composer-dock \{[^}]*padding-bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 10px\)/, 'un chat (sin pestañas) solo deja el hueco del gesto');
});

test('Tareas y Proyectos en el móvil: pestañas que no se cortan, filas legibles, sin rutas de Windows ni fila marcada', () => {
  const app = read('src/ui/app.css');
  assert.match(app, /@media \(pointer: coarse\) \{ ::-webkit-scrollbar \{ display: none; \}/, 'sin barras grises en una pantalla táctil');
  const tasks = read('src/ui/views/tasks.jsx');
  assert.match(tasks, /className=\{phone \? 'h-auto w-full flex-wrap gap-1' : undefined\}/, 'los filtros pasan a otra línea');
  assert.match(tasks, /line-clamp-2/, 'el título en dos líneas');
  assert.match(tasks, /if \(phone && route\.id != null\) return/, 'la tarea en su pantalla');
  assert.match(tasks, /<PageBody/, 'con overflow-x-hidden');
  const projects = read('src/ui/views/projects.jsx');
  assert.match(projects, /bridge\.mobile \? null : <PathText path=\{p\.path\}/);
  assert.match(projects, /bridge\.mobile \? <CardDescription[^>]*>\{t\(`comp\.projects\.category\.\$\{p\.category \?\? 'other'\}`\)\} › \{baseName\(p\.path\)\}/);
  assert.match(projects, /useState\(route\.name \?\? \(phone \? null :/, 'sin selección por defecto en el móvil');
  assert.match(projects, /!phone && selected === p\.name && 'bg-accent'/);
});

test('«Cosas que nadie toca»: quitar uno de serie pide confirmación y se pueden restaurar', async () => {
  const { DEFAULT_PROTECTED } = await import('../src/core/layout.mjs');
  const home = await import('../src/core/home.mjs');
  assert.equal(home.DEFAULT_PROTECTED, DEFAULT_PROTECTED, 'una sola lista, también para la ventana');
  assert.ok(DEFAULT_PROTECTED.includes('vaultwarden'));
  const s = read('src/ui/views/settings.jsx');
  assert.match(s, /if \(isDefault\(x\) && !await confirm\(t\('settings\.protectedRemoveTitle', \{ name: x \}\)/);
  assert.match(s, /store\(\[\.\.\.list, \.\.\.missing\]\)/);
  assert.match(s, /settings\.protectedDefaults/);
});
