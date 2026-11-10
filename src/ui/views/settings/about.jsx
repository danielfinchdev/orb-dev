// Ajustes: updates, support, feedback, more apps, the music and «Acerca de».
import { useEffect, useState } from 'react';
import { HeartHandshake, HandHeart, MessageSquareText, Camera, ImagePlus, X, Send, Download, ExternalLink } from 'lucide-react';
import { ToolIcon } from '@/components/agent-icon.jsx';
import { PRODUCT, AUTHOR } from '../../../shared/product.mjs';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Spinner } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { act, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { useUpdate, updateActions, notesUrl } from '@/components/update-card.jsx';
import { TRACKS } from '../../../shared/music.mjs';
import { available as musicAvailable } from '@/lib/music.js';

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
    <Card data-testid="updates-card">
      <CardHeader><CardTitle>{t('settings.updates')}</CardTitle><CardDescription>{st.portable ? t('settings.update.portable') : t('settings.updatesDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-1">
        <div className="text-sm">{t('settings.update.current', { version: st.current })}</div>
        {line ? <div className={cn('text-xs', st.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{line}</div> : null}
      </CardContent>
      {st.state === 'off' ? null : (
        <CardFooter>
          {st.state === 'available' ? <Button size="sm" onClick={() => updateActions.update(st)}>{st.portable ? t('update.download') : t('update.update')}</Button>
            : st.state === 'downloaded' ? <Button size="sm" onClick={updateActions.restart}>{t('update.restart')}</Button>
              : <Button size="sm" variant="outline" disabled={['checking', 'downloading', 'installing'].includes(st.state)} onClick={updateActions.check}>{t('settings.update.check')}</Button>}
          {st.version ? <Button size="sm" variant="ghost" onClick={() => act(bridge.openExternal(notesUrl(st.version)))}>{t('update.notes')}</Button> : null}
        </CardFooter>
      )}
    </Card>
  );
}

// Contribute: a contribution through PayPal and feedback straight to the developer's inbox (src/engine/host/feedback.mjs).
export function SupportCard() {
  const t = useT();
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><HeartHandshake className="text-primary size-5" /><div><CardTitle>{t('contribute.supportTitle')}</CardTitle><CardDescription>{t('contribute.supportDesc')}</CardDescription></div></CardHeader>
      <CardFooter><Button size="sm" onClick={() => bridge.openExternal(AUTHOR.paypal)} data-testid="contribute-paypal"><HandHeart />{t('contribute.paypal')}</Button></CardFooter>
    </Card>
  );
}

const FEEDBACK_TYPES = ['error', 'idea', 'otro'];
export function FeedbackCard() {
  const t = useT();
  const [v, setV] = useState({ type: 'idea', message: '', contact: '' });
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const room = images.length < 3;
  const add = (list) => setImages((now) => [...now, ...list.filter(Boolean)].slice(0, 3));
  // The capture shows the app behind Ajustes (what the user wants to report), so the window hides while it is taken.
  const capture = async () => {
    document.documentElement.dataset.capturing = '1';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { return await act(bridge.feedback.capture()); } finally { delete document.documentElement.dataset.capturing; }
  };
  const send = async () => {
    setBusy(true);
    const ok = await act(bridge.feedback.send({ ...v, images }), t('contribute.sent'));
    setBusy(false);
    if (ok) { setV({ ...v, message: '' }); setImages([]); }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><MessageSquareText className="text-primary size-5" /><div><CardTitle>{t('contribute.feedbackTitle')}</CardTitle><CardDescription>{t('contribute.feedbackDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label={t('contribute.type')}><Select className="w-full" value={v.type} onValueChange={(type) => setV({ ...v, type })} options={FEEDBACK_TYPES.map((value) => ({ value, label: t(`contribute.type.${value}`) }))} /></Field>
          <Field label={t('contribute.contact')} hint={t('contribute.contactHint')}><Input type="email" value={v.contact} maxLength={120} placeholder={t('contribute.contactPh')} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>
        </div>
        <Field label={t('contribute.message')}><Textarea rows={5} maxLength={5000} value={v.message} placeholder={t('contribute.messagePh')} onChange={(e) => setV({ ...v, message: e.target.value })} data-testid="feedback-message" /></Field>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!room} onClick={async () => add([await capture()])} data-testid="feedback-capture"><Camera />{t('contribute.capture')}</Button>
            <Button size="sm" variant="outline" disabled={!room} onClick={async () => add((await act(bridge.feedback.images())) ?? [])}><ImagePlus />{t('contribute.addImage')}</Button>
            <span className="text-muted-foreground text-xs">{t('contribute.imagesLimit')}</span>
          </div>
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
        </div>
        <p className="text-muted-foreground text-xs">{t('contribute.privacy')}</p>
      </CardContent>
      <CardFooter><Button size="sm" disabled={busy || !v.message.trim()} onClick={send} data-testid="feedback-send">{busy ? <Spinner className="border-white/40 border-t-white" /> : <Send />}{t('contribute.send')}</Button></CardFooter>
    </Card>
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
    <Card>
      <CardContent className="grid gap-3">
        {!apps ? <div className="flex items-center gap-2 text-sm"><Spinner />{t('apps.loading')}</div> : apps.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3" data-testid={`app-${a.id}`}>
            <img src={`apps/${a.id}.png`} alt="" className="size-11 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{a.name}</div>
              <div className="text-muted-foreground text-xs">{DESC[a.id]}</div>
              <div className="text-muted-foreground mt-0.5 text-xs">{a.version ? t('apps.latest', { version: a.version, date: a.date ? new Date(a.date).toLocaleDateString(locale) : '' }) : t('apps.offline')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => bridge.openExternal(a.page)}>{t('apps.details')}</Button>
              <Button size="sm" onClick={() => bridge.openExternal(a.download)}><Download />{t('apps.download')}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// 3.8.2: the music's credits (src/shared/music.mjs): all CC0, each with the page it comes from.
const MUSIC_CREDITS = Object.values(TRACKS);

// 3.6: «Acerca de»: the version, the developer's GitHub and the licence (3.8.2: also at the foot of the sections list).
export function AboutCard({ version }) {
  const t = useT();
  return (
    <Card data-testid="settings-about">
      <CardHeader className="flex-row items-center gap-3"><img src="./icon-o.png" alt="" className="size-10 shrink-0 rounded-[22%]" data-testid="about-icon" /><div><CardTitle>{PRODUCT.name} {version}</CardTitle></div></CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t('about.developer')}</span>
          <button type="button" onClick={() => bridge.openExternal(AUTHOR.url)} className="hover:text-primary inline-flex cursor-pointer items-center gap-1.5 font-medium" data-testid="about-github"><ToolIcon tool="gh" className="size-4" />@{AUTHOR.github}<ExternalLink className="text-muted-foreground size-3.5" /></button>
        </div>
        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t('about.license')}</span><span>MIT</span></div>
        {musicAvailable() ? (
          <details data-testid="about-music">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3"><span className="text-muted-foreground">{t('about.music')}</span><span>{t('about.musicSummary', { n: MUSIC_CREDITS.length })}</span></summary>
            <ul className="text-muted-foreground mt-1 grid gap-0.5 text-xs">
              {MUSIC_CREDITS.map((m) => <li key={m.id}><button type="button" onClick={() => bridge.openExternal(m.page)} className="hover:text-primary cursor-pointer text-left">{t('about.musicTrack', { title: m.title, author: m.author })} · {m.licence}</button></li>)}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
