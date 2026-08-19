import type React from 'react';
import { Info } from 'lucide-react';
import { activityRegistry, resolveVoice } from './activityRegistry';
import { AudioPlayer } from './AudioPlayer';
import { RichText } from './RichText';
import type { ActivityBlock, StudentAnswers, StudentAnswer, Worksheet, WorksheetActivity } from '../types';

type GradeStatus = 'correct' | 'incorrect' | 'pending';

interface WorksheetRendererProps {
  worksheet: Worksheet;
  answers: StudentAnswers;
  readonly?: boolean;
  onAnswerChange: (activityId: string, value: StudentAnswer) => void;
  gradeStatus?: Record<string, GradeStatus>; // modo práctica: resalta cada actividad tras "Revisar"
}

// Estilos de la tarjeta y del badge según el resultado (modo práctica).
const GRADE_CARD: Record<GradeStatus, string> = {
  correct: 'border-emerald-300 bg-emerald-50/50',
  incorrect: 'border-red-300 bg-red-50/50',
  pending: 'border-amber-300 bg-amber-50/50',
};
const GRADE_BADGE: Record<GradeStatus, { label: string; cls: string }> = {
  correct: { label: '✓ Correcto', cls: 'bg-emerald-100 text-emerald-700' },
  incorrect: { label: '✗ Incorrecto', cls: 'bg-red-100 text-red-700' },
  pending: { label: '… Abierta', cls: 'bg-amber-100 text-amber-700' },
};

/** Estímulo compartido de un `block {}`: UN texto de lectura o UN audio arriba del bloque, y
 *  debajo todas sus actividades —de cualquier tipo— preguntando sobre él.
 *
 *  Es lo que evita la única alternativa que había antes: repetir el mismo audio en cada
 *  actividad, que además de aburrido gastaba una petición de TTS por pregunta. */
export function BlockStimulus({ block }: { block: ActivityBlock }) {
  const script = block.lines?.length ? block.lines.map((l) => `${l.speaker}|${l.text}`).join('\n') : null;
  if (!script && !block.audioText && !block.text) return null;
  return (
    <div className="grid gap-3 rounded-3xl border border-rex-light bg-white p-5 shadow-sm">
      {block.text && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-rex">📖 Lee el texto</p>
          <p className="rounded-xl bg-rex-light p-4 leading-7 text-slate-700"><RichText text={block.text} /></p>
        </>
      )}
      {(script || block.audioText) && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-rex">
            {script ? `🗣️ Escucha la conversación · ${block.lines!.length} turnos` : '🎧 Escucha el audio'}
          </p>
          {/* El texto del audio nunca se pinta: leerlo convertiría la escucha en lectura. */}
          <AudioPlayer
            text={script ? '' : block.audioText!}
            voice={script ? undefined : resolveVoice(block.voice ?? undefined)}
            conversation={script ?? undefined}
          />
        </>
      )}
    </div>
  );
}

