// 3.8.9, visual fixes (II) of the PC interface and Android's texts. Read as text where the code is JSX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

test('42: the composer shows the orchestrator icon, lit when on and dim when off', () => {
  const chat = src('views', 'chat.jsx');
  const sw = chat.slice(chat.indexOf('function OrchestratorSwitch'), chat.indexOf('function LiveAnswer'));
  assert.match(chat, /import \{ OrchestratorIcon \}/);
  assert.match(sw, /<OrchestratorIcon className=\{cn\('size-4', on \? 'text-primary' : 'text-muted-foreground'\)\}/);
  assert.doesNotMatch(sw, /\{t\('chat\.orchestrator'\)\}<\/span>/, 'no «Orquestador» word next to the switch');
  assert.match(sw, /aria-label=\{t\('chat\.orchestrator'\)\}/);
  assert.match(sw, /title=\{t\('chat\.orchestratorTip'/);
});

test('43: the new chat has the full permissions menu and applies it to the chat it creates', () => {
  const chat = src('views', 'chat.jsx');
  assert.match(chat, /<AutonomySwitch \{\.\.\.newChatAccess\} testid="chat-autonomy"/);
  assert.match(chat, /options\(PERMISSION\)\.filter/);
  assert.match(chat, /key: 'android'/);
  // the chosen level goes to sessions.create; the total level and the phone are granted with the master password
  assert.match(chat, /\{ permission: level \}/);
  assert.match(chat, /sessions\.grantTotal/);
  assert.match(chat, /sessions\.grantAndroid/);
  // a chat without a project groups «Solo lectura» as the main level and the rest under «Más opciones»
  assert.match(src('views', 'session.jsx'), /<AutonomySwitch main=\{\['leer'\]\}/);
});
