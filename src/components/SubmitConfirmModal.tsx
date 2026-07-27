import type { StudentAnswers, Worksheet } from '../types';
import RexMascot from './RexMascot';

/**
 * Confirmación de envío EN el frontend (sin window.confirm/alert del navegador):
 *  - 'missing-name': la hoja pide identificación y el primer campo (nombre) está vacío.
 *  - 'confirm': última confirmación — las respuestas no se pueden cambiar tras la entrega.
 * Mismo patrón visual que los overlays de resultado (fixed + tarjeta blanca + RexLearn).
 */
export type SubmitPrompt = { kind: 'missing-name'; field: string } | { kind: 'confirm' };

/** Devuelve la etiqueta del campo de nombre si falta llenarlo; null si todo bien. */
export function missingNameLabel(worksheet: Worksheet, answers: StudentAnswers): string | null {
  const fields = worksheet.infoFields ?? [];
  if (!fields.length) return null;
  return String(answers['_info_0'] ?? '').trim() ? null : fields[0];
}

export function SubmitConfirmModal({ prompt, onConfirm, onClose }: {
  prompt: SubmitPrompt;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const missing = prompt.kind === 'missing-name';
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <RexMascot mood={missing ? 'thinking' : 'hero'} className="mx-auto h-24 w-24 drop-shadow-md" />
        <h2 className="mt-2 text-xl font-extrabold text-ink">
          {missing ? `Falta tu ${prompt.field.toLowerCase()}` : '¿Enviar tus respuestas?'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {missing
            ? <>Escribe tu <b>{prompt.field.toLowerCase()}</b> en la sección “Datos del estudiante” antes de enviar.</>
            : <>Revisa bien: una vez enviadas, <b>no podrás cambiarlas</b>.</>}
        </p>
        {missing ? (
          <button
            type="button"
            className="mt-5 w-full rounded-2xl bg-rex px-5 py-3 font-bold text-white transition hover:bg-rex-dark"
            onClick={onClose}
          >
            Entendido
          </button>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-2xl border border-slate-200 px-5 py-3 font-semibold text-slate-600 transition hover:bg-slate-50"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded-2xl bg-rex px-5 py-3 font-bold text-white transition hover:bg-rex-dark"
              onClick={onConfirm}
            >
              Sí, enviar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
