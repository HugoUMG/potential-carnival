import type { StudentAnswers, Worksheet } from '../types';

/**
 * Validación previa al envío de respuestas (hojas en línea):
 *  1. El nombre (primer campo de identificación, `_info_0`) es OBLIGATORIO.
 *  2. Confirmación final: las respuestas no se pueden cambiar tras la entrega.
 *
 * Usa window.alert/confirm (modales nativos): funcionan igual en móvil y escritorio,
 * y el botón de enviar siempre está visible en ambos.
 *
 * Devuelve `true` si se debe proceder con el envío.
 */
export function confirmBeforeSubmit(worksheet: Worksheet, answers: StudentAnswers): boolean {
  const fields = worksheet.infoFields ?? [];
  if (fields.length > 0) {
    const name = String(answers['_info_0'] ?? '').trim();
    if (!name) {
      window.alert(`Por favor escribe tu ${fields[0].toLowerCase()} antes de enviar.`);
      return false;
    }
  }
  return window.confirm(
    '¿Enviar tus respuestas ahora?\n\nUna vez enviadas, NO podrás cambiarlas.',
  );
}
