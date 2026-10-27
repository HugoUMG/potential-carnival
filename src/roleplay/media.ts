import type { IconName } from '../components/AppIcon';
import { roleplayAudioUrl } from '../services/api';
import { browserSpeak, stopBrowserSpeech } from '../utils/browserSpeech';
import type { RoleplayLevel } from '../types';

// ── Voz del personaje ─────────────────────────────────────────────────────────

/** Un solo <audio> para toda la conversación. iPhone solo deja sonar audio que empezó con un toque
 *  del usuario: se "desbloquea" una vez (prueba de sonido o botón Empezar) y después se reutiliza
 *  cambiándole el `src`, también desde respuestas que llegan sin toque. */
export const voice = typeof Audio !== 'undefined' ? new Audio() : null;

/** WAV de silencio de 0,05 s: lo que suena al desbloquear. */
function silentWav(): string {
  const samples = 400;
  const buf = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (o: number, t: string) => [...t].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF'); buf.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt ');
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, 8000, true); buf.setUint32(28, 16000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  text(36, 'data'); buf.setUint32(40, samples * 2, true);
  let binary = '';
  new Uint8Array(buf.buffer).forEach((b) => { binary += String.fromCharCode(b); });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function unlockVoice(): void {
  if (!voice || voice.dataset.unlocked) return;
  voice.src = silentWav();
  voice.play().then(() => { voice.dataset.unlocked = '1'; }, () => {});
}

/** Velocidad de la voz: la del nivel, 15 puntos más lenta con "voz más lenta". */
export function voiceRate(levelRate: string, slower: boolean): string {
  const base = Number.parseInt(levelRate, 10) || 0;
  const value = Math.max(-50, base - (slower ? 15 : 0));
  return `${value >= 0 ? '+' : ''}${value}%`;
}

let finish = () => {};
let loading: AbortController | null = null;

/** Reproduce `src` en el <audio> único y resuelve cuando termina, si no se pudo reproducir o si otra
 *  frase / `stopVoice()` la corta: una promesa que nunca resuelve dejaría la conversación trabada. */
export function play(src: string): Promise<void> {
  stopVoice();
  return new Promise((resolve) => {
    if (!voice) { resolve(); return; }
    finish = resolve;
    voice.onended = () => resolve();
    voice.onerror = () => resolve();
    voice.onplaying = null;
    voice.src = src;
    voice.play().catch(() => resolve());
  });
}

function mediaSource(): typeof MediaSource | undefined {
  // ManagedMediaSource = la de Safari en iPhone (iOS 17.1+); antes no hay ninguna.
  const w = window as unknown as { ManagedMediaSource?: typeof MediaSource; MediaSource?: typeof MediaSource };
  const MS = w.ManagedMediaSource ?? w.MediaSource;
  return MS?.isTypeSupported('audio/mpeg') ? MS : undefined;
}

// ponytail: los blob: no se revocan (~45 KB por frase); se liberan al recargar la página.
/** Suena una voz que llega por trozos (`roleplayTurn`) desde los primeros, sin esperar el mp3 entero:
 *  edge-tts tarda de 0,5 a 5 s en mandar una frase. `onStart` avisa cuando ya suena (o cuando no va a
 *  sonar). Resuelve al terminar con el mp3 completo (blob:) para repetirlo; `null` si otra frase o
 *  `stopVoice()` la cortaron; `undefined` si no llegó audio (el llamador la pide a /tts). Sin
 *  MediaSource (iPhone antes de iOS 17.1) junta el mp3 entero y después lo suena. */
export async function playStream(chunks: AsyncIterable<Uint8Array>, onStart: () => void): Promise<string | null | undefined> {
  const parts: Uint8Array[] = [];
  const whole = () => (parts.length ? URL.createObjectURL(new Blob(parts as BlobPart[], { type: 'audio/mpeg' })) : undefined);
  const MS = voice ? mediaSource() : undefined;
  if (!voice || !MS) {
    try {
      for await (const c of chunks) parts.push(c);
    } catch { /* red cortada: suena lo que llegó */ }
    onStart();
    const url = whole();
    if (url) await play(url);
    return url;
  }
  stopVoice();
  let cut = false;
  let done = () => {};
  const ended = new Promise<void>((resolve) => { done = () => { cut = true; resolve(); }; });
  finish = done;
  const ms = new MS();
  voice.onended = () => done();
  voice.onerror = () => done();
  voice.onplaying = onStart;
  voice.disableRemotePlayback = true; // ManagedMediaSource solo abre así
  voice.src = URL.createObjectURL(ms);
  voice.play().catch(() => { onStart(); done(); });
  let complete = true;
  try {
    await Promise.race([new Promise((r) => ms.addEventListener('sourceopen', r, { once: true })), ended]);
    const sb = cut ? null : ms.addSourceBuffer('audio/mpeg');
    for await (const c of chunks) {
      if (cut || !sb) { complete = false; break; }
      parts.push(c);
      sb.appendBuffer(c as BufferSource);
      await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
    }
  } catch {
    complete = false; // red cortada o el <audio> ya es de otra frase: suena lo que llegó
  }
  if (ms.readyState === 'open') {
    try { ms.endOfStream(); } catch { /* ya cerrada */ }
  }
  if (!parts.length) {
    onStart();
    if (!cut) stopVoice();
    return undefined;
  }
  // Si la voz se comió lo descargado antes de que llegara el último trozo, Chrome queda en
  // `ended` sin disparar el evento y la conversación esperaría para siempre: se mira a mano.
  const watch = setInterval(() => { if (voice.ended) done(); }, 250);
  await ended;
  clearInterval(watch);
  return complete ? whole() : null;
}

/** Dice un texto con la voz del personaje (repetir, versión lenta, informe). Se descarga entero
 *  antes de sonar: con la URL directa el <audio> esperaba igual el archivo completo y además
 *  arrancaba 2-3 s después de tenerlo. */
export async function say(text: string, voiceName: string, rate: string): Promise<void> {
  stopVoice();
  const ctrl = new AbortController();
  loading = ctrl;
  let src: string;
  try {
    const res = await fetch(roleplayAudioUrl(text, voiceName, rate), { signal: ctrl.signal });
    if (!res.ok) {
      // edge-tts caído (403 de Microsoft): la voz del navegador, para que la escena siga sonando.
      if (loading === ctrl) await new Promise<void>((resolve) => { finish = resolve; if (!browserSpeak(text, rate, resolve)) resolve(); });
      return;
    }
    src = URL.createObjectURL(await res.blob());
  } catch {
    return; // cortada mientras bajaba, o sin red
  }
  if (loading === ctrl) await play(src);
}

export function stopVoice(): void {
  loading?.abort();
  loading = null;
  voice?.pause();
  stopBrowserSpeech();
  finish();
}

// ── Micrófono ─────────────────────────────────────────────────────────────────

// El grabador vive en `utils/` porque también lo usa el juego Pronuncia.
export { canRecord, useRecorder } from '../utils/useRecorder';

export const LEVEL_INFO: Record<RoleplayLevel, { label: string; icon: IconName; bullets: string[]; en: boolean; es: boolean }> = {
  beginner: { label: 'Principiante', icon: 'sprout', en: true, es: true,
    bullets: ['Voz lenta y clara', 'Palabras muy sencillas', 'Subtítulos en inglés y español', 'Pronunciación medida con paciencia'] },
  intermediate: { label: 'Intermedio', icon: 'leaf', en: true, es: false,
    bullets: ['Voz casi normal', 'Inglés del día a día', 'Subtítulos solo en inglés', 'Pronunciación más exigente'] },
  advanced: { label: 'Avanzado', icon: 'treePine', en: false, es: false,
    bullets: ['Voz natural y acentos del mundo', 'Expresiones y phrasal verbs', 'Sin subtítulos: solo escuchas', 'Pronunciación estricta'] },
};
