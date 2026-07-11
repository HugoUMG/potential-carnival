import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send, Check } from 'lucide-react';
import { WorksheetRenderer } from '../components/WorksheetRenderer';
import { RocketFueling, SubmitResult } from '../components/submitAnimations';
import { LoadingScreen } from '../components/LoadingScreen';
import { getPublicWorksheet, submitDirectResponse } from '../services/api';
import type { StudentAnswer, StudentAnswers, Worksheet } from '../types';

/** Token por hoja+navegador (estable): evita duplicados en un refresh; el backend igual bloquea el reenvío. */
function tokenFor(worksheetId: string): string {
  const key = `dw_token_${worksheetId}`;
  let t = localStorage.getItem(key);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(key, t); }
  return t;
}

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
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!worksheetId) return;
    if (localStorage.getItem(`dw_done_${worksheetId}`)) { setDone(true); setLoading(false); return; }
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

  const updateAnswer = useCallback((activityId: string, value: StudentAnswer) => {
    setAnswers((cur) => ({ ...cur, [activityId]: value }));
  }, []);

  async function send() {
    if (!worksheet || !worksheetId || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await submitDirectResponse(worksheetId, nameFromAnswers(answers), tokenFor(worksheetId), answers);
      const incorrect = response.details.filter((d) => d.status === 'incorrect').length;
      localStorage.setItem(`dw_done_${worksheetId}`, '1');
      setSubmitResult({ score: response.score, correct: response.correct_count, incorrect, title: worksheet.title });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen message="Cargando hoja de trabajo…" />;

  if (done && !submitResult) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100"><Check className="text-emerald-600" size={28} /></div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">¡Listo! Tu hoja fue enviada.</h1>
          <p className="mt-2 text-sm text-slate-500">Ya puedes cerrar esta ventana. Tu profesor verá tus respuestas.</p>
        </div>
      </main>
    );
  }

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

  return (
    <main className="min-h-screen bg-slate-50 py-8 text-slate-900">
      {submitting && <RocketFueling />}
      <div className="mx-auto max-w-4xl px-4">
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
          onSeeAnswers={() => { setSubmitResult(null); setDone(true); }}
          onClose={() => { setSubmitResult(null); setDone(true); }}
        />
      )}
    </main>
  );
}
