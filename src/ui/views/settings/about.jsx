// Ajustes: updates, support, feedback, more apps, the music and «Acerca de».
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X, Send, Download, Heart, RefreshCw } from 'lucide-react';
import { ToolIcon } from '@/components/agent-icon.jsx';
import { PRODUCT, AUTHOR } from '../../../shared/product.mjs';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Input, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { act, bridge } from '@/lib/store.js';
import { notifyInfo } from '@/lib/notify.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useUpdate, updateActions, notesUrl } from '@/components/update-card.jsx';
import { available as musicAvailable } from '@/lib/music.js';
import { useFeedback, FEEDBACK_TYPES } from '@/components/feedback-pop.jsx';
import { Block, Panel, Setting, Fld, Stack, CardFoot, Hint } from './rows.jsx';

// New versions of Orb (GitHub Releases): the installed version, «Buscar actualizaciones» and the same steps as the card.
export function UpdatesCard() {
  const t = useT();
  const st = useUpdate();
  if (!st) return null;
  const line = {
    off: t('settings.update.off'), idle: '', checking: t('settings.update.checking'), none: t('settings.update.none'),
    available: t('settings.update.available', { version: st.version }), downloading: t('settings.update.downloading', { version: st.version, percent: st.percent ?? 0 }),
    downloaded: t('settings.update.downloaded', { version: st.version }), installing: t('settings.update.installing', { version: st.version }), error: t('settings.update.error', { error: st.error })
  }[st.state] ?? '';
  return (
    <Block title={t('settings.updates')} note={st.portable ? t('settings.update.portable') : t('settings.updatesDesc')} data-testid="updates-card">
      <Panel>
        <Setting label={t('settings.update.current', { version: st.current })} hint={line ? <span className={cn(st.state === 'error' && 'text-destructive')}>{line}</span> : null}>
          {st.state === 'off' ? null : (
            <>
              {st.version ? <Button size="sm" variant="ghost" onClick={() => act(bridge.openExternal(notesUrl(st.version)))}>{t('update.notes')}</Button> : null}
              {st.state === 'available' ? <Button size="sm" onClick={() => updateActions.update(st)}>{st.portable ? t('update.download') : t('update.update')}</Button>
                : st.state === 'downloaded' ? <Button size="sm" onClick={updateActions.restart}>{t('update.restart')}</Button>
                  : <Button size="sm" variant="outline" disabled={['checking', 'downloading', 'installing'].includes(st.state)} onClick={updateActions.check}><RefreshCw />{t('settings.update.check')}</Button>}
            </>
          )}
        </Setting>
      </Panel>
    </Block>
  );
}

// Contribute: a contribution through PayPal and feedback straight to the developer's inbox (src/engine/host/feedback.mjs).
export function SupportCard() {
  const t = useT();
  return (
    <Block title={t('contribute.supportTitle')} note={t('contribute.supportDesc')}>
      <Panel>
        <Setting label={t('contribute.contribution')}><Button size="sm" onClick={() => bridge.openExternal(AUTHOR.paypal)} data-testid="contribute-paypal"><Heart />{t('contribute.paypal')}</Button></Setting>
      </Panel>
    </Block>
  );
}

