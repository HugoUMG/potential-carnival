import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bomb,
  BookOpen,
  Brain,
  Cake,
  Check,
  ChefHat,
  Cloud,
  CookingPot,
  Flame,
  Fuel,
  NotebookPen,
  PartyPopper,
  PenLine,
  PersonStanding,
  Plane,
  Rocket,
  Satellite,
  Sparkle,
  Sparkles,
  Star,
  TreePine,
  Umbrella,
  Utensils,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { AppIcon, type IconName } from './AppIcon';
import RexMascot from './RexMascot';
import { moodForScore } from '../utils/scoreMood';

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
  aiPending?: boolean; // la IA sigue calificando: la nota mostrada es provisional
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
        <Sparkle key={i} size={11} className="rk-twinkle absolute text-white/80" style={{ left: s.left, top: s.top, animationDelay: s.delay }} />
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
function Caption({ text }: { text: ReactNode }) {
  return (
    <p className="absolute inset-x-0 top-10 flex justify-center px-4">
      <span className="flex items-center gap-2 rounded-full bg-black/40 px-5 py-1.5 text-center text-xl font-black text-white backdrop-blur-sm">{text}</span>
    </p>
  );
}

/** Tarjeta blanca final con puntuación y botones · igual para todas las animaciones.
 *  RexLearn asoma sobre la tarjeta y reacciona a la nota (ver moodForScore); sin nota
 *  todavía, usa el resultado binario de la escena (ok). */
