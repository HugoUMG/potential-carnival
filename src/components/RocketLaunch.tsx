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

const PLANETS = [
  { emoji: '🪐', left: '18%', top: '20%', size: 'text-4xl', delay: '0.1s' },
  { emoji: '🌕', left: '78%', top: '14%', size: 'text-3xl', delay: '0.4s' },
  { emoji: '🌍', left: '68%', top: '58%', size: 'text-2xl', delay: '0.7s' },
];

function Planets() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {PLANETS.map((p, i) => (
        <span key={i} className={`rk-planet-in absolute ${p.size}`} style={{ left: p.left, top: p.top, animationDelay: p.delay }}>{p.emoji}</span>
      ))}
    </div>
  );
}

const DEBRIS = [{ dx: -70, dy: -40 }, { dx: 70, dy: -40 }, { dx: -50, dy: 50 }, { dx: 50, dy: 50 }];
const CLOUDS = [
  { left: '15%', top: '55%', delay: '0s' },
  { left: '55%', top: '70%', delay: '0.4s' },
  { left: '75%', top: '45%', delay: '0.8s' },
];

/** Tierra + plataforma de lanzamiento, fijas en la base de la pantalla. El cohete se apoya justo
 * encima de la plataforma (bottom-24 = altura del suelo h-16 + altura de la plataforma h-8). */
function Ground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-16 h-2 bg-gradient-to-t from-amber-400/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-emerald-700 to-emerald-950">
        <div className="absolute inset-x-0 top-0 h-1 bg-emerald-400/50" />
      </div>
      <div className="pointer-events-none absolute bottom-16 left-1/2 h-8 w-16 -translate-x-1/2 rounded-t bg-slate-500/70" />
    </>
  );
}

type Phase = 'pad' | 'ignite' | 'ascend' | 'stabilize' | 'space' | 'turbo' | 'enginefail' | 'fall' | 'card';

// Cada escena avanza a la siguiente tras su duración (ms); la última pasa a 'card'.
const SUCCESS_STEPS: Array<[Phase, number]> = [
  ['pad', 500], ['ignite', 700], ['ascend', 900], ['stabilize', 600], ['space', 1100],
];
const FAIL_STEPS: Array<[Phase, number]> = [
  ['pad', 500], ['ignite', 700], ['ascend', 900], ['turbo', 450], ['enginefail', 300], ['fall', 700],
];

const CAPTIONS: Record<Phase, string> = {
  pad: 'Preparando el cohete…',
  ignite: '🔥 ¡Ignición!',
  ascend: '🚀 ¡Despegando!',
  stabilize: '🛰️ Estabilizando…',
  space: '🌌 ¡Llegó al espacio!',
  turbo: '⚡ ¡Intentando turbo!',
  enginefail: '⚠️ Falla de motor…',
  fall: '💥 ¡Se estrelló!',
  card: '',
};

/** Pantalla de resultado: 4 escenas (normal → despegue → aire → espacio o falla+caída), luego la tarjeta. */
export function RocketResult({ score, correct, incorrect, worksheetTitle, onSeeAnswers, onClose }: {
  score: number | null;
  correct: number;
  incorrect: number;
  worksheetTitle: string;
  onSeeAnswers: () => void;
  onClose: () => void;
}) {
  const launched = score !== null ? score >= 51 : correct >= incorrect;
  const [phase, setPhase] = useState<Phase>('pad');

  useEffect(() => {
    if (phase === 'card') return;
    const steps = launched ? SUCCESS_STEPS : FAIL_STEPS;
    const idx = steps.findIndex(([p]) => p === phase);
    const next = steps[idx + 1]?.[0] ?? 'card';
    const t = setTimeout(() => setPhase(next), steps[idx][1]);
    return () => clearTimeout(t);
  }, [phase, launched]);

  const inSpace = phase === 'stabilize' || phase === 'space';
  const bg = launched ? 'from-indigo-900 to-slate-900' : 'from-slate-800 to-rose-950';

  return (
    <div className={`fixed inset-0 z-50 grid place-items-center overflow-hidden bg-gradient-to-b ${bg} p-6 ${phase === 'ignite' ? 'rk-screenshake' : ''}`}>
      <StarField />
      {phase !== 'card' && <Ground />}
      {inSpace && (
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black via-indigo-950 to-slate-950 transition-opacity duration-1000"
          style={{ opacity: phase === 'space' ? 1 : 0.4 }}
        />
      )}
      {phase === 'space' && <Planets />}
      {phase === 'fall' && <div className="pointer-events-none absolute inset-0 animate-pulse bg-rose-600/20" />}

      {phase !== 'card' ? (
        <div className="relative h-full w-full">
          {phase === 'ascend' && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {CLOUDS.map((c, i) => (
                <span key={i} className="rk-cloud absolute text-4xl" style={{ left: c.left, top: c.top, animationDelay: c.delay }}>☁️</span>
              ))}
            </div>
          )}

          <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
            <div className={launched ? 'rk-journey-success' : 'rk-journey-fail'}>
              <div className={phase === 'ignite' || phase === 'turbo' ? 'rk-rumble' : phase === 'ascend' ? 'rk-rumble-soft' : ''}>
                <div className="rk-bob flex flex-col items-center">
                  <span className="text-7xl">🚀</span>
                  {phase !== 'pad' && phase !== 'fall' && (
                    <span
                      className={
                        phase === 'turbo' ? 'rk-turbo -mt-2 text-4xl'
                        : phase === 'enginefail' ? 'rk-flame-out -mt-2 text-4xl'
                        : 'rk-flame -mt-2 text-4xl'
                      }
                    >
                      🔥
                    </span>
                  )}
                </div>
              </div>
            </div>

            {phase === 'ignite' && (
              <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="rk-smoke absolute text-3xl" style={{ animationDelay: `${i * 0.25}s` }}>💨</span>
                ))}
              </div>
            )}
          </div>

          {phase === 'fall' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-16 grid place-items-center">
              <span className="rk-explode text-7xl" style={{ animationDelay: '0.45s' }}>💥</span>
              {DEBRIS.map((d, i) => (
                <span
                  key={i}
                  className="rk-debris absolute text-2xl"
                  style={{ animationDelay: '0.45s', ['--dx' as string]: `${d.dx}px`, ['--dy' as string]: `${d.dy}px` }}
                >
                  ✨
                </span>
              ))}
            </div>
          )}

          <p className="absolute inset-x-0 top-10 text-center text-2xl font-black text-white">{CAPTIONS[phase]}</p>
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
