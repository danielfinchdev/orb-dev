// Normas: the cards. A text rule shows its title, state and a plain-text view of its body; a rail shows what the code
// enforces, its switch and its values (the real keys of orb.json). Nothing here writes: the buttons call back.
import { useEffect, useMemo, useState } from 'react';
import { Lock, Plus, X, RotateCcw, Pause, Play, Trash2, Eye, EyeOff } from 'lucide-react';
import { Badge, Input } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { IconButton, ListRow, MoreButton } from '@/components/ui/primitives.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { bridge, useStore } from '@/lib/store.js';
import { readableRule, ruleBlurb } from '@/lib/rule-text.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { LIMITS, clampValue, shownValue, changedValues } from '@/lib/rules-access.js';

const railName = (t, r) => r.titulo || t(`rails.${r.id}.title`);
const railDesc = (t, r) => r.descripcion || t(`rails.${r.id}.desc`);
// the hint under a control that asks the password every time
export function EveryTime({ className }) {
  const t = useT();
  return <span className={cn('text-muted-foreground inline-flex items-center gap-1 text-micro', className)}><Lock className="size-3" aria-hidden="true" />{t('rules.everyTime')}</span>;
}

// ---- text rules
// The one-line summary under a rule's title: its first line of prose with the text marks off (heading hashes, bullets,
// emphasis, code ticks); a rule made only of headings falls back to the first heading's text.
export function ruleSummary(texto) {
  const lines = String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const plain = (l) => l.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
  const prose = lines.find((l) => !/^#{1,6}\s/.test(l));
  return plain(prose ?? lines[0] ?? '');
}

// The one line of a rule in the list: the description the app wrote for a shipped rule, else its first sentence.
export function ruleLine(t, rule, names) {
  const key = `rules.desc.${rule.id}`;
  const own = rule.de_serie ? t(key) : key;
  if (own !== key) return own;
  return ruleBlurb(ruleSummary(readableRule(rule.texto, names)));
}

export function RuleCard({ rule, onEdit, onToggle, onDelete }) {
  const t = useT();
  const names = useStore((s) => s.app?.config);
  const [open, setOpen] = useState(false);
  const paused = rule.estado === 'pausada';
  const seed = Boolean(rule.de_serie);
  const acts = bridge.mobile ? null : (
    <>
      <Button size="xs" variant="outline" onClick={() => onEdit(rule)} data-testid={`rule-edit-${rule.id}`}>{t('rules.edit')}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><MoreButton small label={t('rules.more', { name: rule.titulo })} data-testid={`rule-more-${rule.id}`} /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen((o) => !o)}>{open ? <EyeOff /> : <Eye />}{t(open ? 'rules.hideText' : 'rules.viewText')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggle(rule)} data-testid={`rule-toggle-${rule.id}`}>{paused ? <Play /> : <Pause />}<span className="grid"><span>{t(paused ? 'rules.resume' : 'rules.pause')}</span>{seed && !paused ? <span className="text-muted-foreground text-micro">{t('rules.everyTimeShort')}</span> : null}</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(rule)} data-testid={`rule-delete-${rule.id}`}><Trash2 /><span className="grid"><span>{t('rules.delete')}</span>{seed ? <span className="text-muted-foreground text-micro">{t('rules.everyTimeShort')}</span> : null}</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  return (
    <div data-testid={`rule-${rule.id}`} data-state={rule.estado}>
      <ListRow
        title={<span className="inline-flex items-center gap-2">{rule.titulo}<Badge variant="outline">{t(seed ? 'rules.seed' : 'rules.mine')}</Badge></span>}
        meta={<span className="block truncate">{ruleLine(t, rule, { orb: names?.assistantName || 'Orb', usuario: names?.userName?.trim() })}</span>}
        trailing={<span className="acts flex shrink-0 items-center gap-2"><Badge variant={paused ? 'secondary' : 'success'}>{t(paused ? 'rules.paused' : 'rules.active')}</Badge>{acts}</span>} />
      {open ? <pre className="bg-muted/50 mx-3.5 mb-3 max-h-72 overflow-auto rounded-ctl p-3 font-mono text-control whitespace-pre-wrap" data-testid={`rule-body-${rule.id}`}>{rule.texto}</pre> : null}
    </div>
  );
}

