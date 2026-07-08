// Sonidos cortos para interacciones de clic en las hojas de trabajo (elegir opción,
// soltar palabra, marcar T/F, unir en matching, etc.). Sintetizados con ZzFX — sin
// archivos de audio. Se cargan en diferido; el primer clic del alumno es el gesto
// que habilita el audio en el navegador.

type SfxName = 'select' | 'toggle' | 'place';
const u = undefined;
// El primer parámetro es el volumen (bajo, para que sea sutil). No tocamos ZZFX.volume
// para no afectar el volumen de las animaciones de envío que comparten el mismo motor.
const SFX: Record<SfxName, (number | undefined)[]> = {
  select: [0.6, u, 1150, u, 0.02, 0.07, 1, 1.3, u, u, 120, 0.02],
  toggle: [0.55, u, 820, u, 0.02, 0.06, 1, 1.2, u, u, 200, 0.02],
  place: [0.6, u, 420, u, 0.02, 0.09, 1, u, u, u, u, u, u, u, u, u, u, 0.3],
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
