// 3.6: one person's data (src/core/export.mjs). Leo's export has everything of Leo and nothing of Ana; after deleting
// Leo nothing of Leo is left (outside the 30-day trash), his lines in Ana's chat say «(mensaje borrado)», and the
// usage totals stay right.
import './helpers.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/core/context.mjs';
import { Board } from '../src/core/board.mjs';
import { createPerson } from '../src/core/persons.mjs';
import { principalOf, AuthzError } from '../src/core/authz.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { unzipFiles, personsTrash, purgePersonsTrash } from '../src/core/export.mjs';
import { unsealInto } from '../src/core/backup.mjs';
import { walkFiles } from '../src/core/backup.mjs';

const home = tempHome();
after(() => home.cleanup());
const board = new Board();
const api = buildApi({ board, sessions: {}, orchestrator: {}, scheduler: {}, emit: () => {}, log: () => {}, version: 'test' });
const ana = board.ownerId();
const leo = createPerson(board, { name: 'Leo', tz: 'Europe/Madrid' }).id;
const asAna = principalOf(board, { desktop: true });
const asLeo = principalOf(board, { desktop: true, person: leo });
const now = () => new Date().toISOString();

// Ana: a conversation where Leo wrote too; Leo: his own conversation, a device, usage.
const conv = (title, person) => board.createConversation({ title, person }).id;
const line = (c, role, body, person) => board.run('INSERT INTO chat (role, body, at, conversation_id, person_id) VALUES (?, ?, ?, ?, ?)', role, body, now(), c, person);
const gconv = conv('De Ana', ana);
line(gconv, 'usuario', 'ANA-ESCRIBE en su chat', ana);
line(gconv, 'orb', 'respuesta-a-ana', ana);
line(gconv, 'usuario', 'LEO-ESCRIBE en el chat de Ana', leo);
line(gconv, 'orb', 'RESPUESTA-A-LEO', null);
const lconv = conv('De Leo', leo);
line(lconv, 'usuario', 'CHAT-PRIVADO-DE-LEO', leo);
board.run("INSERT INTO devices (id, name, token_hash, created_at, person_id) VALUES ('dev-leo', 'MOVIL-DE-LEO', 'h1', ?, ?)", now(), leo);
const spend = (pid, usd) => board.run('INSERT INTO usage_ledger (at, day, person_id, account_id, turns, tokens_in, tokens_out, usd) VALUES (?, ?, ?, ?, 1, 10, 20, ?)', now(), now().slice(0, 10), pid, 'claude', usd);
spend(ana, 13.37); spend(leo, 2.25); spend(leo, 0.25);

const dumpDb = () => board.all("SELECT name FROM sqlite_master WHERE type = 'table'").map(({ name }) => JSON.stringify(board.all(`SELECT * FROM "${name}"`))).join('\n');
const dumpFiles = (skip) => walkFiles(ctx.home, (n, full) => full.startsWith(skip) || n === 'exportaciones').filter((f) => !f.endsWith('.db') && !f.includes(`${path.sep}orb.db`)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('Leo exports his data: all of Leo, nothing of Ana; nobody exports someone else', async () => {
  const r = await api.call('data.exportPerson', {}, asLeo);
  assert.ok(r.path.endsWith('.zip'));
  const files = unzipFiles(fs.readFileSync(r.path));
  const names = files.map((f) => f.name);
  const all = files.map((f) => f.data.toString('utf8')).join('\n');
  for (const want of ['person.json', 'settings.json', 'projects.json', 'usage.csv', `conversations/${lconv}.jsonl`, `conversations/grupo-${gconv}.jsonl`]) assert.ok(names.includes(want), `falta ${want}`);
  for (const mine of ['LEO-ESCRIBE', 'RESPUESTA-A-LEO', 'CHAT-PRIVADO-DE-LEO', '2.25']) assert.ok(all.includes(mine), `falta ${mine}`);
  for (const theirs of ['ANA-ESCRIBE', 'respuesta-a-ana', '13.37', 'pin_hash']) assert.ok(!all.includes(theirs), `sobra ${theirs}`);
  // The owner cannot take Leo's export; Leo cannot delete Ana.
  await assert.rejects(api.call('data.exportPerson', { id: leo }, asAna), (e) => e instanceof AuthzError);
  await assert.rejects(api.call('data.deletePerson', { id: ana }, asLeo), (e) => e instanceof AuthzError);
  // With a passphrase it is sealed like a backup.
  const sealed = await api.call('data.exportPerson', { passphrase: 'frase de prueba larga' }, asLeo);
  assert.ok(sealed.path.endsWith('.orbbak'));
  assert.ok(!fs.readFileSync(sealed.path).includes(Buffer.from('CHAT-PRIVADO-DE-LEO')));
  const out = path.join(home.base, 'abierta'); await unsealInto(sealed.path, out, { passphrase: 'frase de prueba larga' });
  assert.match(fs.readFileSync(path.join(out, 'conversations', `${lconv}.jsonl`), 'utf8'), /CHAT-PRIVADO-DE-LEO/);
});

test('deleting Leo leaves nothing of him; his lines in Ana’s chat say «(mensaje borrado)»; totals stay; the owner stays', async () => {
  await assert.rejects(api.call('persons.remove', { id: ana }, asAna), /dueñ|owner|no se puede/i);
  const total = board.one('SELECT SUM(usd) AS s FROM usage_ledger').s;
  const r = await api.call('persons.remove', { id: leo }, asAna);
  assert.equal(r.deleted, true);
  const trash = personsTrash(ctx.home);
  const db = dumpDb(); const files = dumpFiles(trash);
  for (const mine of ['LEO-ESCRIBE', 'CHAT-PRIVADO-DE-LEO', 'MOVIL-DE-LEO', '"Leo"']) {
    assert.ok(!db.includes(mine), `en la base: ${mine}`); assert.ok(!files.includes(mine), `en archivos: ${mine}`);
  }
  const where = board.all("SELECT name FROM sqlite_master WHERE type = 'table'").filter(({ name }) => JSON.stringify(board.all(`SELECT * FROM "${name}"`)).includes(leo)).map((t) => t.name);
  assert.deepEqual(where, [], 'su id ya no está en ninguna fila');
  const lines = board.all('SELECT body FROM chat WHERE conversation_id = ? ORDER BY id', gconv).map((l) => l.body);
  assert.deepEqual(lines, ['ANA-ESCRIBE en su chat', 'respuesta-a-ana', '(mensaje borrado)', 'RESPUESTA-A-LEO']);
  assert.equal(board.one('SELECT SUM(usd) AS s FROM usage_ledger').s, total);
  assert.equal(board.one("SELECT SUM(usd) AS s FROM usage_ledger WHERE person_id = 'deleted'").s, 2.5);
  // Ana's things are untouched.
  assert.ok(board.conversation(gconv));
  // The trash keeps his export for 30 days, then it goes.
  const kept = fs.readdirSync(trash); assert.equal(kept.length, 1);
  assert.ok(fs.existsSync(path.join(trash, kept[0], 'export.zip')));
  assert.equal(purgePersonsTrash(ctx.home, Date.now() + 10 * 86_400_000), 0);
  assert.equal(purgePersonsTrash(ctx.home, Date.now() + 31 * 86_400_000), 1);
  assert.deepEqual(fs.readdirSync(trash), []);
});
