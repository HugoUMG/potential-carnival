// Comprobación de src/games/verbData.ts:  npx tsx scripts/check-verbs.ts
import assert from 'node:assert/strict';
import { FORMS, VERBS } from '../src/games/verbData';

const BE = /\b(am|is|are|was|were|be|been|i’m)\s+(\w+\s+)?___/i;
const PRESENT = /\b(now|nowadays|these days|when|before|so|that)\b/i;

for (const { forms, gaps, es } of VERBS) {
  const [base, s, past, pp, ing] = forms;
  assert.equal(forms.length, FORMS.length, base);
  assert.equal(gaps.length, FORMS.length, base);
  assert.ok(es, base);
  assert.ok(forms.every((f) => /^[a-z]+$/.test(f)), base); // Oruga compara en minúsculas, sin espacios
  gaps.forEach((g) => assert.equal(g.split('___').length, 2, g));
  assert.ok(s !== base && ing !== base && /ing$/.test(ing), base);
  // Sin ancla de presente, en el hueco de -s también cabría el pasado.
  assert.match(gaps[1], PRESENT, gaps[1]);
  // Tras `be` cabrían el participio (pasiva) y el -ing: esas oraciones solo valen si el verbo lleva
  // objeto o no admite pasiva; las del participio se revisan a mano, aquí solo que -ing ≠ participio.
  if (BE.test(gaps[4])) assert.notEqual(ing, pp, gaps[4]);
  // "to ___" / modal en la base; have/has/had o pasiva en el participio.
  assert.match(gaps[3], /\b(have|has|had|hasn’t|was|were|is|been)\b/i, gaps[3]);
  assert.doesNotMatch(gaps[2], /\b(have|has|had)\s+___/i, gaps[2]);
}
assert.equal(new Set(VERBS.map((verb) => verb.forms[0])).size, VERBS.length); // sin verbos repetidos
assert.ok(VERBS.filter((verb) => verb.irregular).length >= 12 && VERBS.filter((verb) => !verb.irregular).length >= 12); // SHOTS de Camaleón
console.log(`verbData.ts ok (${VERBS.length} verbos)`);
