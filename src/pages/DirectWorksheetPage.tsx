import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send, Check, RotateCcw } from 'lucide-react';
import { WorksheetRenderer } from '../components/WorksheetRenderer';
import { RocketFueling, SubmitResult } from '../components/submitAnimations';
import { LoadingScreen } from '../components/LoadingScreen';
import { getPublicWorksheet, submitDirectResponse } from '../services/api';
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

export function DirectWorksheetPage() {
  const { worksheetId } = useParams<{ worksheetId: string }>();
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ score: number | null; correct: number; incorrect: number; title: string } | null>(null);
  const [sent, setSent] = useState(false);
  // Intentos usados desde ESTE dispositivo (por hoja). El límite se aplica per-dispositivo, como pidió el usuario.
  const [attemptsUsed, setAttemptsUsed] = useState(0);

  useEffect(() => {
    if (!worksheetId) return;
    setAttemptsUsed(Number(localStorage.getItem(`dw_count_${worksheetId}`) || 0));
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
      // Token nuevo por intento → cada envío es una respuesta independiente (permite reintentos).
      const response = await submitDirectResponse(worksheetId, nameFromAnswers(answers), crypto.randomUUID(), answers);
      const incorrect = response.details.filter((d) => d.status === 'incorrect').length;
      const newCount = attemptsUsed + 1;
      localStorage.setItem(`dw_count_${worksheetId}`, String(newCount));
      setAttemptsUsed(newCount);
      setSubmitResult({ score: response.score, correct: response.correct_count, incorrect, title: worksheet.title });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      setSubmitting(false);
    }
  }

  function finishResult() {
    setSubmitResult(null);
    setSent(true);
  }

  function retry() {
    setSent(false);
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

  // Pantalla de "enviado" (o límite alcanzado). Ofrece reintentar si aún quedan intentos.
  if (sent || (!canAttempt && !submitResult)) {
    const noMore = !canAttempt;
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100"><Check className="text-emerald-600" size={28} /></div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{sent ? '¡Listo! Tu hoja fue enviada.' : 'Ya completaste tus intentos'}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Tu profesor verá tus respuestas.
            {noMore
              ? maxAttempts === 1 ? ' Esta hoja permite un solo intento por dispositivo.' : ` Esta hoja permite ${maxAttempts} intentos por dispositivo.`
              : maxAttempts == null ? ' Puedes volver a hacerla las veces que quieras.' : ` Te quedan ${maxAttempts - attemptsUsed} intento(s).`}
          </p>
          {!noMore && (
            <button className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700" onClick={retry}>
              <RotateCcw size={18} /> Volver a hacerla
            </button>
          )}
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

      {submitResult && (
        <SubmitResult
          score={submitResult.score}
          correct={submitResult.correct}
          incorrect={submitResult.incorrect}
          worksheetTitle={submitResult.title}
          onSeeAnswers={finishResult}
          onClose={finishResult}
        />
      )}
    </main>
  );
}
