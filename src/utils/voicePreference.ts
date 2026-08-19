/**
 * Preferencia de voz y velocidad TTS — persiste en localStorage.
 *
 * El backend acepta cualquiera de las ~47 voces en inglés de edge-tts (en el DSL se puede escribir
 * el nombre literal, p. ej. `voice: en-IE-EmilyNeural`). Las de aquí son las curadas para MODELAR
 * pronunciación, que son las únicas que ofrece el selector del reproductor.
 */

export const VOICE_OPTIONS = [
  { name: 'en-US-AndrewNeural',  label: 'Andrew · EE. UU. ♂' },
  { name: 'en-US-AriaNeural',    label: 'Aria · EE. UU. ♀' },
  { name: 'en-GB-RyanNeural',    label: 'Ryan · Reino Unido ♂' },
  { name: 'en-GB-SoniaNeural',   label: 'Sonia · Reino Unido ♀' },
  { name: 'en-AU-NatashaNeural', label: 'Natasha · Australia ♀' },
  { name: 'en-US-AnaNeural',     label: 'Ana · EE. UU. ♀ infantil' },
  { name: 'en-US-MichelleNeural', label: 'Michelle · EE. UU. ♀ infantil' },
  { name: 'en-US-RogerNeural',   label: 'Roger · EE. UU. ♂ infantil' },
  { name: 'en-GB-MaisieNeural',  label: 'Maisie · Reino Unido ♀ infantil' },
  { name: 'en-GB-OliverNeural',  label: 'Oliver · Reino Unido ♂ infantil' },
] as const;

/** DSL `voice: male|female` → la voz más clara de cada género. */
export const VOICES = {
  male:   'en-US-AndrewNeural',
  female: 'en-US-AriaNeural',
} as const;

export type VoiceGender = keyof typeof VOICES;

/**
 * Velocidad de SÍNTESIS: edge-tts vuelve a generar el audio más lento, con articulación y pausas
 * limpias. No es el `playbackRate` del navegador, que estira la onda ya grabada y le enseña al
 * alumno una articulación que ningún hablante produce. Cambiarla cuesta una petición nueva.
 */
export const RATES = [
  { value: '-35%', label: 'Muy lento' },
  { value: '-15%', label: 'Lento' },
  { value: '+0%',  label: 'Normal' },
] as const;

const DEFAULT_VOICE = VOICES.male;
const DEFAULT_RATE = '-15%'; // principiantes por defecto; el que quiera velocidad nativa la elige

const VOICE_KEY = 'tts_voice';
const RATE_KEY = 'tts_rate';

export function getVoiceName(): string {
  const stored = localStorage.getItem(VOICE_KEY) ?? '';
  return VOICE_OPTIONS.some((v) => v.name === stored) ? stored : DEFAULT_VOICE;
}

export function setVoiceName(name: string): void {
  localStorage.setItem(VOICE_KEY, name);
}

export function getRate(): string {
  const stored = localStorage.getItem(RATE_KEY) ?? '';
  return RATES.some((r) => r.value === stored) ? stored : DEFAULT_RATE;
}

export function setRate(rate: string): void {
  localStorage.setItem(RATE_KEY, rate);
}
