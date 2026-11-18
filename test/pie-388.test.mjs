// Orb UI 2.0, the sidebar foot: the headphones open the music player and the bubble opens «Enviar comentarios», both as
// pop-ups over the foot. Read as text, like the other interface tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const sidebar = read('components/sidebar.jsx');
const player = read('components/music-player.jsx');
const feedback = read('components/feedback-pop.jsx');
const about = read('views/settings/about.jsx');
const css = read('app.css');

test('the headphones open the player, which holds every control', () => {
  assert.match(sidebar, /<MusicPlayer next=\{<IconButton[^>]*data-testid="nav-music-next"/);
  assert.match(sidebar, /<PopoverTrigger asChild>\s*<button[^>]*data-testid="nav-music"/);
  assert.doesNotMatch(sidebar, /onClick=\{toggleMusic\}/, 'the headphones no longer toggle by themselves');
  assert.match(player, /aria-label=\{t\('nav\.music'\)\}/);
  assert.match(player, /onClick=\{back\}/);
  assert.match(player, /const back = \(\) => \(s\.playing \? skipBack\(\) :/);
  assert.match(player, /onClick=\{\(\) => toggleMusic\(\)\}/);
  assert.match(sidebar, /const skip = \(\) => \(s\.playing \? skipTrack\(\) :/);
  assert.match(sidebar, /onClick=\{skip\}/);
  assert.match(player, /onCheckedChange=\{\(on\) => setMusicReactive\(!on\)\}/, '«Manual» is the music that does not react');
  assert.match(player, /setMusicIntensity\(n, \{ save: true \}\)/);
  assert.match(player, /setMusicVolume\(n, \{ save: true \}\)/);
});

test('nothing starts the music without a click', () => {
  // The only way to start it is toggleMusic, inside the play button's handler; nothing runs it from an effect or on mount.
  assert.equal((player.match(/toggleMusic\(/g) ?? []).length, 1);
  assert.equal((sidebar.match(/toggleMusic/g) ?? []).length, 0);
  for (const src of [player, sidebar]) for (const m of src.matchAll(/useEffect\(([\s\S]*?)\n?\s*\}?, \[[^\]]*\]\)/g)) assert.doesNotMatch(m[1], /toggleMusic|startMusic|skipTrack|skipBack|setMusicMode/);
  assert.doesNotMatch(player, /startMusic|playNow|autoPlay|autoplay/);
});

test('only the adaptive music is offered, never the tracks', () => {
  assert.doesNotMatch(player, /setMusicMode|MUSIC_MODES|mode: 'tracks'|'tracks'/);
  assert.doesNotMatch(sidebar, /setMusicMode|mode: 'tracks'/);
});

test('«Enviar comentarios» is a pop-up with the same single call as before', () => {
  assert.match(sidebar, /<FeedbackPop>\s*<BubbleTip[^>]*>\s*<PopoverTrigger asChild>\s*<button[^>]*data-testid="nav-feedback"/);
  assert.doesNotMatch(sidebar, /openSettings\('contribuye'\)/);
  // The call that was in Ajustes at HEAD, now in one place, run only by the send button.
  assert.equal((feedback.match(/bridge\.feedback\.send\(\{ \.\.\.v, images \}\)/g) ?? []).length, 1);
  assert.doesNotMatch(about, /bridge\.feedback\.send/);
  assert.equal((feedback.match(/\bsend\b/g) ?? []).length > 0, true);
  assert.match(feedback, /onClick=\{f\.send\}/);
  assert.equal((feedback.match(/f\.send|\{ send \}|= send\b/g) ?? []).length, 1, 'no other caller of send');
  assert.doesNotMatch(feedback, /useEffect/, 'nothing is sent or attached from an effect');
  // Only what the user chose: the capture and the images are buttons, the limits are the same.
  assert.match(feedback, /const MAX_IMAGES = 3;/);
  assert.match(feedback, /maxLength=\{5000\}/);
  assert.match(feedback, /maxLength=\{120\}/);
  assert.match(feedback, /onClick=\{f\.addCapture\}/);
  assert.match(feedback, /t\('contribute\.privacy'\)/, 'the user is still told how it is sent');
  assert.match(about, /useFeedback\(\{ toasts: true \}\)/, 'Ajustes › Acerca de keeps its form');
});

test('the pop-up has its three states', () => {
  assert.match(feedback, /status === 'sent'/);
  assert.match(feedback, /status === 'error'/);
  assert.match(feedback, /busy \? t\('feedback\.sending'\)/);
  assert.match(feedback, /offline \? <WifiOff/);
});

test('every test id of the foot and of the forms is still there', () => {
  for (const id of ['nav-music', 'nav-music-next', 'nav-feedback', 'sidebar-footer', 'app-version']) assert.ok(sidebar.includes(`data-testid="${id}"`), id);
  for (const id of ['feedback-capture', 'feedback-message', 'feedback-send']) assert.ok(about.includes(`data-testid="${id}"`), id);
  assert.match(sidebar, /aria-pressed=\{s\.playing\}/);
});

test('both pop-ups are dialogs hanging from the foot, with Escape and the focus handled by the popover', () => {
  for (const src of [player, feedback]) {
    assert.match(src, /<PopoverContent side="top" align="start" alignOffset=\{8\}[^>]*aria-label=/);
    assert.match(src, /PopoverPrimitive\.Anchor asChild><span className="foot-anchor"/);
  }
  assert.match(css, /\.orb-tip\.foot-pop \{ width: calc\(var\(--radix-popover-trigger-width\) - 16px\);/);
  assert.match(css, /\.foot-anchor \{ position: absolute; inset: 0;/);
  assert.match(sidebar, /className="side-foot border-border relative /);
  assert.match(css, /html\[data-capturing\][^{]*feedback-pop/, 'the capture does not show the pop-up');
  assert.doesNotMatch(css.slice(css.indexOf('the sidebar foot\'s pop-ups')), /app-region/);
});

test('11D: the two pop-ups sit where the mock-up puts them and the form has its icons', () => {
  for (const src of [player, feedback]) assert.match(src, /alignOffset=\{8\} offset=\{6\} collisionPadding=\{8\}/);
  assert.match(feedback, /const TYPE_ICON = \{ error: Bug, idea: Lightbulb \}/);
  assert.match(feedback, /<AppWindow \/>\{t\('contribute\.capture'\)\}/);
  assert.doesNotMatch(feedback, /Camera/);
});
