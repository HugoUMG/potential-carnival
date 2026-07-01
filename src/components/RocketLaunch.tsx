import { useEffect, useState } from 'react';

// Campo de estrellas para el fondo (posiciones deterministas, sin dependencias).
const STARS = Array.from({ length: 20 }, (_, i) => ({
  left: `${(i * 53) % 100}%`,
  top: `${(i * 41) % 100}%`,
  delay: `${(i % 6) * 0.3}s`,
}));

function StarField() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {STARS.map((s, i) => (
        <span key={i} className="rk-twinkle absolute text-xs text-white/80" style={{ left: s.left, top: s.top, animationDelay: s.delay }}>✦</span>
      ))}
    </div>
  );
}

/** Overlay mostrado mientras se envía/califica: cohete cargando "combustible". */
export function RocketFueling() {
  const [progress, setProgress] = useState(8);
  useEffect(() => {
    const id = setInterval(() => setProgress((p) => (p >= 92 ? p : p + Math.max(1, Math.round((96 - p) / 14)))), 350);
    return () => clearInterval(id);
  }, []);
  const materials = ['📝', '✏️', '📚', '⛽'];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-gradient-to-b from-slate-900 to-indigo-900 p-6">
      <StarField />
      <div className="relative w-full max-w-sm text-center text-white">
        <div className="relative mx-auto h-40 w-24">
          {materials.map((m, i) => (
            <span key={i} className="rk-rise absolute bottom-0 left-1/2 -translate-x-1/2 text-2xl" style={{ animationDelay: `${i * 0.6}s` }}>{m}</span>
          ))}
          <div className="rk-bob absolute bottom-0 left-1/2 -translate-x-1/2 text-6xl">🚀</div>
        </div>
        <h2 className="mt-4 text-xl font-bold">Preparando el despegue…</h2>
        <p className="mt-1 text-sm text-white/70">Cargando tus respuestas como combustible ⛽</p>
        <div className="mx-auto mt-5 h-3 max-w-xs overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs font-semibold text-amber-300">{progress}% de combustible</p>
      </div>
    </div>
  );
}

/** Pantalla de resultado: despega (mayoría correcta) o se estrella, con fondo animado. */
export function RocketResult({ score, correct, incorrect, worksheetTitle, onSeeAnswers, onClose }: {
  score: number | null;
  correct: number;
  incorrect: number;
  worksheetTitle: string;
  onSeeAnswers: () => void;
  onClose: () => void;
}) {
  const launched = correct >= incorrect;
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [phase, setPhase] = useState<'anim' | 'card'>(reduce ? 'card' : 'anim');

  useEffect(() => {
    if (phase !== 'anim') return;
    const t = setTimeout(() => setPhase('card'), 1800);
    return () => clearTimeout(t);
  }, [phase]);

  const bg = launched ? 'from-indigo-900 to-slate-900' : 'from-slate-800 to-rose-950';

  return (
    <div className={`fixed inset-0 z-50 grid place-items-center overflow-hidden bg-gradient-to-b ${bg} p-6`}>
      <StarField />

      {phase === 'anim' ? (
        <div className="relative text-center">
          {launched ? (
            <div className="rk-launch flex flex-col items-center">
              <span className="text-7xl">🚀</span>
              <span className="rk-flame -mt-2 text-4xl">🔥</span>
            </div>
          ) : (
            <div className="relative grid place-items-center">
              <span className="rk-crash text-7xl">🚀</span>
              <span className="absolute text-6xl">💥</span>
            </div>
          )}
          <p className="mt-6 text-2xl font-black text-white">{launched ? '🚀 ¡Despegue!' : '💥 ¡Se estrelló!'}</p>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-25">
            {launched ? <span className="rk-float text-[9rem]">🚀</span> : <span className="text-[9rem]">🚀💥</span>}
          </div>
          <div className="relative w-full max-w-sm rounded-3xl bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
            <div className="text-5xl">{launched ? '🚀' : '💥'}</div>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-900">{launched ? '¡Buen despegue!' : 'Uff, casi…'}</h2>
            <p className="mt-1 text-sm text-slate-500">{worksheetTitle}</p>
            <div className={`mt-4 rounded-2xl px-6 py-4 ${launched ? 'bg-blue-50' : 'bg-rose-50'}`}>
              <p className={`text-4xl font-black ${launched ? 'text-blue-700' : 'text-rose-700'}`}>{score !== null ? score : '—'}</p>
              <p className="text-sm font-semibold text-slate-500">Puntuación</p>
            </div>
            <div className="mt-3 flex justify-center gap-3 text-sm font-semibold">
              <span className="rounded-xl bg-emerald-50 px-3 py-1 text-emerald-700">✓ {correct}</span>
              <span className="rounded-xl bg-red-50 px-3 py-1 text-red-700">✗ {incorrect}</span>
            </div>
            <button className="mt-6 w-full rounded-2xl bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-700" onClick={onSeeAnswers}>
              Ver mis respuestas →
            </button>
            <button className="mt-3 w-full rounded-2xl px-6 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
