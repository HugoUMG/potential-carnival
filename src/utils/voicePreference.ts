/**
 * Preferencia de voz TTS — persiste en localStorage.
 * Default: masculina (en-US-GuyNeural).
 * Femenina: en-US-JennyNeural (acento americano).
 */

export const VOICES = {
  male:   'en-US-GuyNeural',
  female: 'en-US-JennyNeural',
} as const;

export type VoiceGender = keyof typeof VOICES;

const KEY = 'tts_voice_gender';

export function getVoiceGender(): VoiceGender {
  const stored = localStorage.getItem(KEY);
  return stored === 'female' ? 'female' : 'male';
}

export function setVoiceGender(gender: VoiceGender): void {
  localStorage.setItem(KEY, gender);
}

export function getVoiceName(): string {
  return VOICES[getVoiceGender()];
}
