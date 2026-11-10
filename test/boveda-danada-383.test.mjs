// 3.8.3 (uso real final): when Orb's keys cannot be opened because their files are damaged (a power cut mid-write), the
// user is told in plain words what happened, that nothing else is lost, and the two ways out: restore a backup, or
// «Borrar secretos y empezar de cero» and what that one loses. Nothing about the keys themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../src/shared/i18n.mjs';

test('bóveda dañada: qué pasó y cómo recuperarse, en llano (es y en)', () => {
  const es = translate('es', 'msg.master.damaged');
  for (const part of ['dañad', 'proyectos', 'Ajustes › Datos', 'copia de seguridad', '«He olvidado la contraseña»', '«Borrar secretos y empezar de cero»', 'conectores', 'móviles']) assert.ok(es.includes(part), `es: ${part}`);
  const en = translate('en', 'msg.master.damaged');
  for (const part of ['damaged', 'projects', 'Settings › Data', 'backup', 'conn', 'phones']) assert.ok(en.includes(part), `en: ${part}`);
  for (const text of [es, en]) assert.doesNotMatch(text, /secretos\.json|\{|\}|token|clave maestra/i);
});