// ---- fixed core (read only)
export function FixedRail({ rail }) {
  const t = useT();
  return (
    <div className="setting flex items-start gap-3 px-3.5 py-3" data-testid={`rail-fixed-${rail.id}`}>
      <div className="lab min-w-0 flex-1"><div className="flex items-center gap-1.5 text-body font-medium"><Lock className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />{railName(t, rail)}</div><p className="text-muted-foreground m-0 text-caption">{railDesc(t, rail)}</p></div>
      <Badge variant="secondary">{t('rules.noSwitch')}</Badge>
    </div>
  );
}

// ---- values of a rail
const UNIT = { 'budget.stopAt': 'percent', 'budget.weeklyStopAt': 'percent', 'budget.maxFixRounds': 'rounds', timeoutMinutes: 'min', approvalWaitMinutes: 'min' };
const SCALAR = ['budget.stopAt', 'budget.weeklyStopAt', 'budget.maxFixRounds', 'timeoutMinutes', 'maxParallel', 'perAgent', 'approvalWaitMinutes'];

function NumberField({ k, value, onChange, unit }) {
  const t = useT();
  const lim = LIMITS[k];
  return (
    <label className="flex flex-wrap items-center gap-2 text-control">
      <span>{t(`rules.key.${k}`)}</span>
      <Input type="number" inputMode="numeric" min={lim.min} max={lim.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="num w-18" data-testid={`rail-value-${k}`} />
      {unit ? <span className="text-muted-foreground">{t(`rules.unit.${unit}`)}</span> : null}
    </label>
  );
}

function PathList({ paths, onChange }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const add = () => { const p = draft.trim(); if (p && !paths.includes(p)) onChange([...paths, p]); setDraft(''); };
  return (
    <div className="grid gap-2" data-testid="rail-paths">
      <ul className="flex flex-wrap gap-1.5">
        {paths.map((p) => (
          <li key={p} className="border-border inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5 font-mono text-caption">
            <span>{p}</span>
            <IconButton small label={t('rules.removePath', { path: p })} onClick={() => onChange(paths.filter((x) => x !== p))}><X /></IconButton>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={t('rules.pathPlaceholder')} className="max-w-72" data-testid="rail-path-input" />
        <Button variant="outline" onClick={add} disabled={!draft.trim()}><Plus />{t('rules.addPath')}</Button>
      </div>
    </div>
  );
}

function AgentCaps({ caps, onChange }) {
  const t = useT();
  const set = (id, key, raw) => {
    const v = clampValue(key, raw);
    onChange({ ...caps, [id]: { ...caps[id], [key]: v ?? raw } });
  };
  return (
    <div className="grid gap-1.5">
      <p className="text-muted-foreground text-caption">{t('rules.agentsHint')}</p>
      {Object.entries(caps).map(([id, c]) => (
        <div key={id} className="flex flex-wrap items-center gap-2 text-control" data-testid={`rail-caps-${id}`}>
          <span className="min-w-24 font-medium">{id}</span>
          <label className="flex items-center gap-1.5">{t('rules.agentTasks')}<Input type="number" min={LIMITS.maxTasks.min} max={LIMITS.maxTasks.max} value={c?.maxTasks ?? ''} onChange={(e) => set(id, 'maxTasks', e.target.value)} className="num w-18" /></label>
          <label className="flex items-center gap-1.5">{t('rules.agentHeavy')}<Input type="number" min={LIMITS.maxHeavy.min} max={LIMITS.maxHeavy.max} value={c?.maxHeavy ?? ''} onChange={(e) => set(id, 'maxHeavy', e.target.value)} className="num w-18" /></label>
        </div>
      ))}
    </div>
  );
}

// The editable values of a rail. draft: a copy of valores being edited; «Guardar cambios» asks the password (every time).
function RailValues({ rail, onSave }) {
  const t = useT();
  const keys = Object.keys(rail.valores ?? {});
  const [draft, setDraft] = useState(rail.valores ?? {});
  useEffect(() => { setDraft(rail.valores ?? {}); }, [rail.valores]);
  const scalars = SCALAR.filter((k) => keys.includes(k));
  const hasPaths = keys.includes('protected') && Array.isArray(draft.protected);
  const caps = draft['budget.agents'];
  const hasCaps = keys.includes('budget.agents') && caps && typeof caps === 'object' && !Array.isArray(caps);
  // a number being typed stays a string until saved; the saved value is clamped to the engine's limits
  const prepared = useMemo(() => {
    const out = { ...draft };
    for (const k of SCALAR) {
      if (!Object.hasOwn(draft, k)) continue;
      const v = typeof draft[k] === 'string' ? clampValue(k, draft[k]) : draft[k];
      out[k] = v === undefined ? rail.valores?.[k] : v;
    }
    if (hasCaps) {
      out['budget.agents'] = Object.fromEntries(Object.entries(caps).map(([id, c]) => [id, {
        ...c,
        maxTasks: typeof c?.maxTasks === 'string' ? clampValue('maxTasks', c.maxTasks) ?? rail.valores?.['budget.agents']?.[id]?.maxTasks : c?.maxTasks,
        maxHeavy: typeof c?.maxHeavy === 'string' ? clampValue('maxHeavy', c.maxHeavy) ?? rail.valores?.['budget.agents']?.[id]?.maxHeavy : c?.maxHeavy
      }]));
    }
    return out;
  }, [draft, caps, hasCaps, rail.valores]);
  if (!scalars.length && !hasPaths && !hasCaps) return null;
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const changed = changedValues(rail.valores, prepared, keys);
  const dirty = Object.keys(changed).length > 0;
  return (
    <div className="grid gap-3">
      <div className="vals grid gap-2">
        {scalars.map((k) => <NumberField key={k} k={k} value={typeof draft[k] === 'string' ? draft[k] : shownValue(k, draft[k])} unit={UNIT[k]} onChange={(raw) => set(k, raw)} />)}
        {hasPaths ? <PathList paths={draft.protected} onChange={(p) => set('protected', p)} /> : null}
        {hasCaps ? <AgentCaps caps={caps} onChange={(c) => set('budget.agents', c)} /> : null}
      </div>
      <div className="foot flex items-center justify-end gap-3">
        <EveryTime />
        <Button variant="outline" disabled={!dirty} onClick={async () => { if (!(await onSave(rail, rail.valores, prepared, changed))) setDraft(rail.valores ?? {}); }} data-testid={`rail-save-${rail.id}`}>{t('rules.saveChanges')}</Button>
      </div>
    </div>
  );
}

// ---- switchable rail (one block of the mock-up's .rail; the card of the list puts the hairlines between them)
export function RailCard({ rail, onSwitch, onSave, onRemove }) {
  const t = useT();
  const on = rail.activo !== false;
  const name = railName(t, rail);
  const keys = Object.keys(rail.valores ?? {});
  return (
    <div className="rail flex flex-col gap-2 px-3.5 py-3" data-testid={`rail-${rail.id}`} data-state={on ? 'on' : 'off'}>
      <div className="rail-h flex items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-body font-medium">{name}</b>
        <Badge variant={on ? 'success' : 'warning'}>{t(on ? 'rules.railActive' : 'rules.railPaused')}</Badge>
        {bridge.mobile ? null : (<>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><MoreButton small label={t('rules.more', { name })} data-testid={`rail-more-${rail.id}`} /></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onSwitch(rail, !on)} data-testid={`rail-switch-${rail.id}`}>{on ? <Pause /> : <Play />}<span className="grid"><span>{t(on ? 'rules.pauseRail' : 'rules.resume')}</span><span className="text-muted-foreground text-micro">{t('rules.everyTimeShort')}</span></span></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRemove(rail)} data-testid={`rail-remove-${rail.id}`}><Trash2 /><span className="grid"><span>{t('rules.deleteRail')}</span><span className="text-muted-foreground text-micro">{t('rules.everyTimeShort')}</span></span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>)}
      </div>
      <p className="text-muted-foreground m-0 text-caption">{railDesc(t, rail)}</p>
      {bridge.mobile ? null : <RailValues rail={rail} onSave={onSave} />}
      {bridge.mobile ? null : <span className="ids text-faint-foreground text-micro"><code>{[`rails.${rail.id}.enabled`, ...keys].join(' · ')}</code></span>}
    </div>
  );
}

// ---- a removed rail: off and out of sight until it is restored
export function RemovedRail({ rail, onRestore }) {
  const t = useT();
  return (
    <div className="rail flex flex-col gap-2 px-3.5 py-3" data-testid={`rail-removed-${rail.id}`}>
      <div className="rail-h flex items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-body font-medium">{railName(t, rail)}</b>
        <Badge variant="destructive">{t('rules.removed')}</Badge>
        {bridge.mobile ? null : (<><EveryTime /><Button size="xs" variant="outline" onClick={() => onRestore(rail)} data-testid={`rail-restore-${rail.id}`}><RotateCcw />{t('rules.restore')}</Button></>)}
      </div>
      <p className="text-muted-foreground m-0 text-caption">{railDesc(t, rail)}</p>
    </div>
  );
}
