import { useEffect, useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// Animaciones del resultado de envío. El portal elige UNA al azar en cada
// envío (ver SUBMIT_ANIMATIONS al final). Cada alumno puede ver cohete, pastel,
// paracaidista, etc.
//
// Para AGREGAR una animación nueva a futuro:
//   1. Escribe un componente `MiEscena(props: SceneProps)` usando <Overlay>,
//      <Caption>, <ResultCard> y el hook useScenes (copia una de las de abajo).
//   2. Agrégalo al array SUBMIT_ANIMATIONS.
//   `passed()` decide éxito (puntuación >= 70).
// ═══════════════════════════════════════════════════════════════════════════

const PASS_THRESHOLD = 70;

export type SceneProps = {
  score: number | null;
  correct: number;
  incorrect: number;
  worksheetTitle: string;
  onSeeAnswers: () => void;
  onClose: () => void;
};

/** Éxito si la puntuación llega al umbral; si aún no hay nota, por mayoría de aciertos. */
function passed({ score, correct, incorrect }: Pick<SceneProps, 'score' | 'correct' | 'incorrect'>): boolean {
  return score !== null ? score >= PASS_THRESHOLD : correct >= incorrect;
}

/** Máquina de escenas: recorre los pasos [nombre, ms] en orden y termina en 'card'. */
function useScenes<T extends string>(steps: Array<[T, number]>): T | 'card' {
  const [phase, setPhase] = useState<T | 'card'>(steps[0][0]);
  useEffect(() => {
    if (phase === 'card') return;
    const idx = steps.findIndex(([p]) => p === phase);
    const t = setTimeout(() => setPhase(steps[idx + 1]?.[0] ?? 'card'), steps[idx][1]);
    return () => clearTimeout(t);
  }, [phase, steps]);
  return phase;
}

// ── Piezas compartidas ──────────────────────────────────────────────────────

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

const CLOUDS = [
  { left: '15%', top: '55%', delay: '0s' },
  { left: '55%', top: '70%', delay: '0.4s' },
  { left: '75%', top: '45%', delay: '0.8s' },
];

/** Contenedor a pantalla completa de cualquier escena. */
function Overlay({ bg, shake, children }: { bg: string; shake?: boolean; children: ReactNode }) {
  return (
    <div className={`fixed inset-0 z-50 grid place-items-center overflow-hidden bg-gradient-to-b ${bg} p-6 ${shake ? 'rk-screenshake' : ''}`}>
      {children}
    </div>
  );
}

/** Rótulo de la escena, legible sobre cualquier fondo. */
function Caption({ text }: { text: string }) {
  return (
    <p className="absolute inset-x-0 top-10 flex justify-center px-4">
      <span className="rounded-full bg-black/40 px-5 py-1.5 text-center text-xl font-black text-white backdrop-blur-sm">{text}</span>
    </p>
  );
}

/** Tarjeta blanca final con puntuación y botones — igual para todas las animaciones. */
function ResultCard({ ok, emoji, title, score, correct, incorrect, worksheetTitle, onSeeAnswers, onClose }: SceneProps & { ok: boolean; emoji: string; title: string }) {
  return (
    <div className="relative w-full max-w-sm rounded-3xl bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
      <div className="text-5xl">{emoji}</div>
      <h2 className="mt-2 text-2xl font-extrabold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{worksheetTitle}</p>
      <div className={`mt-4 rounded-2xl px-6 py-4 ${ok ? 'bg-blue-50' : 'bg-rose-50'}`}>
        <p className={`text-4xl font-black ${ok ? 'text-blue-700' : 'text-rose-700'}`}>{score !== null ? score : '—'}</p>
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
        <h2 className="mt-4 text-xl font-bold">Preparando el envío…</h2>
        <p className="mt-1 text-sm text-white/70">Procesando tus respuestas ✨</p>
        <div className="mx-auto mt-5 h-3 max-w-xs overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs font-semibold text-amber-300">{progress}%</p>
      </div>
    </div>
  );
}

// ── Animación 1: cohete al espacio ──────────────────────────────────────────

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

function RocketGround() {
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

type RocketPhase = 'pad' | 'ignite' | 'ascend' | 'stabilize' | 'space' | 'turbo' | 'enginefail' | 'fall';
const ROCKET_OK: Array<[RocketPhase, number]> = [['pad', 500], ['ignite', 700], ['ascend', 900], ['stabilize', 600], ['space', 1100]];
const ROCKET_FAIL: Array<[RocketPhase, number]> = [['pad', 500], ['ignite', 700], ['ascend', 900], ['turbo', 450], ['enginefail', 300], ['fall', 700]];
const ROCKET_CAPTIONS: Record<RocketPhase, string> = {
  pad: 'Preparando el cohete…',
  ignite: '🔥 ¡Ignición!',
  ascend: '🚀 ¡Despegando!',
  stabilize: '🛰️ Estabilizando…',
  space: '🌌 ¡Llegó al espacio!',
  turbo: '⚡ ¡Intentando turbo!',
  enginefail: '⚠️ Falla de motor…',
  fall: '💥 ¡Se estrelló!',
};

function RocketScene(props: SceneProps) {
  const ok = passed(props);
  const phase = useScenes(ok ? ROCKET_OK : ROCKET_FAIL);
  const inSpace = phase === 'stabilize' || phase === 'space' || (phase === 'card' && ok);
  const bg = ok ? 'from-indigo-900 to-slate-900' : 'from-slate-800 to-rose-950';

  return (
    <Overlay bg={bg} shake={phase === 'ignite'}>
      <StarField />
      {phase !== 'card' && <RocketGround />}
      {inSpace && (
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black via-indigo-950 to-slate-950 transition-opacity duration-1000"
          style={{ opacity: phase === 'stabilize' ? 0.4 : 1 }}
        />
      )}
      {(phase === 'space' || (phase === 'card' && ok)) && <Planets />}
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
            <div className={ok ? 'rk-journey-success' : 'rk-journey-fail'}>
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

          <Caption text={ROCKET_CAPTIONS[phase]} />
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
            {ok ? (
              <span className="rk-orbit text-[9rem] drop-shadow-[0_0_45px_rgba(129,140,248,0.65)]">🚀</span>
            ) : (
              <span className="text-[9rem] opacity-25">🚀💥</span>
            )}
          </div>
          <ResultCard {...props} ok={ok} emoji={ok ? '🚀' : '💥'} title={ok ? '¡Buen despegue!' : 'Uff, casi…'} />
        </>
      )}
    </Overlay>
  );
}

