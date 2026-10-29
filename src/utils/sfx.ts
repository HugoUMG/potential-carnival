// Sonidos cortos para interacciones de clic en las hojas de trabajo (elegir opción,
// soltar palabra, marcar T/F, unir en matching, etc.). Sintetizados con ZzFX — sin
// archivos de audio. Se cargan en diferido; el primer clic del alumno es el gesto
// que habilita el audio en el navegador.

export type SfxName = 'select' | 'toggle' | 'place' | 'tick' | 'hop' | 'ok' | 'miss' | 'climb' | 'slide' | 'swap' | 'win';
const u = undefined;
// El primer parámetro es el volumen (bajo, para que sea sutil). No tocamos ZZFX.volume
// para no afectar el volumen de las animaciones de envío que comparten el mismo motor.
// Orden ZzFX: volumen, azar, frecuencia, ataque, sostén, caída, forma, curva, deslizamiento…
const SFX: Record<SfxName, (number | undefined)[]> = {
  select: [0.6, u, 1150, u, 0.02, 0.07, 1, 1.3, u, u, 120, 0.02],
  toggle: [0.55, u, 820, u, 0.02, 0.06, 1, 1.2, u, u, 200, 0.02],
  place: [0.6, u, 420, u, 0.02, 0.09, 1, u, u, u, u, u, u, u, u, u, u, 0.3],
  // Juegos de mesa: dado, pasos de la ficha, acierto/fallo, escalera, serpiente y victoria.
  tick: [0.35, 0.1, 260, u, 0.005, 0.02, 4, u, u, u, u, u, u, 0.4],
  hop: [0.45, u, 660, u, 0.01, 0.05, 1, 1.5, u, u, 220, 0.02],
  ok: [0.7, u, 784, u, 0.06, 0.2, u, 1.5, u, u, 262, 0.07],
  miss: [0.6, u, 200, u, 0.08, 0.22, 2, u, -2],
  climb: [0.7, u, 330, 0.02, 0.3, 0.15, u, 1.2, 9, u, u, u, 0.06],
  slide: [0.7, u, 900, 0.02, 0.35, 0.2, 2, u, -10, u, u, u, 0.07],
  swap: [0.6, u, 440, 0.02, 0.12, 0.2, 1, u, u, u, 220, 0.07, 0.09],
  win: [0.9, u, 523, 0.02, 0.35, 0.4, u, 1.6, u, u, 262, 0.09, 0.14],
};

let _z: Promise<(...p: (number | undefined)[]) => void> | null = null;
function load() {
  if (!_z) {
    _z = import('zzfx').then((m) => {
      try { m.ZZFX.audioContext.resume?.(); } catch { /* bloqueado por el navegador */ }
      return m.zzfx;
    });
  }
  return _z;
}

/** Reproduce un efecto de clic (best-effort; silencioso si el navegador lo bloquea). */
export function playSfx(name: SfxName) {
  load().then((zzfx) => zzfx(...SFX[name])).catch(() => {});
}
