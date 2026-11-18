// Normas: the dialogs of the tab. Each one shows what changes (Antes / Después, read from the engine just before it
// opens) and asks the master password in line, in the same dialog. The password goes only to master.unlock, as it did
// in the separate password dialog; the dialog hands back the token that call gave, and the caller makes the same
// rules.* / rails.set call as before. A field is emptied when its dialog closes or the password fails. Everything a
// rule says is plain text for the engine: the preview below the editor is only how it reads.
import { form } from '@/components/dialogs.jsx';
import { Badge, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Segmented, Note } from '@/components/ui/primitives.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { PatchView } from '@/components/patch-view.jsx';
import { call } from '@/lib/store.js';
import { notifyError } from '@/lib/notify.js';
import { t } from '@/lib/i18n.js';
import { FRESH_ACTIONS, heldUnlock, heldUntil, keepUnlock } from '@/lib/core-access.js';
import { diffValues, hasHiddenSecret, asList } from '@/lib/rules-access.js';
import { linePatch, railSaveView } from '@/lib/rules-diff.js';

const railName = (rail) => rail.titulo || t(`rails.${rail.id}.title`);
const minutesLeft = () => { const until = heldUntil(); return until ? Math.max(1, Math.ceil((until - Date.now()) / 60_000)) : 0; };

// What the engine has right now (the dialog compares against this, never against the card on screen).
async function currentRail(id) {
  try { return asList(await call('rails.list', {})).find((r) => r.id === id) ?? null; } catch (error) { notifyError(error); return null; }
}
async function currentRule(id) {
  try { return await call('rules.read', { id }); } catch (error) { notifyError(error); return null; }
}

// → the token for the action: the held 5-minute unlock when the action allows it, else master.unlock with the password
// typed in the dialog (for an action that asks every time, a token for that action alone, never kept).
async function takeUnlock(action, password) {
  const fresh = FRESH_ACTIONS.includes(action);
  if (!fresh) { const held = heldUnlock(); if (held) return held; }
  if (!password) throw new Error(t('rules.needPassword'));
  const r = await call('master.unlock', { password, ...(fresh ? { purpose: action } : {}) });
  return fresh ? r?.unlock ?? null : keepUnlock(r);
}
const needsField = (action) => FRESH_ACTIONS.includes(action) || !heldUnlock();

// ANTES / DESPUÉS: two short blocks, each a title and a line.
function Compare({ before, after }) {
  const side = (label, s, testid) => (
    <div className="bg-secondary rounded-ctl grid content-start gap-0.5 p-2.5" data-testid={testid}>
      <small className="text-faint-foreground text-micro uppercase">{label}</small>
      <b className="text-control font-medium break-words">{s.title}</b>
      {s.note ? <span className="text-muted-foreground text-caption break-words">{s.note}</span> : null}
    </div>
  );
  return <div className="grid grid-cols-2 gap-2.5" data-testid="rules-compare">{side(t('rules.before'), before, 'rules-before')}{side(t('rules.after'), after, 'rules-after')}</div>;
}

// The password, in line. A change that asks every time says so; the others say how long the unlock lasts.
function PasswordPart({ action, v, set }) {
  const every = FRESH_ACTIONS.includes(action);
  const shown = every || v.askPw;
  return (
    <div className="grid gap-2" data-testid="rules-password-part">
      {shown ? (
        <Field label={t('master.password')}>
          <Input type="password" autoComplete="off" autoFocus value={v.password} onChange={(e) => set({ password: e.target.value })} data-testid="rules-password" />
        </Field>
      ) : <Note data-testid="rules-unlocked-note">{t('rules.unlockedNote', { n: minutesLeft() })}</Note>}
      <p className="text-muted-foreground m-0 text-caption">{every ? t('rules.askEveryTime') : t('rules.askNote')}</p>
      <p className="text-muted-foreground m-0 text-caption">{t('rules.logged')}</p>
    </div>
  );
}

