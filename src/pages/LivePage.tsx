import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Trophy, Users, X } from 'lucide-react';
import { LoadingScreen } from '../components/LoadingScreen';
import { RichText } from '../components/RichText';
import { playSfx } from '../utils/sfx';
import { answerLive, getLiveState, joinLive, type LiveState } from '../services/api';

/** Colores de las opciones, estilo Kahoot: se reconocen por color desde el fondo del salón,
 *  no por leer el texto. Ciclan si hay más de cuatro opciones. */
const OPTION_COLORS = [
  { button: 'bg-rex hover:bg-rex-dark', chip: 'bg-rex', label: '▲' },
  { button: 'bg-spike hover:bg-spike-dark', chip: 'bg-spike', label: '●' },
  { button: 'bg-sky-600 hover:bg-sky-700', chip: 'bg-sky-600', label: '■' },
  { button: 'bg-violet-600 hover:bg-violet-700', chip: 'bg-violet-600', label: '◆' },
];

/** True/False no usa la paleta rotatoria: verde=True y rojo=False es la convención que ya usa
 *  `TrueFalseButtons` en la hoja normal, y se lee desde el fondo del salón sin leer la palabra. */
const TRUE_FALSE_COLORS = [
  { button: 'bg-emerald-600 hover:bg-emerald-700', chip: 'bg-emerald-600', label: '✓' },
  { button: 'bg-red-600 hover:bg-red-700', chip: 'bg-red-600', label: '✗' },
];

function colorFor(index: number, type?: string) {
  if (type === 'truefalse') return TRUE_FALSE_COLORS[index % TRUE_FALSE_COLORS.length];
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

// ── Infraestructura compartida ────────────────────────────────────────────────

/** Poll de 1s. ponytail: `setInterval` + fetch en vez de WebSockets — el backend no tiene
 *  infraestructura de tiempo real y 1s de latencia no se nota en un juego de preguntas. El
 *  techo: con cientos de alumnos o si el retraso llega a molestar, el salto es a WebSockets.
 *  `busy` evita que dos peticiones se solapen cuando la red va lenta. */
function useLivePoll(code: string, pid: string | null) {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      if (busy.current) return;
      busy.current = true;
      try {
        const next = await getLiveState(code, pid ?? undefined);
        if (alive) {
          setState(next);
          setError('');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Sin conexión con la sesión.');
      } finally {
        busy.current = false;
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => { alive = false; clearInterval(id); };
  }, [code, pid]);

  return { state, setState, error };
}

/** Mantiene la pantalla encendida mientras dura la sesión.
 *
 *  Chrome en Android y Safari desde iOS 16.4; requiere HTTPS (Render lo da). No es el
 *  "always on display" del sistema: impide que la pantalla se atenúe mientras la pestaña está
 *  visible, y el navegador SUELTA el permiso al cambiar de app — por eso se vuelve a pedir en
 *  `visibilitychange`. Donde no exista, no pasa nada: el alumno tocará la pantalla. */
function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    type Sentinel = { release: () => Promise<void> };
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!api) return;

    let sentinel: Sentinel | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        const next = await api.request('screen');
        if (alive) sentinel = next; else void next.release();
      } catch { /* denegado o no soportado: se sigue sin él */ }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') void acquire(); };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}

/** Avisa de una pregunta nueva por los TRES canales a la vez y devuelve si toca destellar.
 *
 *  No son alternativas en cascada: `navigator.vibrate` no existe en iPhone (Safari nunca lo
 *  implementó y no hay forma de lograrlo desde una web), así que en la mitad de los celulares
 *  del salón el destello y el sonido son el aviso, no el respaldo. */
function useQuestionAlert(state: LiveState | null): boolean {
  const [flash, setFlash] = useState(false);
  const lastAlerted = useRef<number>(-2);

  useEffect(() => {
    if (!state || state.phase !== 'question' || state.index === lastAlerted.current) return;
    lastAlerted.current = state.index;
    if (typeof navigator.vibrate === 'function') {
      try { navigator.vibrate([180, 90, 180]); } catch { /* el navegador puede ignorarlo */ }
    }
    playSfx('select');
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(id);
  }, [state, state?.phase, state?.index]);

  return flash;
}

/** Cuenta atrás suave entre polls: el servidor manda los ms que quedan una vez por segundo y
 *  esto los interpola. La verdad sigue siendo del servidor — al llegar el siguiente poll se
 *  recalibra, así que el reloj del celular no puede adelantar el cronómetro. */
