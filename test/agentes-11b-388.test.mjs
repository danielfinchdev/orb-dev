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
const usage = read('src/ui/views/usage.jsx');
const tab = read('src/ui/views/settings/usage-tab.jsx');

test('Prepara tu equipo: Flutter, SDK de Android y Java solo se detectan; no llevan botón de instalar', () => {
  assert.match(agents, /call\('installer\.devTools'\)/);
  const block = agents.slice(agents.indexOf('team.dev?.map'), agents.indexOf('</Setting>', agents.indexOf('team.dev?.map')));
  assert.match(block, /data-testid=\{`team-dev-\$\{d\.id\}`\}/);
  assert.doesNotMatch(block, /team\.install|<Button/, 'Orb installs none of them');
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
  assert.match(agents, /t\(upd\.available === true \? 'agents\.versionUpdate' : 'agents\.versionCurrent'/);
  // an unknown installed version is not «up to date»; the repair stays in the card's «⋯»; Claude's installer promises no version
  assert.match(agents, /if \(upd && upd\.available === false && !busy\)/);
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

test('Uso: barras por agente y día con su leyenda, y los cuatro números de la maqueta', () => {
  assert.match(usage, /function DaysLegend/);
  assert.match(usage, /data-testid="usage-days-legend"/);
  assert.match(usage, /actions=\{<DaysLegend byDay=\{data\.byDay\} order=\{order\} \/>\}/);
  assert.match(usage, /\[t\('usage\.cache'\), cacheTokens \? tokens\(cacheTokens\) : '—'\]/);
  assert.match(usage, /t\('usage\.total'\), tokens\(totalTokens\)/);
  assert.match(usage, /tokens_cache/);
  assert.match(usage, /data-testid="usage-turns"/, 'the turns, which the mock-up does not draw, stay under «Más opciones»');
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

test('la acentuación sigue siendo un token en las dos páginas', () => {
  for (const src of [agents, usage]) assert.doesNotMatch(src, /\btext-primary\b(?!-)/);
});
