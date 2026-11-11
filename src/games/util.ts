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

// El emparejado vive en spoken.ts (sin dependencias, para probarlo con Node).
export { matchSpoken, matchWords } from './spoken';

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

/** Puntos de cada cara del dado (1–6) en una rejilla 3×3. */
export const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

export const TEAM_COLORS = ['#FF595E', '#1982C4', '#2BB673', '#FF924C'];

/** Nombre que el profe le puso al equipo `k` en la pantalla de inicio, o "Equipo k+1". */
export const teamName = (names: readonly string[], k: number) => names[k]?.trim() || `Equipo ${k + 1}`;

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

// Los mp3 se bajan con `fetch` y se guardan en memoria como blob (url de /tts → url del blob). Con la
// URL de /tts directa en el `src`, el <audio> esperaba el archivo entero y aún tardaba 2-3 s más en
// arrancar, y no siempre aprovechaba lo precargado. La precarga y el toque comparten este mapa: un
// mp3 se pide una sola vez por sesión y lo ya bajado suena dentro del mismo toque.
const CLIP_LIMIT = 300; // ~20 KB cada uno
const clips = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

function clip(url: string): Promise<string> {
  let pending = clips.get(url);
  if (pending) return pending;
  pending = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const src = URL.createObjectURL(await res.blob());
    if (clips.get(url) === pending) ready.set(url, src);
    return src;
  });
  pending.catch(() => { if (clips.get(url) === pending) clips.delete(url); }); // el próximo toque reintenta
  clips.set(url, pending);
  if (clips.size > CLIP_LIMIT) {
    const [oldest, gone] = clips.entries().next().value!;
    clips.delete(oldest);
    ready.delete(oldest);
    gone.then((src) => URL.revokeObjectURL(src), () => {});
  }
  return pending;
}

/** Lo que se espera a /tts antes de pasar a la voz del navegador. Una frase nueva tarda 1-3 s. */
const TTS_WAIT_MS = 7000;

/** Suena solo en este navegador. Un solo elemento de audio, reutilizado. Si `/tts` falla o no
 *  contesta a tiempo, usa la voz del navegador y reintenta el servidor tras un minuto
 *  (`browserSpeech.ts`). */
export function playAudio(text: string, slow = false): void {
  stopAudio();
  const rate = slow ? 0.6 : 0.9;
  if (serverTtsDown() && browserSpeak(text, rate)) return;
  const audio = audioElement();
  const id = playId;
  let settled = false;
  const fallback = () => {
    if (settled || id !== playId) return;
    settled = true;
    markServerTtsDown();
    browserSpeak(text, rate);
  };
  const start = (src: string) => {
    if (settled || id !== playId) return;
    settled = true;
    audio.onerror = () => { if (id === playId) browserSpeak(text, rate); };
    audio.src = src;
    audio.play().catch(() => { /* autoplay bloqueado: no hay nada que hacer sin un toque */ });
  };
  const url = gameAudioUrl(text, slow);
  const src = ready.get(url);
  if (src) { start(src); return; } // precargado: suena dentro del toque, sin esperar nada
  const timer = setTimeout(fallback, TTS_WAIT_MS);
  clip(url).then(start, fallback).finally(() => clearTimeout(timer));
}

// Precarga: baja en segundo plano los mp3 que el juego va a tocar, así el toque suena al instante,
// y de paso quedan en `tts_cache` para la clase.
// ponytail: 3 a la vez y tope de 40 por llamada. El tope cuida el rate limit de /tts (300/min por
// IP, compartido por un colegio tras NAT); de una en una, 40 frases nuevas tardaban ~2 min y el
// alumno tocaba antes de que llegara su turno.
const PRELOAD_PARALLEL = 3;
const preloadQueue: string[] = [];
let preloading = 0;

export function preloadAudio(texts: readonly string[]): void {
  for (const text of texts.slice(0, 40)) {
    const url = gameAudioUrl(text); // la misma URL que pide `playAudio`
    if (text.trim() && !clips.has(url) && !preloadQueue.includes(url)) preloadQueue.push(url);
  }
  while (preloading < PRELOAD_PARALLEL && preloadQueue.length) void drainPreload();
}

async function drainPreload(): Promise<void> {
  preloading++;
  while (preloadQueue.length && !serverTtsDown()) {
    try { await clip(preloadQueue.shift()!); } catch { /* se reintenta si el alumno la toca */ }
  }
  preloading--;
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
