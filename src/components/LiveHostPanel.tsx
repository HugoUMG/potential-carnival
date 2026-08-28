import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, Flag, History, Info, Monitor, Play, Radio, Search, SkipForward, Square, Users, Zap } from 'lucide-react';
import { RichText } from './RichText';
import { activityRegistry } from './activityRegistry';
import {
  cerrarSesionEnVivo,
  crearSesionEnVivo,
  estadoSesionEnVivo,
  lanzarSiguientePregunta,
  historialSesionesEnVivo,
  listarSesionesEnVivo,
  revelarRespuesta,
  terminarSesionEnVivo,
  type LiveHistoryRow,
  type LiveHostState,
} from '../services/api';
import type { Worksheet } from '../types';

/** Los tipos del DSL que se pueden responder en vivo: una pregunta, opciones tocables y
 *  calificación instantánea. **Misma lista que `LIVE_TYPES` en `backend/app/live.py`** — está
 *  duplicada aquí para pintar el resumen de abajo sin una petición por hoja, y hay un test que
 *  falla si las dos se desincronizan (`test_live_session.py`). */
const LIVE_TYPES = new Set(['multiplechoice', 'multiselect', 'truefalse', 'imagechoice', 'matching', 'imagematching', 'dragdrop', 'fillblank']);

/** Tope de opciones por pregunta. **Mismo valor que `MAX_LIVE_OPTIONS` en `live.py`.** */
const MAX_LIVE_OPTIONS = 6;
/** Tope de huecos por pregunta. **Mismo valor que `MAX_LIVE_BLANKS` en `live.py`.** */
const MAX_LIVE_BLANKS = 3;
/** El hueco del DSL. **Misma cadena que `BLANK` en `live.py`.** */
const BLANK = '_____';

/** Tipos que se responden con el teclado o colocando fichas. Sirven para sugerir más tiempo:
 *  20 segundos alcanzan para tocar un botón, no para escribir contra reloj en un celular. */
const TYPING_TYPES = new Set(['fillblank', 'dragdrop']);

/** Cuántas preguntas da UNA actividad. **Espejo de `activity_questions()` en `live.py`**, que
 *  es la autoridad: aquí solo se cuenta, para no pedir una petición por hoja con cincuenta en
 *  la lista. Un test compara los dos conteos sobre una hoja real y falla si se separan — sin
 *  él, el panel prometería "1 pregunta" donde la sesión trae seis, y el profesor lo
 *  descubriría con el salón mirando. */
function questionCount(activity: Worksheet['activities'][number]): number {
  if (!LIVE_TYPES.has(activity.type)) return 0;
  const within = (n: number) => n >= 2 && n <= MAX_LIVE_OPTIONS;

  if (activity.type === 'truefalse') {
    return (activity.statements ?? []).filter((s) => s.text?.trim() && s.answer != null).length;
  }
  if (activity.type === 'matching' || activity.type === 'imagematching') {
    const left = activity.left ?? [];
    const right = activity.right ?? [];
    // Una pregunta por fila; las `right` completas son las opciones, de ahí el tope.
    return left.length >= 2 && right.length >= left.length && right.length <= MAX_LIVE_OPTIONS ? left.length : 0;
  }
  if (activity.type === 'dragdrop' || activity.type === 'fillblank') {
    // Una oración con huecos es UNA pregunta, se teclee o se coloquen fichas.
    const blanks = (activity.text ?? '').split(BLANK).length - 1;
    const answers = (Array.isArray(activity.answer) ? activity.answer : [activity.answer]).filter((a) => String(a ?? '').trim());
    return blanks >= 1 && blanks <= MAX_LIVE_BLANKS && answers.length >= blanks ? 1 : 0;
  }
  const answer = 'answer' in activity ? activity.answer : undefined;
  const options = 'options' in activity ? activity.options ?? [] : [];
  return within(options.length) && answer && answer.length ? 1 : 0;
}

