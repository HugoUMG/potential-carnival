import { createContext, useContext } from 'react';
import { gameAudioUrl } from '../services/api';
import type { GameQuestion, WordMeaning } from '../types';

/** Lo que recibe cada juego: el set entero. Cada juego decide cuántas usa y en qué orden. */
export interface GameProps {
  questions: GameQuestion[];
}

export interface GameCtx {
  glossary: Record<string, WordMeaning>;
  /** Mostrar las traducciones al español (botón ES). */
  es: boolean;
  setId: string;
  openWord: (word: string, anchor: HTMLElement) => void;
}

export const GameContext = createContext<GameCtx>({ glossary: {}, es: true, setId: '', openWord: () => {} });
export const useGame = () => useContext(GameContext);

export const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Palabras ──────────────────────────────────────────────────────────────────

/** Misma regex que `_WORD_RE` del backend (main.py, sobre el texto en minúsculas): si cambia una,
 *  cambia la otra, o el alumno toca palabras que nunca tendrán significado. */
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

export interface Token {
  raw: string;
  /** Solo en las palabras: la forma con la que se busca en el diccionario. */
  word?: string;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (m.index > last) tokens.push({ raw: text.slice(last, m.index) });
    tokens.push({ raw: m[0], word: m[0].toLowerCase().replace(/’/g, "'") });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ raw: text.slice(last) });
  return tokens;
}

export const words = (text: string): string[] => tokenize(text).flatMap((t) => (t.word ? [t.word] : []));

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

// ── Azar ──────────────────────────────────────────────────────────────────────

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const sample = <T,>(items: readonly T[], n: number): T[] => shuffle(items).slice(0, n);
export const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

export function toggled(set: ReadonlySet<number>, value: number): Set<number> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// ── Audio (edge-tts, gratis) ──────────────────────────────────────────────────

let current: HTMLAudioElement | null = null;

/** Lee en voz alta. Un solo audio a la vez: tocar otra palabra corta la anterior. */
export function speak(text: string, slow = false): void {
  current?.pause();
  current = new Audio(gameAudioUrl(text, slow));
  current.play().catch(() => { /* sin red o audio bloqueado: el juego sigue sin sonido */ });
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}