function useCountdown(remainingMs: number | null | undefined): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    if (remainingMs == null) { deadline.current = null; setLeft(null); return; }
    deadline.current = Date.now() + remainingMs;
    setLeft(remainingMs);
  }, [remainingMs]);

  useEffect(() => {
    const id = setInterval(() => {
      if (deadline.current == null) return;
      setLeft(Math.max(0, deadline.current - Date.now()));
    }, 100);
    return () => clearInterval(id);
  }, []);

  return left;
}

function TimeBar({ remaining, duration }: { remaining: number | null; duration: number }) {
  if (remaining == null || !duration) {
    return <p className="text-center text-sm font-semibold text-slate-500">Sin límite de tiempo · el profesor cierra la pregunta</p>;
  }
  const pct = Math.max(0, Math.min(100, (remaining / (duration * 1000)) * 100));
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-500">Tiempo</span>
        <span className={`text-2xl font-black tabular-nums ${seconds <= 5 ? 'text-red-600' : 'text-slate-800'}`}>{seconds}s</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-200">
        <div className={`live-timebar h-full rounded-full ${pct <= 25 ? 'bg-red-500' : 'bg-rex'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Leaderboard({ rows, title = 'Marcador' }: { rows: { label: string; score: number; correct: number }[]; title?: string }) {
  const MEDALS = ['🥇', '🥈', '🥉'];
  if (!rows.length) return null;
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <p className="mb-3 flex items-center gap-2 font-bold text-slate-800"><Trophy size={18} className="text-spike" /> {title}</p>
      <ol className="grid gap-2">
        {rows.map((row, i) => (
          <li key={`${row.label}-${i}`} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${i === 0 ? 'bg-spike/10' : 'bg-slate-50'}`}>
            <span className="w-8 text-center text-lg font-black text-slate-400">{MEDALS[i] ?? i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{row.label}</span>
            <span className="text-xs text-slate-500">{row.correct} ✓</span>
            <strong className="tabular-nums text-rex-deep">{row.score}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SessionError({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-6 text-center">
      <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <p className="text-4xl">📴</p>
        <h1 className="mt-3 text-lg font-bold text-slate-900">Sesión no disponible</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
      </div>
    </main>
  );
}

// ── Portal del alumno · /en-vivo/:code ───────────────────────────────────────

interface StoredJoin { pid: string; info: Record<string, string> }

function readStoredJoin(code: string): StoredJoin | null {
  try {
    const raw = localStorage.getItem(`live:${code}`);
    return raw ? (JSON.parse(raw) as StoredJoin) : null;
  } catch {
    return null; // localStorage bloqueado o JSON corrupto: se pide de nuevo el carné
  }
}

function JoinForm({ code, fields, title, onJoined }: {
  code: string;
  fields: string[];
  title: string;
  onJoined: (join: StoredJoin, state: LiveState) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => readStoredJoin(code)?.info ?? {});
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const complete = fields.every((f) => (values[f] ?? '').trim());

  async function submit() {
    if (!complete || sending) return;
    setSending(true);
    setError('');
    try {
      const state = await joinLive(code, values);
      const join = { pid: state.pid, info: values };
      try { localStorage.setItem(`live:${code}`, JSON.stringify(join)); } catch { /* modo privado */ }
      onJoined(join, state);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo entrar.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-cream px-4 py-8">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-rex">Sesión {code}</p>
        <h1 className="mt-2 text-center text-2xl font-extrabold text-slate-900">{title}</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Completa tus datos para entrar.</p>

        <div className="mt-6 grid gap-3">
          {fields.map((field, i) => (
            <label key={field} className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">{field}</span>
              <input
                autoFocus={i === 0}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none transition focus:border-rex focus:ring-4 focus:ring-rex/20"
                placeholder={`Tu ${field.toLowerCase()}`}
                value={values[field] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              />
            </label>
          ))}
        </div>

        {error && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}

        <button
          className="mt-5 w-full rounded-2xl bg-rex px-5 py-4 text-lg font-bold text-white transition hover:bg-rex-dark disabled:opacity-50"
          disabled={!complete || sending}
          onClick={() => void submit()}
        >
          {sending ? 'Entrando…' : 'Entrar →'}
        </button>
      </div>
    </main>
  );
}

export function LivePage() {
  const { code = '' } = useParams<{ code: string }>();
  const normalized = code.toUpperCase();
  const [join, setJoin] = useState<StoredJoin | null>(() => readStoredJoin(normalized));
  const { state, setState, error } = useLivePoll(normalized, join?.pid ?? null);
  const flash = useQuestionAlert(join ? state : null);
  const remaining = useCountdown(state?.remaining_ms);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  useWakeLock(Boolean(join));

  const question = state?.question;
  const answered = state?.me?.answered ?? false;

  // Pregunta nueva → se limpia lo elegido en la anterior.
  useEffect(() => { setPicked([]); setSendError(''); }, [question?.id]);

  const send = useCallback(async (answer: string | string[]) => {
    if (!join || sending) return;
    setSending(true);
    setSendError('');
    try {
      setState(await answerLive(normalized, join.pid, answer));
      playSfx('toggle');
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      setSending(false);
    }
  }, [join, normalized, sending, setState]);

  if (error && !state) return <SessionError message={error} />;
  if (!state) return <LoadingScreen message="Buscando la sesión…" />;
  if (!join) {
    return <JoinForm code={normalized} fields={state.info_fields} title={state.title} onJoined={(j, s) => { setJoin(j); setState(s); }} />;
  }

  const me = state.me;
  const revealed = state.phase === 'reveal';
  const correctSet = new Set(
    (Array.isArray(state.answer) ? state.answer : state.answer != null ? [state.answer] : []).map((a) => String(a).toLowerCase()),
  );
  const mine = new Set((Array.isArray(me?.answer) ? me!.answer : me?.answer != null ? [me!.answer] : []).map((a) => String(a).toLowerCase()));

  return (
    <main className="min-h-screen bg-cream pb-10">
      {flash && <div className="live-flash pointer-events-none fixed inset-0 z-50 bg-spike" aria-hidden />}

      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-slate-500">{state.title}</p>
            <p className="truncate font-bold leading-tight text-slate-900">{me?.label ?? 'Conectado'}</p>
          </div>
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Puntos</p>
              <p className="text-lg font-black leading-none tabular-nums text-rex-deep">{me?.score ?? 0}</p>
            </div>
            {me?.rank != null && (
              <div className="rounded-xl bg-rex-light px-3 py-1.5">
                <p className="text-[11px] uppercase tracking-wide text-rex">Puesto</p>
                <p className="text-lg font-black leading-none text-rex-deep">#{me.rank}</p>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto mt-5 grid max-w-2xl gap-5 px-4">
        {/* ── Sala de espera: mientras el profesor no lance, aquí se queda ── */}
        {state.phase === 'lobby' && (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
            <p className="text-5xl">⏳</p>
            <h1 className="mt-4 text-xl font-extrabold text-slate-900">Ya estás dentro</h1>
            <p className="mt-2 text-sm text-slate-500">Espera a que el profesor lance la primera pregunta. No cierres esta página.</p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-rex-light px-4 py-2 text-sm font-semibold text-rex-deep">
              <Users size={16} /> {state.participants} conectado{state.participants === 1 ? '' : 's'}
            </p>
          </div>
        )}

        {/* ── Pregunta abierta ── */}
        {question && state.phase === 'question' && (
          <>
            <div className="live-pop rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-rex">
                Pregunta {question.number} de {state.total}
                {question.type === 'truefalse' && <span className="ml-2 text-slate-400">· ¿Verdadero o falso?</span>}
              </p>
              <h1 className="mt-2 text-xl font-extrabold leading-snug text-slate-900"><RichText text={question.question} /></h1>
              {question.image && <img className="mx-auto mt-3 block max-h-56 w-auto max-w-full rounded-2xl" src={question.image} alt="" />}
              <div className="mt-4"><TimeBar remaining={remaining} duration={state.duration} /></div>
            </div>

            {answered ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
                <p className="text-5xl">✅</p>
                <p className="mt-3 text-lg font-bold text-slate-900">Respuesta enviada</p>
                <p className="mt-1 text-sm text-slate-500">
                  {me?.correct === undefined ? 'El resultado se muestra cuando el profesor cierre la pregunta.' : me.correct ? '¡Correcta!' : 'Incorrecta.'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3">
                  {question.options.map((option, i) => {
                    const color = colorFor(i, question.type);
                    const isPicked = picked.includes(option);
                    const image = question.option_images?.[i] || null;
                    return (
                      <button
                        key={option}
                        className={`flex items-center gap-3 rounded-2xl px-5 py-5 text-left text-lg font-bold text-white shadow-md transition active:scale-[0.98] disabled:opacity-60 ${color.button} ${isPicked ? 'ring-4 ring-slate-900/30' : ''}`}
                        disabled={sending}
                        onClick={() => {
                          if (question.type === 'multiselect') {
                            playSfx('toggle');
                            setPicked((p) => (p.includes(option) ? p.filter((o) => o !== option) : [...p, option]));
                          } else {
                            void send(option);
                          }
                        }}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/25 text-base">{color.label}</span>
                        {/* La imagen acompaña al texto, no lo sustituye: la clave sigue siendo el
                            texto (ADR-20) y así una URL rota no deja la opción en blanco. */}
                        {image && <img className="h-16 w-16 shrink-0 rounded-xl bg-white/20 object-cover" src={image} alt="" />}
                        <span className="min-w-0 flex-1">{option}</span>
                        {isPicked && <Check size={22} className="shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                {question.type === 'multiselect' && (
                  <button
                    className="rounded-2xl bg-slate-900 px-5 py-4 text-lg font-bold text-white transition hover:bg-slate-700 disabled:opacity-40"
                    disabled={!picked.length || sending}
                    onClick={() => void send(picked)}
                  >
                    {sending ? 'Enviando…' : `Enviar ${picked.length} seleccionada${picked.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </>
            )}
            {sendError && <p className="rounded-2xl bg-red-50 p-3 text-center text-sm font-semibold text-red-600">{sendError}</p>}
          </>
        )}

        {/* ── Revelación ── */}
        {question && revealed && (
          <>
            <div className={`live-pop rounded-3xl p-8 text-center text-white shadow-lg ${me?.correct ? 'bg-rex' : answered ? 'bg-red-500' : 'bg-slate-500'}`}>
              <p className="text-6xl">{me?.correct ? '🎉' : answered ? '😕' : '⏱️'}</p>
              <h1 className="mt-3 text-2xl font-black">
                {me?.correct ? '¡Correcta!' : answered ? 'Incorrecta' : 'Sin responder'}
              </h1>
              <p className="mt-1 text-sm text-white/90">Respuesta correcta: <strong>{state.answer_label}</strong></p>
              <p className="mt-4 text-lg font-bold">{me?.score ?? 0} puntos {me?.rank != null && <>· puesto #{me.rank}</>}</p>
            </div>

            <div className="grid gap-2">
              {question.options.map((option, i) => {
                const isCorrect = correctSet.has(option.toLowerCase());
                const isMine = mine.has(option.toLowerCase());
                const image = question.option_images?.[i] || null;
                return (
                  <div key={option} className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 font-semibold ${isCorrect ? 'border-rex bg-rex-light text-rex-deep' : isMine ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs text-white ${colorFor(i, question.type).chip}`}>{colorFor(i, question.type).label}</span>
                    {image && <img className="h-10 w-10 shrink-0 rounded-lg object-cover" src={image} alt="" />}
                    <span className="min-w-0 flex-1">{option}</span>
                    {isCorrect && <Check size={20} />}
                    {isMine && !isCorrect && <X size={20} />}
                    <span className="text-xs tabular-nums text-slate-400">{state.option_counts?.[i] ?? 0}</span>
                  </div>
                );
              })}
            </div>
            <Leaderboard rows={state.leaderboard ?? []} title="Top 5" />
            <p className="text-center text-sm text-slate-500">Espera la siguiente pregunta…</p>
          </>
        )}

        {/* ── Fin ── */}
        {state.phase === 'ended' && (
          <>
            <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
              <p className="text-5xl">🏁</p>
              <h1 className="mt-3 text-2xl font-extrabold text-slate-900">Terminó la sesión</h1>
              <p className="mt-2 text-slate-600">
                Tu puntaje: <strong className="text-rex-deep">{me?.score ?? 0}</strong> · {me?.correct_total ?? 0} de {state.total} correctas
              </p>
              {me?.rank != null && <p className="mt-1 text-sm text-slate-500">Quedaste en el puesto #{me.rank} de {state.participants}.</p>}
            </div>
            <Leaderboard rows={state.leaderboard ?? []} title="Top 5" />
          </>
        )}

        {error && <p className="text-center text-xs text-slate-400">Reconectando…</p>}
      </div>
    </main>
  );
}

// ── Pantalla proyectada · /en-vivo/:code/pantalla ────────────────────────────

export function LiveScreenPage() {
  const { code = '' } = useParams<{ code: string }>();
  const normalized = code.toUpperCase();
  const { state, error } = useLivePoll(normalized, null);
  const remaining = useCountdown(state?.remaining_ms);
  useWakeLock(true);

  if (error && !state) return <SessionError message={error} />;
  if (!state) return <LoadingScreen message="Conectando con la sesión…" />;

  const joinUrl = `${window.location.origin}/en-vivo/${normalized}`;
  const question = state.question;
  const totalAnswers = (state.option_counts ?? []).reduce((a, b) => a + b, 0) || 1;

  return (
    <main className="min-h-screen bg-ink px-8 py-6 text-white">
      <header className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">{state.title}</p>
          <p className="text-2xl font-bold">{state.phase === 'lobby' ? 'Sala de espera' : `Pregunta ${state.index + 1} de ${state.total}`}</p>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-white/50">Conectados</p>
            <p className="text-4xl font-black tabular-nums">{state.participants}</p>
          </div>
          {state.phase === 'question' && (
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-white/50">Respondieron</p>
              <p className="text-4xl font-black tabular-nums text-rex">{state.answered}</p>
            </div>
          )}
        </div>
      </header>

      {/* ── Sala de espera: el código, en grande, es lo único que importa ── */}
      {state.phase === 'lobby' && (
        <section className="mt-16 text-center">
          <p className="text-xl text-white/60">Entra desde tu celular a</p>
          <p className="mt-3 text-4xl font-bold text-rex">{joinUrl.replace(/^https?:\/\//, '')}</p>
          <p className="mt-12 text-xl text-white/60">o con el código</p>
          <p className="mt-2 text-[10rem] font-black leading-none tracking-[0.15em] text-white">{normalized}</p>
        </section>
      )}

      {question && state.phase === 'question' && (
        <section className="mt-10">
          {question.type === 'truefalse' && <p className="text-center text-lg uppercase tracking-[0.3em] text-white/50">¿Verdadero o falso?</p>}
          <h1 className="mt-2 text-center text-5xl font-black leading-tight"><RichText text={question.question} /></h1>
          {question.image && <img className="mx-auto mt-6 block max-h-64 w-auto max-w-full rounded-3xl" src={question.image} alt="" />}
          {remaining != null && state.duration > 0 && (
            <div className="mx-auto mt-8 max-w-4xl">
              <p className="mb-2 text-center text-7xl font-black tabular-nums">{Math.ceil(remaining / 1000)}</p>
              <div className="h-4 overflow-hidden rounded-full bg-white/15">
                <div className="live-timebar h-full rounded-full bg-rex" style={{ width: `${Math.max(0, (remaining / (state.duration * 1000)) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2">
            {question.options.map((option, i) => {
              const image = question.option_images?.[i] || null;
              return (
                <div key={option} className={`flex items-center gap-4 rounded-3xl px-8 py-8 text-3xl font-bold ${colorFor(i, question.type).button.split(' ')[0]}`}>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/25 text-2xl">{colorFor(i, question.type).label}</span>
                  {image && <img className="h-24 w-24 shrink-0 rounded-2xl bg-white/20 object-cover" src={image} alt="" />}
                  <span className="min-w-0 flex-1">{option}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {question && state.phase === 'reveal' && (
        <section className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h1 className="text-3xl font-black leading-tight"><RichText text={question.question} /></h1>
            <p className="mt-2 text-lg text-rex">Respuesta: <strong>{state.answer_label}</strong></p>
            <div className="mt-6 grid gap-3">
              {question.options.map((option, i) => {
                const count = state.option_counts?.[i] ?? 0;
                const isCorrect = (Array.isArray(state.answer) ? state.answer : [state.answer]).some((a) => String(a).toLowerCase() === option.toLowerCase());
                const image = question.option_images?.[i] || null;
                return (
                  <div key={option} className={`overflow-hidden rounded-2xl border-2 ${isCorrect ? 'border-rex' : 'border-white/15'}`}>
                    <div className="relative px-6 py-4">
                      <div className={`absolute inset-y-0 left-0 ${colorFor(i, question.type).chip} opacity-40`} style={{ width: `${(count / totalAnswers) * 100}%` }} />
                      <div className="relative flex items-center gap-3 text-xl font-bold">
                        {image && <img className="h-12 w-12 shrink-0 rounded-lg object-cover" src={image} alt="" />}
                        <span className="min-w-0 flex-1 truncate">{option}</span>
                        {isCorrect && <Check size={24} className="text-rex" />}
                        <span className="tabular-nums">{count}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-ink">
            <Leaderboard rows={state.leaderboard ?? []} title="Top 5" />
          </div>
        </section>
      )}

      {state.phase === 'ended' && (
        <section className="mx-auto mt-10 max-w-2xl text-center">
          <p className="text-6xl">🏆</p>
          <h1 className="mt-4 text-4xl font-black">Resultados finales</h1>
          <div className="mt-8 text-ink">
            <Leaderboard rows={state.leaderboard ?? []} title="Top 5" />
          </div>
        </section>
      )}
    </main>
  );
}
