// Normas: the dialogs of the tab. Each one explains what changes (before → after) and which password it asks for;
// the password itself comes from unlockCore right after, in lib/rules-actions.js. Everything a rule says is plain text.
import { confirm, form } from '@/components/dialogs.jsx';
import { Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Segmented, Note } from '@/components/ui/primitives.jsx';
import { t } from '@/lib/i18n.js';
import { diffValues, hasHiddenSecret } from '@/lib/rules-access.js';

const lines = (...parts) => parts.filter(Boolean).join('\n\n');
const railName = (rail) => rail.titulo || t(`rails.${rail.id}.title`);

// Pausing a rail: orange button; the chat's permission level still decides the rest.
export function confirmPauseRail(rail) {
  const key = `rules.pauseAfter.${rail.id}`;
  const after = t(key) !== key ? t(key) : t('rules.pauseAfter.default');
  return confirm(t('rules.pauseTitle', { name: railName(rail) }), lines(
    t('rules.pauseBody'),
    `${t('rules.before').toUpperCase()}: ${t('rules.nowOn')}. ${rail.descripcion ?? ''}\n${t('rules.after').toUpperCase()}: ${t('rules.nowOff')}. ${after}`,
    t('rules.pauseNote'),
    `${t('rules.askEveryTime')} ${t('rules.logged')}`
  ), { ok: t('rules.pauseOk'), warn: true });
}
export const confirmResumeRail = (rail) => confirm(t('rules.resumeTitle', { name: railName(rail) }), lines(rail.descripcion, `${t('rules.askEveryTime')} ${t('rules.logged')}`), { ok: t('rules.resume') });
// Removing a rail is turning it off and hiding it: red, the only red of the rails.
export const confirmRemoveRail = (rail) => confirm(t('rules.removeRailTitle', { name: railName(rail) }), lines(t('rules.removeRailBody'), `${t('rules.askEveryTime')} ${t('rules.logged')}`), { ok: t('rules.removeOk'), danger: true });
export const confirmRestoreRail = (rail) => confirm(t('rules.restoreRailTitle', { name: railName(rail) }), lines(t('rules.restoreRailBody'), `${t('rules.askEveryTime')} ${t('rules.logged')}`), { ok: t('rules.restore') });
// The values that change, one line each: «key: before → after».
export function confirmSaveRail(rail, before, after) {
  const changes = diffValues(before, after).map((d) => `${d.key}: ${d.before || '—'} → ${d.after || '—'}`).join('\n');
  return confirm(t('rules.saveRailTitle', { name: railName(rail) }), lines(changes, `${t('rules.askEveryTime')} ${t('rules.logged')}`), { ok: t('rules.saveChanges') });
}

export const confirmPauseRule = (rule) => confirm(t('rules.pauseRuleTitle', { name: rule.titulo }), lines(t('rules.pauseRuleBody'), rule.de_serie ? t('rules.askEveryTime') : t('rules.fiveMin')), { ok: t('rules.pause'), warn: true });
export const confirmDeleteRule = (rule) => confirm(t('rules.deleteRuleTitle', { name: rule.titulo }), lines(t(rule.de_serie ? 'rules.deleteSeedBody' : 'rules.deleteMineBody'), rule.de_serie ? t('rules.askEveryTime') : t('rules.fiveMin')), { ok: t('rules.delete'), danger: true });
export const confirmRestoreRules = () => confirm(t('rules.restoreSeedTitle'), lines(t('rules.restoreSeedBody'), t('rules.askEveryTime')), { ok: t('rules.restoreOk') });

// The editor of a text rule (D55). rule: null for a new one. → { titulo, para, texto } or null when cancelled.
export function openRuleEditor(rule, defaultPara = 'orb') {
  const forOptions = [['orb', 'rules.forOrb'], ['subagentes', 'rules.forAgents'], ['ambos', 'rules.forBoth']].map(([value, key]) => ({ value, label: t(key), testid: `rule-for-${value}` }));
  return form(t(rule ? 'rules.editorEdit' : 'rules.editorNew'), {
    description: rule?.de_serie ? t('rules.askEveryTime') : t('rules.fiveMin'),
    initial: { titulo: rule?.titulo ?? '', para: rule?.para ?? defaultPara, texto: rule?.texto ?? '' },
    wide: true,
    ok: t(rule ? 'rules.saveRule' : 'rules.createRule'),
    body: (v, set) => (<>
      <Field label={t('rules.fieldTitle')}><Input value={v.titulo} onChange={(e) => set({ titulo: e.target.value })} maxLength={80} autoFocus data-testid="rule-title" /></Field>
      <Field label={t('rules.fieldFor')}><Segmented value={v.para} onChange={(para) => set({ para })} options={forOptions} className="w-fit" /></Field>
      <Field label={t('rules.fieldText')} hint={t('rules.textHint')}><Textarea value={v.texto} onChange={(e) => set({ texto: e.target.value })} rows={10} maxLength={20000} className="min-h-40 font-mono text-control" data-testid="rule-text" /></Field>
      {hasHiddenSecret(rule?.texto) || hasHiddenSecret(rule?.titulo) ? <Note tone="warning" data-testid="rule-hidden-note">{t('rules.hiddenSecret')}</Note> : null}
      <p className="text-muted-foreground text-caption">{t('rules.noAccess')}</p>
    </>),
    onOk: (v) => {
      if (!v.titulo.trim() || !v.texto.trim()) throw new Error(t('rules.fillAll'));
      if (hasHiddenSecret(v.titulo) || hasHiddenSecret(v.texto)) throw new Error(t('rules.hiddenSecret'));
      return { titulo: v.titulo.trim(), para: v.para, texto: v.texto };
    }
  });
}
