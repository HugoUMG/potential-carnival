import { useEffect, useState, type ReactNode } from 'react';
import RexMascot from './RexMascot';

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

// La escena se elige AL AZAR en cada envío. La pantalla de carga es RexLearn pensando
// (LoadingOverlay en LoadingScreen.tsx) y ya no preselecciona la escena.
type SceneKind = 'rocket' | 'baker' | 'skydiver';
const KINDS: SceneKind[] = ['rocket', 'baker', 'skydiver'];
function pickKind(): SceneKind {
  return KINDS[Math.floor(Math.random() * KINDS.length)];
}

// ── Efectos de sonido (ZzFX: sintetizados, sin archivos de audio) ────────────
// Cada efecto son parámetros de ZzFX (zzfx.3d2k.com). Se carga en diferido y se
// "primeé" dentro del gesto de envío para que el navegador permita reproducirlo.
type SfxName = 'launch' | 'success' | 'explosion' | 'pop' | 'whoosh' | 'ding';
// `u` = parámetro por defecto de ZzFX (evita arrays con huecos que el linter rechaza).
const u = undefined;
const SFX: Record<SfxName, (number | undefined)[]> = {
  launch: [1.2, u, 80, 0.1, 0.5, 0.6, 4, 1.5, u, u, u, u, u, 0.4],
  success: [u, u, 1675, u, 0.06, 0.24, 1, 1.82, u, u, 837, 0.06],
  explosion: [1.6, u, 333, 0.01, 0, 0.9, 4, 1.9, u, u, u, u, u, 0.5, u, 0.6],
  pop: [u, u, 500, u, 0.03, 0.1, 1],
  whoosh: [1, u, 120, 0.05, 0.25, 0.3, 4, u, u, u, u, u, u, 0.7],
  ding: [u, u, 1046, u, 0.1, 0.25, u, 1.5, u, u, 400, 0.05],
};

let _zzfx: Promise<(...p: (number | undefined)[]) => void> | null = null;
function _loadZzfx() {
  if (!_zzfx) {
    _zzfx = import('zzfx').then((m) => {
      try { m.ZZFX.audioContext.resume?.(); } catch { /* bloqueado por el navegador */ }
      return m.zzfx;
    });
  }
  return _zzfx;
}
/** Prepara el audio dentro del gesto del usuario (al enviar) para poder sonar luego. */
function primeSfx() { _loadZzfx().catch(() => {}); }
/** Reproduce un efecto (best-effort; silencioso si el navegador lo bloquea). */
function playSfx(name: SfxName) { _loadZzfx().then((zzfx) => zzfx(...SFX[name])).catch(() => {}); }

/** Máquina de escenas: recorre los pasos [nombre, ms] en orden y termina en 'card'.
 *  `sounds` reproduce un efecto al ENTRAR a cada fase indicada. */