function ResultCard({ ok, icon, title, score, correct, incorrect, worksheetTitle, aiPending, onSeeAnswers, onClose }: SceneProps & { ok: boolean; icon: IconName; title: string }) {
  return (
    <div className="relative mt-16 w-full max-w-sm rounded-3xl bg-white/95 p-8 pt-14 text-center shadow-2xl backdrop-blur">
      <RexMascot
        mood={score !== null ? moodForScore(score) : (ok ? 'happy' : 'sad')}
        className="absolute -top-20 left-1/2 h-36 w-36 -translate-x-1/2 drop-shadow-xl"
      />
      <h2 className="flex items-center justify-center gap-2 text-2xl font-extrabold text-ink"><AppIcon name={icon} size={26} /> {title}</h2>
      <p className="mt-1 text-sm text-slate-500">{worksheetTitle}</p>
      <div className={`mt-4 rounded-2xl px-6 py-4 ${ok ? 'bg-rex-light' : 'bg-rose-50'}`}>
        <p className={`text-4xl font-black ${ok ? 'text-rex-deep' : 'text-rose-700'}`}>{score !== null ? score : '-'}</p>
        <p className="text-sm font-semibold text-slate-500">{aiPending ? 'Puntuación provisional' : 'Puntuación'}</p>
      </div>
      {aiPending && (
        <p role="status" className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Tus respuestas se están calificando. Regresa en unos minutos para ver tu nota real: no se perdió nada.
        </p>
      )}
      <div className="mt-3 flex justify-center gap-3 text-sm font-semibold">
        <span className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-1 text-emerald-700"><Check size={15} /> {correct}</span>
        <span className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-1 text-red-700"><X size={15} /> {incorrect}</span>
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

const PLANETS: { icon: IconName; left: string; top: string; size: number; delay: string }[] = [
  { icon: 'orbit', left: '18%', top: '20%', size: 38, delay: '0.1s' },
  { icon: 'moon', left: '78%', top: '14%', size: 30, delay: '0.4s' },
  { icon: 'globe', left: '68%', top: '58%', size: 24, delay: '0.7s' },
];

function Planets() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {PLANETS.map((p, i) => (
        <AppIcon key={i} name={p.icon} size={p.size} className="rk-planet-in absolute text-indigo-200/70" style={{ left: p.left, top: p.top, animationDelay: p.delay }} />
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
const ROCKET_CAPTIONS: Record<RocketPhase, ReactNode> = {
  fuel: <><Fuel size={20} /> Tus respuestas son la gasolina del cohete</>,
  suspense: <>¿Podrá despegar el cohete? <Brain size={20} /></>,
  ignite: <><Flame size={20} /> ¡Ignición!</>,
  ascend: <><Rocket size={20} /> ¡Despegando!</>,
  stabilize: <><Satellite size={20} /> Estabilizando…</>,
  space: <><Sparkles size={20} /> ¡Llegó al espacio!</>,
  turbo: <><Zap size={20} /> ¡Intentando turbo!</>,
  enginefail: <><AlertTriangle size={20} /> Falla de motor…</>,
  fall: <><Bomb size={20} /> ¡Se estrelló!</>,
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
                <Cloud key={i} size={38} className="rk-cloud absolute text-white/80" style={{ left: c.left, top: c.top, animationDelay: c.delay }} />
              ))}
            </div>
          )}

          <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
            {phase === 'suspense' && <div className="pointer-events-none absolute inset-0 -z-10 animate-pulse rounded-full bg-amber-400/25 blur-2xl" />}
            {phase === 'fuel' && (
              <>
                <Fuel size={44} className="rk-bob absolute -left-20 bottom-1 text-amber-300" />
                {[NotebookPen, PenLine, BookOpen].map((Icon, i) => (
                  <Icon key={i} size={22} className="rk-rise absolute -left-7 bottom-0 text-amber-100" style={{ animationDelay: `${i * 0.5}s` }} />
                ))}
              </>
            )}
            <div className={onPad ? '' : (ok ? 'rk-journey-success' : 'rk-journey-fail')}>
              <div className={phase === 'ignite' || phase === 'turbo' ? 'rk-rumble' : (phase === 'ascend' || phase === 'suspense') ? 'rk-rumble-soft' : ''}>
                <div className="rk-bob flex flex-col items-center">
                  <Rocket size={72} className="text-white drop-shadow-lg" />
                  {!onPad && phase !== 'fall' && (
                    <Flame
                      size={40}
                      className={
                        phase === 'turbo' ? 'rk-turbo -mt-2 text-orange-400'
                        : phase === 'enginefail' ? 'rk-flame-out -mt-2 text-slate-400'
                        : 'rk-flame -mt-2 text-orange-400'
                      }
                    />
                  )}
                </div>
              </div>
            </div>

            {phase === 'ignite' && (
              <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2">
                {[0, 1, 2].map((i) => (
                  <Wind key={i} size={30} className="rk-smoke absolute text-slate-300/70" style={{ animationDelay: `${i * 0.25}s` }} />
                ))}
              </div>
            )}
          </div>

          {phase === 'fall' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-16 grid place-items-center">
              <Bomb size={72} className="rk-explode text-orange-400" style={{ animationDelay: '0.45s' }} />
              {DEBRIS.map((d, i) => (
                <Sparkle
                  key={i}
                  size={22}
                  className="rk-debris absolute text-amber-300"
                  style={{ animationDelay: '0.45s', ['--dx' as string]: `${d.dx}px`, ['--dy' as string]: `${d.dy}px` }}
                />
              ))}
            </div>
          )}

          <Caption text={ROCKET_CAPTIONS[phase]} />
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
            {ok ? (
              <Rocket size={144} className="rk-orbit text-indigo-300 drop-shadow-[0_0_45px_rgba(129,140,248,0.65)]" />
            ) : (
              <div className="relative text-rose-400/30">
                <Rocket size={144} />
                <Bomb size={72} className="absolute -bottom-4 -right-4 text-rose-400/60" />
              </div>
            )}
          </div>
          <ResultCard {...props} ok={ok} icon={ok ? 'rocket' : 'bomb'} title={ok ? '¡Buen despegue!' : 'Uff, casi…'} />
        </>
      )}
    </Overlay>
  );
}

// ── Animación 2: pastelero (bowl → pastel) ──────────────────────────────────

const INGREDIENTS: { icon: IconName; off: string; delay: string }[] = [
  { icon: 'egg', off: '-80px', delay: '0s' },
  { icon: 'milk', off: '60px', delay: '0.22s' },
  { icon: 'sandwich', off: '-20px', delay: '0.44s' },
  { icon: 'candy', off: '90px', delay: '0.66s' },
  { icon: 'cherry', off: '-90px', delay: '0.88s' },
  { icon: 'candy', off: '30px', delay: '1.1s' },
];

