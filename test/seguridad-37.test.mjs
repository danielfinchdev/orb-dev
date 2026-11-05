// 3.7 security review: a linked Orb only touches the bots of the persons this Orb serves to it (knowing a uid is not
// enough), and the agents of Orb Server never reach the admin helper without no_new_privs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';

test('replica: otro Orb no puede tomar, reclamar ni pisar un bot de otra persona', async () => {
  const t = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const { createReplica } = await import('../src/engine/replica.mjs');
    const { createPerson } = await import('../src/core/persons.mjs');
    const B = await import('../src/core/bots.mjs');
    const R = await import('../src/core/replica.mjs');
    const board = new Board();
    const self = R.selfId(board) ?? 'SELF';
    if (!R.selfId(board)) board.setting('orb_self', self);
    const maria = createPerson(board, { name: 'María' }).id;
    const rep = createReplica({ board, bots: null });
    // The Admin's bot run here, and a copy of another Admin's bot whose home is the Admin's PC.
    const here = B.createBot(board, { name: 'Casa', tools: [] });
    const hereRow = board.one('SELECT * FROM bots WHERE id = ?', here.id);
    const copy = B.createBot(board, { name: 'Copia', tools: [] });
    board.run('UPDATE bots SET home = ?, home_epoch = 1 WHERE id = ?', 'ADMIN-PC', copy.id);
    const copyRow = board.one('SELECT * FROM bots WHERE id = ?', copy.id);
    const mariaOrb = { id: 'dev-m', key: 'MARIA-ORB', person: maria, name: 'Orb de María' };
    const adminPc = { id: 'dev-a', key: 'ADMIN-PC', person: null, name: 'PC' };

    // María's Orb: commit (become the home of the copy), claim (take the bot run here), prepare: all refused or no-ops.
    await assert.rejects(() => rep.serve(mariaOrb, 'home.commit', { uid: copyRow.uid, epoch: 9 }));
    assert.equal(board.one('SELECT home FROM bots WHERE id = ?', copy.id).home, 'ADMIN-PC');
    await rep.serve(mariaOrb, 'home.claim', { uid: hereRow.uid, home: 'MARIA-ORB', epoch: 9 });
    const h = board.one('SELECT home, home_epoch FROM bots WHERE id = ?', here.id);
    assert.ok(R.isHomeHere(board, h), 'sigue ejecutándose aquí');
    await rep.serve(mariaOrb, 'home.claim', { uid: copyRow.uid, home: 'MARIA-ORB', epoch: 9 });
    assert.equal(board.one('SELECT home FROM bots WHERE id = ?', copy.id).home, 'ADMIN-PC', 'la copia sigue apuntando a su casa');
    assert.equal((await rep.serve(mariaOrb, 'home.prepare', { uid: copyRow.uid })).ok, false);
    await assert.rejects(() => rep.serve(mariaOrb, 'replica.pull', { uid: hereRow.uid, since: 0 }));
    // A third Orb of the Admin that is not the copy's home cannot commit it either.
    await assert.rejects(() => rep.serve({ id: 'dev-x', key: 'OTHER', person: null }, 'home.commit', { uid: copyRow.uid, epoch: 9 }));
    // The copy's own home (the Admin's PC) can.
    const ok = await rep.serve(adminPc, 'home.commit', { uid: copyRow.uid, epoch: 2 });
    assert.equal(ok.ok, true);
    assert.ok(R.isHomeHere(board, board.one('SELECT home FROM bots WHERE id = ?', copy.id)));
    rep.stop?.();
  } finally { t.cleanup(); }
});

test('motores: sin no_new_privs no arranca si está el ayudante de administración', async () => {
  const { runScript } = await import('../src/server/engines.mjs');
  const s = runScript({ bin: '/x/claude' });
  // /etc/sudoers.d is not readable by the user: the check must look at the helper itself.
  assert.match(s, /\/usr\/local\/libexec\/orb-server-admin/);
  assert.doesNotMatch(s, /-e \/etc\/sudoers\.d/);
  const { confineArgs } = await import('../src/agents/common.mjs');
  assert.deepEqual(confineArgs('/bin/claude', ['-p'], { platform: 'win32' }), { cmd: '/bin/claude', args: ['-p'] });
  assert.deepEqual(confineArgs('/bin/claude', ['-p'], { platform: 'linux', helper: false }), { cmd: '/bin/claude', args: ['-p'] });
  assert.deepEqual(confineArgs('/bin/claude', ['-p'], { platform: 'linux', helper: true, setpriv: '/usr/bin/setpriv' }), { cmd: '/usr/bin/setpriv', args: ['--no-new-privs', '--', '/bin/claude', '-p'] });
  assert.throws(() => confineArgs('/bin/claude', [], { platform: 'linux', helper: true, setpriv: null }), /no_new_privs/);
});

test('control: el socket de reserva va en una carpeta solo de este usuario, nunca suelto en /tmp', { skip: process.platform === 'win32' }, async () => {
  const { controlPath, privateDir } = await import('../src/server/control.mjs');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const long = path.join(os.tmpdir(), 'x'.repeat(120));
  const p = controlPath(long);
  assert.notEqual(path.dirname(p), '/tmp');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ctl-'));
  fs.chmodSync(d, 0o755); assert.equal(privateDir(d), false);
  fs.chmodSync(d, 0o700); assert.equal(privateDir(d), true);
  fs.rmSync(d, { recursive: true, force: true });
});
