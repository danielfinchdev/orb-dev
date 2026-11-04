#!/usr/bin/env node
// 3.5, Orb en la terminal: the fourth way into Orb (with the desktop app, the phone and the browser). Plain Node 22, no
// native modules. It links to an Orb with Magic Link like a phone does (kind «terminal»), with the same limits.
//   orb enlazar <código> <dirección>     link with the short code shown by the other Orb and its address
//   orb enlazar "<enlace del QR>"         or with the QR's text (the link under the QR)
//   orb                                   interactive mode (chat with Orbe, /bots, /tareas, /aprobar, /taller…)
//   orb "mensaje"                         one message to Orbe; prints the answer and ends
//   orb --bot <nombre> "mensaje"          the same with a bot
//   orb estado | dispositivos | enlaces | olvidar [nombre] | ayuda | --version
// Options: --orb <nombre> (which linked Orb), --json. Exit codes: 0 fine, 1 error, 2 the Orb does not answer, 3 the link
// is closed, 4 nothing linked yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLinks, readPrefs, writePrefs, pickPeer } from './store.mjs';
import { painter, translator, columns, wrap, spinner } from './render.mjs';
import { createClient, answerText } from './client.mjs';
import { statusView, devicesView, linksView, extraLine, roleLabel } from './views.mjs';
import { runTui, waitOnline, findBot } from './tui.mjs';
import { parseLinkPayload, parseManual } from '../core/link-payload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUB = { enlazar: 'enlazar', link: 'enlazar', estado: 'estado', status: 'estado', dispositivos: 'dispositivos', devices: 'dispositivos',
  enlaces: 'enlaces', links: 'enlaces', olvidar: 'olvidar', unlink: 'olvidar', ayuda: 'ayuda', help: 'ayuda', version: 'version' };
export const EXIT = { ok: 0, error: 1, offline: 2, revoked: 3, none: 4 };

export function parseArgs(argv) {
  const o = { command: null, args: [], orb: null, bot: null, json: false };
  const rest = []; let forced = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); forced = true; break; }
    if (a === '--orb' || a === '-o') o.orb = argv[++i] ?? null;
    else if (a.startsWith('--orb=')) o.orb = a.slice(6);
    else if (a === '--bot' || a === '-b') o.bot = argv[++i] ?? null;
    else if (a.startsWith('--bot=')) o.bot = a.slice(6);
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.command = 'ayuda';
    else if (a === '--version' || a === '-v') o.command = 'version';
    else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) throw Object.assign(new Error(a), { usage: true });
    else rest.push(a);
  }
  if (o.command) return o;
  if (!rest.length) o.command = 'tui';
  else if (!forced && SUB[rest[0].toLowerCase()]) { o.command = SUB[rest[0].toLowerCase()]; o.args = rest.slice(1); }
  else { o.command = 'mensaje'; o.args = [rest.join(' ')]; }
  return o;
}

// Which argument of «orb enlazar a b» is the short code (8 letters and digits, with or without the dash).
export const looksLikeCode = (s) => /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(String(s ?? '').trim());
export function linkRequest(args) {
  const parts = args.map((x) => String(x).trim()).filter(Boolean);
  if (!parts.length) throw Object.assign(new Error('usage'), { usage: true });
  if (parts.length === 1 && /^(https?:\/\/|\{)/i.test(parts[0])) {
    const q = parseLinkPayload(parts[0]);
    return { qr: { v: q.v, urls: q.urls, pc: q.pc, code: q.code, name: q.name, role: q.role } };
  }
  if (parts.length === 1) throw Object.assign(new Error('needAddress'), { needAddress: true });
  let [code, address] = parts;
  if (!looksLikeCode(code) && looksLikeCode(address)) [code, address] = [address, code];
  parseManual({ code, address }); // checks the address (home network, Tailscale or https)
  return { code, address };
}

function version() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } }

export async function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin } = {}) {
  const t = translator(env); const p = painter({ stream: stdout, env }); const pe = painter({ stream: stderr, env });
  const say = (s = '') => stdout.write(`${s}\n`);
  const fail = (s) => stderr.write(`${pe.red(s)}\n`);
  let o;
  try { o = parseArgs(argv); } catch (error) { fail(t('term.cli.badOption', { name: error.message, cmd: 'orb ayuda' })); return EXIT.error; }
  if (o.command === 'version') { say(version()); return EXIT.ok; }
  if (o.command === 'ayuda') { say(helpCli(t, p)); return EXIT.ok; }

  const { link, dir } = openLinks();
  const explain = (error, peer = current) => {
    if (error?.revoked) return t('term.err.revoked', { name: peer?.name ?? 'Orb' });
    if (error?.offline || error?.status === 0) return t('term.err.offline', { name: peer?.name ?? 'Orb', url: peer?.url ?? '' });
    if (error?.key) return t(error.key);
    return String(error?.message ?? error);
  };
  const codeOf = (error) => (error?.revoked ? EXIT.revoked : error?.offline || error?.status === 0 ? EXIT.offline : EXIT.error);
  let current = null;
  try {
    if (o.command === 'enlazar') {
      let req;
      try { req = linkRequest(o.args); } catch (error) {
        if (error.usage) { fail(t('term.link.usage')); return EXIT.error; }
        if (error.needAddress) { fail(t('term.link.needAddress')); return EXIT.error; }
        fail(explain(error)); return EXIT.error;
      }
      let peer;
      try { peer = await link.connect(req); } catch (error) {
        const where = req.address ?? req.qr?.urls?.[0] ?? '';
        fail(error.status ? `${t('term.link.refused')} ${error.message ?? ''}`.trim() : error.status === 0 || error instanceof TypeError || /no responde/.test(error.message) ? t('term.link.unreachable', { address: where }) : explain(error));
        return EXIT.error;
      }
      writePrefs(dir, { last: peer.id });
      if (o.json) say(JSON.stringify(peer, null, 2));
      else { say(p.green(t('term.link.done', { name: peer.name, role: roleLabel(peer.role, t) }))); say(p.dim(t('term.link.next', { cmd: 'orb' }))); }
      return EXIT.ok;
    }

    link.start();
    const peers = link.peers();
    if (o.command === 'enlaces') {
      if (o.json) say(JSON.stringify(peers, null, 2)); else say(linksView(peers, readPrefs(dir).last, { t, p }));
      return peers.length ? EXIT.ok : EXIT.none;
    }
    const pick = pickPeer(peers, o.orb, readPrefs(dir).last);
    if (pick.error === 'none') { fail(t('term.links.noneYet', { cmd: 'orb enlazar <código> <dirección>' })); return EXIT.none; }
    if (pick.error === 'unknown') { fail(t('term.links.unknown', { name: o.orb })); say(linksView(peers, null, { t, p })); return EXIT.error; }
    if (pick.error === 'many' && !(o.command === 'tui' && stdin.isTTY)) { fail(t('term.links.many', { cmd: 'orb --orb <nombre>' })); say(linksView(pick.list, null, { t, p })); return EXIT.error; }
    current = pick.peer ?? await choose(pick.list, { t, p, stdin, stdout });
    if (!current) return EXIT.error;

    if (o.command === 'olvidar') {
      await link.disconnect(current.id);
      say(t('term.links.forgotten', { name: current.name }));
      return EXIT.ok;
    }
    if (current.revoked) { fail(t('term.err.revoked', { name: current.name })); return EXIT.revoked; }
    writePrefs(dir, { last: current.id });
    const client = createClient({ link, peer: current });

    if (o.command === 'estado' || o.command === 'dispositivos') {
      let st;
      try { st = await client.status(); } catch (error) { fail(explain(error)); return codeOf(error); }
      if (o.command === 'dispositivos') { if (o.json) say(JSON.stringify(st.devices, null, 2)); else say(devicesView(st.devices, { t, p })); return EXIT.ok; }
      const taller = st.dev === 'remote' ? await client.taller().catch(() => null) : null;
      const me = link.peers().find((x) => x.id === current.id) ?? current;
      if (o.json) say(JSON.stringify({ orb: me, status: st, taller }, null, 2)); else say(statusView({ peer: me, st, taller }, { t, p }));
      return EXIT.ok;
    }
    if (o.command === 'tui') return await runTui({ link, peer: current, t, p, explain: (e) => explain(e), stdin, stdout });

    // o.command === 'mensaje': one message, its answer, and out.
    return await oneShot({ client, link, peer: current, text: o.args[0], botName: o.bot, t, p, pe, say, fail, explain, codeOf, stdout, stderr, json: o.json });
  } finally {
    link.stop();
  }
}