function ActivityCard({ activity, answer, readonly, onAnswerChange, index, status }: {
  activity: WorksheetActivity;
  answer?: StudentAnswer;
  readonly?: boolean;
  onAnswerChange: (activityId: string, value: StudentAnswer) => void;
  index: number;
  status?: GradeStatus;
}) {
  const definition = activityRegistry[activity.type];
  const Renderer = definition.Renderer as React.ComponentType<{
    activity: WorksheetActivity;
    value?: StudentAnswer;
    readonly?: boolean;
    onChange: (activityId: string, value: StudentAnswer) => void;
  }>;

  // `content` es un repaso informativo, no una actividad numerada: sin cabecera "Actividad N"
  // ni badge "Interactiva". Se muestra como una tarjeta de contenido limpia.
  if (activity.type === 'content') {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <Renderer activity={activity} value={answer} readonly={readonly} onChange={onAnswerChange} />
      </section>
    );
  }

  const badge = status ? GRADE_BADGE[status] : null;
  return (
    <section className={`rounded-2xl border p-5 shadow-sm transition hover:shadow-md ${status ? GRADE_CARD[status] : 'border-slate-100 bg-white'}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-rex-light text-lg">{definition.icon}</span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-rex">Actividad {index + 1}</p>
            <h2 className="font-semibold text-slate-900">{definition.label}</h2>
          </div>
        </div>
        {badge
          ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
          : <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Interactiva</span>}
      </div>
      <Renderer activity={activity} value={answer} readonly={readonly} onChange={onAnswerChange} />
    </section>
  );
}

/** Lo que NO entra en la miniatura de una tarjeta: audio (cada `listening*`/`conversation` monta un
 *  AudioPlayer que pediría su MP3 al TTS), micrófono (`speaking`) y `content` en sandbox (un iframe
 *  con scripts propios). Con varias tarjetas en pantalla eso son decenas de peticiones por nada. */
function isThumbSafe(activity: WorksheetActivity): boolean {
  if (activity.type.startsWith('listening') || activity.type === 'speaking' || activity.type === 'conversation') return false;
  return !(activity.type === 'content' && activity.sandbox);
}

/** Tarjeta de reemplazo para audio/habla en la miniatura: no monta AudioPlayer (evitaría
 *  descargar TTS de más) pero igual muestra icono + nombre del tipo, nunca un hueco vacío. */
function ThumbPlaceholderCard({ activity }: { activity: WorksheetActivity }) {
  const definition = activityRegistry[activity.type];
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-rex-light text-lg">{definition.icon}</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-rex">Actividad</p>
          <h2 className="font-semibold text-slate-900">{definition.label}</h2>
        </div>
      </div>
    </section>
  );
}

/** Mini vista previa ESTÁTICA de una hoja, para las tarjetas de «Evaluaciones guardadas».
 *
 *  Usa el renderer del alumno (ADR-18: ver y diseñar se parecen porque son lo mismo) en `readonly`,
 *  sin interacción (`pointer-events-none`) y encogido con `scale`. No es un mini-DSL ni una
 *  imitación: si un tipo cambia de aspecto, la miniatura cambia sola.
 *
 *  Toda hoja con actividades muestra algo: las de audio/habla caen a `ThumbPlaceholderCard` en vez
 *  de desaparecer de la miniatura.
 *
 *  `group-hover:-translate-y-1/3` desliza el contenido muy despacio (8s) cuando el `article`
 *  contenedor (`.group`) recibe hover, para que se vea más sin necesidad de abrir el editor.
 *
 *  ponytail: `scale` sobre el renderer completo en vez de una vista propia. Cuesta pintar dos
 *  actividades de más en el DOM; a cambio no hay un segundo renderer que se desincronice. */
export function WorksheetThumb({ worksheet, limit = 3 }: { worksheet: Worksheet; limit?: number }) {
  const visible = worksheet.activities.slice(0, limit);
  const hidden = worksheet.activities.length - visible.length;

  if (!visible.length) {
    return (
      <div className="grid h-full place-items-center bg-slate-50 px-4 text-center">
        <p className="text-xs font-semibold text-slate-400">Hoja sin actividades</p>
      </div>
    );
  }

  return (
    <div className="pointer-events-none h-full select-none bg-white" aria-hidden>
      <div className="w-[250%] origin-top-left scale-[0.4] p-3 transition-transform duration-[8000ms] ease-linear group-hover:-translate-y-1/3">
        <div className="grid gap-3">
          {visible.map((activity, index) => (
            isThumbSafe(activity)
              ? <ActivityCard key={activity.id} activity={activity} readonly onAnswerChange={() => undefined} index={index} />
              : <ThumbPlaceholderCard key={activity.id} activity={activity} />
          ))}
          {hidden > 0 && <p className="text-lg font-semibold text-slate-400">+{hidden} actividad{hidden !== 1 ? 'es' : ''} más</p>}
        </div>
      </div>
    </div>
  );
}

export function WorksheetRenderer({ worksheet, answers, readonly, onAnswerChange, gradeStatus }: WorksheetRendererProps) {
  const completedCount = worksheet.activities.filter((activity) => Boolean(answers[activity.id])).length;
  const progress = worksheet.activities.length === 0 ? 0 : Math.round((completedCount / worksheet.activities.length) * 100);
  const blocks = worksheet.blocks?.length ? worksheet.blocks : [{ title: null, instructions: null, activities: worksheet.activities }];

  return (
    <div className="mx-auto max-w-4xl" style={{ backgroundColor: worksheet.theme?.background_color, color: worksheet.theme?.text_color }}>
      <header className="mb-6 rounded-3xl bg-gradient-to-br from-rex to-rex p-6 text-white shadow-lg" style={{ background: worksheet.theme?.primary_color }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">Worksheet</span>
            <h1 className="mt-4 text-3xl font-bold">{worksheet.title}</h1>
            <p className="mt-2 max-w-2xl text-rex-light"><RichText text={worksheet.description} /></p>
          </div>
          <div className="rounded-2xl bg-white/15 p-4 text-center backdrop-blur">
            <p className="text-3xl font-bold">{progress}%</p>
            <p className="text-sm text-rex-light">completado</p>
          </div>
        </div>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {/* ── Campos de identificación (info {}) ─────────────────────────────── */}
      {(worksheet.infoFields?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-lg">📋</span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Identificación</p>
              <h2 className="font-semibold text-slate-900">Datos del estudiante</h2>
            </div>
            <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">No calificable</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {worksheet.infoFields!.map((fieldLabel, i) => (
              <label key={i} className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">{fieldLabel}</span>
                <input
                  className="w-full rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  placeholder={`Escribe tu ${fieldLabel.toLowerCase()}…`}
                  value={String(answers[`_info_${i}`] ?? '')}
                  readOnly={readonly}
                  onChange={(e) => onAnswerChange(`_info_${i}`, e.target.value)}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6">
        {blocks.map((block, blockIndex) => (
          <section key={`${block.title ?? 'block'}-${blockIndex}`} className="grid gap-5">
            {(block.title || block.instructions) && (
              <div className="rounded-3xl border border-rex-light bg-rex-light/70 p-5">
                {block.title && <h2 className="text-xl font-extrabold text-slate-900"><RichText text={block.title} /></h2>}
                {block.instructions && <p className="mt-2 text-sm italic leading-6 text-rex-deep"><Info className="mr-1 inline align-[-2px] text-rex" size={15} /><RichText text={block.instructions} /></p>}
              </div>
            )}
            <BlockStimulus block={block} />
            {block.activities.map((activity, activityIndex) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                answer={answers[activity.id]}
                readonly={readonly}
                onAnswerChange={onAnswerChange}
                index={activityIndex}
                status={gradeStatus?.[activity.id]}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
