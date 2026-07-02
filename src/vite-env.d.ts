/// <reference types="vite/client" />

// ZzFX no trae tipos propios; declaramos lo que usamos (efectos de sonido sintetizados).
declare module 'zzfx' {
  export function zzfx(...params: (number | undefined)[]): AudioBufferSourceNode;
  export const ZZFX: { audioContext: AudioContext; volume: number };
}
