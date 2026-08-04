import type { RexMood } from '../components/RexMascot';

/** Ánimo de RexLearn según la nota: <50 llorando, 50-74 pensativo ("le falta mejorar"),
 *  ≥75 celebrando. Sin nota todavía (respuestas abiertas pendientes de calificar) se
 *  trata como pensativo. */
export function moodForScore(score: number | null): RexMood {
  if (score === null) return 'thinking';
  if (score < 50) return 'sad';
  if (score < 75) return 'thinking';
  return 'happy';
}