// One guarded change: intro, what the caller draws (`content`), the password in line. Resolves { unlock, ...extra(values) } or null.
function ask({ title, intro, action, ok, danger = false, content, extra = () => ({}), okDisabled = null }) {
  let reset = null;
  return form(title, {
    description: intro,
    initial: { password: '', askPw: needsField(action) },
    ok,
    okDanger: danger,
    okDisabled,
    body: (v, set) => { reset = set; return (<>{typeof content === 'function' ? content(v, set) : content}<PasswordPart action={action} v={v} set={set} /></>); },
    onOk: async (v) => {
      try { return { ...extra(v), unlock: await takeUnlock(action, v.password) }; } catch (error) {
        // the password never stays in the field after a failure; a held unlock that ran out asks for it now
        reset?.({ password: '', askPw: true });
        throw error;
      }
    }
  });
}

const sideState = (on, note) => ({ title: t(on ? 'rules.nowOn' : 'rules.nowOff'), note });

// ---- rails
// Pausing a rail: what the chat's permission level still decides is told in the text.
export async function confirmPauseRail(rail) {
  const now = await currentRail(rail.id) ?? rail;
  const key = `rules.pauseAfter.${now.id}`;
  const after = t(key) !== key ? t(key) : t('rules.pauseAfter.default');
  return ask({
    title: t('rules.pauseTitle', { name: railName(now) }), intro: t('rules.pauseBody'), action: 'rails', ok: t('rules.pauseOk'),
    content: (<>
      <Compare before={sideState(now.activo !== false, now.descripcion)} after={sideState(false, after)} />
      <p className="text-muted-foreground m-0 text-caption">{t('rules.pauseNote')}</p>
    </>)
  });
}
export async function confirmResumeRail(rail) {
  const now = await currentRail(rail.id) ?? rail;
  return ask({
    title: t('rules.resumeTitle', { name: railName(now) }), intro: now.descripcion, action: 'rails', ok: t('rules.resume'),
    content: <Compare before={sideState(now.activo !== false)} after={sideState(true, now.descripcion)} />
  });
}
// Removing a rail is turning it off and hiding it: red, the only red of the rails.
export async function confirmRemoveRail(rail) {
  const now = await currentRail(rail.id) ?? rail;
  return ask({
    title: t('rules.removeRailTitle', { name: railName(now) }), intro: t('rules.removeRailBody'), action: 'rails', ok: t('rules.removeOk'), danger: true,
    content: <Compare before={sideState(now.activo !== false, now.descripcion)} after={{ title: t('rules.removedState') }} />
  });
}
export async function confirmRestoreRail(rail) {
  const now = await currentRail(rail.id) ?? rail;
  return ask({
    title: t('rules.restoreRailTitle', { name: railName(now) }), intro: t('rules.restoreRailBody'), action: 'rails', ok: t('rules.restore'),
    content: <Compare before={{ title: t('rules.removedState') }} after={sideState(true, now.descripcion)} />
  });
}
// The values that change, read again from the engine: «key: before → after». → { unlock, changed } or null.
// `edited` holds only what the user changed against what the card loaded; nothing else is ever written.
export async function confirmSaveRail(rail, loaded, _after, edited) {
  const now = await currentRail(rail.id) ?? rail;
  const { changed, before, stale } = railSaveView(loaded ?? rail.valores, now.valores, edited ?? {});
  const diffs = diffValues(before, changed);
  const line = (key, v) => `${t(`rules.key.${key}`) !== `rules.key.${key}` ? t(`rules.key.${key}`) : key}: ${v || '—'}`;
  return ask({
    title: t('rules.saveRailTitle', { name: railName(now) }), intro: t('rules.saveRailBody'), action: 'rails', ok: t('rules.saveChanges'),
    okDisabled: () => diffs.length === 0,
    extra: () => ({ changed }),
    content: diffs.length ? (<>
      {stale.length ? <Note tone="warning" data-testid="rules-stale">{t('rules.staleValues')}</Note> : null}
      <Compare before={{ title: t('rules.nowValues'), note: diffs.map((d) => line(d.key, d.before)).join('\n') }} after={{ title: t('rules.newValues'), note: diffs.map((d) => line(d.key, d.after)).join('\n') }} />
    </>) : <Note>{t('rules.noChanges')}</Note>
  });
}

