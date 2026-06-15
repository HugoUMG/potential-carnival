/**
 * Constructor visual de hojas de trabajo.
 * Alternativa al editor de script DSL — misma funcionalidad, interfaz drag-and-form.
 * Tipos soportados: todos los tipos del sistema excepto speaking.
 */

import { useState } from 'react';
import {
  AlignLeft, CheckSquare, ChevronDown, ChevronUp, Columns2,
  GripVertical, List, PlusCircle, Save, Trash2, ToggleLeft,
  Volume2, Image, BookOpen, Headphones,
} from 'lucide-react';
import type { Worksheet, WorksheetActivity, FillBlankActivity, MultipleChoiceActivity, MatchingActivity, TextBoxActivity, TrueFalseActivity, ActivityBlock } from '../types';
import {
  serializeToScript, emptyActivity, emptyBlock, emptyState,
  type VisualActivity, type VisualBlock, type VisualState, type VisualStatement, type VisualPair, type VisualActivityType,
} from '../utils/dslSerializer';

// ── Constantes de tipos ───────────────────────────────────────────────────────

const VISUAL_TYPES: VisualActivityType[] = [
  'fillblank', 'multiplechoice', 'matching', 'textbox', 'truefalse',
  'listening', 'listeningfillblank', 'listeningmultiplechoice',
  'listeningmatching', 'listeningtruefalse',
  'reading', 'imagequestion',
];