/** Cuántas PREGUNTAS da la hoja y qué se queda fuera.
 *
 *  Se cuenta por lo que cada actividad DA, no por su tipo: un `matching` de ocho columnas es de
 *  tipo jugable y aun así no entra, y eso tiene que verse. Si la sesión sale más corta que la
 *  hoja, el profesor tiene que saber por qué antes de proyectarla. */
function liveBreakdown(worksheet: Worksheet): { questions: number; skipped: Map<string, number> } {
  let questions = 0;
  const skipped = new Map<string, number>();
  for (const activity of worksheet.activities) {
    if (activity.type === 'content') continue; // repaso, no se descarta
    const count = questionCount(activity);
    if (count) questions += count;
    else skipped.set(activity.type, (skipped.get(activity.type) ?? 0) + 1);
  }
  return { questions, skipped };
}

/** Nombre visible de un tipo. Única fuente: `activityRegistry`, la misma que usa el picker del
 *  constructor y la tarjeta de la hoja, así que el profesor lee el mismo nombre en los tres. */
function typeLabel(type: string): string {
  return activityRegistry[type as keyof typeof activityRegistry]?.label ?? type;
}

function SkippedNote({ skipped }: { skipped: Map<string, number> | { type: string; count: number }[] }) {
  const rows = Array.isArray(skipped) ? skipped : [...skipped].map(([type, count]) => ({ type, count }));
  if (!rows.length) return null;
  return (
    <p className="mt-2 flex items-start gap-2 text-xs text-slate-500">
      <Info size={14} className="mt-0.5 shrink-0 text-amber-500" />
      <span>
        Queda fuera de la sesión: {rows.map((r) => `${r.count} ${typeLabel(r.type)}`).join(' · ')}.
        <span className="block text-slate-400">
          En vivo se responde lo que se toca con el pulgar y se califica solo: opción múltiple, selección
          múltiple, verdadero/falso, imagen + opción múltiple, emparejar, emparejar imágenes y arrastrar
          de un solo hueco. También queda fuera una actividad de esas si pasa de {MAX_LIVE_OPTIONS} opciones
          (los colores dejan de distinguirse desde el fondo) o si depende de un audio. El resto sigue en la
          hoja para resolverla normal.
        </span>
      </span>
    </p>
  );
}

const DURATIONS = [10, 15, 20, 30, 45, 60, 0];

/** Etiqueta corta por tipo en el temario. `multiplechoice` no lleva: es el caso normal. */
const QUESTION_BADGE: Record<string, string> = {
  multiselect: 'multi',
  truefalse: 'V/F',
  imagechoice: 'imagen',
  matching: 'pareja',
  imagematching: 'imagen',
  dragdrop: 'hueco',
  fillblank: 'escribir',
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-sm font-medium text-slate-700">{value}</p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:border-rex hover:text-rex"
        title="Copiar"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }}
      >
        <Copy size={16} />
      </button>
      {copied && <span className="shrink-0 text-xs font-semibold text-rex">copiado</span>}
    </div>
  );
}

/** Historial de sesiones en vivo YA TERMINADAS, con su podio.
 *
 *  No sale de `live.py` (su estado vive en memoria y se pierde al reiniciar el proceso) sino de
 *  las entregas que deja `finish`, reagrupadas por el código de sesión. Es lo que hace que una
 *  evaluación en vivo deje rastro visible sin tener que entrar a Revisión hoja por hoja: ahí
 *  las entregas quedan mezcladas con las de la hoja normal y no se sabe cuál fue en vivo. */