async function oneShot({ client, link, peer, text, botName, t, p, pe, say, fail, explain, codeOf, stdout, stderr, json }) {
  let bot = null;
  try {
    if (botName) { bot = findBot(await client.bots(), botName); if (!bot) { fail(t('term.bots.unknown', { name: botName })); return EXIT.error; } }
    await waitOnline(link, peer, 3000);
    const spin = spinner(stderr);
    let streamed = '';
    const onPartial = (full) => {
      spin.stop(); if (json) return;
      stdout.write(full.startsWith(streamed) ? full.slice(streamed.length) : `\n${full}`); streamed = full;
    };
    let f; let conversation = null;
    if (bot) { const r = await client.sendBot(bot, text); f = client.follow({ mode: 'bot', bot, sinceId: r.sinceId, onPartial, timeoutMs: 15 * 60_000 }); }
    else { const r = await client.sendOrb(text); conversation = r.conversation; f = client.follow({ mode: 'orb', conversation: r.conversation, sinceId: r.sinceId, onPartial, timeoutMs: 15 * 60_000 }); }
    spin.start(t('term.chat.thinking', { name: bot?.name ?? peer.name }));
    const stop = () => { spin.stop(); (bot ? client.stopBot(bot) : client.stopOrb(conversation)).catch(() => {}); f.cancel(); };
    process.once('SIGINT', stop);
    let lines;
    try { lines = await f; } finally { process.off('SIGINT', stop); spin.stop(); }
    if (json) { say(JSON.stringify(lines, null, 2)); return EXIT.ok; }
    const width = columns(stdout);
    for (const part of answerText(lines, streamed)) {
      if (part.line.role === 'orb' || part.line.role === 'bot') stdout.write(`${part.redo ? '\n' : ''}${part.cont || !stdout.isTTY ? part.text : wrap(part.text, width)}`);
      else stdout.write(`\n${extraLine(part.line, { t, p, width })}`);
    }
    stdout.write('\n');
    return EXIT.ok;
  } catch (error) {
    if (error.cancelled) { stderr.write(`${pe.dim(t('term.chat.stopped'))}\n`); return 130; }
    if (error.timeout) { fail(t('term.chat.timeout')); return EXIT.error; }
    fail(explain(error)); return codeOf(error);
  }
}

// Several Orbs linked and none chosen: ask which (interactive mode only).
async function choose(list, { t, p, stdin, stdout }) {
  stdout.write(`${t('term.links.choose')}\n${linksView(list, null, { t, p })}\n`);
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await new Promise((r) => { rl.question('› ', r); rl.once('close', () => r('')); });
    const n = Number(String(answer).trim());
    return list[n - 1] ?? pickPeer(list, String(answer).trim()).peer ?? null;
  } finally { rl.close(); }
}

export function helpCli(t, p) {
  const rows = [['orb', t('term.cli.tui')], ['orb "…"', t('term.cli.message')], ['orb --bot <nombre> "…"', t('term.cli.botMessage')],
    ['orb enlazar <código> <dirección>', t('term.cli.linkCode')], ['orb enlazar "<enlace>"', t('term.cli.linkQr')], ['orb estado', t('term.cli.status')],
    ['orb dispositivos', t('term.cli.devices')], ['orb enlaces', t('term.cli.links')], ['orb olvidar [nombre]', t('term.cli.forget')], ['--orb <nombre>', t('term.cli.orbOption')], ['--json', t('term.cli.json')]];
  const w = Math.max(...rows.map((r) => r[0].length));
  return `${p.bold('Orb')} ${p.dim(`· ${t('term.cli.title')}`)}\n\n${rows.map(([c, d]) => `  ${p.cyan(c.padEnd(w))}  ${d}`).join('\n')}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code ?? 0), (error) => { process.stderr.write(`Orb: ${error?.message ?? error}\n`); process.exit(1); });
}
