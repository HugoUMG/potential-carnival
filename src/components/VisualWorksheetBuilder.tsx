/**
 * Constructor visual de hojas de trabajo.
 * Alternativa al editor de script DSL — misma funcionalidad, interfaz drag-and-form.
 * Tipos soportados: fillblank, multiplechoice, matching, textbox, truefalse.
 */

import { useState } from 'react';
import {
  AlignLeft, CheckSquare, ChevronDown, ChevronUp, Columns2,
  GripVertical, List, PlusCircle, Save, Trash2, ToggleLeft,
} from 'lucide-react';
import type { Worksheet, WorksheetActivity, FillBlankActivity, MultipleChoiceActivity, MatchingActivity, TextBoxActivity, TrueFalseActivity, ActivityBlock } from '../types';
import {
  serializeToScript, emptyActivity, emptyBlock, emptyState,
  type VisualActivity, type VisualBlock, type VisualState, type VisualStatement,
} from '../utils/dslSerializer';

// ── Constantes de tipos ───────────────────────────────────────────────────────

const VISUAL_TYPES = ['fillblank', 'multiplechoice', 'matching', 'textbox', 'truefalse'] as const;

const TYPE_META: Record<VisualActivity['type'], { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  fillblank:      { label: 'Fill in the Blank', icon: <AlignLeft size={14} />,   color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  multiplechoice: { label: 'Multiple Choice',    icon: <CheckSquare size={14} />, color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
  matching:       { label: 'Matching',           icon: <Columns2 size={14} />,    color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200' },
  textbox:        { label: 'Open Answer',        icon: <List size={14} />,        color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
  truefalse:      { label: 'True / False',       icon: <ToggleLeft size={14} />,  color: 'text-rose-700',   bg: 'bg-rose-50 border-rose-200' },
};

// ── Importar hoja existente al estado visual ──────────────────────────────────

const SUPPORTED_VISUAL = new Set(VISUAL_TYPES as readonly string[]);

function activityToVisual(act: WorksheetActivity): VisualActivity | null {
  if (!SUPPORTED_VISUAL.has(act.type)) return null;

  const base: VisualActivity = {
    id: act.id,
    type: act.type as VisualActivity['type'],
    instructions: act.instructions ?? '',
    text: '', answer: '', question: '', options: [], correctOption: '',
    left: [], right: [], prompt: '', statements: [],
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

// ── Editores por tipo ─────────────────────────────────────────────────────────

function StringListEditor({
  items, onChange, placeholder, addLabel,
}: { items: string[]; onChange: (items: string[]) => void; placeholder?: string; addLabel: string }) {
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
          <button
            type="button"
            className="rounded-xl border border-red-100 p-2 text-red-400 transition hover:bg-red-50"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:text-blue-600"
        onClick={() => onChange([...items, ''])}
      >
        <PlusCircle size={14} /> {addLabel}
      </button>
    </div>
  );
}

function FillBlankEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  const blanks = (act.text.match(/_____/g) ?? []).length;
  return (
    <div className="grid gap-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Texto (usa _____ para cada espacio en blanco)</span>
        <textarea
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          rows={3}
          value={act.text}
          onChange={(e) => onChange({ ...act, text: e.target.value })}
        />
        {blanks > 1 && (
          <p className="mt-1 text-xs text-slate-400">
            {blanks} espacios detectados — separa las respuestas con coma. Ej: <em>was, weren't</em>
          </p>
        )}
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Respuesta(s) correcta(s)</span>
        <input
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={act.answer}
          placeholder={blanks > 1 ? 'respuesta1, respuesta2' : 'respuesta correcta'}
          onChange={(e) => onChange({ ...act, answer: e.target.value })}
        />
      </label>
    </div>
  );
}

function MultipleChoiceEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <div className="grid gap-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pregunta</span>
        <input
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={act.question}
          onChange={(e) => onChange({ ...act, question: e.target.value })}
        />
      </label>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opciones</span>
        <p className="mb-2 text-xs text-slate-400">Haz clic en el círculo para marcar la correcta.</p>
        <div className="grid gap-2">
          {act.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...act, correctOption: opt })}
                className={`h-5 w-5 shrink-0 rounded-full border-2 transition ${opt === act.correctOption && opt.trim() ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'}`}
              />
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
              <button
                type="button"
                className="rounded-xl border border-red-100 p-2 text-red-400 transition hover:bg-red-50"
                onClick={() => {
                  const next = act.options.filter((_, j) => j !== i);
                  onChange({ ...act, options: next, correctOption: act.correctOption === opt ? '' : act.correctOption });
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:text-blue-600"
            onClick={() => onChange({ ...act, options: [...act.options, ''] })}
          >
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
      <p className="text-xs text-slate-400">Asegúrate de que ambas columnas tengan el mismo número de ítems.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Columna Izquierda</span>
          <div className="mt-2">
            <StringListEditor items={act.left} onChange={(left) => onChange({ ...act, left })} placeholder="Término" addLabel="Agregar ítem" />
          </div>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Columna Derecha</span>
          <div className="mt-2">
            <StringListEditor items={act.right} onChange={(right) => onChange({ ...act, right })} placeholder="Definición / Par" addLabel="Agregar ítem" />
          </div>
        </div>
      </div>
      {act.left.length !== act.right.length && act.left.length > 0 && act.right.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ Ambas columnas deben tener el mismo número de ítems ({maxLen} esperados en cada una).
        </p>
      )}
    </div>
  );
}

function TextboxEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Instrucción / Prompt</span>
      <textarea
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        rows={3}
        value={act.prompt}
        onChange={(e) => onChange({ ...act, prompt: e.target.value })}
      />
    </label>
  );
}