const TYPE_META: Record<VisualActivityType, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  fillblank:              { label: 'Fill in the Blank',        icon: <AlignLeft size={14} />,    color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
  multiplechoice:         { label: 'Multiple Choice',          icon: <CheckSquare size={14} />,  color: 'text-violet-700',  bg: 'bg-violet-50 border-violet-200' },
  matching:               { label: 'Matching',                 icon: <Columns2 size={14} />,     color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  textbox:                { label: 'Open Answer',              icon: <List size={14} />,         color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
  truefalse:              { label: 'True / False',             icon: <ToggleLeft size={14} />,   color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200' },
  listening:              { label: 'Listening',                icon: <Volume2 size={14} />,      color: 'text-cyan-700',    bg: 'bg-cyan-50 border-cyan-200' },
  listeningfillblank:     { label: 'Listening + Fill Blank',   icon: <Headphones size={14} />,   color: 'text-teal-700',    bg: 'bg-teal-50 border-teal-200' },
  listeningmultiplechoice:{ label: 'Listening + MC',           icon: <Headphones size={14} />,   color: 'text-indigo-700',  bg: 'bg-indigo-50 border-indigo-200' },
  listeningmatching:      { label: 'Listening + Matching',     icon: <Headphones size={14} />,   color: 'text-purple-700',  bg: 'bg-purple-50 border-purple-200' },
  listeningtruefalse:     { label: 'Listening + True/False',   icon: <Headphones size={14} />,   color: 'text-fuchsia-700', bg: 'bg-fuchsia-50 border-fuchsia-200' },
  reading:                { label: 'Reading',                  icon: <BookOpen size={14} />,     color: 'text-lime-700',    bg: 'bg-lime-50 border-lime-200' },
  imagequestion:          { label: 'Image Question',           icon: <Image size={14} />,        color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200' },
};

// Grupos para el picker de actividades
const TYPE_GROUPS: { label: string; types: VisualActivityType[] }[] = [
  { label: 'Básicas', types: ['fillblank', 'multiplechoice', 'matching', 'textbox', 'truefalse'] },
  { label: 'Listening', types: ['listening', 'listeningfillblank', 'listeningmultiplechoice', 'listeningmatching', 'listeningtruefalse'] },
  { label: 'Otras', types: ['reading', 'imagequestion'] },
];

// ── Importar hoja existente al estado visual ──────────────────────────────────

const SUPPORTED_VISUAL = new Set(VISUAL_TYPES as string[]);

function activityToVisual(act: WorksheetActivity): VisualActivity | null {
  if (!SUPPORTED_VISUAL.has(act.type)) return null;

  const base: VisualActivity = {
    id: act.id,
    type: act.type as VisualActivityType,
    instructions: act.instructions ?? '',
    text: '', answer: '', question: '', options: [], correctOption: '',
    left: [], right: [], prompt: '', statements: [],
    audioText: '', pairs: [],
    readingTitle: '', readingContent: '', readingQuestions: [],
    imageUrl: '',
  };

  if (act.type === 'fillblank') {
    const fb = act as FillBlankActivity;
    return { ...base, text: fb.text, answer: Array.isArray(fb.answer) ? fb.answer.join(', ') : (fb.answer ?? '') };
  }
  if (act.type === 'multiplechoice') {
    const mc = act as MultipleChoiceActivity;
    const correct = Array.isArray(mc.answer) ? mc.answer[0] : (mc.answer ?? '');
    return { ...base, question: mc.question, options: [...mc.options], correctOption: correct };
  }
  if (act.type === 'matching') {
    const m = act as MatchingActivity;
    return { ...base, left: [...m.left], right: [...m.right] };
  }
  if (act.type === 'textbox') {
    const tb = act as TextBoxActivity;
    return { ...base, prompt: tb.prompt };
  }
  if (act.type === 'truefalse') {
    const tf = act as TrueFalseActivity;
    return { ...base, statements: tf.statements.map((s) => ({ id: crypto.randomUUID(), text: s.text, answer: s.answer })) };
  }
  if (act.type === 'listening') {
    return { ...base, audioText: (act as any).text ?? '', question: (act as any).question ?? '', answer: (act as any).answer ?? '' };
  }
  if (act.type === 'listeningfillblank') {
    const a = act as any;
    return { ...base, audioText: a.audio_text ?? '', text: a.text ?? '', answer: Array.isArray(a.answer) ? a.answer.join(', ') : (a.answer ?? '') };
  }
  if (act.type === 'listeningmultiplechoice') {
    const a = act as any;
    return { ...base, audioText: a.audio_text ?? '', question: a.question ?? '', options: a.options ?? [], correctOption: a.answer ?? '' };
  }
  if (act.type === 'listeningmatching') {
    const a = act as any;
    const pairs: VisualPair[] = (a.pairs ?? []).map((p: any) => ({ id: crypto.randomUUID(), audioText: p.audio_text ?? '', match: p.match ?? '' }));
    return { ...base, pairs, options: a.options ?? [] };
  }
  if (act.type === 'listeningtruefalse') {
    const a = act as any;
    const statements: VisualStatement[] = (a.statements ?? []).map((s: any) => ({ id: crypto.randomUUID(), text: s.text ?? '', answer: s.answer ?? false }));
    return { ...base, audioText: a.audio_text ?? '', statements };
  }
  if (act.type === 'reading') {
    const a = act as any;
    return { ...base, readingTitle: a.title ?? '', readingContent: a.content ?? '', readingQuestions: a.questions ?? [] };
  }
  if (act.type === 'imagequestion') {
    const a = act as any;
    return { ...base, imageUrl: a.image ?? '', prompt: a.prompt ?? '' };
  }
  return null;
}

function blockToVisual(block: ActivityBlock): VisualBlock {
  return {
    id: crypto.randomUUID(),
    title: block.title ?? '',
    instructions: block.instructions ?? '',
    activities: block.activities.map(activityToVisual).filter((a): a is VisualActivity => a !== null),
  };
}

export function worksheetToVisualState(worksheet: Worksheet): { state: VisualState; skipped: number } {
  const totalActivities = worksheet.blocks
    ? worksheet.blocks.reduce((n, b) => n + b.activities.length, 0)
    : worksheet.activities.length;

  let state: VisualState;

  if (worksheet.blocks?.length) {
    const blocks = worksheet.blocks.map(blockToVisual);
    state = { title: worksheet.title, description: worksheet.description, blocks };
  } else if (worksheet.activities.length) {
    const activities = worksheet.activities.map(activityToVisual).filter((a): a is VisualActivity => a !== null);
    state = {
      title: worksheet.title,
      description: worksheet.description,
      blocks: [{ id: crypto.randomUUID(), title: '', instructions: '', activities }],
    };
  } else {
    state = emptyState();
  }

  const imported = state.blocks.reduce((n, b) => n + b.activities.length, 0);
  const skipped = totalActivities - imported;
  return { state, skipped };
}

// ── Componentes compartidos ───────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</span>;
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextArea({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea
      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function AudioField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block rounded-xl bg-cyan-50 border border-cyan-200 p-3">
      <FieldLabel>🔊 Texto del audio (oculto al estudiante)</FieldLabel>
      <TextInput value={value} onChange={onChange} placeholder="Texto que leerá el TTS al estudiante..." />
    </label>
  );
}

function StringListEditor({ items, onChange, placeholder, addLabel }: { items: string[]; onChange: (items: string[]) => void; placeholder?: string; addLabel: string }) {
  return (
    <div className="grid gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            value={item}
            placeholder={placeholder}
            onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }}
          />
          <button type="button" className="rounded-xl border border-red-100 p-2 text-red-400 transition hover:bg-red-50" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:text-blue-600" onClick={() => onChange([...items, ''])}>
        <PlusCircle size={14} /> {addLabel}
      </button>
    </div>
  );
}

function StatementsEditor({ statements, onChange }: { statements: VisualStatement[]; onChange: (s: VisualStatement[]) => void }) {
  const update = (id: string, patch: Partial<VisualStatement>) =>
    onChange(statements.map((s) => s.id === id ? { ...s, ...patch } : s));
  return (
    <div className="grid gap-2">
      <p className="text-xs text-slate-400">Escribe el enunciado y marca si es verdadero (✓) o falso (✗).</p>
      {statements.map((stmt) => (
        <div key={stmt.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2">
          <input
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            value={stmt.text}
            placeholder="Escribe el enunciado..."
            onChange={(e) => update(stmt.id, { text: e.target.value })}
          />
          <button type="button" onClick={() => update(stmt.id, { answer: !stmt.answer })}
            className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition ${stmt.answer ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {stmt.answer ? '✓ True' : '✗ False'}
          </button>
          <button type="button" className="rounded-xl border border-red-100 p-2 text-red-400 transition hover:bg-red-50" onClick={() => onChange(statements.filter((s) => s.id !== stmt.id))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:text-blue-600"
        onClick={() => onChange([...statements, { id: crypto.randomUUID(), text: '', answer: true }])}>
        <PlusCircle size={14} /> Agregar enunciado
      </button>
    </div>
  );
}

// ── Editores por tipo ─────────────────────────────────────────────────────────

function FillBlankEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  const blanks = (act.text.match(/_____/g) ?? []).length;
  return (
    <div className="grid gap-4">
      <label className="block">
        <FieldLabel>Texto (usa _____ para cada espacio en blanco)</FieldLabel>
        <TextArea value={act.text} onChange={(v) => onChange({ ...act, text: v })} />
        {blanks > 1 && <p className="mt-1 text-xs text-slate-400">{blanks} espacios — separa las respuestas con coma. Ej: <em>was, weren't</em></p>}
      </label>
      <label className="block">
        <FieldLabel>Respuesta(s) correcta(s)</FieldLabel>
        <TextInput value={act.answer} onChange={(v) => onChange({ ...act, answer: v })} placeholder={blanks > 1 ? 'respuesta1, respuesta2' : 'respuesta correcta'} />
      </label>
    </div>
  );
}

function MultipleChoiceEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <label className="block">
        <FieldLabel>Pregunta</FieldLabel>
        <TextInput value={act.question} onChange={(v) => onChange({ ...act, question: v })} />
      </label>
      <div>
        <FieldLabel>Opciones</FieldLabel>
        <p className="mb-2 text-xs text-slate-400">Haz clic en el círculo para marcar la correcta.</p>
        <div className="grid gap-2">
          {act.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <button type="button" onClick={() => onChange({ ...act, correctOption: opt })}
                className={`h-5 w-5 shrink-0 rounded-full border-2 transition ${opt === act.correctOption && opt.trim() ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'}`} />
              <input
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={opt}
                onChange={(e) => {
                  const next = [...act.options];
                  const wasCorrect = opt === act.correctOption;
                  next[i] = e.target.value;
                  onChange({ ...act, options: next, correctOption: wasCorrect ? e.target.value : act.correctOption });
                }}
              />
              <button type="button" className="rounded-xl border border-red-100 p-2 text-red-400 transition hover:bg-red-50"
                onClick={() => { const next = act.options.filter((_, j) => j !== i); onChange({ ...act, options: next, correctOption: act.correctOption === opt ? '' : act.correctOption }); }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:text-blue-600"
            onClick={() => onChange({ ...act, options: [...act.options, ''] })}>
            <PlusCircle size={14} /> Agregar opción
          </button>
        </div>
      </div>
    </div>
  );
}

function MatchingEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  const maxLen = Math.max(act.left.length, act.right.length);
  return (
    <div className="grid gap-4">
      <p className="text-xs text-slate-400">Ambas columnas deben tener el mismo número de ítems.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Columna Izquierda</FieldLabel>
          <div className="mt-2"><StringListEditor items={act.left} onChange={(left) => onChange({ ...act, left })} placeholder="Término" addLabel="Agregar ítem" /></div>
        </div>
        <div>
          <FieldLabel>Columna Derecha</FieldLabel>
          <div className="mt-2"><StringListEditor items={act.right} onChange={(right) => onChange({ ...act, right })} placeholder="Definición / Par" addLabel="Agregar ítem" /></div>
        </div>
      </div>
      {act.left.length !== act.right.length && act.left.length > 0 && act.right.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠ Ambas columnas deben tener {maxLen} ítems.</p>
      )}
    </div>
  );
}

function TextboxEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <label className="block">
      <FieldLabel>Instrucción / Prompt</FieldLabel>
      <TextArea value={act.prompt} onChange={(v) => onChange({ ...act, prompt: v })} />
    </label>
  );
}

function TrueFalseEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return <StatementsEditor statements={act.statements} onChange={(statements) => onChange({ ...act, statements })} />;
}

function ListeningEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <AudioField value={act.audioText} onChange={(v) => onChange({ ...act, audioText: v })} />
      <label className="block">
        <FieldLabel>Pregunta para el estudiante</FieldLabel>
        <TextInput value={act.question} onChange={(v) => onChange({ ...act, question: v })} placeholder="What did you hear?" />
      </label>
      <label className="block">
        <FieldLabel>Respuesta clave (referencia)</FieldLabel>
        <TextInput value={act.answer} onChange={(v) => onChange({ ...act, answer: v })} placeholder="Respuesta de referencia..." />
      </label>
    </div>
  );
}

function ListeningFillBlankEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  const blanks = (act.text.match(/_____/g) ?? []).length;
  return (
    <div className="grid gap-4">
      <AudioField value={act.audioText} onChange={(v) => onChange({ ...act, audioText: v })} />
      <label className="block">
        <FieldLabel>Texto con espacios (usa _____ para cada blank)</FieldLabel>
        <TextArea value={act.text} onChange={(v) => onChange({ ...act, text: v })} />
        {blanks > 1 && <p className="mt-1 text-xs text-slate-400">{blanks} espacios — separa respuestas con coma.</p>}
      </label>
      <label className="block">
        <FieldLabel>Respuesta(s) correcta(s)</FieldLabel>
        <TextInput value={act.answer} onChange={(v) => onChange({ ...act, answer: v })} placeholder={blanks > 1 ? 'respuesta1, respuesta2' : 'respuesta correcta'} />
      </label>
    </div>
  );
}

function ListeningMultipleChoiceEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <AudioField value={act.audioText} onChange={(v) => onChange({ ...act, audioText: v })} />
      <MultipleChoiceEditor act={act} onChange={onChange} />
    </div>
  );
}

function ListeningMatchingEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  const updatePair = (id: string, patch: Partial<VisualPair>) =>
    onChange({ ...act, pairs: act.pairs.map((p) => p.id === id ? { ...p, ...patch } : p) });
  const removePair = (id: string) => onChange({ ...act, pairs: act.pairs.filter((p) => p.id !== id) });
  const addPair = () => onChange({ ...act, pairs: [...act.pairs, { id: crypto.randomUUID(), audioText: '', match: '' }] });

  return (
    <div className="grid gap-4">
      <div>
        <FieldLabel>Audios y sus respuestas correctas</FieldLabel>
        <div className="mt-2 grid gap-2">
          {act.pairs.map((pair, i) => (
            <div key={pair.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 grid gap-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-700">🔊 Audio {i + 1}</span>
                <button type="button" className="ml-auto rounded-xl border border-red-100 p-1.5 text-red-400 hover:bg-red-50" onClick={() => removePair(pair.id)}><Trash2 size={12} /></button>
              </div>
              <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={pair.audioText} placeholder="Texto del audio (oculto al estudiante)..."
                onChange={(e) => updatePair(pair.id, { audioText: e.target.value })} />
              <input className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                value={pair.match} placeholder="Respuesta correcta (debe estar en opciones abajo)..."
                onChange={(e) => updatePair(pair.id, { match: e.target.value })} />
            </div>
          ))}
          <button type="button" className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600"
            onClick={addPair}><PlusCircle size={14} /> Agregar audio</button>
        </div>
      </div>
      <div>
        <FieldLabel>Opciones del dropdown (todas las respuestas posibles)</FieldLabel>
        <div className="mt-2"><StringListEditor items={act.options} onChange={(options) => onChange({ ...act, options })} placeholder="Opción..." addLabel="Agregar opción" /></div>
      </div>
    </div>
  );
}

function ListeningTrueFalseEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <AudioField value={act.audioText} onChange={(v) => onChange({ ...act, audioText: v })} />
      <div>
        <FieldLabel>Enunciados</FieldLabel>
        <div className="mt-2">
          <StatementsEditor statements={act.statements} onChange={(statements) => onChange({ ...act, statements })} />
        </div>
      </div>
    </div>
  );
}

function ReadingEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <label className="block">
        <FieldLabel>Título del texto</FieldLabel>
        <TextInput value={act.readingTitle} onChange={(v) => onChange({ ...act, readingTitle: v })} placeholder="Título del texto de lectura..." />
      </label>
      <label className="block">
        <FieldLabel>Contenido del texto</FieldLabel>
        <TextArea value={act.readingContent} onChange={(v) => onChange({ ...act, readingContent: v })} rows={5} placeholder="Escribe el texto de lectura aquí. Puedes usar \\n para saltos de línea." />
      </label>
      <div>
        <FieldLabel>Preguntas de comprensión</FieldLabel>
        <div className="mt-2"><StringListEditor items={act.readingQuestions} onChange={(readingQuestions) => onChange({ ...act, readingQuestions })} placeholder="Pregunta..." addLabel="Agregar pregunta" /></div>
      </div>
    </div>
  );
}

function ImageQuestionEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <label className="block">
        <FieldLabel>URL de la imagen</FieldLabel>
        <TextInput value={act.imageUrl} onChange={(v) => onChange({ ...act, imageUrl: v })} placeholder="https://..." />
        {act.imageUrl && (
          <img src={act.imageUrl} alt="preview" className="mt-2 max-h-40 w-full rounded-xl object-cover border border-slate-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
      </label>
      <label className="block">
        <FieldLabel>Pregunta / Prompt</FieldLabel>
        <TextArea value={act.prompt} onChange={(v) => onChange({ ...act, prompt: v })} placeholder="Describe what you see in the image." />
      </label>
    </div>
  );
}

// ── Tarjeta de actividad ──────────────────────────────────────────────────────

function ActivityEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  switch (act.type) {
    case 'fillblank':              return <FillBlankEditor act={act} onChange={onChange} />;
    case 'multiplechoice':         return <MultipleChoiceEditor act={act} onChange={onChange} />;
    case 'matching':               return <MatchingEditor act={act} onChange={onChange} />;
    case 'textbox':                return <TextboxEditor act={act} onChange={onChange} />;
    case 'truefalse':              return <TrueFalseEditor act={act} onChange={onChange} />;
    case 'listening':              return <ListeningEditor act={act} onChange={onChange} />;
    case 'listeningfillblank':     return <ListeningFillBlankEditor act={act} onChange={onChange} />;
    case 'listeningmultiplechoice':return <ListeningMultipleChoiceEditor act={act} onChange={onChange} />;
    case 'listeningmatching':      return <ListeningMatchingEditor act={act} onChange={onChange} />;
    case 'listeningtruefalse':     return <ListeningTrueFalseEditor act={act} onChange={onChange} />;
    case 'reading':                return <ReadingEditor act={act} onChange={onChange} />;
    case 'imagequestion':          return <ImageQuestionEditor act={act} onChange={onChange} />;
    default:                       return null;
  }
}

