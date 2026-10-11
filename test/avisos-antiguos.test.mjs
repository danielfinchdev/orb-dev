// Avisos antiguos (2.7.3): las líneas grises de sistema guardadas antes de la 2.7 (carpeta de trabajo, modo, nueva
// conversación…) pasan a ser avisos y salen del chat; lo demás (tus mensajes, los del asistente y otros avisos del
// sistema) se queda igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../src/core/db.mjs';

test('avisos antiguos: las líneas grises de siempre pasan a avisos y nada más cambia', () => {
  const db = openDb(':memory:');
  const add = db.prepare("INSERT INTO chat (role, body, at) VALUES (?, ?, '2026-10-01T10:00:00Z')");
  add.run('system', '📁 Carpeta de trabajo: erp (D:\\Orb\\web\\erp). Las tareas nuevas solo trabajarán ahí.');
  add.run('system', 'Carpeta de trabajo: erp (D:\\Orb\\web\\erp). Las tareas nuevas se ejecutarán en esta carpeta.');
  add.run('system', 'Working folder: erp (D:\\Orb\\web\\erp). New tasks will run in this folder.');
  add.run('system', 'Modo libre: el asistente puede leer, editar y ejecutar comandos en la carpeta del proyecto.');
  add.run('system', 'Nueva conversación. Orbe no conserva el contexto anterior.');
  add.run('system', '⚠️ La tarea #3 «Web» necesita tu aprobación (publica).');
  add.run('user', 'Carpeta de trabajo: esto lo escribí yo');
  add.run('assistant', 'Modo libre: te explico cómo funciona');
  migrate(db);
  const roles = db.prepare('SELECT role FROM chat ORDER BY id').all().map((r) => r.role);
  assert.deepEqual(roles, ['notice', 'notice', 'notice', 'notice', 'notice', 'system', 'user', 'assistant']);
  migrate(db); // otra vez, sin cambios: se puede ejecutar en cada arranque
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat WHERE role = 'notice'").get().n, 5);
});