// The same form as the sidebar's pop-up (components/feedback-pop.jsx): one state, one call to the engine.
export function FeedbackCard() {
  const t = useT();
  const { v, setV, images, setImages, room, busy, addCapture, addImages, send } = useFeedback({ toasts: true });
  const messageRef = useRef(null);
  // The button stays the main one even with nothing written: it points at the message instead of being greyed out.
  const trySend = () => { if (!v.message.trim()) { notifyInfo(t('sys.feedback.empty')); messageRef.current?.focus(); return; } send(); };
  return (
    <Block title={t('contribute.feedbackTitle')} note={t('contribute.feedbackDesc')}>
      <Panel>
        <Setting label={t('contribute.type')}><Select caret="solid" value={v.type} onValueChange={(type) => setV({ ...v, type })} title={t('contribute.type')} options={FEEDBACK_TYPES.map((value) => ({ value, label: t(`contribute.type.${value}`) }))} /></Setting>
        <Fld label={t('contribute.message')}><Textarea ref={messageRef} rows={3} className="field-sizing-fixed h-[74px] min-h-[74px] resize-y" maxLength={5000} value={v.message} placeholder={t('contribute.messagePh')} onChange={(e) => setV({ ...v, message: e.target.value })} data-testid="feedback-message" /></Fld>
        <Fld label={t('contribute.contact')} hint={t('contribute.contactHint')}><Input type="email" value={v.contact} maxLength={120} placeholder={t('contribute.contactPh')} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Fld>
        <Stack className="border-border border-t">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!room} onClick={addCapture} data-testid="feedback-capture"><Camera />{t('contribute.capture')}</Button>
            <Button size="sm" variant="outline" disabled={!room} onClick={addImages}><ImagePlus />{t('contribute.addImage')}</Button>
          </div>
          <Hint>{t('contribute.imagesLimit')}</Hint>
          {images.length ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={`${img.name}-${i}`} className="group relative">
                  <img src={`data:${img.type};base64,${img.data}`} alt={img.name} className="h-16 w-24 rounded-md border object-cover" />
                  <button type="button" className="bg-background/90 absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full border" aria-label={t('contribute.removeImage')} onClick={() => setImages(images.filter((_, j) => j !== i))}><X className="size-3" /></button>
                </div>
              ))}
            </div>
          ) : null}
        </Stack>
        <CardFoot className="justify-between"><Hint className="min-w-0 flex-1 text-left">{t('contribute.privacy')}</Hint><Button size="sm" disabled={busy} onClick={trySend} data-testid="feedback-send">{busy ? <Spinner className="border-white/40 border-t-white" /> : <Send />}{t('contribute.send')}</Button></CardFoot>
      </Panel>
    </Block>
  );
}

// Other apps by the same developer, with their latest version and a download button.
export function MoreAppsCard() {
  const t = useT();
  const locale = useLocale();
  const [apps, setApps] = useState(null);
  useEffect(() => { bridge.moreApps?.().then(setApps).catch(() => setApps([])); }, []);
  const DESC = { 'open-control-edge': t('apps.openControl') };
  return (
    <Block title={t('settings.group.apps')}>
      <Panel>
        {!apps ? <Stack><div className="flex items-center gap-2 text-control"><Spinner />{t('apps.loading')}</div></Stack> : apps.map((a) => (
          <Setting key={a.id} data-testid={`app-${a.id}`} label={a.name}
            hint={<>{DESC[a.id]} {a.version ? t('apps.latest', { version: a.version, date: a.date ? new Date(a.date).toLocaleDateString(locale) : '' }) : t('apps.offline')}</>}>
            <Button size="sm" variant="outline" onClick={() => bridge.openExternal(a.page)}><ToolIcon tool="gh" className="size-4" />{t('apps.details')}</Button>
            <Button size="sm" onClick={() => bridge.openExternal(a.download)}><Download />{t('apps.download')}</Button>
          </Setting>
        ))}
      </Panel>
    </Block>
  );
}

// «Acerca de»: the version, the developer's GitHub and the licence (also at the foot of the sections list).
export function AboutCard({ version }) {
  const t = useT();
  const st = useUpdate();
  return (
    <Block title={PRODUCT.name} note={t('about.tagline')} data-testid="settings-about">
      <Panel className="[&>details]:border-border [&>details]:border-t [&>details]:px-3.5 [&>details]:py-3">
        <Setting label={t('about.version')} hint={t('about.installed', { version })}>
          {st?.state === 'none' ? <Badge variant="success">{t('about.upToDate')}</Badge> : null}
        </Setting>
        <Setting label={t('about.developer')}>
          <button type="button" onClick={() => bridge.openExternal(AUTHOR.url)} className="text-primary-text cursor-pointer text-control hover:underline" data-testid="about-github">@{AUTHOR.github}</button>
        </Setting>
        <Setting label={t('about.license')} hint={t('about.openSource')}><Badge variant="secondary">MIT</Badge></Setting>
        {/* all the music is made by Orb as it plays: there is nothing to credit */}
        {musicAvailable() ? <Setting label={t('about.music')} hint={t('about.musicAdaptive')} data-testid="about-music" /> : null}
      </Panel>
    </Block>
  );
}
