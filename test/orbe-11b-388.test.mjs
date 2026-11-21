// 3.8.8 paso 11b (tanda 2), interfaz del chat con Orbe: el «+» (adjuntar y capturar la ventana) y la tarjeta «parada».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import es from '../src/shared/locales/es/chat.mjs';
import en from '../src/shared/locales/en/chat.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const chat = read('src/ui/views/chat.jsx');
const card = read('src/ui/components/conversation/stopped-card.jsx');
const chip = read('src/ui/components/conversation/attach-chip.jsx');
const session = read('src/ui/views/session.jsx');

test('the box of the chat with Orbe has the «+» left of «Auto», with the same menu as an agent\'s chat', () => {
  assert.match(chat, /import \{ AttachMenu \} from '@\/components\/conversation\/attach-menu\.jsx'/);
  const group = chat.slice(chat.indexOf('data-testid="composer-group-access"'));
  assert.ok(group.indexOf('<AttachMenu') > 0 && group.indexOf('<AttachMenu') < group.indexOf('<AutonomySwitch'), 'before «Auto»');
  assert.match(chat, /<AttachMenu onAttach=\{async \(\) => addImages\(await bridge\.pickAttachments\(\)\)\} onCapture=\{fullPc\(\) && canCapture\(\) \? capture : null\} \/>/);
  // the window is only captured when the user picks that option, through the same call as in an agent's chat
  assert.match(chat, /const dataUrl = await captureFrame\(\); if \(!dataUrl\) return;\n\s+const saved = await act\(call\('images\.mark', \{ dataUrl \}\)\)/);
  assert.equal((chat.match(/captureFrame\(\)/g) ?? []).length, 1);
});

test('the attachments travel with the message in every way of sending it, and come back if it fails', () => {
  assert.match(chat, /call\('chat\.send', \{ text: msg, conversation: id, \.\.\.files \}\)/);
  assert.match(chat, /\.\.\.\(Object\.keys\(chosen\)\.length \? \{ brain: chosen \} : \{\}\), \.\.\.files \}\)/);
  assert.match(chat, /call\('sessions\.send', \{ id: s\.id, text: msg, \.\.\.files \}\)/);
  assert.match(chat, /const files = sentImages\.length \? \{ images: sentImages \} : \{\};/);
  assert.match(chat, /if \(idNow\.current === id\) setImages\(\(now\) => \(now\.length \? now : sentImages\)\)/, 'a failed send gives them back, only to their own conversation');
  assert.match(chat, /useEffect\(\(\) => \{ setImages\(\[\]\); \}, \[id\]\)/, 'never to another conversation');
  assert.match(chat, /t\('session\.lookAtFiles'\)/, 'only files: the same line as an agent\'s chat');
  assert.match(chat, /attached=\{images\.length > 0\}/);
  assert.match(chat, /onPaste=\{\(e\) => \{ fromTransfer\(e\.clipboardData\)/);
  assert.match(chat, /onDrop=\{\(e\) => \{ fromTransfer\(e\.dataTransfer\)\.then\(addImages\)/);
});

test('the message bubble draws what was attached, and the agent\'s chat is not touched', () => {
  assert.match(chat, /\{m\.body\}<AttachedFiles files=\{m\.meta\?\.images\} \/>/);
  assert.match(chip, /data-testid="message-attachments"/);
  assert.match(chip, /data-testid="message-attachment"/);
  // the agent's chat keeps its own sending as it was
  assert.match(session, /call\('sessions\.send', \{ id: s\.id, text: said, images: sentImages, mode, comments: taken\.length \? taken : undefined \}\)/);
  assert.match(session, /<AttachMenu onAttach=\{async \(\) => addImages\(await bridge\.pickAttachments\(\)\)\} onCapture=\{fullPc\(\) && canCapture\(\) \? capture : null\} \/>/);
});

test('the «Orb ha parado el turno» card has the mock-up\'s parts and only calls what a task already has', () => {
  assert.match(chat, /m\.meta\?\.kind === 'turn-stopped'\) return <StoppedCard m=\{m\} name=\{name\} \/>/);
  assert.match(card, /data-testid="stopped-card"/);
  assert.match(card, /data-testid="stopped-reason"/);
  assert.match(card, /<OctagonAlert/);
  assert.match(card, /<Badge variant="destructive">\{t\('chat\.stopped\.badge'\)\}<\/Badge>/);
  // «Ver tarea» goes to the task and «Deshacer esta tarea» is the task's own undo (it asks first, then tasks.undo)
  assert.match(card, /go\(\{ view: 'tasks', id: meta\.task \}\)/);
  assert.match(card, /undoTask\(t, task\)/);
  // the photo is only in the task's detail (the list does not carry it): asked there, read only
  assert.match(card, /call\('tasks\.get', \{ id: meta\.task \}\)\.then\(\(d\) => \{ if \(alive\) setPhoto\(Boolean\(d\?\.hasCheckpoint\)\); \}, quiet\)/);
  assert.match(card, /task && photo && task\.status !== 'running' && !task\.held/, 'the condition of the task\'s own «Deshacer»');
  assert.doesNotMatch(card, /call\('tasks\.(accept|approve|resume|undo)|call\('permissions|setMode|unlock/, 'no way round the stop');
  assert.doesNotMatch(card, /text-primary(?!-)/);
});

test('the texts are in both languages', () => {
  for (const key of ['chat.stopped.title', 'chat.stopped.badge']) { assert.ok(es[key], `es ${key}`); assert.ok(en[key], `en ${key}`); }
});
