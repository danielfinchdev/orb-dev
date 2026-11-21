// The music player: the headphones of the sidebar foot open it over the foot. Only Orb's own adaptive music (lib/music.js);
// nothing here starts it by itself: it plays after a click on «Reproducir», never when the player opens.
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { AudioLines, SkipBack, Play, Pause, LoaderCircle, Activity, Volume2 } from 'lucide-react';
import { Popover, PopoverContent, Switch, Range } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { useStore } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { subscribe as onMusic, musicState, toggleMusic, skipBack, setMusicTheme, setMusicReactive, setMusicIntensity, setMusicVolume } from '@/lib/music.js';
import { musicPrefs, previousTheme } from '../../shared/music.mjs';

const pct = (v) => `${Math.round(v * 100)} %`;

// One slider of the player: heard while it is dragged, saved when it is let go. It follows the saved value, so a change
// made in Ajustes › Apariencia shows here too.
function Slider({ icon: Icon, label, saved, onLive, onKeep, disabled, testid }) {
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  const keep = () => onKeep(v);
  return (
    <label className="mp-sl">
      <span className="mp-k"><Icon />{label}</span>
      <Range min={0} max={1} step={0.05} value={v} disabled={disabled} aria-label={label} data-testid={testid}
        onChange={(e) => { const n = Number(e.target.value); setV(n); onLive(n); }} onPointerUp={keep} onKeyUp={keep} />
      <span className="mp-v">{pct(v)}</span>
    </label>
  );
}

// next: the «next» button, drawn by the sidebar (it knows the label of what it skips to). children: the headphones.
export function MusicPlayer({ next, children }) {
  const t = useT();
  const s = useSyncExternalStore(onMusic, musicState);
  const ui = useStore((st) => st.app?.config?.ui);
  const prefs = musicPrefs(ui);
  const running = Boolean(s.playing || s.loading);
  const theme = running && s.theme ? s.theme : prefs.theme;
  const manual = !prefs.reactive;
  // While it plays the engine skips by itself; before, the arrows only choose the style the next play will start with.
  const back = () => (s.playing ? skipBack() : setMusicTheme(previousTheme(prefs.theme)));
  return (
    <Popover>
      {children}
      <PopoverPrimitive.Anchor asChild><span className="foot-anchor" aria-hidden="true" /></PopoverPrimitive.Anchor>
      <PopoverContent side="top" align="start" alignOffset={8} offset={6} collisionPadding={8} className="foot-pop music-pop" aria-label={t('nav.music')} data-testid="music-pop" data-music-button="">
        <div className="mp-now">
          <span className="mp-art"><AudioLines /></span>
          <span className="mp-t">
            <b data-testid="music-pop-name">{t(`nav.musicTheme.${theme}`)}</b>
            {s.error ? <span className="mp-err" role="alert">{t('nav.musicErrorAdaptive')}</span> : <span>{t(`player.theme.${theme}`)}</span>}
          </span>
        </div>
        <div className="mp-ctl">
          <IconButton label={t('nav.musicPrevTheme')} onClick={back} data-testid="music-pop-prev"><SkipBack className="size-4" /></IconButton>
          <Button size="icon" className="mp-play" aria-label={running ? t('nav.musicPause') : t('nav.musicPlay')} onClick={() => toggleMusic()} data-testid="music-pop-play">
            {s.loading ? <LoaderCircle className="animate-spin" /> : s.playing ? <Pause /> : <Play />}
          </Button>
          {next}
        </div>
        <hr className="mp-hr" />
        <div className="mp-row">
          <span className="mp-lab"><b>{t('player.manual')}</b><span>{t('player.manualHint')}</span></span>
          <Switch checked={manual} onCheckedChange={(on) => setMusicReactive(!on)} aria-label={t('player.manual')} data-testid="music-pop-manual" />
        </div>
        {/* with «Manual» off the slider shows how far the music has risen by itself (the engine's own figure, while it plays) */}
        <Slider icon={Activity} label={t('player.adaptation')} saved={!manual && s.intensity != null ? s.intensity : prefs.intensity} disabled={!manual} testid="music-pop-intensity"
          onLive={(n) => setMusicIntensity(n)} onKeep={(n) => setMusicIntensity(n, { save: true })} />
        <Slider icon={Volume2} label={t('player.volume')} saved={prefs.volume} testid="music-pop-volume"
          onLive={(n) => setMusicVolume(n)} onKeep={(n) => setMusicVolume(n, { save: true })} />
      </PopoverContent>
    </Popover>
  );
}
