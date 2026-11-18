// 3.8.8 step 11b (batch 4B), project page: the PR filter and its rows, Vigilando / permission / Revisar tarea inside the PR,
// «Sincronizar», «Escribir entrada», and where the functions the mock-up does not draw now live. Reads the code as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page = read('src/ui/views/project-page.jsx');
const pr = read('src/ui/components/pr-project.jsx');
const sync = read('src/ui/components/project-sync.jsx');
const card = read('src/ui/components/pr-card.jsx');

test('every new text exists in Spanish and English', () => {
  const keys = ['filterLabel', 'f.open', 'f.merged', 'f.closed', 'noneMerged', 'noneClosed', 'stateMerged', 'stateClosed', 'checksOk', 'checksFailOne', 'checksFailOther', 'checksRunning', 'readFail', 'watching', 'watchNote', 'askComment', 'askMerge', 'deny', 'allow', 'reviewTask', 'reviewMade']
    .map((k) => `projects.prs.${k}`)
    .concat(['sync', 'sync.title', 'sync.pullOne', 'sync.pullOther', 'sync.pushOne', 'sync.pushOther', 'sync.and', 'sync.note', 'sync.ok', 'sync.done', 'sync.upToDate', 'sync.diverged', 'sync.unsaved', 'sync.noRemote', 'sync.noBranch', 'sync.pushFailed', 'sync.pushNote', 'sync.busy', 'log.write', 'log.writeDesc', 'log.writeTitle', 'log.writeBody', 'log.written', 'tasks.moreKinds'].map((k) => `projects.${k}`));
  for (const k of keys) for (const l of [es, en]) assert.ok(l[k], k);
  assert.match(es['projects.sync.diverged'], /God mode/);
});

test('the PR filter has its three states with counters and reads the list of the chosen one', () => {
  assert.match(pr, /export function PrFilter/);
  assert.match(pr, /\['open', 'merged', 'closed'\]/);
  assert.match(pr, /projects\.prCounts/);
  assert.match(pr, /call\('projects\.prs', \{ name: project, state \}\)/);
  assert.match(page, /<PrFilter value=\{filter\}/);
  assert.match(page, /usePrList\(p\.name, filter, info\)/);
  assert.match(page, /<PrChecksBadge s=\{pr\.checksSummary\} \/>/);
  assert.match(page, /baseRefName \? <> → /, 'the row says where the PR goes');
  assert.match(page, /project-pr-filter|PrFilter/);
});

test('inside the PR: Vigilando only from a real watch, Denegar / Permitir are the card calls, Revisar tarea', () => {
  assert.match(pr, /call\('ciWatch\.list'\)/);
  assert.match(page, /watching && pr\.state === 'OPEN'/);
  assert.match(pr, /<PrCard r=\{\{ focusCancel: true, \.\.\.r \}\} onDone=\{onDone\} \/>/, 'the very card of the chat, Denegar focused');
  assert.match(card, /call\('prConfirm\.decline', refOf\(r\)\)/); assert.match(card, /call\('prConfirm\.answer', refOf\(r\)\)/);
  assert.match(card, /export function PrCard/);
  assert.match(card, /<pre [^>]*data-testid="pr-body">\{r\.body\}<\/pre>/, 'the whole comment');
  assert.match(pr, /r\.project !== project\).*r\.number !== number\)\) return null/, 'a request of another PR is not drawn');
  assert.match(pr, /r\?\.project === project && r\?\.number === number/, 'only the permissions of this PR');
  assert.match(card, /export const refOf/);
  assert.match(page, /projects\.prReview/);
  assert.match(page, /data-testid="project-pr-review"/);
  for (const id of ['project-pr-ask', 'project-pr-watching']) assert.ok((pr + page).includes(`data-testid="${id}"`), id);
  assert.match(page, /pr\.state !== 'OPEN' \|\| pr\.isDraft/, 'a PR that is not open cannot be merged');
  assert.match(page, /danger: true/, 'merging still asks');
});

test('«Sincronizar» shows the plan first and sends the numbers the user read', () => {
  assert.match(sync, /projects\.syncPlan/);
  assert.ok(sync.indexOf('projects.syncPlan') < sync.indexOf("choose(t('projects.sync.title')"), 'plan before the dialog');
  assert.ok(sync.indexOf("choose(t('projects.sync.title')") < sync.indexOf("call('projects.sync'"), 'dialog before the sync');
  assert.match(sync, /confirm\(t\('projects\.sync\.title'\), .*pushNote', \{ upstream \}\).*danger: true/, 'sending names the destination and is a danger dialog');
  assert.match(sync, /plan\.busy/);
  assert.match(sync, /projects\.sync\.pushFailed', \{ upstream, detail/);
  assert.doesNotMatch(es['projects.sync.pushFailed'] + en['projects.sync.pushFailed'], /trajo|came in/, 'a failed push does not claim anything was brought in');
  assert.match(sync, /behind: plan\.behind, ahead: plan\.ahead/);
  assert.match(sync, /pushFlow\(p, \{ branch, remote: 'origin' \}/, 'no remote branch: the existing push');
  assert.doesNotMatch(sync, /force/i);
  assert.match(page, /data-testid="project-sync"/); assert.match(page, /data-testid="project-panel-sync"/);
});

test('«Escribir entrada» is in the summary card and the logbook tab', () => {
  assert.match(sync, /call\('logs\.addEntry'/);
  assert.match(page, /data-testid="project-log-write"/);
  assert.match(page, /<LogCard p=\{p\} full \/>/);
  for (const id of ['project-log-entry-title', 'project-log-entry-body']) assert.ok(sync.includes(`data-testid="${id}"`), id);
});

test('what the mock-up does not draw moved to the menus: working project, refresh, expert mode, the reviews', () => {
  const menu = page.slice(page.indexOf('data-testid="project-page-menu-list"'), page.indexOf('</DropdownMenuContent>', page.indexOf('data-testid="project-page-menu-list"')));
  for (const id of ['project-set-active', 'project-git-refresh', 'project-expert-open']) assert.match(menu, new RegExp(`data-testid="${id}"`), id);
  assert.doesNotMatch(page, /data-testid="project-work-card"/);
  const split = page.slice(page.indexOf('data-testid="project-new-task-split"'));
  for (const id of ['project-new-task', 'project-new-task-more', 'project-review', 'project-security']) assert.ok(split.includes(`data-testid="${id}"`), id);
  assert.match(split, /askReview\(\{ project: p\.name \}\)/); assert.match(split, /askSecurityReview\(\{ project: p\.name \}\)/);
});