// ---- text rules
export async function confirmPauseRule(rule) {
  const now = await currentRule(rule.id) ?? rule;
  return ask({
    title: t('rules.pauseRuleTitle', { name: now.titulo }), intro: t('rules.pauseRuleBody'), action: now.de_serie ? 'ruleSeed' : 'rules', ok: t('rules.pause'),
    content: <Compare before={{ title: t(now.estado === 'pausada' ? 'rules.paused' : 'rules.active') }} after={{ title: t('rules.paused') }} />
  });
}
export async function confirmDeleteRule(rule) {
  const now = await currentRule(rule.id) ?? rule;
  return ask({
    title: t('rules.deleteRuleTitle', { name: now.titulo }), intro: t(now.de_serie ? 'rules.deleteSeedBody' : 'rules.deleteMineBody'), action: now.de_serie ? 'ruleSeed' : 'rules', ok: t('rules.delete'), danger: true,
    content: <Compare before={{ title: t(now.estado === 'pausada' ? 'rules.paused' : 'rules.active'), note: now.titulo }} after={{ title: t('rules.deletedState') }} />
  });
}
export const confirmRestoreRules = () => ask({
  title: t('rules.restoreSeedTitle'), intro: t('rules.restoreSeedBody'), action: 'ruleSeed', ok: t('rules.restoreOk'), content: null
});

// Saving a rule that exists: its title, side and text now in the engine against what the editor holds. → { unlock } or null.
// `initial` is what the editor was opened with: when the engine holds something else now, the dialog says so.
export async function confirmSaveRule(rule, fields, initial = null) {
  const now = await currentRule(rule.id) ?? rule;
  const moved = initial && (now.texto !== initial.texto || now.titulo !== initial.titulo || now.para !== initial.para);
  const sides = { orb: t('rules.forOrb'), subagentes: t('rules.forAgents'), ambos: t('rules.forBoth') };
  const patch = linePatch(now.texto, fields.texto);
  const head = [];
  if (now.titulo !== fields.titulo) head.push({ title: now.titulo, to: fields.titulo, label: t('rules.fieldTitle') });
  if (now.para !== fields.para) head.push({ title: sides[now.para] ?? now.para, to: sides[fields.para] ?? fields.para, label: t('rules.fieldFor') });
  return ask({
    title: t('rules.saveRuleTitle', { name: now.titulo }), intro: t('rules.saveRuleBody'), action: now.de_serie ? 'ruleSeed' : 'rules', ok: t('rules.saveRule'),
    okDisabled: () => !patch && !head.length,
    content: (<>
      {moved ? <Note tone="warning" data-testid="rules-stale">{t('rules.staleRule')}</Note> : null}
      {head.map((h) => <Compare key={h.label} before={{ title: h.title, note: h.label }} after={{ title: h.to, note: h.label }} />)}
      {patch ? <PatchView text={patch} name={now.titulo} path="norma.md" bodyClass="max-h-64" /> : null}
      {!patch && !head.length ? <Note>{t('rules.noChanges')}</Note> : null}
    </>)
  });
}