// ── Animación 2: pastelero (bowl → pastel) ──────────────────────────────────

const INGREDIENTS = [
  { emoji: '🥚', off: '-80px', delay: '0s' },
  { emoji: '🥛', off: '60px', delay: '0.22s' },
  { emoji: '🧈', off: '-20px', delay: '0.44s' },
  { emoji: '🍫', off: '90px', delay: '0.66s' },
  { emoji: '🍓', off: '-90px', delay: '0.88s' },
  { emoji: '🍯', off: '30px', delay: '1.1s' },
];

type BakePhase = 'kitchen' | 'mixing' | 'whisk' | 'oven' | 'reveal' | 'burnt';
const BAKE_OK: Array<[BakePhase, number]> = [['kitchen', 600], ['mixing', 1400], ['whisk', 900], ['oven', 1000], ['reveal', 1300]];
const BAKE_FAIL: Array<[BakePhase, number]> = [['kitchen', 600], ['mixing', 1400], ['whisk', 900], ['oven', 1000], ['burnt', 1300]];
const BAKE_CAPTIONS: Record<BakePhase, string> = {
  kitchen: '👩‍🍳 Alistando la cocina…',
  mixing: '🥣 Agregando ingredientes…',
  whisk: '🥄 ¡Batiendo la mezcla!',
  oven: '🔥 Al horno…',
  reveal: '🎂 ¡Pastel perfecto!',
  burnt: '💨 Uy… se quemó',
};

