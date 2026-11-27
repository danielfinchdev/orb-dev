// The uninstall note: a pure URL for a prefilled GitHub issue with the text and the Orb version only.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { surveyUrl, surveyIssue, cleanSurvey, SURVEY_MAX } from '../src/shared/uninstall-survey.mjs';
import { AUTHOR } from '../src/shared/product.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

test('nothing to send when the text is empty', () => {
  assert.equal(surveyUrl('', '3.8.12'), null);
  assert.equal(surveyUrl('   \n ', '3.8.12'), null);
  assert.equal(surveyUrl(undefined, '3.8.12'), null);
});

test('the URL points to github.com/<repo>/issues/new with the title and an encoded body', () => {
  const url = surveyUrl('Uso otro programa & más / "cosas"?', '3.8.12');
  assert.ok(url.startsWith(`https://github.com/${AUTHOR.repo}/issues/new?title=Uninstall%20feedback&body=`));
  const u = new URL(url);
  assert.equal(u.host, 'github.com');
  assert.deepEqual([...u.searchParams.keys()], ['title', 'body']);
  assert.equal(u.searchParams.get('body'), 'Uso otro programa & más / "cosas"?\n\nOrb 3.8.12');
});

test('the text is cut at 280 characters on one line, without splitting a character', () => {
  assert.equal(cleanSurvey('a'.repeat(400)).length, SURVEY_MAX);
  assert.equal([...cleanSurvey('😀'.repeat(300))].length, SURVEY_MAX);
  assert.equal(cleanSurvey('uno\n\n  dos'), 'uno dos');
});

test('only the text and the version go in: no paths, system or user names', () => {
  const issue = surveyIssue('motivo', '3.8.12');
  assert.equal(issue.body, 'motivo\n\nOrb 3.8.12');
  assert.ok(!/[\\/:\s]/.test(surveyIssue('motivo', '3.8.12 C:\\Users').version));
  assert.ok(!/[\\/:]/.test(surveyIssue('motivo', 'C:\\Users\\x/y').version));
  assert.equal(surveyIssue('motivo', undefined).body, 'motivo');
});

test('the repo cannot escape github.com', () => {
  assert.ok(surveyUrl('x', '1', 'a/b').startsWith('https://github.com/a/b/issues/new?'));
});

test('the flow opens the page before the uninstaller and a failure does not stop the uninstall', () => {
  const view = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'uninstall.jsx'), 'utf8');
  const survey = view.indexOf('askSurvey(');
  const run = view.indexOf("call('uninstall.run'");
  assert.ok(survey > 0 && survey < run);
  assert.match(view, /openExternal\(url\)[^\n]*catch/);
});

test('the texts exist in both languages and follow the style guide', () => {
  for (const k of ['title', 'body', 'label', 'count', 'skip', 'next', 'confirmTitle', 'confirmBody', 'public', 'open', 'no']) {
    assert.equal(typeof es[`uninstall.survey.${k}`], 'string', k);
    assert.equal(typeof en[`uninstall.survey.${k}`], 'string', k);
  }
  assert.equal(es['uninstall.survey.public'], 'Se abrirá en GitHub como comentario público con tu cuenta.');
  assert.equal(es['uninstall.survey.confirmTitle'], '¿Abrir tu comentario en GitHub para enviarlo?');
});