// The editor of a text rule. rule: null for a new one. → { fields: { titulo, para, texto }, unlock? } (unlock only for a new
// rule: an existing one is confirmed with confirmSaveRule), { op: 'pause' | 'resume' | 'delete' } when the footer
// buttons were used, or null when cancelled.
export async function openRuleEditor(rule, defaultPara = 'orb') {
  const current = rule ? await currentRule(rule.id) ?? rule : null;
  const forOptions = [['orb', 'rules.forOrb'], ['subagentes', 'rules.forAgents'], ['ambos', 'rules.forBoth']].map(([value, key]) => ({ value, label: t(key), testid: `rule-for-${value}` }));
  const initial = { titulo: current?.titulo ?? '', para: current?.para ?? defaultPara, texto: current?.texto ?? '' };
  const action = 'rules';
  const paused = current?.estado === 'pausada';
  const ofSide = { orb: 'rules.appendOrb', subagentes: 'rules.appendAgents', ambos: 'rules.appendBoth' };
  let pending = null; // the footer buttons close the editor with their own answer
  let reset = null;
  const useButton = (op) => (e) => { pending = op; e.currentTarget.form?.requestSubmit(); };
  return form(t(current ? 'rules.editorEdit' : 'rules.editorNew'), {
    description: current ? (current.de_serie ? t('rules.askEveryTime') : t('rules.fiveMin')) : t('rules.fiveMin'),
    initial: { ...initial, password: '', askPw: !current && needsField(action) },
    wide: true,
    ok: t(current ? 'rules.saveRule' : 'rules.createRule'),
    body: (v, set) => {
      reset = set;
      const dirty = v.titulo !== initial.titulo || v.para !== initial.para || v.texto !== initial.texto;
      return (<>
        {dirty && current ? <div><Badge variant="warning" data-testid="rule-dirty">{t('rules.unsaved')}</Badge></div> : null}
        <Field label={t('rules.fieldTitle')}><Input value={v.titulo} onChange={(e) => set({ titulo: e.target.value })} maxLength={80} autoFocus data-testid="rule-title" /></Field>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label={t('rules.fieldFor')}><Segmented value={v.para} onChange={(para) => set({ para })} options={forOptions} className="w-fit" /></Field>
          <div className="grid gap-1 text-right" data-testid="rule-state">
            <span className="text-muted-foreground text-caption">{t('rules.fieldState')}</span>
            <Badge variant={paused ? 'secondary' : 'success'}>{t(paused ? 'rules.paused' : 'rules.active')}</Badge>
          </div>
        </div>
        <p className="text-muted-foreground m-0 text-caption">{t(ofSide[v.para] ?? ofSide.orb)}</p>
        <p className="text-muted-foreground m-0 text-caption">{current ? t(current.de_serie ? 'rules.seedNote' : 'rules.mineNote', { n: minutesLeft() || 5 }) : t('rules.newNote')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('rules.fieldText')} hint={t('rules.textHint')}><Textarea value={v.texto} onChange={(e) => set({ texto: e.target.value })} rows={10} maxLength={20000} className="min-h-40 font-mono text-control" data-testid="rule-text" /></Field>
          <div className="grid content-start gap-1.5">
            <span className="text-muted-foreground text-caption uppercase">{t('rules.preview')}</span>
            <div className="bg-secondary rounded-ctl max-h-72 min-h-40 overflow-auto p-3 text-control" data-testid="rule-preview">
              {v.titulo.trim() ? <b className="block font-medium">{v.titulo}</b> : null}
              <Markdown>{v.texto}</Markdown>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground m-0 text-caption" data-testid="rule-file">{current?.ruta ? <>{t('rules.file')}: <code className="font-mono">{current.ruta}</code></> : t('rules.fileNew')}</p>
        {hasHiddenSecret(current?.texto) || hasHiddenSecret(current?.titulo) ? <Note tone="warning" data-testid="rule-hidden-note">{t('rules.hiddenSecret')}</Note> : null}
        <p className="text-muted-foreground m-0 text-caption">{t('rules.noAccess')}</p>
        {current ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={useButton(paused ? 'resume' : 'pause')} disabled={dirty} title={dirty ? t('rules.saveFirst') : undefined} data-testid="rule-editor-toggle">{t(paused ? 'rules.resume' : 'rules.pauseRule')}</Button>
            <Button type="button" variant="destructive" onClick={useButton('delete')} disabled={dirty} title={dirty ? t('rules.saveFirst') : undefined} data-testid="rule-editor-delete">{t('rules.deleteRule')}</Button>
          </div>
        ) : <PasswordPart action={action} v={v} set={set} />}
      </>);
    },
    onOk: async (v) => {
      if (pending) { const op = pending; pending = null; return { op }; }
      if (!v.titulo.trim() || !v.texto.trim()) throw new Error(t('rules.fillAll'));
      if (hasHiddenSecret(v.titulo) || hasHiddenSecret(v.texto)) throw new Error(t('rules.hiddenSecret'));
      const fields = { titulo: v.titulo.trim(), para: v.para, texto: v.texto };
      if (current) return { fields, initial };
      try { return { fields, unlock: await takeUnlock(action, v.password) }; } catch (error) {
        reset?.({ password: '', askPw: true });
        throw error;
      }
    }
  });
}