function useScenes<T extends string>(steps: Array<[T, number]>, sounds?: Partial<Record<T, SfxName>>): T | 'card' {
  const [phase, setPhase] = useState<T | 'card'>(steps[0][0]);
  useEffect(() => {
    if (phase === 'card') return;
    const idx = steps.findIndex(([p]) => p === phase);
    const t = setTimeout(() => setPhase(steps[idx + 1]?.[0] ?? 'card'), steps[idx][1]);
    return () => clearTimeout(t);
  }, [phase, steps]);
  useEffect(() => {
    if (phase !== 'card' && sounds?.[phase as T]) playSfx(sounds[phase as T]!);
  }, [phase, sounds]);
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

/** Tarjeta blanca final con puntuación y botones · igual para todas las animaciones.
 *  RexLearn asoma sobre la tarjeta y reacciona al resultado (feliz si aprobó, triste si no). */
function ResultCard({ ok, emoji, title, score, correct, incorrect, worksheetTitle, onSeeAnswers, onClose }: SceneProps & { ok: boolean; emoji: string; title: string }) {
  return (
    <div className="relative mt-16 w-full max-w-sm rounded-3xl bg-white/95 p-8 pt-14 text-center shadow-2xl backdrop-blur">
      <RexMascot
        mood={ok ? 'happy' : 'sad'}
        className="absolute -top-20 left-1/2 h-36 w-36 -translate-x-1/2 drop-shadow-xl"
      />
      <h2 className="text-2xl font-extrabold text-ink">{emoji} {title}</h2>
      <p className="mt-1 text-sm text-slate-500">{worksheetTitle}</p>
      <div className={`mt-4 rounded-2xl px-6 py-4 ${ok ? 'bg-rex-light' : 'bg-rose-50'}`}>
        <p className={`text-4xl font-black ${ok ? 'text-rex-deep' : 'text-rose-700'}`}>{score !== null ? score : '-'}</p>
        <p className="text-sm font-semibold text-slate-500">Puntuación</p>
      </div>
      <div className="mt-3 flex justify-center gap-3 text-sm font-semibold">
        <span className="rounded-xl bg-emerald-50 px-3 py-1 text-emerald-700">✓ {correct}</span>
        <span className="rounded-xl bg-red-50 px-3 py-1 text-red-700">✗ {incorrect}</span>
      </div>
      <button className="mt-6 w-full rounded-2xl bg-rex px-6 py-3 font-semibold text-white transition hover:bg-rex-dark" onClick={onSeeAnswers}>
        Ver mis respuestas →
      </button>
      <button className="mt-3 w-full rounded-2xl px-6 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
        Cerrar
      </button>
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

type RocketPhase = 'fuel' | 'suspense' | 'ignite' | 'ascend' | 'stabilize' | 'space' | 'turbo' | 'enginefail' | 'fall';
// El cohete solo "viaja" en las fases de vuelo; la suma de esas fases debe igualar la
// duración de rocket-journey-* en app.css (OK vuelo = 4.9s, FAIL vuelo = 4.6s).
const ROCKET_OK: Array<[RocketPhase, number]> = [['fuel', 2000], ['suspense', 1700], ['ignite', 1000], ['ascend', 1400], ['stabilize', 900], ['space', 1600]];
const ROCKET_FAIL: Array<[RocketPhase, number]> = [['fuel', 2000], ['suspense', 1700], ['ignite', 1000], ['ascend', 1400], ['turbo', 700], ['enginefail', 500], ['fall', 1000]];
const ROCKET_SFX: Partial<Record<RocketPhase, SfxName>> = { ignite: 'launch', turbo: 'launch', space: 'success', fall: 'explosion' };
const ROCKET_CAPTIONS: Record<RocketPhase, string> = {
  fuel: '⛽ Tus respuestas son la gasolina del cohete',
  suspense: '¿Podrá despegar el cohete? 🤔',
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
  const phase = useScenes(ok ? ROCKET_OK : ROCKET_FAIL, ROCKET_SFX);
  const onPad = phase === 'fuel' || phase === 'suspense'; // aún en tierra: sin viaje ni llama
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
            {phase === 'suspense' && <div className="pointer-events-none absolute inset-0 -z-10 animate-pulse rounded-full bg-amber-400/25 blur-2xl" />}
            {phase === 'fuel' && (
              <>
                <span className="rk-bob absolute -left-20 bottom-1 text-5xl">⛽</span>
                {['📝', '✏️', '📚'].map((m, i) => (
                  <span key={i} className="rk-rise absolute -left-7 bottom-0 text-2xl" style={{ animationDelay: `${i * 0.5}s` }}>{m}</span>
                ))}
              </>
            )}
            <div className={onPad ? '' : (ok ? 'rk-journey-success' : 'rk-journey-fail')}>
              <div className={phase === 'ignite' || phase === 'turbo' ? 'rk-rumble' : (phase === 'ascend' || phase === 'suspense') ? 'rk-rumble-soft' : ''}>
                <div className="rk-bob flex flex-col items-center">
                  <span className="text-7xl">🚀</span>
                  {!onPad && phase !== 'fall' && (
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

type BakePhase = 'kitchen' | 'mixing' | 'whisk' | 'suspense' | 'oven' | 'reveal' | 'burnt';
const BAKE_OK: Array<[BakePhase, number]> = [['kitchen', 700], ['mixing', 2000], ['whisk', 1200], ['suspense', 1600], ['oven', 1300], ['reveal', 1800]];
const BAKE_FAIL: Array<[BakePhase, number]> = [['kitchen', 700], ['mixing', 2000], ['whisk', 1200], ['suspense', 1600], ['oven', 1300], ['burnt', 1800]];
const BAKE_SFX: Partial<Record<BakePhase, SfxName>> = { mixing: 'pop', whisk: 'whoosh', reveal: 'success', burnt: 'explosion' };
const BAKE_CAPTIONS: Record<BakePhase, string> = {
  kitchen: '👩‍🍳 Alistando la cocina…',
  mixing: '🥣 Tus respuestas son los ingredientes del chef',
  whisk: '🥄 ¡Batiendo la mezcla!',
  suspense: '¿Saldrá bien el pastel? 🤔',
  oven: '🔥 Al horno…',
  reveal: '🎂 ¡Pastel perfecto!',
  burnt: '💨 Uy… se quemó',
};

function BakerScene(props: SceneProps) {
  const ok = passed(props);
  const phase = useScenes(ok ? BAKE_OK : BAKE_FAIL, BAKE_SFX);
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

            {phase === 'suspense' && (
              <div className="relative flex flex-col items-center">
                <span className="text-8xl">👩‍🍳</span>
                <div className="relative -mt-4">
                  <span className="block text-[11rem] leading-none">🥣</span>
                  <div className="absolute inset-6 -z-10 animate-pulse rounded-full bg-amber-400/40 blur-2xl" />
                </div>
                <span className="mt-1 animate-bounce text-5xl">🤔</span>
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

type SkyPhase = 'prep' | 'suspense' | 'jump' | 'deploy' | 'land' | 'plummet';
const SKY_OK: Array<[SkyPhase, number]> = [['prep', 2000], ['suspense', 1600], ['jump', 1800], ['deploy', 1500], ['land', 2000]];
const SKY_FAIL: Array<[SkyPhase, number]> = [['prep', 2000], ['suspense', 1600], ['jump', 1800], ['plummet', 2000]];
const SKY_SFX: Partial<Record<SkyPhase, SfxName>> = { prep: 'pop', jump: 'whoosh', deploy: 'pop', land: 'success', plummet: 'whoosh' };
const SKY_CAPTIONS: Record<SkyPhase, string> = {
  prep: '🪂 Tus respuestas son los parches del paracaídas',
  suspense: '¿Aguantará el paracaídas? 🤔',
  jump: '🪂 ¡Saltó del avión!',
  deploy: '🪂 ¡Paracaídas abierto!',
  land: '🌳 ¡Aterrizaje perfecto!',
  plummet: '💥 ¡El paracaídas falló!',
};

function SkydiverScene(props: SceneProps) {
  const ok = passed(props);
  const phase = useScenes(ok ? SKY_OK : SKY_FAIL, SKY_SFX);
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
            {phase === 'prep' && (
              <div className="relative">
                <span className="rk-bob block text-[14rem] leading-none">🪂</span>
                <ChutePatches />
              </div>
            )}

            {phase === 'suspense' && (
              <div className="relative flex flex-col items-center">
                <div className="pointer-events-none absolute inset-0 -z-10 animate-pulse rounded-full bg-white/30 blur-2xl" />
                <span className="sky-plane-bob text-[9rem] leading-none">✈️</span>
                <span className="mt-2 animate-bounce text-6xl">🕴️</span>
              </div>
            )}

            {phase === 'jump' && <span className="sky-wobble text-[12rem] leading-none">🕴️</span>}

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
                <span className="sky-spin block text-[12rem] leading-none">🕴️</span>
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
// Agrega aquí nuevas animaciones. Para añadir una: define el `SceneKind`, súmala a
// KINDS y LOADING (arriba), y regístrala aquí.
const SUBMIT_ANIMATIONS: Array<{ id: SceneKind; label: string; component: (p: SceneProps) => ReactNode }> = [
  { id: 'rocket', label: 'Cohete al espacio', component: RocketScene },
  { id: 'baker', label: 'Pastelero', component: BakerScene },
  { id: 'skydiver', label: 'Paracaidista', component: SkydiverScene },
];

/** Elige una animación al azar en cada envío (se fija al montar, no cambia entre fases). */
export function SubmitResult(props: SceneProps) {
  const [Scene] = useState(() => SUBMIT_ANIMATIONS.find((a) => a.id === pickKind())!.component);
  // El alumno ya interactuó (clics + botón enviar), así que el navegador permite reanudar el audio.
  useEffect(() => { primeSfx(); }, []);
  return <Scene {...props} />;
}
