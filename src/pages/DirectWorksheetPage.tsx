import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send, RotateCcw } from 'lucide-react';
import { WorksheetRenderer } from '../components/WorksheetRenderer';
import { RocketFueling } from '../components/submitAnimations';
import { LoadingScreen } from '../components/LoadingScreen';
import { getPublicWorksheet, submitDirectResponse, type DetalleRespuesta } from '../services/api';
import type { StudentAnswer, StudentAnswers, Worksheet } from '../types';

/** El nombre lo pide la propia hoja (campo info {}): usa el primer `_info_*` con valor; si no hay, "Sin nombre". */
function nameFromAnswers(answers: StudentAnswers): string {
  const keys = Object.keys(answers).filter((k) => /^_info_\d+$/.test(k)).sort();
  for (const k of keys) {
    const v = String(answers[k] ?? '').trim();
    if (v) return v;
  }
  return 'Sin nombre';
}

/** Estado por actividad para el resaltado inline (matching/truefalse generan id:índice). */
function gradeStatusFrom(details: DetalleRespuesta[]): Record<string, 'correct' | 'incorrect' | 'pending'> {
  const m: Record<string, 'correct' | 'incorrect' | 'pending'> = {};
  for (const d of details) {
    const base = d.activity_id.split(':')[0];
    if (m[base] === 'incorrect') continue;
    if (d.status === 'incorrect') m[base] = 'incorrect';
    else if (d.status === 'pending') m[base] = 'pending';
    else if (m[base] !== 'pending') m[base] = 'correct';
  }
  return m;
}
function answerText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, val]) => `${k} → ${val}`).join(', ');
  return String(v);
}

interface Result { details: DetalleRespuesta[]; score: number | null; correct: number; incorrect: number; pending: number; answers: StudentAnswers; }

export function DirectWorksheetPage() {
  const { worksheetId } = useParams<{ worksheetId: string }>();
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);

  useEffect(() => {
    if (!worksheetId) return;
    setAttemptsUsed(Number(localStorage.getItem(`dw_count_${worksheetId}`) || 0));
    const stored = localStorage.getItem(`dw_result_${worksheetId}`);
    if (stored) { try { setResult(JSON.parse(stored)); } catch { /* ignore */ } }
    let alive = true;
    (async () => {
      try {
        const w = await getPublicWorksheet(worksheetId);
        if (alive) setWorksheet(w);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Hoja no disponible.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [worksheetId]);

  const maxAttempts = worksheet?.maxAttempts ?? null; // null = ilimitada
  const canAttempt = maxAttempts == null || attemptsUsed < maxAttempts;

  const updateAnswer = useCallback((activityId: string, value: StudentAnswer) => {
    setAnswers((cur) => ({ ...cur, [activityId]: value }));
  }, []);

  async function send() {
    if (!worksheet || !worksheetId || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await submitDirectResponse(worksheetId, nameFromAnswers(answers), crypto.randomUUID(), answers);
      const incorrect = response.details.filter((d) => d.status === 'incorrect').length;
      const pending = response.details.filter((d) => d.status === 'pending').length;
      const r: Result = { details: response.details, score: response.score, correct: response.correct_count, incorrect, pending, answers };
      const newCount = attemptsUsed + 1;
      localStorage.setItem(`dw_count_${worksheetId}`, String(newCount));
      localStorage.setItem(`dw_result_${worksheetId}`, JSON.stringify(r));
      setAttemptsUsed(newCount);
      setResult(r);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers({});
    setError('');
    window.scrollTo({ top: 0 });
  }

  if (loading) return <LoadingScreen message="Cargando hoja de trabajo…" />;

  if (error && !worksheet) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-4xl">🔒</p>
          <h1 className="mt-3 text-lg font-bold text-slate-900">Hoja no disponible</h1>
          <p className="mt-2 text-sm text-slate-500">{error} El enlace puede estar deshabilitado o ser incorrecto.</p>
        </div>
      </main>
    );
  }

  if (!worksheet) return null;

  // ── Vista de resultados (siempre disponible tras enviar) ──────────────────
  if (result) {
    return (
      <main className="min-h-screen bg-slate-50 py-8 text-slate-900">
        <div className="mx-auto max-w-4xl px-4">
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-lg font-bold">
              Tu resultado: <span className="text-blue-700">{result.score ?? 0}</span>
              <span className="ml-3 text-sm font-semibold text-emerald-700">✓ {result.correct} correctas</span>
              <span className="ml-3 text-sm font-semibold text-red-600">✗ {result.incorrect} incorrectas</span>
              {result.pending > 0 && <span className="ml-3 text-sm font-semibold text-amber-600">… {result.pending} en revisión</span>}
            </p>
            <p className="mt-1 text-xs text-slate-500">Aquí puedes ver siempre qué respondiste bien y mal.</p>
          </div>

          <WorksheetRenderer worksheet={worksheet} answers={result.answers} readonly onAnswerChange={() => undefined} gradeStatus={gradeStatusFrom(result.details)} />

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 font-bold text-slate-800">Detalle de respuestas</p>
            <div className="grid gap-2">
              {result.details.map((d, i) => (
                <div key={i} className={`rounded-xl border p-2 text-sm ${d.status === 'correct' ? 'border-emerald-200 bg-emerald-50' : d.status === 'incorrect' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                  <p className="font-semibold text-slate-700">{d.status === 'correct' ? '✓' : d.status === 'incorrect' ? '✗' : '…'} {String(d.prompt).slice(0, 100)}</p>
                  <p className="text-slate-500">Tu respuesta: {answerText(d.student_answer)}{d.status === 'incorrect' && d.correct_answer != null && <> · Correcta: <b>{answerText(d.correct_answer)}</b></>}</p>
                  {d.teacher_comment && <p className="mt-1 text-xs italic text-slate-600">💬 {d.teacher_comment}</p>}
                </div>
              ))}
            </div>
          </div>

          {canAttempt && (
            <div className="mt-6 flex justify-center">
              <button className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700" onClick={retry}>
                <RotateCcw size={18} /> Volver a hacerla
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Límite alcanzado sin resultado guardado (raro): mensaje simple.
  if (!canAttempt) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Ya completaste tus intentos</h1>
          <p className="mt-2 text-sm text-slate-500">Esta hoja permite {maxAttempts} intento(s) por dispositivo.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-8 text-slate-900">
      {submitting && <RocketFueling />}
      <div className="mx-auto max-w-4xl px-4">
        <p className="mb-4 rounded-2xl bg-blue-50 px-4 py-2 text-center text-sm font-semibold text-blue-800">
          {maxAttempts == null ? '♾️ Puedes hacer esta hoja las veces que quieras.' : `Intento ${attemptsUsed + 1} de ${maxAttempts}.`}
        </p>
        <WorksheetRenderer worksheet={worksheet} answers={answers} onAnswerChange={updateAnswer} />
        {error && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}
        <div className="sticky bottom-4 mt-6 flex justify-center">
          <button
            className="flex items-center gap-2 rounded-2xl bg-blue-600 px-8 py-3 font-bold text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-60"
            disabled={submitting}
            onClick={() => void send()}
          >
            <Send size={18} /> {submitting ? 'Enviando…' : 'Enviar respuestas'}
          </button>
        </div>
      </div>
    </main>
  );
}