type BakePhase = 'kitchen' | 'mixing' | 'whisk' | 'suspense' | 'oven' | 'reveal' | 'burnt';
const BAKE_OK: Array<[BakePhase, number]> = [['kitchen', 700], ['mixing', 2000], ['whisk', 1200], ['suspense', 1600], ['oven', 1300], ['reveal', 1800]];
const BAKE_FAIL: Array<[BakePhase, number]> = [['kitchen', 700], ['mixing', 2000], ['whisk', 1200], ['suspense', 1600], ['oven', 1300], ['burnt', 1800]];
const BAKE_SFX: Partial<Record<BakePhase, SfxName>> = { mixing: 'pop', whisk: 'whoosh', reveal: 'success', burnt: 'explosion' };
const BAKE_CAPTIONS: Record<BakePhase, ReactNode> = {
  kitchen: <><ChefHat size={20} /> Alistando la cocina…</>,
  mixing: <><CookingPot size={20} /> Tus respuestas son los ingredientes del chef</>,
  whisk: <><Utensils size={20} /> ¡Batiendo la mezcla!</>,
  suspense: <>¿Saldrá bien el pastel? <Brain size={20} /></>,
  oven: <><Flame size={20} /> Al horno…</>,
  reveal: <><Cake size={20} /> ¡Pastel perfecto!</>,
  burnt: <><Wind size={20} /> Uy… se quemó</>,
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
                <ChefHat size={80} className="text-stone-800" />
                <div className="relative -mt-6">
                  <CookingPot size={176} strokeWidth={1.2} className={`block text-stone-700 ${phase === 'mixing' || phase === 'whisk' ? 'bake-shake' : ''}`} />
                  {phase === 'whisk' && <Utensils size={64} className="bake-whisk absolute -top-14 left-1/2 -translate-x-1/2 text-stone-800" />}
                  {phase === 'mixing' && INGREDIENTS.map((ing, i) => (
                    <div key={i} className="absolute left-1/2 top-2 -translate-x-1/2" style={{ marginLeft: ing.off }}>
                      <AppIcon name={ing.icon} size={52} className="bake-drop-cu block text-amber-900" style={{ animationDelay: ing.delay }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === 'suspense' && (
              <div className="relative flex flex-col items-center">
                <ChefHat size={80} className="text-stone-800" />
                <div className="relative -mt-4">
                  <CookingPot size={176} strokeWidth={1.2} className="block text-stone-700" />
                  <div className="absolute inset-6 -z-10 animate-pulse rounded-full bg-amber-400/40 blur-2xl" />
                </div>
                <Brain size={46} className="mt-1 animate-bounce text-amber-800" />
              </div>
            )}

            {phase === 'oven' && (
              <div className="relative grid place-items-center">
                <Cake size={208} strokeWidth={1.2} className="text-amber-900" style={{ filter: 'brightness(0.75)' }} />
                <div className="absolute inset-8 animate-pulse rounded-full bg-orange-500/50 blur-2xl" />
                <div className="absolute -bottom-2 flex gap-1 text-orange-500">
                  <Flame size={56} /><Flame size={56} /><Flame size={56} />
                </div>
              </div>
            )}

            {phase === 'reveal' && (
              <div className="relative">
                <Cake size={224} strokeWidth={1.2} className="bake-cake-pop block text-amber-700 drop-shadow-[0_0_45px_rgba(251,191,36,0.7)]" />
                {[Sparkle, PartyPopper, Star, Sparkle, PartyPopper, Star].map((Icon, i) => (
                  <Icon key={i} size={34} className="bake-sparkle absolute text-amber-500" style={{ left: `${[0, 86, 12, 78, 42, 58][i]}%`, top: `${[-8, 2, 74, 66, -12, 82][i]}%`, animationDelay: `${i * 0.18}s` }} />
                ))}
              </div>
            )}

            {phase === 'burnt' && (
              <div className="relative">
                <Cake size={224} strokeWidth={1.2} className="bake-shake block text-stone-900" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <Wind key={i} size={44} className="bake-steam absolute text-stone-500" style={{ left: `${16 + i * 16}%`, top: '-10%', animationDelay: `${i * 0.25}s` }} />
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
              <Cake size={144} className="bake-cake-pop text-amber-600 drop-shadow-[0_0_35px_rgba(251,191,36,0.6)]" />
            ) : (
              <Cake size={144} className="text-stone-500 opacity-30" />
            )}
          </div>
          <ResultCard {...props} ok={ok} icon={ok ? 'cake' : 'flame'} title={ok ? '¡Pastel perfecto!' : 'Se quemó…'} />
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
const SKY_CAPTIONS: Record<SkyPhase, ReactNode> = {
  prep: <><Umbrella size={20} /> Tus respuestas son los parches del paracaídas</>,
  suspense: <>¿Aguantará el paracaídas? <Brain size={20} /></>,
  jump: <><Umbrella size={20} /> ¡Saltó del avión!</>,
  deploy: <><Umbrella size={20} /> ¡Paracaídas abierto!</>,
  land: <><TreePine size={20} /> ¡Aterrizaje perfecto!</>,
  plummet: <><Bomb size={20} /> ¡El paracaídas falló!</>,
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
              <Cloud key={i} size={58} className="sky-rush absolute text-white" style={{ left: c.left, bottom: '-10%', animationDelay: c.delay }} />
            ))
          : CLOUDS.map((c, i) => (
              <Cloud key={i} size={38} className="rk-cloud absolute text-white" style={{ left: c.left, top: c.top, animationDelay: c.delay }} />
            ))}
      </div>

      {showGround && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-emerald-500 to-emerald-800" />
          <TreePine size={48} className="pointer-events-none absolute bottom-16 left-[12%] text-emerald-900" />
          <TreePine size={48} className="pointer-events-none absolute bottom-16 right-[12%] text-emerald-950" />
        </>
      )}
      {phase === 'plummet' && <div className="pointer-events-none absolute inset-0 animate-pulse bg-rose-600/20" />}

      {phase !== 'card' ? (
        <div className="relative h-full w-full">
          {/* Close-up: el paracaidista ocupa la pantalla; el fondo da el movimiento. */}
          <div className="absolute inset-0 grid place-items-center">
            {phase === 'prep' && (
              <div className="relative">
                <Umbrella size={224} strokeWidth={1.1} className="rk-bob block text-white drop-shadow-lg" />
                <ChutePatches />
              </div>
            )}

            {phase === 'suspense' && (
              <div className="relative flex flex-col items-center">
                <div className="pointer-events-none absolute inset-0 -z-10 animate-pulse rounded-full bg-white/30 blur-2xl" />
                <Plane size={144} className="sky-plane-bob text-white drop-shadow-lg" />
                <PersonStanding size={64} className="mt-2 animate-bounce text-sky-950" />
              </div>
            )}

            {phase === 'jump' && <PersonStanding size={190} className="sky-wobble text-sky-950" />}

            {phase === 'deploy' && (
              <div className="sky-chute-open relative">
                <Umbrella size={224} strokeWidth={1.1} className="block text-white drop-shadow-lg" />
                <ChutePatches />
              </div>
            )}

            {phase === 'land' && (
              <div className="sky-sway relative">
                <Umbrella size={208} strokeWidth={1.1} className="block text-white drop-shadow-lg" />
                <ChutePatches />
              </div>
            )}

            {phase === 'plummet' && (
              <div className="relative grid place-items-center">
                <PersonStanding size={190} className="sky-spin block text-sky-950" />
                <Umbrella size={64} className="absolute -top-20 text-white/70" />
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
              <TreePine size={38} className="pointer-events-none absolute bottom-14 left-[15%] text-emerald-900" />
              <TreePine size={38} className="pointer-events-none absolute bottom-14 right-[15%] text-emerald-950" />
            </>
          )}
          <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
            {ok ? (
              <Umbrella size={144} className="sky-plane-bob text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]" />
            ) : (
              <Bomb size={144} className="text-rose-200 opacity-40" />
            )}
          </div>
          <ResultCard {...props} ok={ok} icon={ok ? 'umbrella' : 'bomb'} title={ok ? '¡Aterrizaje perfecto!' : '¡Se estrelló!'} />
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
