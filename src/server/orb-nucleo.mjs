#!/usr/bin/env node
// 3.5, Orb Núcleo: the command the server runs (by hand or from systemd, orb-nucleo.service).
//   orb-nucleo [--home <carpeta>] [--papel centro|todo|taller]   start the engine and keep it running
//   orb-nucleo estado [--home <carpeta>]                    start, print app.state in short and stop (a quick check)
//   orb-nucleo entrar <claude|codex|cuenta> [--home …]      sign an agent's account in from this terminal (link + code)
//   orb-nucleo enlazar [--home <carpeta>] [--no-esperar]    a Magic Link QR (drawn in the terminal), short code and address,
//                                                           so a phone, another Orb or a terminal can link to a server
//                                                           without a screen; waits until one links (or the code expires)
//   orb-nucleo --version
// The Orb folder: --home, else ORB_HOME, else ~/orb. Its log: <home>/.orb/ejecuciones/nucleo.log (and the console).
// While it runs, the same user's commands reach it through a local socket (src/server/control.mjs).
import readline from 'node:readline';
import { createHost, prepareHome, defaultHome, packageVersion } from './host.mjs';
import { serveControl, controlCall } from './control.mjs';
import { qrTerminal } from '../core/qr.mjs';
import { translator, painter } from '../terminal/render.mjs';

function parse(argv) {
  const o = { command: 'run', home: null, profile: null, account: null, wait: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--home') o.home = argv[++i];
    else if (a.startsWith('--home=')) o.home = a.slice(7);
    else if (a === '--papel' || a === '--profile') o.profile = argv[++i];
    else if (a === '--version' || a === '-v') o.command = 'version';
    else if (a === '--help' || a === '-h') o.command = 'help';
    else if (a === '--no-esperar' || a === '--no-wait') o.wait = false;
    else if (a === 'estado' || a === 'status') o.command = 'status';
    else if (a === 'enlazar' || a === 'link' || a === 'pair') o.command = 'link';
    // 3.5 «Solo Orb»: the sign-in without a screen: the link and the code are printed, Claude's code is pasted here.
    else if (a === 'entrar' || a === 'login') { o.command = 'login'; o.account = argv[++i]; if (!o.account) throw new Error('falta la cuenta: orb-nucleo entrar claude'); }
    else throw new Error(`no entiendo «${a}» (prueba --help)`);
  }
  return o;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The QR, the short code and the address of this server, and the wait for a device to use them. With the service
// running, through its local socket; otherwise the engine is started just for this (and the wait is needed).
async function linkDevice(home, o, version) {
  const t = translator(); const p = painter();
  let call; let own = null;
  try { await controlCall(home, 'app.state', {}, { timeoutMs: 5000 }); call = (m, params) => controlCall(home, m, params); }
  catch {
    console.log(p.dim(t('term.nucleo.ownEngine')));
    own = createHost({ home, version, echo: false });
    await own.start();
    call = (m, params) => own.call(m, params);
  }
  let code = 0;
  const stop = async () => { if (own) { const h = own; own = null; await h.stop(); } };
  const onSignal = () => { stop().finally(() => process.exit(130)); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const known = new Set((await call('link.devices')).map((d) => d.id));
    const q = await call('link.qr', { admin: true }); // the first device linked here may administer this server
    console.log(`\n${p.bold(t('term.nucleo.title', { name: q.name }))}\n`);
    console.log(qrTerminal(q.url, { color: p.on }));
    console.log(`\n${t('term.nucleo.scan')}`);
    console.log(`  ${p.bold(t('term.nucleo.code', { code: q.code }))}`);
    console.log(`  ${t('term.nucleo.address', { address: q.address })}`);
    console.log(`  ${p.dim(t('term.nucleo.command', { cmd: `orb enlazar ${q.code} ${q.address}` }))}`);
    console.log(`  ${p.dim(q.url)}`);
    console.log(p.dim(t('term.nucleo.expires', { min: Math.max(1, Math.round((q.expiresAt - Date.now()) / 60_000)) })));
    if (!o.wait && !own) return 0;
    console.log(p.dim(t('term.nucleo.waiting')));
    for (;;) {
      await wait(1000);
      const fresh = (await call('link.devices')).find((d) => !known.has(d.id));
      if (fresh) { console.log(p.green(t('term.nucleo.linked', { name: fresh.name }))); break; }
      if (Date.now() > q.expiresAt) { console.log(p.yellow(t('term.nucleo.expired'))); code = 1; break; }
    }
  } finally {
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    await stop();
  }
  return code;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const version = packageVersion();
  if (o.command === 'version') { console.log(version); return; }
  if (o.command === 'help') { console.log('orb-nucleo [--home <carpeta>] [--papel centro|todo|taller] | estado | entrar <claude|codex|cuenta> | enlazar [--no-esperar] | --version'); return; }
  const home = prepareHome(o.home ? o.home : defaultHome(), { profile: o.profile });
  if (o.command === 'link') { process.exit(await linkDevice(home, o, version)); }
  let onLogin = () => {};
  const host = createHost({ home, version, echo: o.command === 'run', onEvent: (event, payload) => { if (event === 'agents:login') onLogin(payload); } });
  let control = null;
  let closing = false;
  const close = async (why) => {
    if (closing) return; closing = true;
    host.log(`cerrando (${why})`);
    await control?.close().catch(() => {});
    const r = await host.stop();
    process.exit(r.clean ? (process.exitCode ?? 0) : 1);
  };
  process.on('SIGTERM', () => close('SIGTERM'));
  process.on('SIGINT', () => close('SIGINT'));
  process.on('SIGHUP', () => close('SIGHUP'));
  const info = await host.start();
  if (o.command === 'status') {
    const s = await host.call('app.state');
    const remote = await host.call('remote.status').catch(() => null);
    console.log(JSON.stringify({ version: s.version, home: s.home, role: s.role, name: info.name, agents: s.agentsAvailable, remote: remote ? { running: remote.running, routes: remote.routes?.map((r) => r.url), error: remote.error } : null }, null, 2));
    await close('estado');
    return;
  }
  if (o.command === 'run') {
    // The local door for «orb-nucleo enlazar» while the service runs.
    control = serveControl({ home, call: (m, params) => host.call(m, params), log: host.log });
    const where = await control.ready;
    if (where) host.log(`control local en ${where}`);
    return;
  }
  if (o.command === 'login') {
    const r = await host.call('agents.login', { account: o.account, mode: 'device' }).catch((error) => { console.error(error.message); return null; });
    if (!r) return close('entrar');
    console.log(`Abre este enlace en el móvil o en otro PC e inicia sesión:
  ${r.url}`);
    if (r.code) console.log(`Código: ${r.code}`);
    let rl = null;
    if (r.needsCode) {
      console.log('Si la página te muestra un código, pégalo aquí y pulsa Intro:');
      rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => { if (line.trim()) host.call('agents.loginCode', { id: r.id, code: line.trim() }).catch((error) => console.error(error.message)); });
    }
    await new Promise((resolve) => {
      onLogin = (p) => {
        if (p.id !== r.id || p.state === 'esperando') { if (p.id === r.id && p.message) console.log(p.message); return; }
        console.log(p.message ?? p.state); process.exitCode = p.state === 'hecho' ? 0 : 1; resolve();
      };
    });
    rl?.close();
    await close('entrar');
  }
}

main().catch((error) => { console.error(`Orb Núcleo: ${error.message}`); process.exit(1); });
