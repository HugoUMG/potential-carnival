/**
 * Comprobación del serializador del constructor visual:  npx tsx scripts/check-dsl-serializer.ts
 *
 * `esc()` escapaba el backslash antes que la comilla, y el parser del backend solo quita las
 * comillas EXTERIORES. Resultado: el alumno veía backslashes sueltos en cualquier texto con
 * salto de línea o con comillas guardado desde el modo visual.
 *
 * Vive en scripts/ (como shots.mjs) y no en src/: importa módulos de Node y el tsconfig de la
 * app solo cubre código de navegador.
 */
import assert from 'node:assert/strict';
import { serializeToScript, emptyState, emptyActivity, emptyBlock } from '../src/utils/dslSerializer';

/** Lo que el alumno acaba viendo: el parser quita las comillas exteriores y RichText traduce \n. */
function comoLoVeElAlumno(script: string, campo: string): string {
  const linea = script.split('\n').find((l) => l.trim().startsWith(`${campo}:`));
  if (!linea) throw new Error(`no se serializó el campo ${campo}`);
  const valor = linea.trim().slice(campo.length + 1).trim().replace(/^"|"$/g, '');
  return valor.replace(/\\n/g, '\n');
}

const state = emptyState();
state.title = 'Prueba';
const reading = emptyActivity('reading');
reading.readingTitle = 'Texto';
reading.readingContent = 'Line one.\nLine two.';
const mc = emptyActivity('multiplechoice');
mc.question = 'Say "hello" to her.';
const lo = emptyActivity('listeningorder');
lo.audioText = 'What time do you get up?';
lo.answer = 'What, time, do, you, get, up';
lo.voice = 'female';
lo.rate = '-35%';
state.blocks = [{ ...emptyBlock(), title: 'P1', activities: [reading, mc, lo] }];

const script = serializeToScript(state);

// Un salto de línea llega como salto de línea, sin backslash suelto.
assert.equal(comoLoVeElAlumno(script, 'content'), 'Line one.\nLine two.');

// Las comillas internas salen tipográficas, nunca como \"
assert.equal(comoLoVeElAlumno(script, 'question'), 'Say ”hello” to her.');
assert.ok(!script.includes('\\"'), 'el DSL no debe contener \\" (queda literal en el parser)');

// El visual serializa voz y velocidad de las listening*, igual que las escribe a mano en el DSL.
assert.equal(comoLoVeElAlumno(script, 'voice'), 'female');
assert.equal(comoLoVeElAlumno(script, 'rate'), '-35%');

console.log('dslSerializer: ok');
