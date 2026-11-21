// «Enviar comentarios»: the speech bubble of the sidebar foot opens this form over it. The same form lives in
// Ajustes › Acerca de (views/settings/about.jsx), so its state and its one call to the engine are in useFeedback.
import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { AppWindow, Bug, Lightbulb, ImagePlus, X, Send, CircleCheck, LoaderCircle, WifiOff, CircleAlert, Lock } from 'lucide-react';
import { Popover, PopoverContent } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Textarea } from '@/components/ui/basic.jsx';
import { Segmented } from '@/components/ui/primitives.jsx';
import { act, bridge } from '@/lib/store.js';
import { notifyOk, notifyError } from '@/lib/notify.js';
import { useT } from '@/lib/i18n.js';

export const FEEDBACK_TYPES = ['error', 'idea', 'otro'];
// the mock-up's type buttons: a bug and a light bulb; «Otro» has no mark
const TYPE_ICON = { error: Bug, idea: Lightbulb };
const MAX_IMAGES = 3;

// The form's state. status: idle | sending | error | sent. With `toasts` the result is also announced as a passing
// notice (Ajustes has no other place to say it); the pop-up says it inside itself.
export function useFeedback({ toasts = false } = {}) {
  const t = useT();
  const [v, setV] = useState({ type: 'error', message: '', contact: '' });
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const room = images.length < MAX_IMAGES;
  const add = (list) => setImages((now) => [...now, ...list.filter(Boolean)].slice(0, MAX_IMAGES));
  // The capture shows the app behind the form (what the user wants to report), so the form hides while it is taken.
  const capture = async () => {
    document.documentElement.dataset.capturing = '1';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { return await act(bridge.feedback.capture()); } finally { delete document.documentElement.dataset.capturing; }
  };
  const addCapture = async () => add([await capture()]);
  const addImages = async () => add((await act(bridge.feedback.images())) ?? []);
  // Nothing leaves the PC until this runs, from the send button alone.
  const send = async () => {
    setStatus('sending'); setError('');
    try {
      const ok = await bridge.feedback.send({ ...v, images });
      if (!ok) { setStatus('idle'); return; }
      if (toasts) notifyOk(t('contribute.sent'));
      setV({ ...v, message: '' }); setImages([]); setStatus('sent');
    } catch (e) {
      if (toasts) notifyError(e);
      setError(e?.message ?? String(e)); setStatus('error');
    }
  };
  const again = () => setStatus('idle');
  return { v, setV, images, setImages, room, status, error, busy: status === 'sending', addCapture, addImages, send, again };
}

// The pop-up: a Popover that hangs from the whole sidebar foot (the anchor), `children` holding its trigger.
export function FeedbackPop({ children }) {
  const t = useT();
  const f = useFeedback();
  const [open, setOpen] = useState(false);
  const { v, setV, images, setImages, room, status, error, busy } = f;
  // A sent form shows its «thank you» until it is closed; the next time it opens it is ready for another message.
  const onOpenChange = (next) => { setOpen(next); if (!next && status === 'sent') f.again(); };
  const offline = error === t('sys.feedback.offline');
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children}
      <PopoverPrimitive.Anchor asChild><span className="foot-anchor" aria-hidden="true" /></PopoverPrimitive.Anchor>
      <PopoverContent side="top" align="start" alignOffset={8} offset={6} collisionPadding={8} className="foot-pop fb-pop" aria-label={t('nav.feedback')} data-testid="feedback-pop">
        <div className="fb-h"><b>{t('contribute.feedbackTitle')}</b><span>{t('contribute.feedbackDesc')}</span></div>
        {status === 'sent' ? (
          <div className="fb-ok" data-testid="feedback-sent" role="status">
            <CircleCheck />
            <b>{t('contribute.sent')}</b>
            <Button variant="outline" onClick={f.again} data-testid="feedback-again">{t('feedback.again')}</Button>
          </div>
        ) : (
          <>
            <div className="fb-form">
              <Segmented className="fb-type" aria-label={t('contribute.type')} value={v.type} onChange={(type) => setV({ ...v, type })}
                options={FEEDBACK_TYPES.map((value) => { const Icon = TYPE_ICON[value]; return { value, label: <>{Icon ? <Icon className="size-3.5" /> : null}{t(`contribute.type.${value}`)}</> }; })} />
              <Textarea className="fb-msg" rows={5} maxLength={5000} value={v.message} placeholder={t('contribute.messagePh')} aria-label={t('contribute.message')}
                onChange={(e) => setV({ ...v, message: e.target.value })} data-testid="feedback-pop-message" />
              {images.length ? (
                <div className="fb-imgs">
                  {images.map((img, i) => (
                    <span key={`${img.name}-${i}`} className="fb-img">
                      <img src={`data:${img.type};base64,${img.data}`} alt={img.name} />
                      <button type="button" aria-label={t('contribute.removeImage')} onClick={() => setImages(images.filter((_, j) => j !== i))}><X /></button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="fb-att">
                <Button variant="ghost" size="xs" disabled={!room} onClick={f.addCapture} data-testid="feedback-pop-capture"><AppWindow />{t('contribute.capture')}</Button>
                <Button variant="ghost" size="xs" disabled={!room} onClick={f.addImages}><ImagePlus />{t('contribute.addImage')}</Button>
                <span className="fb-n">{images.length ? t('feedback.imagesCount', { n: images.length }) : t('contribute.imagesLimit')}</span>
              </div>
              <label className="fb-mail">
                <span>{t('contribute.contact')}</span>
                <Input type="email" value={v.contact} maxLength={120} placeholder={t('contribute.contactPh')} onChange={(e) => setV({ ...v, contact: e.target.value })} />
                <small>{t('contribute.contactHint')}</small>
              </label>
              {status === 'error' ? (
                <p className="fb-err" role="alert" data-testid="feedback-error">{offline ? <WifiOff /> : <CircleAlert />}<span>{t('feedback.failed', { reason: error })}</span></p>
              ) : null}
            </div>
            <div className="fb-f">
              <span className="fb-priv"><Lock />{t('contribute.privacy')}</span>
              <Button disabled={busy || !v.message.trim()} onClick={f.send} data-testid="feedback-pop-send">
                {busy ? <LoaderCircle className="animate-spin" /> : <Send />}{busy ? t('feedback.sending') : t('contribute.send')}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