function TrueFalseEditor({ act, onChange }: { act: VisualActivity; onChange: (a: VisualActivity) => void }) {
  const updateStmt = (id: string, patch: Partial<VisualStatement>) => {
    onChange({ ...act, statements: act.statements.map((s) => s.id === id ? { ...s, ...patch } : s) });
  };
  const removeStmt = (id: string) => onChange({ ...act, statements: act.statements.filter((s) => s.id !== id) });
  const addStmt = () => onChange({ ...act, statements: [...act.statements, { id: crypto.randomUUID(), text: '', answer: true }] });

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-400">Escribe el enunciado y marca si es verdadero (✓) o falso (✗).</p>
      {act.statements.map((stmt) => (
        <div key={stmt.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2">
          <input
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            value={stmt.text}
            placeholder="Escribe el enunciado..."
            onChange={(e) => updateStmt(stmt.id, { text: e.target.value })}
          />
          <button
            type="button"
            onClick={() => updateStmt(stmt.id, { answer: !stmt.answer })}
            className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition ${stmt.answer ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
          >
            {stmt.answer ? '✓ True' : '✗ False'}
          </button>
          <button
            type="button"
            className="rounded-xl border border-red-100 p-2 text-red-400 transition hover:bg-red-50"
            onClick={() => removeStmt(stmt.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:text-blue-600"
        onClick={addStmt}
      >
        <PlusCircle size={14} /> Agregar enunciado
      </button>
    </div>
  );
}

// ── Tarjeta de actividad ──────────────────────────────────────────────────────

function ActivityCard({
  act, index, total, onUpdate, onRemove, onMove,
}: {
  act: VisualActivity;
  index: number;
  total: number;
  onUpdate: (a: VisualActivity) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = TYPE_META[act.type];

  return (
    <div className={`rounded-2xl border ${meta.bg} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="cursor-grab text-slate-300"><GripVertical size={16} /></span>
        <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.color} ${meta.bg}`}>
          {meta.icon} {meta.label}
        </span>
        <span className="text-xs text-slate-400">Actividad {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white disabled:opacity-30"><ChevronUp size={14} /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white disabled:opacity-30"><ChevronDown size={14} /></button>
          <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-red-400 transition hover:bg-red-50"><Trash2 size={14} /></button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-white/60 bg-white/70 px-4 py-4 grid gap-4">
          {/* Instructions (optional, collapsed by default) */}
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

          {/* Type-specific editor */}
          {act.type === 'fillblank'      && <FillBlankEditor      act={act} onChange={onUpdate} />}
          {act.type === 'multiplechoice' && <MultipleChoiceEditor act={act} onChange={onUpdate} />}
          {act.type === 'matching'       && <MatchingEditor       act={act} onChange={onUpdate} />}
          {act.type === 'textbox'        && <TextboxEditor        act={act} onChange={onUpdate} />}
          {act.type === 'truefalse'      && <TrueFalseEditor      act={act} onChange={onUpdate} />}
        </div>
      )}
    </div>
  );
}

// ── Tarjeta de bloque ─────────────────────────────────────────────────────────

function BlockCard({
  block, blockIndex, totalBlocks, onUpdate, onRemove, onMoveBlock,
}: {
  block: VisualBlock;
  blockIndex: number;
  totalBlocks: number;
  onUpdate: (b: VisualBlock) => void;
  onRemove: () => void;
  onMoveBlock: (dir: -1 | 1) => void;
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

  const addActivity = (type: VisualActivity['type']) => {
    onUpdate({ ...block, activities: [...block.activities, emptyActivity(type)] });
    setShowPicker(false);
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Block header */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-5 py-4 border-b border-slate-100">
        <div className="flex-1 grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Título del bloque (ej: Part 1)"
            value={block.title}
            onChange={(e) => onUpdate({ ...block, title: e.target.value })}
          />
          <input
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Instrucciones del bloque (opcional)"
            value={block.instructions}
            onChange={(e) => onUpdate({ ...block, instructions: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" disabled={blockIndex === 0} onClick={() => onMoveBlock(-1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"><ChevronUp size={15} /></button>
          <button type="button" disabled={blockIndex === totalBlocks - 1} onClick={() => onMoveBlock(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"><ChevronDown size={15} /></button>
          <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-red-400 transition hover:bg-red-50"><Trash2 size={15} /></button>
        </div>
      </div>

      {/* Activities */}
      <div className="p-5 grid gap-3">
        {block.activities.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            Este bloque está vacío. Agrega una actividad abajo.
          </p>
        )}
        {block.activities.map((act, i) => (
          <ActivityCard
            key={act.id}
            act={act}
            index={i}
            total={block.activities.length}
            onUpdate={(a) => updateActivity(act.id, a)}
            onRemove={() => removeActivity(act.id)}
            onMove={(dir) => moveActivity(i, dir)}
          />
        ))}

        {/* Add activity */}
        {showPicker ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-blue-600">Selecciona el tipo de actividad</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {VISUAL_TYPES.map((type) => {
                const m = TYPE_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addActivity(type)}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-semibold transition hover:shadow-sm ${m.color} ${m.bg}`}
                  >
                    <span className="text-base">{m.icon}</span>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setShowPicker(false)} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancelar</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-300 py-3 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
          >
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

export function VisualWorksheetBuilder({
  initialState, maxAttemptsDraft, isSaving, message, onMaxAttemptsChange, onSave,
}: VisualWorksheetBuilderProps) {
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

  const addBlock = () =>
    setState((s) => ({ ...s, blocks: [...s.blocks, emptyBlock()] }));

  const totalActivities = state.blocks.reduce((n, b) => n + b.activities.length, 0);

  const handleSave = () => {
    const script = serializeToScript(state);
    onSave(script);
  };

  return (
    <div className="grid gap-5">
      {/* Worksheet meta */}
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
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Título de la hoja de trabajo"
              value={state.title}
              onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción</span>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Descripción opcional"
              value={state.description}
              onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
            />
          </label>
        </div>
      </div>

      {/* Blocks */}
      {state.blocks.map((block, i) => (
        <BlockCard
          key={block.id}
          block={block}
          blockIndex={i}
          totalBlocks={state.blocks.length}
          onUpdate={(b) => updateBlock(block.id, b)}
          onRemove={() => removeBlock(block.id)}
          onMoveBlock={(dir) => moveBlock(i, dir)}
        />
      ))}

      {/* Add block */}
      <button
        type="button"
        onClick={addBlock}
        className="flex items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 transition hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50"
      >
        <PlusCircle size={18} /> Agregar bloque
      </button>

      {/* Footer: save */}
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">Intentos permitidos</span>
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
              value={maxAttemptsDraft}
              onChange={(e) => onMaxAttemptsChange(e.target.value)}
            >
              <option value="unlimited">Ilimitada</option>
              <option value="1">1 intento</option>
              <option value="2">2 intentos</option>
              <option value="3">3 intentos</option>
              <option value="4">4 intentos</option>
              <option value="5">5 intentos</option>
            </select>
          </label>
          <button
            type="button"
            disabled={isSaving || !state.title.trim() || totalActivities === 0}
            onClick={handleSave}
            className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={18} /> {isSaving ? 'Guardando...' : 'Guardar evaluación'}
          </button>
        </div>
        {message && (
          <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-medium text-blue-700">{message}</p>
        )}
        {(!state.title.trim() || totalActivities === 0) && (
          <p className="mt-2 text-xs text-slate-400">
            {!state.title.trim() ? 'El título es obligatorio. ' : ''}
            {totalActivities === 0 ? 'Agrega al menos una actividad.' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
