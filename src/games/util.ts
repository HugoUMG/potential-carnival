import { createContext, useContext } from 'react';
import { gameAudioUrl } from '../services/api';
import { browserSpeak, markServerTtsDown, serverTtsDown, stopBrowserSpeech } from '../utils/browserSpeech';
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
  /** Abre "Jugar en línea" (crear o unirse a una sala). Solo si el juego admite sala y no hay una. */
  openGroup?: () => void;
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

/** `toggled` para arrays: el estado de una sala tiene que ser JSON, y un `Set` no lo es. */
export const toggledList = (list: readonly number[], value: number): number[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

// ── Retos y equipos (Dados, Equipos, Sobres, Cajas bomba) ─────────────────────

/** El reto de cada cara del dado; Sobres reparte los mismos. El 5.º (índice 4) lleva cronómetro. */
export const CHALLENGES = [
  'Responde con una oración completa.',
  'Responde con dos oraciones.',
  'Responde con tres oraciones y da un ejemplo.',
  'Responde y luego hazle la misma pregunta a un compañero.',
  'Habla 30 segundos sin parar. ¡Usa el cronómetro!',
  '¡Comodín! Tú eliges quién responde.',
];

export const TEAM_COLORS = ['#FF595E', '#1982C4', '#2BB673', '#FF924C'];

// ── Audio (edge-tts, gratis) ──────────────────────────────────────────────────

let current: HTMLAudioElement | null = null;
let playId = 0;

const audioElement = () => {
  current ??= new Audio();
  current.preload = 'auto';
  return current;
};

/** Corta el audio en curso y suelta la descarga. Se llama al cambiar o cerrar un juego. */
export function stopAudio(): void {
  playId++;
  const audio = current;
  if (audio) {
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  stopBrowserSpeech();
}

/** En una sala (room.tsx) decide qué navegador suena: quien mueve suena y avisa a los demás; el
 *  resto calla aquí y suena cuando llega el aviso. Devolver `false` calla este `speak`. */
let speakGate: ((text: string, slow: boolean) => boolean) | null = null;
export const setSpeakGate = (gate: typeof speakGate) => { speakGate = gate; };

/** Lee en voz alta. Un solo audio a la vez: tocar otra palabra corta la anterior. */
export function speak(text: string, slow = false): void {
  if (speakGate && !speakGate(text, slow)) return;
  playAudio(text, slow);
}

/** Suena solo en este navegador. Un solo elemento de audio, reutilizado. Si `/tts` falla, usa la
 *  voz del navegador y reintenta el servidor tras un minuto (`browserSpeech.ts`). */
export function playAudio(text: string, slow = false): void {
  stopAudio();
  if (serverTtsDown() && browserSpeak(text, slow ? 0.6 : 0.9)) return;
  const audio = audioElement();
  const id = playId;
  audio.onerror = () => {
    if (id !== playId) return;
    markServerTtsDown();
    browserSpeak(text, slow ? 0.6 : 0.9);
  };
  audio.src = gameAudioUrl(text, slow);
  audio.play().catch(() => { /* autoplay bloqueado o error: `onerror` decide el respaldo */ });
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}

// ── Reconocimiento de voz (Web Speech API: Chrome, Edge, Safari; Firefox no) ─────

interface Recognizer {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerClass = new () => Recognizer;
const speechWindow = typeof window === 'undefined' ? {} : window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
export const canRecognize = Boolean(Recognition);

/** Escucha una frase en inglés y devuelve lo que entendió el navegador ('' si no oyó nada). */
export function recognizeOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!Recognition) { reject(new Error('Tu navegador no reconoce la voz. Usa Chrome o Edge.')); return; }
    const r = new Recognition();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    let text = '';
    r.onresult = (e) => { text = e.results[0][0].transcript; };
    r.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? 'Permite el micrófono para responder con la voz.' : 'No te escuché bien. Intenta otra vez.'));
    r.onend = () => resolve(text);
    r.start();
  });
}
