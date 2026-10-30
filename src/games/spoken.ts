// Comparar lo que se debía decir con lo que Whisper escribió. Whisper pone cifras ("$12.50", "7:30")
// y a veces separa o junta contracciones ("I am" por "I'm"): sin esto, una palabra bien dicha salía
// en rojo. Sin dependencias, para poder probarlo con Node (`scripts/check-spoken.ts`).

/** Qué palabras de `target` aparecen en `said`, en orden (subsecuencia común más larga). Así una
 *  palabra de más o de menos no descuadra el resto, como pasaría comparando posición a posición. */
export function matchWords(target: string[], said: string[]): boolean[] {
  const dp = Array.from({ length: target.length + 1 }, () => new Array<number>(said.length + 1).fill(0));
  for (let i = target.length - 1; i >= 0; i--) {
    for (let j = said.length - 1; j >= 0; j--) {
      dp[i][j] = target[i] === said[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hit = new Array<boolean>(target.length).fill(false);
  for (let i = 0, j = 0; i < target.length && j < said.length;) {
    if (target[i] === said[j]) { hit[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return hit;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Una cifra en palabras. ponytail: hasta 9999 y en la forma más común ("one hundred", no "a hundred"). */
function numberWords(n: number): string[] {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? numberWords(n % 100) : [])];
  if (n < 10000) return [...numberWords(Math.floor(n / 1000)), 'thousand', ...(n % 1000 ? numberWords(n % 1000) : [])];
  return [String(n)];
}

const SPECIAL: Record<string, string[]> = {
  "can't": ['can', 'not'], cannot: ['can', 'not'], "won't": ['will', 'not'], "let's": ['let', 'us'],
};
const ENDINGS: Record<string, string> = { "n't": 'not', "'re": 'are', "'ll": 'will', "'ve": 'have', "'d": 'would', "'m": 'am' };
// "'s" solo se abre tras estas palabras: en "Tom's" es posesivo y se queda igual.
const IS = new Set(['it', 'that', 'what', 'he', 'she', 'there', 'here', 'where', 'who', 'how']);

function expand(word: string): string[] {
  if (SPECIAL[word]) return SPECIAL[word];
  const m = /^(.+?)(n't|'re|'ll|'ve|'d|'m|'s)$/.exec(word);
  if (!m) return [word];
  if (m[2] === "'s") return IS.has(m[1]) ? [m[1], 'is'] : [word];
  return [m[1], ENDINGS[m[2]]];
}

/** Las palabras de un texto como se oyen: minúsculas, contracciones abiertas y cifras en palabras
 *  ("12.50" → twelve fifty, "7:00" → seven). */
export function spokenWords(text: string): string[] {
  const clean = text.toLowerCase().replace(/’/g, "'").replace(/(\d),(?=\d{3})/g, '$1');
  return [...clean.matchAll(/[a-z]+(?:'[a-z]+)*|\d+/g)].flatMap(([w]) => (
    /^\d/.test(w) ? (/^0+$/.test(w) && w.length > 1 ? [] : numberWords(Number(w))) : expand(w)));
}

/** `matchWords` tolerante: qué palabras de `target` (las de `words()`) se oyeron en `heard`. Una
 *  palabra que se abre en dos ("I'm") cuenta solo si se oyeron las dos. */
export function matchSpoken(target: string[], heard: string): boolean[] {
  const parts = target.map((w) => spokenWords(w));
  const hit = matchWords(parts.flat(), spokenWords(heard));
  let at = 0;
  return parts.map((p) => {
    const ok = p.length > 0 && p.every((_, j) => hit[at + j]);
    at += p.length;
    return ok;
  });
}
