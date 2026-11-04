// 3.5, Orb en la terminal: how lists and answers look (shared by the one-shot commands and the interactive mode).
import { wrap, ago } from './render.mjs';

const KIND_KEYS = { phone: 'term.kind.phone', browser: 'term.kind.browser', orb: 'term.kind.orb', terminal: 'term.kind.terminal' };
const STATUS_KEYS = { queued: 'term.task.queued', running: 'term.task.running', done: 'term.task.done', failed: 'term.task.failed', cancelled: 'term.task.cancelled', awaiting_approval: 'term.task.approval' };

export function roleLabel(role, t) { return role === 'centro' ? t('term.role.centro') : role === 'taller' ? t('term.role.taller') : t('term.role.todo'); }

export function statusView({ peer, st, taller, me = null }, { t, p }) {
  const out = [];
  out.push(`${p.bold(st?.name ?? peer.name)} ${p.dim(`· ${roleLabel(st?.role ?? peer.role, t)} · ${peer.url}`)}`);
  // 3.6: whom this terminal is for there.
  const who = me?.person?.name ?? peer.remotePerson?.name;
  if (who) out.push(`  ${t('term.tui.connectedAs', { name: who })}`);
  out.push(`  ${p.green('●')} ${t('term.status.linked', { when: ago(peer.linkedAt, t) })}`);
  const devices = st?.devices ?? [];
  out.push(`  ${t('term.status.devices', { n: devices.length, on: devices.filter((d) => d.online).length })}`);
  if (taller) out.push(`  ${tallerLine(taller, { t, p })}`);
  return out.join('\n');
}

export function tallerLine(tl, { t, p }) {
  if (!tl?.linked && !tl?.id) return t('term.taller.none');
  const queued = tl.queued ? ` · ${t('term.taller.queued', { n: tl.queued })}` : '';
  return tl.online ? `${p.green('●')} ${t('term.taller.on', { name: tl.name })}${queued}`
    : `${p.red('●')} ${t('term.taller.off', { name: tl.name, when: ago(tl.lastSeen, t) })}${queued}${tl.canWake ? p.dim(` · ${t('term.taller.canWake', { cmd: '/despertar' })}`) : ''}`;
}

export function devicesView(devices, { t, p }) {
  if (!devices?.length) return t('term.devices.none');
  return devices.map((d) => `  ${d.online ? p.green('●') : p.gray('○')} ${p.bold(d.name)} ${p.dim(`· ${t(KIND_KEYS[d.kind] ?? 'term.kind.browser')}${d.role ? ` · ${roleLabel(d.role, t)}` : ''} · ${d.online ? t('term.online') : ago(d.lastSeen, t)}`)}`).join('\n');
}

export function linksView(peers, current, { t, p }) {
  if (!peers.length) return t('term.links.none');
  return peers.map((x, i) => `  ${i + 1}. ${x.revoked ? p.red('×') : x.online ? p.green('●') : p.gray('○')} ${p.bold(x.name)} ${p.dim(`· ${roleLabel(x.role, t)} · ${x.url}${x.remotePerson?.name ? ` · ${t('term.links.as', { name: x.remotePerson.name })}` : ''}${x.revoked ? ` · ${t('term.links.closed')}` : ''}${x.id === current ? ` · ${t('term.links.current')}` : ''}`)}`).join('\n');
}

export function tasksView(tasks, { t, p, width = 80 }) {
  if (!tasks?.length) return t('term.tasks.none');
  const color = { done: p.green, failed: p.red, running: p.cyan, awaiting_approval: p.yellow };
  return tasks.map((x) => {
    const st = (color[x.status] ?? p.dim)(t(STATUS_KEYS[x.status] ?? 'term.task.other', { status: x.status }));
    return wrap(`#${x.id} ${st} ${x.title}${x.project ? p.dim(` · ${x.project}`) : ''}${x.agent ? p.dim(` · ${x.assigned_to ?? x.agent}`) : ''}`, width, '  ');
  }).join('\n');
}

export function approvalsView(cards, { t, p, width = 80 }) {
  if (!cards.length) return t('term.approve.none');
  const kind = { permiso: t('term.approve.kindPermission'), tarea: t('term.approve.kindTask'), bot: t('term.approve.kindBot') };
  return cards.map((c, i) => wrap(`${p.yellow(`${i + 1}.`)} ${p.bold(kind[c.kind])} ${c.title}${c.where ? p.dim(` · ${c.where}`) : ''}${c.detail ? `\n${p.dim(c.detail)}` : ''}`, width, '  ')).join('\n');
}

export function botsView(bots, current, { t, p }) {
  if (!bots.length) return t('term.bots.none');
  return bots.map((b) => `  ${b.id === current ? p.cyan('›') : ' '} ${b.icon ? `${b.icon} ` : ''}${p.bold(b.name)}${b.is_chief ? p.dim(` · ${t('term.bots.chief')}`) : ''}${b.paused ? p.dim(` · ${t('term.bots.paused')}`) : ''}${b.role_text ? p.dim(` · ${String(b.role_text).split('\n')[0].slice(0, 60)}`) : ''}`).join('\n');
}

// A chat line that is not plain answer text: a question with options, a card, a note of the system.
export function extraLine(l, { t, p, width = 80 }) {
  const m = l.meta ?? {};
  if (m.kind === 'question' && m.status === 'pending') return wrap(`${p.yellow('?')} ${m.question ?? l.body}\n${(m.options ?? []).map((o, i) => `  ${i + 1}. ${o.label}`).join('\n')}\n${p.dim(t('term.chat.answerHint'))}`, width);
  if (m.kind === 'bot_card' && m.status === 'pending') return `${p.yellow('!')} ${l.body} ${p.dim(t('term.chat.cardHint', { cmd: '/aprobar' }))}`;
  if (m.kind === 'approval' && m.status === 'pending') return `${p.yellow('!')} ${l.body} ${p.dim(t('term.chat.cardHint', { cmd: '/aprobar' }))}`;
  return p.dim(wrap(l.body, width));
}