function BakerScene(props: SceneProps) {
  const ok = passed(props);
  const phase = useScenes(ok ? BAKE_OK : BAKE_FAIL);
  const bg = ok ? 'from-amber-200 to-rose-300' : 'from-stone-600 to-stone-900';
  const withBowl = phase === 'kitchen' || phase === 'mixing' || phase === 'whisk';

  return (
    <Overlay bg={bg} shake={phase === 'whisk'}>
      {/* encimera de la cocina */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-amber-800/40 to-amber-950/70" />

      {phase !== 'card' ? (
        <div className="relative h-full w-full">
          {/* Close-up: la acción ocupa la pantalla, centrada en primer plano. */}
          <div className="absolute inset-0 grid place-items-center">
            {withBowl && (
              <div className="relative flex flex-col items-center">
                <span className="text-8xl">👩‍🍳</span>
                <div className="relative -mt-6">
                  <span className={`block text-[11rem] leading-none ${phase === 'mixing' || phase === 'whisk' ? 'bake-shake' : ''}`}>🥣</span>
                  {phase === 'whisk' && <span className="bake-whisk absolute -top-14 left-1/2 -translate-x-1/2 text-7xl">🥄</span>}
                  {phase === 'mixing' && INGREDIENTS.map((ing, i) => (
                    <div key={i} className="absolute left-1/2 top-2 -translate-x-1/2" style={{ marginLeft: ing.off }}>
                      <span className="bake-drop-cu block text-6xl" style={{ animationDelay: ing.delay }}>{ing.emoji}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === 'oven' && (
              <div className="relative grid place-items-center">
                <span className="text-[13rem] leading-none" style={{ filter: 'brightness(0.75)' }}>🎂</span>
                <div className="absolute inset-8 animate-pulse rounded-full bg-orange-500/50 blur-2xl" />
                <span className="absolute -bottom-2 text-6xl">🔥🔥🔥</span>
              </div>
            )}

            {phase === 'reveal' && (
              <div className="relative">
                <span className="bake-cake-pop block text-[14rem] leading-none drop-shadow-[0_0_45px_rgba(251,191,36,0.7)]">🎂</span>
                {['✨', '🎉', '⭐', '✨', '🎊', '⭐'].map((s, i) => (
                  <span key={i} className="bake-sparkle absolute text-4xl" style={{ left: `${[0, 86, 12, 78, 42, 58][i]}%`, top: `${[-8, 2, 74, 66, -12, 82][i]}%`, animationDelay: `${i * 0.18}s` }}>{s}</span>
                ))}
              </div>
            )}

            {phase === 'burnt' && (
              <div className="relative">
                <span className="bake-shake block text-[14rem] leading-none" style={{ filter: 'brightness(0.3) saturate(0.35)' }}>🎂</span>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="bake-steam absolute text-5xl" style={{ left: `${16 + i * 16}%`, top: '-10%', animationDelay: `${i * 0.25}s` }}>💨</span>
                ))}
              </div>
            )}
          </div>

          <Caption text={BAKE_CAPTIONS[phase]} />
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
            {ok ? (
              <span className="bake-cake-pop text-[9rem] drop-shadow-[0_0_35px_rgba(251,191,36,0.6)]">🎂</span>
            ) : (
              <span className="text-[9rem] opacity-30" style={{ filter: 'brightness(0.4) saturate(0.4)' }}>🎂</span>
            )}
          </div>
          <ResultCard {...props} ok={ok} emoji={ok ? '🎂' : '🔥'} title={ok ? '¡Pastel perfecto!' : 'Se quemó…'} />
        </>
      )}
    </Overlay>
  );
}

// ── Animación 3: paracaidista ───────────────────────────────────────────────

// Nubes que suben rápido: dan la sensación de caída sin mover al personaje.
const RUSH_CLOUDS = [
  { left: '18%', delay: '0s' },
  { left: '62%', delay: '0.3s' },
  { left: '38%', delay: '0.6s' },
  { left: '80%', delay: '0.85s' },
  { left: '8%', delay: '1.1s' },
];

// Colores de los "parches" (respuestas) cosidos sobre la vela del paracaídas.
const PATCHES = ['#ef4444', '#22c55e', '#eab308', '#3b82f6'];

function ChutePatches() {
  return (
    <>
      {PATCHES.map((c, i) => (
        <span key={i} className="patch-pop absolute h-7 w-7 rounded border-2 border-white/70 shadow-md" style={{ background: c, left: `${24 + i * 15}%`, top: '15%', animationDelay: `${i * 0.15}s` }} />
      ))}
    </>
  );
}

type SkyPhase = 'plane' | 'jump' | 'deploy' | 'land' | 'plummet';
const SKY_OK: Array<[SkyPhase, number]> = [['plane', 800], ['jump', 1000], ['deploy', 900], ['land', 1300]];
const SKY_FAIL: Array<[SkyPhase, number]> = [['plane', 800], ['jump', 1000], ['plummet', 1100]];
const SKY_CAPTIONS: Record<SkyPhase, string> = {
  plane: '✈️ Listo para saltar…',
  jump: '🪂 ¡Saltó del avión!',
  deploy: '🪂 ¡Paracaídas abierto!',
  land: '🌳 ¡Aterrizaje perfecto!',
  plummet: '💥 ¡El paracaídas falló!',
};

function SkydiverScene(props: SceneProps) {
  const ok = passed(props);
  const phase = useScenes(ok ? SKY_OK : SKY_FAIL);
  const bg = ok ? 'from-sky-400 to-sky-200' : 'from-sky-600 to-slate-500';
  const falling = phase === 'jump' || phase === 'plummet';
  const showGround = phase === 'land' || (phase === 'card' && ok);

  return (
    <Overlay bg={bg}>
      {/* En caída libre las nubes suben rápido (sensación de caer); si no, van lentas. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {falling
          ? RUSH_CLOUDS.map((c, i) => (
              <span key={i} className="sky-rush absolute text-6xl" style={{ left: c.left, bottom: '-10%', animationDelay: c.delay }}>☁️</span>
            ))
          : CLOUDS.map((c, i) => (
              <span key={i} className="rk-cloud absolute text-4xl" style={{ left: c.left, top: c.top, animationDelay: c.delay }}>☁️</span>
            ))}
      </div>

      {showGround && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-emerald-500 to-emerald-800" />
          <span className="pointer-events-none absolute bottom-16 left-[12%] text-5xl">🌳</span>
          <span className="pointer-events-none absolute bottom-16 right-[12%] text-5xl">🌲</span>
        </>
      )}
      {phase === 'plummet' && <div className="pointer-events-none absolute inset-0 animate-pulse bg-rose-600/20" />}

      {phase !== 'card' ? (
        <div className="relative h-full w-full">
          {/* Close-up: el paracaidista ocupa la pantalla; el fondo da el movimiento. */}
          <div className="absolute inset-0 grid place-items-center">
            {phase === 'plane' && <span className="sky-plane-bob text-[10rem] leading-none">✈️</span>}

            {phase === 'jump' && <span className="sky-wobble text-[12rem] leading-none">🧑</span>}

            {phase === 'deploy' && (
              <div className="sky-chute-open relative">
                <span className="block text-[14rem] leading-none">🪂</span>
                <ChutePatches />
              </div>
            )}

            {phase === 'land' && (
              <div className="sky-sway relative">
                <span className="block text-[13rem] leading-none">🪂</span>
                <ChutePatches />
              </div>
            )}

            {phase === 'plummet' && (
              <div className="relative grid place-items-center">
                <span className="sky-spin block text-[12rem] leading-none">🧑</span>
                <span className="absolute -top-20 text-6xl opacity-70">🪂</span>
              </div>
            )}
          </div>

          <Caption text={SKY_CAPTIONS[phase]} />
        </div>
      ) : (
        <>
          {ok && (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-emerald-500 to-emerald-800" />
              <span className="pointer-events-none absolute bottom-14 left-[15%] text-4xl">🌳</span>
              <span className="pointer-events-none absolute bottom-14 right-[15%] text-4xl">🌲</span>
            </>
          )}
          <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
            {ok ? (
              <span className="sky-plane-bob text-[9rem] drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">🪂</span>
            ) : (
              <span className="text-[9rem] opacity-30">💥</span>
            )}
          </div>
          <ResultCard {...props} ok={ok} emoji={ok ? '🪂' : '💥'} title={ok ? '¡Aterrizaje perfecto!' : '¡Se estrelló!'} />
        </>
      )}
    </Overlay>
  );
}

// ── Registro ────────────────────────────────────────────────────────────────
// Agrega aquí nuevas animaciones. El portal elige una al azar por envío.
const SUBMIT_ANIMATIONS: Array<{ id: string; label: string; component: (p: SceneProps) => ReactNode }> = [
  { id: 'rocket', label: 'Cohete al espacio', component: RocketScene },
  { id: 'baker', label: 'Pastelero', component: BakerScene },
  { id: 'skydiver', label: 'Paracaidista', component: SkydiverScene },
];

/** Elige una animación de resultado al azar (fija durante la vida del modal). */
export function SubmitResult(props: SceneProps) {
  const [Scene] = useState(() => SUBMIT_ANIMATIONS[Math.floor(Math.random() * SUBMIT_ANIMATIONS.length)].component);
  return <Scene {...props} />;
}
