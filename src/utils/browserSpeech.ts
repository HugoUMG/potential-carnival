/**
 * Voz del navegador (Web Speech API, `speechSynthesis`): respaldo gratis y sin red para cuando
 * `/tts` no puede sintetizar (Microsoft rechaza edge-tts con 403 o ElevenLabs se queda sin cuota).
 * Suena peor que edge o ElevenLabs, pero suena.
 *
 * `ttsDownUntil` recuerda el fallo solo un minuto: pasado ese tiempo se vuelve a probar el servidor.
 * Antes el fallo era para siempre y un 503 pasajero dejaba toda la clase con la voz del navegador.
 * Mientras está caído, la voz arranca dentro del toque del alumno, que es lo que pide iOS.
 */

const RETRY_MS = 60_000;
let ttsDownUntil = 0;
export const serverTtsDown = () => Date.now() < ttsDownUntil;
export const markServerTtsDown = () => { ttsDownUntil = Date.now() + RETRY_MS; };

export const canBrowserSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** `rate` en el formato de edge ('-10%', '+20%') o un número (1 = normal). `onEnd` se llama al
 *  terminar, al fallar o al cortarla otra frase. */
export function browserSpeak(text: string, rate: string | number = 1, onEnd?: () => void): boolean {
  if (!canBrowserSpeak() || !text.trim()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  u.lang = 'en-US';
  const pct = typeof rate === 'number' ? (rate - 1) * 100 : parseFloat(rate) || 0;
  u.rate = Math.min(2, Math.max(0.5, 1 + pct / 100));
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang === 'en-US' && /natural|online|google/i.test(v.name))
    ?? voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  synth.speak(u);
  return true;
}

export const stopBrowserSpeech = () => { if (canBrowserSpeak()) window.speechSynthesis.cancel(); };
