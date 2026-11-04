// 3.5, Orb en la terminal: the interactive mode (`orb` with nothing else). Chat with Orbe (or with a bot) with the answer
// streamed, and a few commands: /bots, /bot <nombre>, /orb, /nueva, /tareas, /aprobar, /taller, /despertar, /estado,
// /dispositivos, /limpiar, /ayuda, /salir. Ctrl+C stops an answer; twice on an empty line, it leaves.
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { createClient, answerText } from './client.mjs';
import { spinner, columns, wrap } from './render.mjs';
import { statusView, tallerLine, devicesView, tasksView, approvalsView, botsView, extraLine, roleLabel } from './views.mjs';

// Command names and the other words that mean the same.
export const COMMANDS = {
  ayuda: ['ayuda', 'help', '?', 'h'], salir: ['salir', 'exit', 'quit', 'q'], orb: ['orb', 'orbe'], bots: ['bots'], bot: ['bot'],
  nueva: ['nueva', 'new'], tareas: ['tareas', 'tasks'], aprobar: ['aprobar', 'approve', 'aprobaciones'], taller: ['taller', 'workshop'],
  despertar: ['despertar', 'wake'], estado: ['estado', 'status'], dispositivos: ['dispositivos', 'devices'], limpiar: ['limpiar', 'clear', 'cls']
};
const ALIAS = new Map(Object.entries(COMMANDS).flatMap(([name, words]) => words.map((w) => [w, name])));
const YES = new Set(['si', 'sí', 's', 'yes', 'y', 'ok', 'vale', 'aprobar', 'allow']);
const NO = new Set(['no', 'n', 'deny', 'rechazar', 'denegar']);
const ALWAYS = new Set(['siempre', 'always']);

// One line typed at the prompt → { type: 'empty' } | { type: 'message', text } | { type: 'command', name, arg, … } |
// { type: 'unknown', name }. «//texto» sends «/texto» as a message.
export function parseLine(input) {
  const s = String(input ?? '').trim();
  if (!s) return { type: 'empty' };
  if (s.startsWith('//')) return { type: 'message', text: s.slice(1) };
  if (!s.startsWith('/')) return { type: 'message', text: s };
  const head = s.slice(1).split(/\s+/)[0];
  const name = ALIAS.get(head.toLowerCase());
  if (!name) return { type: 'unknown', name: head };
  const arg = s.slice(1 + head.length).trim();
  if (name === 'aprobar') {
    if (!arg) return { type: 'command', name, arg, index: null, decision: null };
    let index = null; let decision = null;
    for (const w of arg.toLowerCase().split(/\s+/)) {
      if (/^\d+$/.test(w) && index === null) index = Number(w);
      else if (YES.has(w) && !decision) decision = 'allow';
      else if (NO.has(w) && !decision) decision = 'deny';
      else if (ALWAYS.has(w) && !decision) decision = 'always';
      else return { type: 'command', name, arg, error: 'usage' };
    }
    if (index === null || index < 1) return { type: 'command', name, arg, error: 'usage' };
    return { type: 'command', name, arg, index, decision };
  }
  return { type: 'command', name, arg };
}

// A bot by id, name (any case) or the start of its name.
export function findBot(bots, wanted) {
  const w = String(wanted ?? '').trim().toLowerCase();
  if (!w) return null;
  return bots.find((b) => String(b.id) === w) ?? bots.find((b) => b.name.toLowerCase() === w) ?? bots.find((b) => b.name.toLowerCase().startsWith(w)) ?? null;
}

export async function waitOnline(link, peer, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const me = link.peers().find((x) => x.id === peer.id);
    if (!me || me.revoked || me.online) return me ?? null;
    await new Promise((r) => setTimeout(r, 100));
  }
  return link.peers().find((x) => x.id === peer.id) ?? null;
}

export function helpText(t, p) {
  const rows = [['/bots', t('term.help.bots')], ['/bot <nombre>', t('term.help.bot')], ['/orb', t('term.help.orb')], ['/nueva', t('term.help.new')],
    ['/tareas', t('term.help.tasks')], ['/aprobar', t('term.help.approve')], ['/aprobar <n> si|no|siempre', t('term.help.approveOne')],
    ['/taller', t('term.help.taller')], ['/despertar', t('term.help.wake')], ['/estado', t('term.help.status')], ['/dispositivos', t('term.help.devices')],
    ['/limpiar', t('term.help.clear')], ['/salir', t('term.help.quit')]];
  const w = Math.max(...rows.map((r) => r[0].length));
  return `${rows.map(([c, d]) => `  ${p.cyan(c.padEnd(w))}  ${d}`).join('\n')}\n${p.dim(`  ${t('term.help.keys')}`)}`;
}

