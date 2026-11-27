// 3.8.8 paso 11b (tanda 9), interfaz de Agentes y Uso: herramientas opcionales de «Prepara tu equipo», gasto de hoy, cerrar
// sesión, versión nueva y «Actualizar a X», barras por agente con leyenda, tokens de caché, aviso y cambio de cuenta.
// Se lee el código como texto (la interfaz no se ejecuta aquí).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const agents = read('src/ui/views/agents.jsx');
const tools = read('src/ui/views/agents-tools.jsx');
const usage = read('src/ui/views/usage.jsx');
const tab = read('src/ui/views/settings/usage-tab.jsx');

test('Prepara tu equipo: solo Flutter se detecta sin instalador; Java y Android Studio se instalan con winget', () => {
  assert.match(agents, /call\('installer\.devTools'\)/);
  // they come from team.dev as rows without an installer: «Cómo instalarlo» opens their official page and starts nothing
  assert.match(tools, /\(team\.dev \?\? \[\]\)\.filter\(\(d\) => !team\.items\.some\(\(i\) => i\.id === d\.id\)\)\.map/);
  assert.match(tools, /installable: false/);
  assert.match(tools, /data-testid=\{`team-howto-\$\{x\.id\}`\}/);
  assert.match(tools, /x\.installable\s*\? <Button[\s\S]*?team\.install\(\[x\.id\]\)/, 'only an installer item has the install button');
  for (const id of ['flutter', 'androidSdk', 'java']) for (const l of [es, en]) assert.ok(l[`agents.team.tool.${id}`], id);
});

test('Gasto de hoy: sale de usage.history de un día y no inventa cifras', () => {
  assert.match(agents, /call\('usage\.history', \{ days: 1 \}\)/);
  assert.match(agents, /data-testid=\{`agent-spend-\$\{a\.id\}`\}/);
  assert.match(agents, /if \(!usd && !turns && !a\.keys\?\.length\) return null/);
  assert.match(agents, /turns \? t\('agents\.spendNoCost'\) : t\('agents\.spendNone'\)/, 'an agent without a cost says so');
});

