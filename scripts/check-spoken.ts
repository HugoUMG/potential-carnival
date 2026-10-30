// Comprobación de src/games/spoken.ts:  npx tsx scripts/check-spoken.ts (vive en scripts/: importa módulos de Node).
import assert from 'node:assert/strict';
import { matchSpoken, spokenWords } from '../src/games/spoken';

const all = (target: string, heard: string) => matchSpoken(target.toLowerCase().split(' '), heard).every(Boolean);

assert.deepEqual(spokenWords('$12.50 at 7:00, 1,500 people'), ['twelve', 'fifty', 'at', 'seven', 'one', 'thousand', 'five', 'hundred', 'people']);
assert.ok(!all('twelve dollars fifty', '$12.50')); // falta "dollars"
assert.ok(all('twenty five dollars', '25 dollars'));
assert.ok(all("I'm fine", 'I am fine'));
assert.ok(all('I am fine', "I'm fine"));
assert.ok(all("it's seven thirty", 'It is 7:30.'));
assert.ok(all("don't worry", 'Do not worry'));
assert.ok(all("Tom's car", "Tom's car"));
assert.deepEqual(matchSpoken(["i'm", 'very', 'tired'], 'I very tired'), [false, true, true]); // falta "am"
console.log('spoken.ts ok');