// Runs until /salir, Ctrl+D or the link is closed. explain(error) → the text to show for an error of a call.
export async function runTui({ link, peer, t, p, explain, stdin = process.stdin, stdout = process.stdout }) {
  const client = createClient({ link, peer });
  const width = () => columns(stdout);
  let mode = 'orb'; let conversation = null; let bot = null; let bots = [];
  let cards = []; let current = null; let pending = 0; let mute = false; let lastCtrlC = 0; let closed = false;
  let assistant = 'Orbe';

  // readline writes through this: muted while an answer is streaming (what is typed meanwhile waits, unseen, for its turn).
  const out = new Writable({ write(chunk, enc, cb) { if (!mute) stdout.write(chunk); cb(); } });
  Object.defineProperty(out, 'columns', { get: () => stdout.columns });
  Object.defineProperty(out, 'rows', { get: () => stdout.rows });
  out.isTTY = stdout.isTTY;
  stdout.on?.('resize', () => out.emit('resize'));
  const rl = readline.createInterface({ input: stdin, output: out, terminal: Boolean(stdin.isTTY && stdout.isTTY), historySize: 300 });
  const say = (text = '') => stdout.write(`${text}\n`);
  const promptText = () => (mode === 'bot' && bot ? `${p.magenta(bot.name)} ${p.dim('›')} ` : `${p.cyan(assistant)} ${p.dim('›')} `);
  const prompt = () => { if (closed || rl.closed) return; try { rl.setPrompt(promptText()); rl.prompt(); } catch { /* the input ended */ } };
  const spin = spinner(stdout);

  let finish; const done = new Promise((r) => { finish = r; });
  const close = (code = 0) => { if (closed) return; closed = true; spin.stop(); try { rl.close(); } catch { /* closed */ } finish(code); };

  // ---- connecting (lines typed or piped meanwhile wait for it, in order)
  async function connect() {
    mute = true;
    spin.start(t('term.tui.connecting', { name: peer.name }));
    try {
      await waitOnline(link, peer);
      try { const st = await client.state(); assistant = st?.config?.assistantName || assistant; }
      catch (error) { spin.stop(); say(p.red(explain(error))); if (error.revoked) { close(3); return; } }
      spin.stop();
      const ls = await client.status().catch(() => null);
      say(`${p.bold('Orb')} ${p.dim('·')} ${p.bold(ls?.name ?? peer.name)} ${p.dim(`· ${roleLabel(ls?.role ?? peer.role, t)}`)}`);
      // 3.6: whom this terminal is for there, and whether one of the two has to be updated.
      const me = await client.me().catch((error) => { if (error.status === 426) say(p.yellow(error.message)); return null; });
      if (me?.person?.name) say(p.dim(t('term.tui.connectedAs', { name: me.person.name })));
      const note = versionNotice(me, ls?.name ?? peer.name, t); if (note) say(p.yellow(note));
      say(p.dim(t('term.tui.hello', { name: assistant, cmd: '/ayuda' })));
    } finally { spin.stop(); mute = false; }
  }
  link.on('link:peers', (list) => { if (!closed && list.find((x) => x.id === peer.id)?.revoked) { spin.stop(); mute = false; say(`\n${p.red(t('term.err.revoked', { name: peer.name }))}`); close(3); } });

  // ---- an answer, streamed
  async function talk(text) {
    if (mode === 'bot' && !bot) { say(p.yellow(t('term.bots.pickFirst', { cmd: '/bot <nombre>' }))); return; }
    const name = mode === 'bot' ? bot.name : assistant;
    mute = true; let streamed = ''; let started = false;
    const head = () => { if (!started) { started = true; spin.stop(); say(p.bold(mode === 'bot' ? p.magenta(name) : p.cyan(name))); } };
    spin.start(t('term.chat.thinking', { name }));
    try {
      let f;
      if (mode === 'bot') { const r = await client.sendBot(bot, text); f = client.follow({ mode: 'bot', bot, sinceId: r.sinceId, onPartial }); }
      else { const r = await client.sendOrb(text, conversation); conversation = r.conversation; f = client.follow({ mode: 'orb', conversation, sinceId: r.sinceId, onPartial }); }
      current = { cancel: f.cancel, stop: () => (mode === 'bot' ? client.stopBot(bot) : client.stopOrb(conversation)) };
      const lines = await f;
      head();
      for (const part of answerText(lines, streamed)) {
        if (part.line.role === 'orb' || part.line.role === 'bot') stdout.write(`${part.redo ? '\n' : ''}${part.cont ? part.text : wrap(part.text, width())}`);
        else stdout.write(`\n${extraLine(part.line, { t, p, width: width() })}`);
      }
      say('\n');
    } catch (error) {
      spin.stop();
      if (error.cancelled) say(`\n${p.dim(t('term.chat.stopped'))}\n`);
      else { say(`\n${p.red(explain(error))}`); if (error.revoked) close(3); }
    } finally { current = null; mute = false; spin.stop(); }
    function onPartial(full) {
      head();
      if (full.startsWith(streamed)) stdout.write(full.slice(streamed.length)); else stdout.write(`\n${full}`);
      streamed = full;
    }
  }

  async function command(c) {
    switch (c.name) {
      case 'ayuda': say(helpText(t, p)); return;
      case 'salir': close(0); return;
      case 'limpiar': stdout.write('\x1b[2J\x1b[H'); return;
      case 'nueva': conversation = null; mode = 'orb'; say(p.dim(t('term.tui.newChat'))); return;
      case 'orb': mode = 'orb'; say(p.dim(t('term.tui.orbMode', { name: assistant }))); return;
      case 'bots': case 'bot': {
        bots = await client.bots();
        if (c.name === 'bot' && c.arg) {
          const b = findBot(bots, c.arg);
          if (!b) { say(p.yellow(t('term.bots.unknown', { name: c.arg }))); say(botsView(bots, bot?.id, { t, p })); return; }
          bot = b; mode = 'bot'; say(p.dim(t('term.bots.talking', { name: b.name, cmd: '/orb' }))); return;
        }
        if (!bots.length) { say(t('term.bots.none')); return; }
        bot = bots.find((b) => b.id === bot?.id) ?? bots.find((b) => b.is_chief && !b.paused) ?? bots.find((b) => !b.paused) ?? bots[0];
        mode = 'bot';
        say(botsView(bots, bot.id, { t, p }));
        say(p.dim(t('term.bots.talking', { name: bot.name, cmd: '/orb' })));
        return;
      }
      case 'tareas': say(tasksView(await client.tasks(), { t, p, width: width() })); return;
      case 'aprobar': {
        if (c.error) { say(p.yellow(t('term.approve.usage', { cmd: '/aprobar <n> si|no' }))); return; }
        if (c.index == null) {
          cards = await client.approvals();
          say(approvalsView(cards, { t, p, width: width() }));
          if (cards.length) say(p.dim(t('term.approve.hint', { cmd: '/aprobar 1 si' })));
          return;
        }
        if (!cards.length) cards = await client.approvals();
        const card = cards[c.index - 1];
        if (!card) { say(p.yellow(t('term.approve.noSuch', { n: c.index }))); return; }
        if (!c.decision) { say(p.yellow(t('term.approve.usage', { cmd: `/aprobar ${c.index} si|no` }))); return; }
        if (c.decision === 'always' && card.kind !== 'permiso') { say(p.yellow(t('term.approve.alwaysOnlyPerm'))); return; }
        // 3.6: a sensitive card asks the PIN (not shown while typed).
        const askPin = () => new Promise((resolve) => { say(t('term.pin.ask')); mute = true; rl.question('', (a) => { mute = false; resolve(String(a ?? '').trim()); }); });
        await client.decide(card, c.decision, { askPin });
        say(c.decision === 'deny' ? p.red(t('term.approve.denied')) : p.green(t('term.approve.allowed')));
        cards = await client.approvals();
        if (cards.length) say(approvalsView(cards, { t, p, width: width() }));
        return;
      }
      case 'taller': case 'despertar': {
        const s = await client.status();
        if (s.dev !== 'remote') { say(t('term.taller.notCentro', { name: s.name })); return; }
        if (c.name === 'despertar') { const r = await client.wake(); say(p.green(t('term.taller.wakeSent', { name: r.name }))); return; }
        say(tallerLine(await client.taller(), { t, p }));
        return;
      }
      case 'estado': {
        const s = await client.status();
        say(statusView({ peer: link.peers().find((x) => x.id === peer.id) ?? peer, st: s, taller: s.dev === 'remote' ? await client.taller().catch(() => null) : null }, { t, p }));
        return;
      }
      case 'dispositivos': say(devicesView((await client.status()).devices, { t, p })); return;
      default:
    }
  }

  async function handle(line) {
    const c = parseLine(line);
    try {
      if (c.type === 'empty') return;
      if (c.type === 'unknown') { say(p.yellow(t('term.tui.unknown', { name: c.name, cmd: '/ayuda' }))); return; }
      if (c.type === 'message') { await talk(c.text); return; }
      await command(c);
    } catch (error) {
      say(p.red(explain(error)));
      if (error.revoked) close(3);
    }
  }

  pending++;
  let chain = connect().catch((error) => say(p.red(explain(error)))).finally(() => { pending--; if (!pending) prompt(); });
  rl.on('line', (line) => {
    if (closed) return;
    pending++;
    chain = chain.then(() => (closed ? null : handle(line))).finally(() => { pending--; if (!pending) prompt(); });
  });
  rl.on('SIGINT', () => {
    if (current) { const c = current; current = null; c.stop().catch(() => {}); c.cancel(); return; }
    if (rl.line) { rl.write(null, { ctrl: true, name: 'u' }); return; }
    if (Date.now() - lastCtrlC < 2000) { stdout.write('\n'); close(0); return; }
    lastCtrlC = Date.now();
    stdout.write(`\n${p.dim(t('term.tui.ctrlC', { cmd: '/salir' }))}\n`); prompt();
  });
  rl.on('close', () => { chain.finally(() => close(0)); });
  return done;
}
