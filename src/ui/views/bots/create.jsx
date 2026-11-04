// 3.6: a bot's avatar is chosen when it is made (docs/DESIGN-SYSTEM.md › 2.5, mockup mensajeria.html ?s=create): a big
// live preview, the name, the twelve shapes and the ten colours, and «Crear bot». A dialog on the PC; on the phone it
// takes the whole screen (on Android a glass sheet). The rest (role, brain, tools) is set later in «Editar». 3.7: or, in one
// click, the optional template «Mantenimiento del PC» (a bot with the «Equipo» tools; src/core/templates/<lang>/mantenimiento.json).
// AvatarPicker is shared with the bot's editor.
import { useEffect, useRef, useState } from 'react';
import { X, HeartPulse } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Field, Input } from '@/components/ui/basic.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { BotAvatar } from '@/components/bot-avatar.jsx';
import { useStore, botCall, call, act, go, loadBots, phoneLayout, botsVia, getState, uiLanguage } from '@/lib/store.js';
import { newBotDraft, botPayload } from '@/lib/bots.js';
import { useT } from '@/lib/i18n.js';
import { SHAPE_IDS, COLOR_IDS, avatarFor, avatarParts } from '../../../core/avatar.mjs';
import { useBots } from './common.jsx';

// A colour swatch painted like the avatar's own body (avatar.mjs › avatarParts), so the dot and the bot match.
const swatch = (c) => { const p = avatarParts('mochi', c); return { background: `linear-gradient(${p.top}, ${p.bottom})` }; };

const BOT_BRAINS = ['claude', 'codex'];
const PC_TEMPLATE = 'mantenimiento';
const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };

// A moment of joy each time the avatar changes (the preview hops), then back to idle.
export function useHop() {
  const [n, setN] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hop = () => { setN((x) => x + 1); setOn(true); clearTimeout(timer.current); timer.current = setTimeout(() => setOn(false), 1800); };
  return { key: n, state: on ? 'happy' : 'idle', hop };
}

// The shapes (in the chosen colour) and the colours, as two groups of radio buttons.
export function AvatarPicker({ value, onChange, size = 40 }) {
  const t = useT();
  const pick = (patch) => onChange({ ...value, ...patch });
  const arrows = (list, current, key) => (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const box = e.currentTarget;
    const next = list[(list.indexOf(current) + step + list.length) % list.length];
    pick({ [key]: next });
    requestAnimationFrame(() => box.querySelector(`[data-value="${next}"]`)?.focus());
  };
  return (
    <div className="grid gap-4">
      <Field label={t('bots.av.shape')}>
        <div className="avatar-shapes" role="radiogroup" aria-label={t('bots.av.shape')} onKeyDown={arrows(SHAPE_IDS, value.shape, 'shape')} data-testid="avatar-shapes">
          {SHAPE_IDS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={value.shape === s} tabIndex={value.shape === s ? 0 : -1} className="avatar-shape" data-value={s}
              aria-label={t(`bots.av.s.${s}`)} title={t(`bots.av.s.${s}`)} onClick={() => pick({ shape: s })} data-testid={`avatar-shape-${s}`}>
              <BotAvatar shape={s} color={value.color} size={size} still />
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('bots.av.color')}>
        <div className="avatar-colors" role="radiogroup" aria-label={t('bots.av.color')} onKeyDown={arrows(COLOR_IDS, value.color, 'color')} data-testid="avatar-colors">
          {COLOR_IDS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value.color === c} tabIndex={value.color === c ? 0 : -1} className="avatar-color" data-value={c}
              aria-label={t(`bots.av.c.${c}`)} title={t(`bots.av.c.${c}`)} onClick={() => pick({ color: c })} data-testid={`avatar-color-${c}`}
              style={swatch(c)} />
          ))}
        </div>
      </Field>
    </div>
  );
}

export function CreateBot({ onClose }) {
  const t = useT();
  const phone = phoneLayout();
  const { bots } = useBots();
  const app = useStore((s) => s.app);
  const [name, setName] = useState('');
  // A different suggestion for each new bot (the same one for the same number of bots).
  const [avatar, setAvatar] = useState(() => avatarFor(`nuevo-${bots.length}`));
  const [saving, setSaving] = useState(false);
  const preview = useHop();
  const change = (a) => { setAvatar(a); preview.hop(); };
  // The template only for bots that live in this Orb (not on a linked one: templates.apply makes them here).
  const [tpl, setTpl] = useState(null);
  useEffect(() => {
    if (botsVia()) return undefined;
    let alive = true;
    call('templates.list', { lang: uiLanguage(getState()) }).then((list) => { if (alive) setTpl((list ?? []).find((x) => x.id === PC_TEMPLATE) ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const fromTemplate = async () => {
    if (!tpl || saving) return;
    setSaving(true);
    const r = await act(call('templates.apply', { id: tpl.id, tz: hereTz() }), t('bots.templateMade', { name: tpl.name }));
    setSaving(false);
    if (r) { await loadBots(); if (r.bots?.[0]) go({ view: 'bot-chat', id: r.bots[0] }); else onClose(); }
  };
  const create = async (e) => {
    e?.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const agent = BOT_BRAINS.includes(app?.assistant?.agent) ? app.assistant.agent : 'claude';
    const r = await act(botCall('bots.create', { ...botPayload(newBotDraft(agent)), name: name.trim(), avatar }), t('bots.created'));
    setSaving(false);
    if (r) { await loadBots(); go({ view: 'bot-chat', id: r.id }); }
  };
  const button = <Button type="submit" disabled={saving || !name.trim()} className={phone ? 'h-12 w-full rounded-[14px] text-[15px]' : undefined} data-testid="bot-create-ok">{t('bots.create')}</Button>;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-sheet="full" showClose={!phone} className={phone ? 'flex flex-col gap-5' : 'gap-5 sm:max-w-[460px]'} data-testid="bot-create">
        <form onSubmit={create} className="contents">
          {phone ? (
            <div className="-mx-1 grid grid-cols-[40px_1fr_40px] items-center">
              <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label={t('bots.cancel')} data-testid="bot-create-close"><X /></Button>
              <DialogTitle className="text-center text-base font-semibold">{t('bots.new')}</DialogTitle>
            </div>
          ) : <DialogTitle>{t('bots.new')}</DialogTitle>}
          <DialogDescription className="sr-only">{t('bots.createHint')}</DialogDescription>
          <div className="grid justify-items-center" data-testid="bot-create-preview">
            <BotAvatar key={preview.key} shape={avatar.shape} color={avatar.color} size={phone ? 150 : 128} state={preview.state} label={name.trim() ? t('bots.av.aria', { name: name.trim() }) : t('bots.av.new')} />
          </div>
          <Field label={t('bots.f.name')}>
            <Input autoFocus={!phone} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('bots.f.namePh')} className="h-11 text-base" data-testid="bot-create-name" />
          </Field>
          <AvatarPicker value={avatar} onChange={change} size={phone ? 40 : 42} />
          <p className="text-muted-foreground text-xs">{t('bots.createHint')}</p>
          {tpl ? (
            <button type="button" disabled={saving} onClick={fromTemplate} title={tpl.description} data-testid="bot-create-template"
              className="text-muted-foreground hover:text-foreground -mt-2 inline-flex cursor-pointer items-center gap-1.5 self-start text-left text-xs underline-offset-2 hover:underline">
              <HeartPulse className="size-3.5 shrink-0" />{t('bots.fromTemplate', { name: tpl.name })}
            </button>
          ) : null}
          {phone ? <><div className="flex-1" />{button}</> : (
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t('bots.cancel')}</Button>{button}</div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