function ActivityCard({ act, index, total, onUpdate, onRemove, onMove }: {
  act: VisualActivity; index: number; total: number;
  onUpdate: (a: VisualActivity) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = TYPE_META[act.type];

  return (
    <div className={`rounded-2xl border ${meta.bg} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="cursor-grab text-slate-300"><GripVertical size={16} /></span>
        <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.color} ${meta.bg}`}>
          {meta.icon} {meta.label}
        </span>
        <span className="text-xs text-slate-400">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white disabled:opacity-30"><ChevronUp size={14} /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white disabled:opacity-30"><ChevronDown size={14} /></button>
          <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-red-400 transition hover:bg-red-50"><Trash2 size={14} /></button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-white/60 bg-white/70 px-4 py-4 grid gap-4">
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 list-none flex items-center gap-1">
              <PlusCircle size={12} className="group-open:hidden" />
              <span className="group-open:hidden">Agregar instrucción extra</span>
              <span className="hidden group-open:inline text-xs font-semibold uppercase tracking-wide text-slate-500">Instrucción de actividad</span>
            </summary>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Instrucción opcional para esta actividad..."
              value={act.instructions}
              onChange={(e) => onUpdate({ ...act, instructions: e.target.value })}
            />
          </details>
          <ActivityEditor act={act} onChange={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ── Tarjeta de bloque ─────────────────────────────────────────────────────────

function BlockCard({ block, blockIndex, totalBlocks, onUpdate, onRemove, onMoveBlock }: {
  block: VisualBlock; blockIndex: number; totalBlocks: number;
  onUpdate: (b: VisualBlock) => void; onRemove: () => void; onMoveBlock: (dir: -1 | 1) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const updateActivity = (id: string, act: VisualActivity) =>
    onUpdate({ ...block, activities: block.activities.map((a) => (a.id === id ? act : a)) });
  const removeActivity = (id: string) =>
    onUpdate({ ...block, activities: block.activities.filter((a) => a.id !== id) });
  const moveActivity = (index: number, dir: -1 | 1) => {
    const arr = [...block.activities];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    onUpdate({ ...block, activities: arr });
  };
  const addActivity = (type: VisualActivityType) => {
    onUpdate({ ...block, activities: [...block.activities, emptyActivity(type)] });
    setShowPicker(false);
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-5 py-4 border-b border-slate-100">
        <div className="flex-1 grid gap-2 sm:grid-cols-2">
          <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Título del bloque (ej: Part 1)" value={block.title}
            onChange={(e) => onUpdate({ ...block, title: e.target.value })} />
          <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Instrucciones del bloque (opcional)" value={block.instructions}
            onChange={(e) => onUpdate({ ...block, instructions: e.target.value })} />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" disabled={blockIndex === 0} onClick={() => onMoveBlock(-1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"><ChevronUp size={15} /></button>
          <button type="button" disabled={blockIndex === totalBlocks - 1} onClick={() => onMoveBlock(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"><ChevronDown size={15} /></button>
          <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-red-400 transition hover:bg-red-50"><Trash2 size={15} /></button>
        </div>
      </div>

      <div className="p-5 grid gap-3">
        {block.activities.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            Este bloque está vacío. Agrega una actividad abajo.
          </p>
        )}
        {block.activities.map((act, i) => (
          <ActivityCard key={act.id} act={act} index={i} total={block.activities.length}
            onUpdate={(a) => updateActivity(act.id, a)}
            onRemove={() => removeActivity(act.id)}
            onMove={(dir) => moveActivity(i, dir)} />
        ))}

        {showPicker ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-blue-600">Selecciona el tipo de actividad</p>
            <div className="grid gap-4">
              {TYPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-xs text-slate-400 font-semibold">{group.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {group.types.map((type) => {
                      const m = TYPE_META[type];
                      return (
                        <button key={type} type="button" onClick={() => addActivity(type)}
                          className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-semibold transition hover:shadow-sm ${m.color} ${m.bg}`}>
                          <span className="text-base">{m.icon}</span> {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setShowPicker(false)} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancelar</button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowPicker(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-300 py-3 text-sm font-semibold text-blue-600 transition hover:bg-blue-50">
            <PlusCircle size={16} /> Agregar actividad
          </button>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface VisualWorksheetBuilderProps {
  initialState: VisualState;
  maxAttemptsDraft: string;
  isSaving?: boolean;
  message?: string;
  onMaxAttemptsChange: (value: string) => void;
  onSave: (script: string) => void;
}

export function VisualWorksheetBuilder({ initialState, maxAttemptsDraft, isSaving, message, onMaxAttemptsChange, onSave }: VisualWorksheetBuilderProps) {
  const [state, setState] = useState<VisualState>(initialState);

  const updateBlock = (id: string, block: VisualBlock) =>
    setState((s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === id ? block : b)) }));
  const removeBlock = (id: string) =>
    setState((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id) }));
  const moveBlock = (index: number, dir: -1 | 1) => {
    const arr = [...state.blocks];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    setState((s) => ({ ...s, blocks: arr }));
  };
  const addBlock = () => setState((s) => ({ ...s, blocks: [...s.blocks, emptyBlock()] }));
  const totalActivities = state.blocks.reduce((n, b) => n + b.activities.length, 0);

  return (
    <div className="grid gap-5">
      <div className="rounded-3xl bg-white p-5 shadow-sm grid gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Constructor visual</p>
            <p className="mt-1 text-sm text-slate-500">Diseña la hoja sin escribir código. Se convierte a script automáticamente al guardar.</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
            {totalActivities} actividad{totalActivities !== 1 ? 'es' : ''}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Título *</span>
            <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Título de la hoja de trabajo" value={state.title}
              onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción</span>
            <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Descripción opcional" value={state.description}
              onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} />
          </label>
        </div>
      </div>

      {state.blocks.map((block, i) => (
        <BlockCard key={block.id} block={block} blockIndex={i} totalBlocks={state.blocks.length}
          onUpdate={(b) => updateBlock(block.id, b)}
          onRemove={() => removeBlock(block.id)}
          onMoveBlock={(dir) => moveBlock(i, dir)} />
      ))}

      <button type="button" onClick={addBlock}
        className="flex items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 transition hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50">
        <PlusCircle size={18} /> Agregar bloque
      </button>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">Intentos permitidos</span>
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
              value={maxAttemptsDraft} onChange={(e) => onMaxAttemptsChange(e.target.value)}>
              <option value="unlimited">Ilimitada</option>
              <option value="1">1 intento</option>
              <option value="2">2 intentos</option>
              <option value="3">3 intentos</option>
              <option value="4">4 intentos</option>
              <option value="5">5 intentos</option>
            </select>
          </label>
          <button type="button" disabled={isSaving} onClick={() => onSave(serializeToScript(state))}
            className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:opacity-60">
            <Save className="mr-2 inline" size={18} /> {isSaving ? 'Guardando...' : 'Guardar evaluación'}
          </button>
        </div>
        {message && <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-medium text-blue-700">{message}</p>}
      </div>
    </div>
  );
}
