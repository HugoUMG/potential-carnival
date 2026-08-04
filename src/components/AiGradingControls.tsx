/* eslint-disable react-refresh/only-export-components */
/** Los tres escalones que entiende el backend (`_grade_system` en ai.py). */
export function toleranceLabel(value: number): { title: string; detail: string } {
  if (value <= 33) return {
    title: 'Estricta',
    detail: 'Cuenta como error la puntuación final, la mayúscula inicial, los acentos y cualquier falta de ortografía. Para exámenes de precisión escrita.',
  };
  if (value <= 66) return {
    title: 'Equilibrada',
    detail: 'Perdona puntuación, mayúsculas, acentos y un dedazo evidente ("wass" → "was"). Marca error si cambia la palabra, el tiempo verbal o el número.',
  };
  return {
    title: 'Permisiva',
    detail: 'Solo importa el mensaje: perdona ortografía y descuidos de gramática mientras se entienda. Marca error solo si el significado está mal.',
  };
}

/** Autoevaluación con IA + barra de tolerancia a errores de forma. Lo comparten los tres modos
 *  del editor (script, visual e IA) para que la configuración sea la misma en todos. */
export function AiGradingControls({ checked, tolerance, onCheckedChange, onToleranceChange }: {
  checked: boolean;
  tolerance: number;
  onCheckedChange: (value: boolean) => void;
  onToleranceChange: (value: number) => void;
}) {
  return (
    <div className="mt-4">
      <label className="flex max-w-xl items-start gap-3 rounded-2xl border border-slate-200 p-4">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 rounded border-slate-300 text-rex focus:ring-rex-light"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-700">Autoevaluación con IA</span>
          <span className="block text-xs text-slate-500">Si está activa, la IA califica y comenta las respuestas abiertas/incorrectas al enviarse. Solo tú ves esta opción; el alumno no la percibe.</span>
        </span>
      </label>

      {/* Tolerancia: define cuánto perdona la IA los errores de forma (puntuación, dedazos)
          sin perdonar nunca el contenido que la actividad evalúa. */}
      {checked && (() => {
        const { title, detail } = toleranceLabel(tolerance);
        return (
          <div className="mt-3 max-w-xl rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">Tolerancia a errores de forma</span>
              <span className="rounded-full bg-rex-light px-3 py-0.5 text-xs font-bold text-rex-deep">{title} · {tolerance}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={tolerance}
              onChange={(event) => onToleranceChange(Number(event.target.value))}
              className="mt-3 w-full accent-rex"
              aria-label="Tolerancia a errores de forma"
            />
            <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <span>Estricta</span><span>Equilibrada</span><span>Permisiva</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Nunca perdona el contenido: si la actividad practica pasado simple y el alumno usa presente, se marca error en cualquier nivel.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