test('Cerrar sesión: en el «⋯» de la cuenta, con el nombre escrito; las demás cuentas explican cómo', () => {
  assert.match(agents, /\{acc\.logout \? <DropdownMenuItem onSelect=\{\(\) => signOut\(acc, reload\)\} data-testid=\{`agent-logout-\$\{acc\.id\}`\}/);
  assert.match(agents, /okDanger: true, okDisabled: \(v\) => v\.name\.trim\(\) !== acc\.label/);
  assert.match(agents, /call\('accounts\.logout', \{ id: acc\.id, confirm: v\.name\.trim\(\) \}\)/);
  assert.match(agents, /if \(acc\.logout !== 'orb'\) \{/);
  for (const k of ['agents.logout', 'agents.logoutTitle', 'agents.logoutBody', 'agents.logoutToolBody', 'agents.logoutHow.claude', 'agents.logoutHow.codex']) for (const l of [es, en]) assert.ok(l[k], k);
});

test('Versión nueva: «Versión X · hay Y», «Actualizar a Y» con confirmación y el comando donde no hay instalador', () => {
  assert.match(agents, /upd\.available === true \? t\('agents\.newVersion', \{ latest: upd\.latest \}\) : t\('agents\.upToDate'\)/);
  // «Actualizar» only when a newer version is known; the repair stays in the detail's «⋯»; Claude's installer promises no version
  assert.match(agents, /if \(a\.installed && !upd\?\.available && !busy\) return null/);
  assert.match(agents, /agent-reinstall-/);
  assert.match(agents, /agents\.updateConfirmBodyRun/);
  assert.match(agents, /<IconButton label=\{t\('agents\.tipUpdatesTitle'\)\} onClick=\{searchUpdates\}/);
  assert.match(agents, /backup\?\.accounts === true/);
  for (const k of ['agents.reinstall', 'agents.updateConfirmBodyRun', 'agents.updateConfirmBodyRunNoCmd', 'agents.updateConfirmBodyNoCmd', 'agents.logoutBackups']) for (const l of [es, en]) assert.ok(l[k], k);
  assert.match(agents, /t\('agents\.updateTo', \{ version: upd\.latest \}\)/);
  assert.match(agents, /agents\.updateConfirmBody/);
  assert.match(agents, /data-testid=\{`agent-update-cmd-\$\{a\.id\}`\}/, 'the command to run when Orb has no installer at hand');
  assert.match(agents, /call\('agents\.install', \{ agent: a\.id \}\)/, 'Claude Code and Codex update with the installer that installs them');
  assert.match(agents, /team\.install\(\[a\.id\]\)/, 'the npm agents with the team installer');
  // the internet is only asked by the button of the bar, never when the page opens
  const open = agents.slice(agents.indexOf('export function AgentsView'), agents.indexOf('const searchUpdates'));
  assert.doesNotMatch(open, /agents\.checkUpdates/);
  assert.match(agents, /onClick=\{searchUpdates\} disabled=\{searching\} data-testid="agents-check-all"/);
});

test('Uso: líneas por día con su leyenda de series, y los números de la maqueta', () => {
  const chart = read('src/ui/components/usage-chart.jsx');
  assert.match(chart, /data-testid="usage-legend"/);
  assert.match(chart, /aria-pressed=\{!hidden\[l\.key\]\}/, 'a box per series turns it on and off');
  assert.match(usage, /\[t\('usage\.cache'\), tot\.tokensCache \? tokens\(tot\.tokensCache\) : '—'\]/);
  assert.match(usage, /\[t\('usage\.total'\), tokens\(tot\.tokens\), deltaBadge\]/);
  assert.match(usage, /data-testid="usage-local-toggle"/, 'the turns and hours outside Orb stay in their own fold');
});

test('Uso: aviso en las barras, leyenda y «Aviso» en la cuenta; el aviso y el cambio de cuenta se ajustan en Uso y en Ajustes', () => {
  assert.match(usage, /data-testid="usage-warn"/);
  assert.match(usage, /data-testid="usage-legend-warn"/);
  assert.match(usage, /data-testid="usage-warned"/);
  assert.match(usage, /save\(\{ budget: \{ warnAt: Number\(v\) \/ 100 \} \}\)/, 'the warning is not a rail value: no profile, no brake');
  assert.match(usage, /save\(\{ continuity: \{ switchAccount: v \} \}\)/);
  assert.match(usage, /data-testid="usage-switch-account"/); assert.match(usage, /data-testid="usage-warn-at"/);
  assert.match(usage, /warn=\{warn\}/);
  assert.match(tab, /field\('warn', t\('settings\.warnAt'\)/);
  assert.match(tab, /warnAt: warn \/ 100/);
  assert.match(tab, /warn=\{warn\}/, 'the cards of Ajustes carry the mark too');
  for (const k of ['usage.warnAt', 'usage.warnAtHint', 'usage.legendWarn', 'usage.warnBadge', 'usage.pastWarn', 'usage.switchAccount', 'usage.cache', 'settings.warnAt']) for (const l of [es, en]) assert.ok(l[k], k);
});

test('con el agente desactivado ninguna cuenta dice «Activa»: solo que tiene la sesión iniciada', () => {
  assert.match(agents, /acc\.login === 'si' \? \(agentOn \? \[t\('agents\.accountActive'\), 'success'\] : \[t\('login\.si'\), 'secondary'\]\) : login/);
  assert.match(agents, /<AccountRow .*agentOn=\{!!cfg\.enabled\}.* \/>/);
});

test('la acentuación sigue siendo un token en las dos páginas', () => {
  for (const src of [agents, usage]) assert.doesNotMatch(src, /\btext-primary\b(?!-)/);
});
