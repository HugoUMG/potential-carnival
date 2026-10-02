import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';
import { Spinner } from './LoadingScreen';
import { getReinforcementPlan, type PlanReforzamiento } from '../services/api';

/** Plan de reforzamiento al final de los resultados: qué falló, la explicación y un quiz corto.
 *  Se pide solo (una vez) y el padre lo guarda con el resultado para no pagar la IA de nuevo. */
export function ReinforcementPlan({ responseId, plan, onLoaded }: { responseId: string; plan?: PlanReforzamiento; onLoaded: (p: PlanReforzamiento) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requested = useRef(false); // StrictMode monta dos veces: sin esto se pagan dos llamadas

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      onLoaded(await getReinforcementPlan(responseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el plan.');
    } finally {
      setLoading(false);
    }
  }, [responseId, onLoaded]);

  useEffect(() => {
    if (plan || requested.current) return;
    requested.current = true;
    void load();
  }, [plan, load]);

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-2 font-bold text-slate-800"><BookOpen size={18} className="text-rex-deep" /> Tu plan de reforzamiento</p>
      {loading && <p className="mt-3 flex items-center gap-3 text-sm text-slate-500"><Spinner size={20} /> Preparando un repaso de lo que fallaste…</p>}
      {error && !loading && (
        <p className="mt-3 text-sm text-red-600">
          {error}{' '}
          <button className="inline-flex items-center gap-1 font-semibold text-rex-deep underline" onClick={() => void load()}><RotateCcw size={14} /> Reintentar</button>
        </p>
      )}
      {plan && <PlanBody plan={plan} />}
    </section>
  );
}

function PlanBody({ plan }: { plan: PlanReforzamiento }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const hits = plan.quiz.filter((q, i) => picked[i] === q.answer).length;

  return (
    <div className="mt-3 grid gap-4">
      {plan.intro && <p className="text-sm text-slate-600">{plan.intro}</p>}

      {plan.areas.map((a, i) => (
        <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-bold text-slate-800">{i + 1}. {a.topic}</p>
          {a.mistakes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-slate-600">
              {a.mistakes.map((m, j) => <li key={j}>{m}</li>)}
            </ul>
          )}
          <p className="mt-2 text-slate-700"><b>Explicación:</b> {a.explanation}</p>
        </div>
      ))}

      {plan.quiz.length > 0 && (
        <div>
          <p className="font-bold text-slate-800">Mini evaluación</p>
          <div className="mt-2 grid gap-3">
            {plan.quiz.map((q, i) => (
              <fieldset key={i} className={`rounded-xl border p-3 text-sm ${!checked ? 'border-slate-200' : picked[i] === q.answer ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <legend className="px-1 font-semibold text-slate-700">{i + 1}. {q.question}</legend>
                {q.options.map((o, j) => (
                  <label key={j} className="flex cursor-pointer items-center gap-2 py-0.5 text-slate-700">
                    <input type="radio" name={`rq-${i}`} disabled={checked} checked={picked[i] === j} onChange={() => setPicked((p) => ({ ...p, [i]: j }))} />
                    {o}{checked && j === q.answer && <b className="text-emerald-700"> ✓</b>}
                  </label>
                ))}
                {checked && q.explanation && <p className="mt-1 text-xs italic text-slate-600">💬 {q.explanation}</p>}
              </fieldset>
            ))}
          </div>
          {checked ? (
            <p className="mt-3 flex flex-wrap items-center gap-3 font-bold text-slate-800">
              Acertaste {hits} de {plan.quiz.length}
              <button className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600" onClick={() => { setPicked({}); setChecked(false); }}>
                <RotateCcw size={14} /> Repetir
              </button>
            </p>
          ) : (
            <button
              className="mt-3 rounded-2xl bg-rex px-5 py-2 font-bold text-white transition hover:bg-rex-dark disabled:opacity-60"
              disabled={Object.keys(picked).length < plan.quiz.length}
              onClick={() => setChecked(true)}
            >
              Comprobar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