function LiveHistory({ rows }: { rows: LiveHistoryRow[] }) {
  const MEDALS = ['🥇', '🥈', '🥉'];
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <History size={16} className="text-slate-400" /> Sesiones en vivo anteriores
      </p>
      <p className="mt-1 text-xs text-slate-400">
        Las entregas de cada una también están en <strong>Revisión</strong>, dentro de su hoja.
      </p>
      <div className="mt-3 grid gap-2">
        {rows.map((s) => (
          <details key={s.code} className="rounded-xl bg-slate-50 px-4 py-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <strong className="tracking-widest text-slate-900">{s.code}</strong>
              <span className="min-w-0 flex-1 truncate text-slate-600">{s.title}</span>
              <span className="shrink-0 text-xs text-slate-500">{s.participants} alumno{s.participants === 1 ? '' : 's'}</span>
              <span className="shrink-0 text-xs font-semibold text-rex-deep">promedio {s.average}</span>
            </summary>
            <ol className="mt-2 grid gap-1">
              {s.top.map((p, i) => (
                <li key={`${p.label}-${i}`} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm">
                  <span className="w-6 text-center">{MEDALS[i] ?? i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="text-xs text-slate-400">{p.correct}✓</span>
                  <strong className="tabular-nums text-rex-deep">{Math.round(p.score)}</strong>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </div>
  );
}

/** Panel del profesor para la evaluación en tiempo real: elige la hoja, abre la sesión y va
 *  lanzando pregunta por pregunta. Nada avanza solo — el ritmo lo pone quien está al frente. */
export function LiveHostPanel({ worksheets }: { worksheets: Worksheet[] }) {
  const [state, setState] = useState<LiveHostState | null>(null);
  const [previous, setPrevious] = useState<{ code: string; title: string; participants: number; phase: string }[]>([]);
  const [worksheetId, setWorksheetId] = useState('');
  const [duration, setDuration] = useState(20);
  const [instant, setInstant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<LiveHistoryRow[]>([]);
  const polling = useRef(false);

  // Se listan TODAS las hojas, no solo las jugables: si una no sirve, el profesor tiene que ver
  // que existe y por qué no sirve. Ocultarla deja la impresión de que se perdió.
  const breakdowns = useMemo(() => new Map(worksheets.map((w) => [w.id, liveBreakdown(w)])), [worksheets]);
  const playable = worksheets.filter((w) => (breakdowns.get(w.id)?.questions ?? 0) > 0);
  const unplayable = worksheets.filter((w) => (breakdowns.get(w.id)?.questions ?? 0) === 0);
  // Con cincuenta hojas en producción, una lista sin filtro es scroll y nada más.
  const needle = query.trim().toLowerCase();
  const visible = needle ? playable.filter((w) => w.title.toLowerCase().includes(needle)) : playable;

  // Sesiones que siguen vivas en el backend: si el profesor recargó el navegador a media
  // clase, aquí las recupera en vez de quedarse sin control (la sesión no vive en esta pestaña).
  useEffect(() => {
    void listarSesionesEnVivo().then(setPrevious).catch(() => {});
    void historialSesionesEnVivo().then(setHistory).catch(() => {});
  }, []);

  // Poll del panel: 1.5s basta para ver subir el contador de respuestas.
  useEffect(() => {
    const code = state?.code;
    if (!code || state?.phase === 'ended') return;
    const id = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void estadoSesionEnVivo(code)
        .then(setState)
        .catch(() => {})
        .finally(() => { polling.current = false; });
    }, 1500);
    return () => clearInterval(id);
  }, [state?.code, state?.phase]);

  const run = useCallback(async (action: () => Promise<LiveHostState>) => {
    setBusy(true);
    setError('');
    try {
      setState(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  }, []);

  // ── Sin sesión abierta: elegir hoja ────────────────────────────────────────
  if (!state) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-spike/15 text-spike"><Radio size={22} /></span>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Evaluación en tiempo real</h2>
            <p className="text-sm text-slate-500">Tú lanzas cada pregunta y el salón responde desde el celular.</p>
          </div>
        </div>

        {previous.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">Tienes sesiones abiertas</p>
            <div className="mt-2 grid gap-2">
              {previous.map((s) => (
                <button
                  key={s.code}
                  className="flex items-center gap-3 rounded-xl bg-white px-4 py-2 text-left text-sm transition hover:ring-2 hover:ring-amber-300"
                  onClick={() => void run(() => estadoSesionEnVivo(s.code))}
                >
                  <strong className="tracking-widest text-slate-900">{s.code}</strong>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{s.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{s.participants} conectados</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">Elige la evaluación y arráncala aquí mismo</p>
              {playable.length > 6 && (
                <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
                  <Search size={15} className="shrink-0 text-slate-400" />
                  <input
                    className="w-full bg-transparent text-sm outline-none"
                    placeholder={`Buscar entre ${playable.length} evaluaciones…`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
            </div>
            {playable.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                Ninguna de tus evaluaciones tiene actividades que se puedan responder en vivo desde el
                celular: <strong>opción múltiple</strong>, <strong>selección múltiple</strong>,
                <strong> verdadero/falso</strong>, <strong>imagen + opción múltiple</strong>,
                <strong> emparejar</strong>, <strong>emparejar imágenes</strong> o
                <strong> arrastrar de un solo hueco</strong>. Crea una y vuelve aquí.
              </p>
            ) : (
              // Contenedor con scroll propio: con cincuenta hojas, la página entera medía metros
              // y los controles quedaban al fondo, lejos de la hoja que se acababa de elegir.
              <div className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1">
                {visible.map((w) => {
                  const { questions, skipped } = breakdowns.get(w.id)!;
                  const selected = worksheetId === w.id;
                  return (
                    <div
                      key={w.id}
                      className={`rounded-2xl border transition ${selected ? 'border-rex bg-rex-light' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      <button className="block w-full p-4 text-left" onClick={() => setWorksheetId(selected ? '' : w.id)}>
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <strong className="block truncate text-slate-900">{w.title}</strong>
                            <p className="truncate text-xs text-slate-500"><RichText text={w.description} /></p>
                          </div>
                          <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-rex-deep">
                            {questions} pregunta{questions === 1 ? '' : 's'}
                          </span>
                        </div>
                        {/* Solo en la seleccionada: en la lista entera sería ruido. */}
                        {selected && <SkippedNote skipped={skipped} />}
                      </button>

                      {/* Tiempo, feedback y arranque DENTRO de la tarjeta. Antes vivían al final
                          de la página: elegir una hoja de la posición 40 obligaba a bajar hasta
                          el fondo, poner el tiempo y arrancar sin ver ya cuál se había elegido. */}
                      {selected && (
                        <div className="border-t border-rex/20 p-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tiempo por pregunta</p>
                          {/* Escribir en un celular contra reloj no es lo mismo que tocar un
                              botón: 20s castigan al que teclea despacio, no al que no sabe. */}
                          {w.activities.some((a) => TYPING_TYPES.has(a.type) && questionCount(a)) && duration > 0 && duration < 45 && (
                            <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              Esta evaluación tiene preguntas que se escriben o se arman con fichas.
                              Con {duration}s se castiga a quien teclea despacio, no a quien no sabe:{' '}
                              <button className="font-bold underline" onClick={(e) => { e.stopPropagation(); setDuration(45); }}>ponle 45s</button>.
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {DURATIONS.map((d) => (
                              <button
                                key={d}
                                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${duration === d ? 'bg-rex text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                                onClick={() => setDuration(d)}
                              >
                                {d === 0 ? 'Sin límite' : `${d}s`}
                              </button>
                            ))}
                          </div>
                          <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                            <input type="checkbox" className="mt-0.5" checked={instant} onChange={(e) => setInstant(e.target.checked)} />
                            <span>
                              Mostrar el ✓/✗ al momento de responder.
                              <span className="block text-xs text-slate-400">
                                Apagado (recomendado): el resultado sale cuando cierras la pregunta, así el primero en responder no le canta la respuesta al de al lado.
                              </span>
                            </span>
                          </label>
                          {error && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}
                          <button
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-rex px-6 py-3.5 text-base font-bold text-white transition hover:bg-rex-dark disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void run(() => crearSesionEnVivo(w.id, duration, instant))}
                          >
                            <Zap size={18} /> {busy ? 'Abriendo…' : 'Iniciar evaluación con esta actividad'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {visible.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Ninguna evaluación jugable se llama así.</p>
                )}
              </div>
            )}

            {unplayable.length > 0 && (
              <details className="mt-3 rounded-2xl bg-slate-50 p-4">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                  {unplayable.length} evaluación{unplayable.length === 1 ? '' : 'es'} más que no se puede{unplayable.length === 1 ? '' : 'n'} jugar en vivo
                </summary>
                <ul className="mt-2 grid gap-1 text-xs text-slate-500">
                  {unplayable.map((w) => (
                    <li key={w.id} className="truncate">
                      <strong className="text-slate-600">{w.title}</strong> — solo tiene{' '}
                      {[...liveBreakdown(w).skipped].map(([type, count]) => `${count} ${typeLabel(type)}`).join(', ') || 'contenido de repaso'}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <LiveHistory rows={history} />
        </div>
      </section>
    );
  }

  // ── Sesión abierta: control pregunta por pregunta ──────────────────────────
  const joinUrl = `${window.location.origin}/en-vivo/${state.code}`;
  const screenUrl = `${joinUrl}/pantalla`;
  const hasNext = state.index + 1 < state.total;
  const isEnded = state.phase === 'ended';

  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-5">
        {/* Cabecera con el código */}
        <div className="rounded-3xl bg-ink p-6 text-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-white/50">Código de sesión</p>
              <p className="text-5xl font-black tracking-[0.15em]">{state.code}</p>
              <p className="mt-1 text-sm text-white/60">{state.title}</p>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-xs uppercase tracking-widest text-white/50">Conectados</p>
                <p className="text-3xl font-black tabular-nums">{state.participants}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-white/50">Respondieron</p>
                <p className="text-3xl font-black tabular-nums text-rex">{state.answered}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <CopyField label="Enlace para los alumnos" value={joinUrl} />
            <CopyField label="Pantalla para proyectar" value={screenUrl} />
          </div>
          <a
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
            href={screenUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Monitor size={16} /> Abrir la pantalla en otra pestaña <ExternalLink size={14} />
          </a>
        </div>

        {/* Controles */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          {isEnded ? (
            <div className="text-center">
              <p className="text-4xl">🏁</p>
              <p className="mt-2 text-lg font-bold text-slate-900">Sesión terminada</p>
              {state.saved != null && (
                <p className="mt-1 text-sm text-slate-500">
                  Se guard{state.saved === 1 ? 'ó' : 'aron'} <strong>{state.saved}</strong> entrega{state.saved === 1 ? '' : 's'}. Ya aparece{state.saved === 1 ? '' : 'n'} en <strong>Revisión</strong>.
                </p>
              )}
              <button
                className="mt-5 rounded-2xl border border-slate-200 px-5 py-3 font-semibold text-slate-600 transition hover:border-slate-300"
                onClick={() => { void cerrarSesionEnVivo(state.code).catch(() => {}); setState(null); }}
              >
                Cerrar y volver
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className="font-bold text-slate-900">
                  {state.phase === 'lobby' ? 'Sala de espera' : `Pregunta ${state.index + 1} de ${state.total}`}
                </p>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${state.phase === 'question' ? 'bg-emerald-100 text-emerald-700' : state.phase === 'reveal' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                  {state.phase === 'question' ? 'Pregunta abierta' : state.phase === 'reveal' ? 'Respuesta revelada' : 'Esperando'}
                </span>
              </div>

              {state.question && (
                <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-lg font-semibold text-slate-800">
                  <RichText text={state.question.question} />
                </p>
              )}
              {state.phase === 'lobby' && (
                <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                  Los alumnos que entren se quedan esperando hasta que lances la primera pregunta.
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                {state.phase === 'question' && (
                  <button
                    className="flex items-center gap-2 rounded-2xl bg-amber-500 px-6 py-3 font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void run(() => revelarRespuesta(state.code))}
                  >
                    <Square size={18} /> Cerrar ahora y revelar
                  </button>
                )}
                {state.phase !== 'question' && hasNext && (
                  <button
                    className="flex items-center gap-2 rounded-2xl bg-rex px-6 py-3 font-bold text-white transition hover:bg-rex-dark disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void run(() => lanzarSiguientePregunta(state.code))}
                  >
                    {state.phase === 'lobby' ? <Play size={18} /> : <SkipForward size={18} />}
                    {state.phase === 'lobby' ? 'Lanzar primera pregunta' : `Lanzar pregunta ${state.index + 2}`}
                  </button>
                )}
                <button
                  className="flex items-center gap-2 rounded-2xl border border-slate-200 px-6 py-3 font-bold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void run(() => terminarSesionEnVivo(state.code))}
                >
                  <Flag size={18} /> Terminar y guardar
                </button>
              </div>
              {!hasNext && state.phase !== 'question' && state.index >= 0 && (
                <p className="mt-3 text-sm text-slate-500">Era la última pregunta. Dale a <strong>Terminar y guardar</strong> para cerrar y dejar las notas en Revisión.</p>
              )}
              {error && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}
            </>
          )}
        </div>

        {/* Temario */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="mb-3 font-bold text-slate-900">Preguntas ({state.total})</p>
          <ol className="grid gap-2">
            {state.questions.map((q) => (
              <li
                key={q.number}
                className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${q.number - 1 === state.index ? 'bg-rex-light font-semibold text-rex-deep' : q.number - 1 < state.index ? 'text-slate-400' : 'bg-slate-50 text-slate-600'}`}
              >
                <span className="w-5 shrink-0 text-center font-bold">{q.number}</span>
                <span className="min-w-0 flex-1"><RichText text={q.question} /></span>
                {QUESTION_BADGE[q.type] && (
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">{QUESTION_BADGE[q.type]}</span>
                )}
              </li>
            ))}
          </ol>
          {/* El temario es la verdad del backend: si aquí salen menos preguntas de las que tiene la
              hoja, esta nota dice exactamente qué se quedó fuera y por qué. */}
          <SkippedNote skipped={state.skipped ?? []} />
        </div>
      </div>

      {/* Marcador completo */}
      <aside className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="mb-3 flex items-center gap-2 font-bold text-slate-900"><Users size={18} className="text-rex" /> Marcador ({state.roster.length})</p>
        {state.roster.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Nadie ha entrado todavía. Comparte el código.</p>}
        <ol className="grid gap-1.5">
          {state.roster.map((p, i) => (
            <li key={`${p.label}-${i}`} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${i < 3 ? 'bg-spike/10' : 'bg-slate-50'}`}>
              <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
              <span aria-hidden>{p.emoji}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-800" title={Object.entries(p.info).map(([k, v]) => `${k}: ${v}`).join(' · ')}>{p.label}</span>
              {/* El promedio por acierto es lo único que separa "acertó más" de "fue más rápido"
                  cuando dos puntajes se cruzan: es la pregunta que hacen los alumnos al ver el
                  podio, y aquí el profesor tiene la respuesta a mano. */}
              {p.avg_speed != null && <span className="text-[11px] tabular-nums text-slate-400" title="Segundos promedio por acierto">{p.avg_speed}s</span>}
              <span className="text-xs text-slate-400">{p.correct}✓</span>
              <strong className="tabular-nums text-rex-deep">{p.score}</strong>
            </li>
          ))}
        </ol>

        {(state.awards?.length ?? 0) > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Menciones</p>
            <ul className="grid gap-1.5">
              {state.awards!.map((a) => (
                <li key={a.key} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-base" aria-hidden>{a.badge}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-slate-800">{a.title}</strong>
                    <span className="block truncate text-slate-400">{a.emoji} {a.label} · {a.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </section>
  );
}
