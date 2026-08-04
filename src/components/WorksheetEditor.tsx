import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Code2, Eye, LayoutTemplate, Sparkles, Save, Loader2, Wand2, ClipboardCopy, Check } from 'lucide-react';
import { VisualWorksheetBuilder, worksheetToVisualState } from './VisualWorksheetBuilder';
import { emptyState } from '../utils/dslSerializer';
import { generateWorksheetWithAI, aiEditWorksheet } from '../services/api';
import { GENERATION_PROMPT } from '../utils/generationPrompt';
import type { Worksheet, WorksheetActivity } from '../types';

// ── Constructor de prompt para la IA (chips + presets) ────────────────────────

interface BuilderState {
  level: string; topic: string; objective: string; focus: string;
  age: string; duration: string; difficulty: string; activities: string[];
}
const EMPTY_BUILDER: BuilderState = { level: '', topic: '', objective: '', focus: '', age: '', duration: '', difficulty: '', activities: [] };

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const OBJECTIVES: [string, string][] = [['Repaso', 'repaso'], ['Introducción', 'introducción del tema'], ['Práctica', 'práctica'], ['Evaluación', 'evaluación'], ['Tarea', 'tarea para casa']];
const FOCUS = ['Affirmative', 'Negative', 'Questions', 'WH Questions', 'Mixed'];
const AGES: [string, string][] = [['Niños', 'niños'], ['Adolescentes', 'adolescentes'], ['Adultos', 'adultos']];
const DURATIONS = ['10', '20', '30', '45'];
const DIFFICULTIES: [string, string][] = [['Fácil', 'fácil'], ['Normal', 'normal'], ['Desafiante', 'desafiante']];
// [etiqueta amigable, tipo DSL] — se incluyen ambos en el prompt para guiar a la IA. Los 19 tipos.
const ACTIVITIES: [string, string][] = [
  ['Multiple Choice', 'multiplechoice'], ['Multi-Select', 'multiselect'], ['Fill in the Blank', 'fillblank'],
  ['Drag & Drop', 'dragdrop'], ['Matching', 'matching'], ['True/False', 'truefalse'],
  ['Repaso (teoría)', 'content'], ['Reading', 'reading'], ['Reading T/F', 'readingtruefalse'],
  ['Listening', 'listening'], ['Listening MC', 'listeningmultiplechoice'], ['Listening T/F', 'listeningtruefalse'],
  ['Listening Fill', 'listeningfillblank'], ['Listen & Order', 'listeningorder'], ['Listening Matching', 'listeningmatching'],
  ['Speaking', 'speaking'], ['Conversation', 'conversation'],
  ['Escritura libre', 'textbox'], ['Image Question', 'imagequestion'],
];
// Grupos por objetivo pedagógico: un clic activa todo el set (misma taxonomía que conoce la IA del backend).
const ACTIVITY_GROUPS: { label: string; icon: string; types: string[] }[] = [
  { label: 'Gramática y vocabulario', icon: '🧱', types: ['fillblank', 'dragdrop', 'multiplechoice', 'multiselect', 'matching', 'truefalse'] },
  { label: 'Lectura', icon: '📖', types: ['content', 'reading', 'readingtruefalse'] },
  { label: 'Comprensión auditiva', icon: '🎧', types: ['listening', 'listeningmultiplechoice', 'listeningtruefalse'] },
  { label: 'Escucha fina', icon: '🎼', types: ['listeningfillblank', 'listeningorder', 'listeningmatching'] },
  { label: 'Producción oral', icon: '🗣️', types: ['speaking', 'conversation'] },
  { label: 'Escritura abierta', icon: '✍️', types: ['textbox', 'imagequestion'] },
];
const PRESETS: { label: string; icon: string; patch: Partial<BuilderState> }[] = [
  { label: 'Warm-up', icon: '🔥', patch: { objective: 'Introducción', duration: '10', difficulty: 'Fácil', activities: ['multiplechoice', 'truefalse'] } },
  { label: 'Grammar Practice', icon: '✏️', patch: { objective: 'Práctica', duration: '20', difficulty: 'Normal', activities: ['fillblank', 'multiplechoice', 'dragdrop'] } },
  { label: 'Weekly Quiz', icon: '📝', patch: { objective: 'Evaluación', duration: '20', difficulty: 'Normal', activities: ['multiplechoice', 'fillblank', 'truefalse'] } },
  { label: 'Monthly Test', icon: '📊', patch: { objective: 'Evaluación', duration: '45', difficulty: 'Desafiante', activities: ['multiplechoice', 'fillblank', 'matching', 'reading'] } },
  { label: 'Homework', icon: '🏠', patch: { objective: 'Tarea', duration: '30', difficulty: 'Normal', activities: ['fillblank', 'multiplechoice', 'reading'] } },
  { label: 'Speaking Club', icon: '🗣️', patch: { objective: 'Práctica', duration: '30', age: 'Adolescentes', activities: ['speaking', 'conversation', 'listening'] } },
  { label: 'Listening Exam', icon: '🎧', patch: { objective: 'Evaluación', duration: '30', activities: ['listening', 'listeningorder', 'conversation'] } },
  { label: 'Reading Assessment', icon: '📖', patch: { objective: 'Evaluación', duration: '30', activities: ['reading', 'multiplechoice'] } },
];

// Plantillas listas para el modo Script: un clic reemplaza el editor con un WorksheetScript válido.
// Procura dar variedad: sin bloques, con bloques, y con los tipos más usados.
const SCRIPT_TEMPLATES: { label: string; icon: string; desc: string; script: string }[] = [
  {
    label: 'Warm-up',
    icon: '🔥',
    desc: 'Vocabulario + true/false + fillblank. Nivel A1, sin bloques.',
    script: `worksheet {
title: "Daily Routine Warm-up"

description: "Short activities to activate vocabulary about daily routines."

multiplechoice {
  question: "What do you do in the morning?"
  options:
  - I eat breakfast.
  - I go to bed.
  - I play the piano.
  answer: "I eat breakfast."
}

truefalse {
  statements:
  - We sleep at night. | true
  - We eat breakfast in the evening. | false
  - We brush our teeth in the morning. | true
}

fillblank {
  text: "I _____ up at seven o'clock."
  answer: "wake"
}
}`,
  },
  {
    label: 'Past Simple',
    icon: '✏️',
    desc: 'Gramática con bloques: opción múltiple, drag & drop y escritura. Nivel A2.',
    script: `worksheet {
title: "Past Simple Practice"

description: "Practice regular and irregular past forms."

block {
  title: "Part 1: Choose"
  instructions: "Choose the correct past form."

  multiplechoice {
    question: "She _____ to school yesterday."
    options:
    - walked
    - walk
    - walking
    answer: "walked"
  }

  dragdrop {
    text: "Yesterday I _____ a film and _____ dinner."
    answer: ["watched", "cooked"]
    bank:
    - watched
    - watch
    - cooked
    - cook
  }
}

block {
  title: "Part 2: Writing"
  instructions: "Write in complete sentences."

  textbox {
    prompt: "Write 3 sentences about what you did last weekend."
  }
}
}`,
  },
  {
    label: 'Listening Club',
    icon: '🎧',
    desc: 'Escuchar y ordenar + opción múltiple por audio. Nivel A2.',
    script: `worksheet {
title: "Listen and Rebuild"

description: "Listening practice: rebuild the sentence, then answer a question."

listeningorder {
  audio_text: "She has never been to Paris."
  voice: female
  answer:
  - She
  - has
  - never
  - been
  - to
  - Paris
}

listeningmultiplechoice {
  audio_text: "He goes to work by bus every day."
  question: "How does he go to work?"
  options:
  - By bus.
  - By car.
  - On foot.
  answer: "By bus."
}
}`,
  },
  {
    label: 'Reading + Writing',
    icon: '📖',
    desc: 'Lectura con bloques y escritura guiada. Nivel B1.',
    script: `worksheet {
title: "My Town"

description: "Read about a town, then answer and write about yours."

block {
  title: "Read and Answer"
  instructions: "Read the text and answer the questions."

  reading {
    title: "Newton is a quiet town"
    content:
    """
    Newton is a small town in the north. There is a park, a library and one supermarket.
    People are friendly, and the streets are quiet. Many residents work in the city nearby.
    """
    questions:
    - Is Newton a big city?
    - Where do many residents work?
  }
}

block {
  title: "Write about your town"
  instructions: "Use the text as a model."

  textbox {
    prompt: "Write 4 sentences describing your town or neighbourhood."
  }
}
}`,
  },
];

/** Compone un prompt en español a partir de las selecciones. */
function composePrompt(s: BuilderState): string {
  const empty = !s.level && !s.topic.trim() && !s.objective && !s.focus && !s.age && !s.duration && !s.difficulty && s.activities.length === 0;
  if (empty) return '';
  let base = 'Crea una hoja de trabajo de inglés';
  if (s.level) base += ` de nivel ${s.level}`;
  if (s.topic.trim()) base += ` sobre ${s.topic.trim()}`;
  if (s.focus && s.focus !== 'Mixed') base += ` enfocada en ${s.focus}`;
  const meta: string[] = [];
  const obj = OBJECTIVES.find((o) => o[0] === s.objective)?.[1];
  if (obj) meta.push(`como actividad de ${obj}`);
  const age = AGES.find((a) => a[0] === s.age)?.[1];
  if (age) meta.push(`para ${age}`);
  if (s.duration) meta.push(`de aproximadamente ${s.duration} minutos`);
  const diff = DIFFICULTIES.find((d) => d[0] === s.difficulty)?.[1];
  if (diff) meta.push(`con dificultad ${diff}`);
  let out = base + '.';
  if (meta.length) out += ' Debe ser ' + meta.join(', ') + '.';
  if (s.activities.length) {
    const names = s.activities.map((v) => ACTIVITIES.find((a) => a[1] === v)?.[0] ?? v);
    out += ` Incluye actividades de estos tipos: ${names.join(', ')} (${s.activities.join(', ')}).`;
  }
  return out;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-spike bg-spike text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-spike/40'}`}>
      {children}
    </button>
  );
}
function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ── "Pídele a la IA": agregar/quitar/modificar actividades con IA ─────────────
export function AskAiEdit({ getScript, onApply }: { getScript: () => string; onApply: (script: string) => void }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [working, setWorking] = useState(false);
  const [provider, setProvider] = useState('');
  const [err, setErr] = useState('');

  async function run() {
    const script = getScript().trim();
    if (!instruction.trim() || working) return;
    if (!script) { setErr('Primero escribe o crea una hoja.'); return; }
    setWorking(true); setErr('');
    try {
      const res = await aiEditWorksheet(script, instruction.trim());
      onApply(res.script);
      setProvider(res.provider);
      setInstruction('');
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo contactar a la IA.');
    } finally { setWorking(false); }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-2xl border border-spike/40 bg-spike/10 px-3 py-2 text-sm font-semibold text-spike-dark transition hover:bg-spike/15">
          <Wand2 size={15} /> Pídele a la IA
        </button>
        {working && <span className="text-xs font-semibold text-spike animate-pulse">✦ IA trabajando…</span>}
        {!working && provider && <span className="text-xs text-slate-400" title="IA que hizo el último cambio">✦ {provider}</span>}
      </div>
      {open && (
        <div className="mt-1 grid gap-2 rounded-2xl border border-spike/30 bg-white p-3">
          <textarea
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-spike"
            rows={2}
            placeholder="Ej: agrega 3 preguntas de fillblank sobre el pasado simple · quita la actividad de matching · cambia el tema a comida"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run(); }}
          />
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button type="button" onClick={() => void run()} disabled={working || !instruction.trim()}
            className="w-fit rounded-xl bg-spike px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {working ? 'Trabajando…' : 'Aplicar cambio con IA'}
          </button>
          <p className="text-xs text-slate-400">La IA modifica la hoja completa y reemplaza el script. Revísalo antes de guardar.</p>
        </div>
      )}
    </div>
  );
}

// ── Panel de generación con IA ────────────────────────────────────────────────

function AiPanel({ aiPrompt, setAiPrompt, isGenerating, aiError, onGenerate }: {
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
  isGenerating: boolean;
  aiError: string;
  onGenerate: () => void;
}) {
  const [b, setB] = useState<BuilderState>(EMPTY_BUILDER);
  // Cualquier cambio en los chips recompone el prompt (se puede afinar a mano en el textarea).
  const apply = (next: BuilderState) => { setB(next); setAiPrompt(composePrompt(next)); };
  const patch = (p: Partial<BuilderState>) => apply({ ...b, ...p });
  const toggleActivity = (v: string) => patch({ activities: b.activities.includes(v) ? b.activities.filter((x) => x !== v) : [...b.activities, v] });
  // Grupo activo = todos sus tipos seleccionados. Clic: activa el set completo, o lo quita si ya está.
  const groupActive = (types: string[]) => types.every((t) => b.activities.includes(t));
  const toggleGroup = (types: string[]) => patch({
    activities: groupActive(types)
      ? b.activities.filter((x) => !types.includes(x))
      : [...b.activities, ...types.filter((t) => !b.activities.includes(t))],
  });

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-spike/15">
          <Wand2 size={20} className="text-spike" />
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-spike">Generar con Inteligencia Artificial</p>
          <h2 className="text-xl font-bold text-slate-900">Arma la hoja con un clic</h2>
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500 mb-5">Elige un preset o selecciona opciones: el prompt se arma solo. No necesitas escribir nada.</p>

      {/* Presets */}
      <ChipGroup label="⭐ Presets (un clic)">
        {PRESETS.map((p) => (
          <Chip key={p.label} active={false} onClick={() => patch(p.patch)}>{p.icon} {p.label}</Chip>
        ))}
      </ChipGroup>

      <div className="mt-5 grid gap-4">
        <ChipGroup label="📚 Nivel">
          {LEVELS.map((l) => <Chip key={l} active={b.level === l} onClick={() => patch({ level: b.level === l ? '' : l })}>{l}</Chip>)}
        </ChipGroup>
        <label className="block">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">📖 Tema</p>
          <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-spike"
            placeholder="Ej: Present Simple, colores, comida…" value={b.topic} onChange={(e) => patch({ topic: e.target.value })} />
        </label>
        <ChipGroup label="🎯 Objetivo">
          {OBJECTIVES.map(([l]) => <Chip key={l} active={b.objective === l} onClick={() => patch({ objective: b.objective === l ? '' : l })}>{l}</Chip>)}
        </ChipGroup>
        <ChipGroup label="✏️ Enfoque">
          {FOCUS.map((f) => <Chip key={f} active={b.focus === f} onClick={() => patch({ focus: b.focus === f ? '' : f })}>{f}</Chip>)}
        </ChipGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <ChipGroup label="👨‍🎓 Edad">
            {AGES.map(([l]) => <Chip key={l} active={b.age === l} onClick={() => patch({ age: b.age === l ? '' : l })}>{l}</Chip>)}
          </ChipGroup>
          <ChipGroup label="⏱️ Duración">
            {DURATIONS.map((d) => <Chip key={d} active={b.duration === d} onClick={() => patch({ duration: b.duration === d ? '' : d })}>{d} min</Chip>)}
          </ChipGroup>
          <ChipGroup label="🎲 Dificultad">
            {DIFFICULTIES.map(([l]) => <Chip key={l} active={b.difficulty === l} onClick={() => patch({ difficulty: b.difficulty === l ? '' : l })}>{l}</Chip>)}
          </ChipGroup>
        </div>
        <ChipGroup label="🎯 Grupos por habilidad (un clic activa el set)">
          {ACTIVITY_GROUPS.map((g) => (
            <Chip key={g.label} active={groupActive(g.types)} onClick={() => toggleGroup(g.types)}>
              {g.icon} {g.label}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="🧩 Actividades (opcional, ajusta el detalle)">
          {ACTIVITIES.map(([l, v]) => <Chip key={v} active={b.activities.includes(v)} onClick={() => toggleActivity(v)}>{b.activities.includes(v) ? '✓ ' : ''}{l}</Chip>)}
        </ChipGroup>
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-semibold text-slate-700">📝 Prompt generado <span className="font-normal text-slate-400">(puedes ajustarlo a mano)</span></span>
        <textarea
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-spike focus:ring-4 focus:ring-spike/15 min-h-28"
          placeholder="El prompt aparecerá aquí conforme selecciones opciones… o escríbelo tú mismo."
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onGenerate(); }}
        />
        <p className="mt-1 text-xs text-slate-400">Ctrl+Enter para generar · Los tipos de actividad son una sugerencia a la IA, no una garantía exacta.</p>
      </label>

      {aiError && (
        <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{aiError}</div>
      )}

      <button type="button" disabled={isGenerating || !aiPrompt.trim()} onClick={onGenerate}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-spike px-5 py-3 font-semibold text-white shadow-lg shadow-spike/15 transition hover:bg-spike-dark disabled:cursor-not-allowed disabled:opacity-60">
        {isGenerating
          ? <><Loader2 size={18} className="animate-spin" /> Generando con IA...</>
          : <><Sparkles size={18} /> Generar hoja de trabajo</>}
      </button>
      {isGenerating && <p className="mt-3 text-center text-sm text-slate-400">La IA está creando tu hoja... esto puede tardar unos segundos.</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface WorksheetEditorProps {
  worksheet: Worksheet;
  selectedActivity?: WorksheetActivity;
  scriptDraft: string;
  maxAttemptsDraft: string;
  aiGradingDraft: boolean;
  aiToleranceDraft: number;
  isSaving?: boolean;
  isEditing?: boolean;
  message?: string;
  userId: string;
  onAddActivity: (activity: WorksheetActivity) => void;
  onScriptChange: (script: string) => void;
  onMaxAttemptsChange: (value: string) => void;
  onAiGradingChange: (value: boolean) => void;
  onAiToleranceChange: (value: number) => void;
  onSaveScript: (script?: string) => void;
  /** Hoja recién guardada; null mientras se edita. Dispara el aviso "Guardada". */
  savedWorksheet?: Worksheet | null;
  onPreviewSaved?: () => void;
  /** La IA genera Y guarda: hay que adoptar esa hoja como la que se está editando. */
  onAiGenerated?: (worksheet: Worksheet) => void;
}

type EditorMode = 'script' | 'visual' | 'ai';

/** Aviso tras guardar. Sustituye a la vista previa que antes se abría sola y sacaba del editor:
 *  desde aquí eliges tú qué hacer con la hoja, y sigues sobre la MISMA (no nace una copia). */
function SavedPanel({ worksheet, onPreview, onVisual, onScript, onAi }: {
  worksheet: Worksheet;
  onPreview: () => void; onVisual: () => void; onScript: () => void; onAi: () => void;
}) {
  const acciones = [
    { label: 'Vista previa', icon: <Eye size={15} />, onClick: onPreview, title: 'Verla como la verá el alumno' },
    { label: 'Ver y editar en gráfico', icon: <LayoutTemplate size={15} />, onClick: onVisual, title: 'Abrir el constructor visual sobre esta hoja' },
    { label: 'Editar', icon: <Code2 size={15} />, onClick: onScript, title: 'Volver al script' },
    { label: 'Pedir cambios a la IA', icon: <Sparkles size={15} />, onClick: onAi, title: 'Describir los cambios en lenguaje natural' },
  ];
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
        <Check size={16} /> Guardada
      </p>
      <p className="mt-0.5 text-sm text-emerald-700">
        «{worksheet.title}» está guardada. Sigues sobre la misma hoja: lo que cambies y vuelvas a guardar la actualiza.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {acciones.map((a) => (
          <button key={a.label} type="button" onClick={a.onClick} title={a.title}
            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100">
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Los tres escalones que entiende el backend (`_grade_system` en ai.py). */
function toleranceLabel(value: number): { title: string; detail: string } {
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

export function WorksheetEditor({
  worksheet, scriptDraft, maxAttemptsDraft, aiGradingDraft, aiToleranceDraft, isSaving, isEditing, message, userId,
  onScriptChange, onMaxAttemptsChange, onAiGradingChange, onAiToleranceChange, onSaveScript,
  savedWorksheet, onPreviewSaved, onAiGenerated,
}: WorksheetEditorProps) {
  const [mode, setMode] = useState<EditorMode>('visual');
  const [skippedWarning, setSkippedWarning] = useState<number | null>(null);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuccess, setAiSuccess] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const visualScriptRef = useRef<(() => string) | null>(null); // script serializado actual del builder visual

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(GENERATION_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch { /* el navegador puede bloquear el portapapeles; sin acción */ }
  };

  useEffect(() => {
    const el = scriptTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Cap: el HTML de `content` puede ser enorme. Se limita a ~55% de la ventana y el textarea
    // hace scroll interno, así el script (lo importante) no se pierde bajo el HTML (extra).
    const cap = Math.round(window.innerHeight * 0.55);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [scriptDraft]);

  const buildVisualState = () => {
    const hasContent = worksheet.blocks?.length || worksheet.activities.length;
    if (!hasContent) return emptyState();
    const { state, skipped } = worksheetToVisualState(worksheet);
    if (skipped > 0) setSkippedWarning(skipped);
    return state;
  };

  const [visualState, setVisualState] = useState(() => buildVisualState());
  const [visualKey, setVisualKey] = useState(0); // remonta el builder al "empezar de cero"

  // El constructor guarda su propia copia del estado, así que hay que recargarlo cuando la hoja
  // cambia por fuera (al guardar desde el script, al abrir otra hoja). Sin esto, "ver y editar en
  // gráfico" después de guardar abría la versión anterior y el siguiente guardado la revertía.
  const loadedScript = useRef(worksheet.scriptContent);
  useEffect(() => {
    if (worksheet.scriptContent === loadedScript.current) return;
    loadedScript.current = worksheet.scriptContent;
    if (mode === 'visual') return; // lo guardó el propio builder: su estado ya es el bueno
    const hasContent = worksheet.blocks?.length || worksheet.activities.length;
    const { state, skipped } = hasContent ? worksheetToVisualState(worksheet) : { state: emptyState(), skipped: 0 };
    setVisualState(state);
    setSkippedWarning(skipped > 0 ? skipped : null);
    setVisualKey((k) => k + 1);
  }, [worksheet, mode]);

  const clearAll = () => {
    if (!confirm('¿Empezar de cero? Se limpiará el contenido actual del editor (no afecta lo ya guardado).')) return;
    onScriptChange('');
    setVisualState(emptyState());
    setVisualKey((k) => k + 1);
    setSkippedWarning(null);
  };

  const switchToVisual = () => {
    const hasUnsavedScript = scriptDraft.trim() && scriptDraft !== worksheet.scriptContent;
    if (hasUnsavedScript) {
      const ok = confirm('¿Cambiar al modo visual? Los cambios no guardados en el script se perderán. El modo visual carga la última versión guardada.');
      if (!ok) return;
    }
    setMode('visual');
  };

  const handleVisualSave = (script: string) => {
    onScriptChange(script);
    onSaveScript(script); // pasa el DSL serializado directo (sin esperar al estado)
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    setAiError('');
    setAiSuccess('');
    try {
      const generated = await generateWorksheetWithAI(aiPrompt.trim(), userId);
      onScriptChange(generated.scriptContent ?? '');
      // `/worksheets/ai-generate` YA guardó la hoja. Hay que atar el editor a ella o el primer
      // "guardar" crearía una segunda: la generada quedaría huérfana en la lista.
      onAiGenerated?.(generated);
      setAiSuccess('✓ Hoja generada y guardada. Revísala y guarda de nuevo si la cambias.');
      setMode('script');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error al generar con IA. Intenta de nuevo.');
    } finally {
      setIsGenerating(false);
    }
  };

  const tabs: { id: EditorMode; label: string; icon: React.ReactNode }[] = [
    { id: 'visual',  label: 'Visual',      icon: <LayoutTemplate size={15} /> },
    { id: 'ai',      label: 'Generar con IA', icon: <Sparkles size={15} /> },
    { id: 'script',  label: 'Script',      icon: <Code2 size={15} /> },
  ];

  const savedPanel = savedWorksheet ? (
    <SavedPanel
      worksheet={savedWorksheet}
      onPreview={() => onPreviewSaved?.()}
      onVisual={switchToVisual}
      onScript={() => setMode('script')}
      onAi={() => setMode('ai')}
    />
  ) : null;

  // En modo script: layout de 3 columnas. En visual e IA: ancho completo.
  if (mode !== 'script') {
    return (
      <div className="grid gap-5">
        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
          {tabs.map((tab) => (
            <button key={tab.id} type="button"
              onClick={() => tab.id === 'visual' ? switchToVisual() : setMode(tab.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                mode === tab.id
                  ? tab.id === 'ai' ? 'bg-spike text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {savedPanel}

        {mode === 'visual' && !guideDismissed && (
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p className="leading-relaxed">
              <strong className="text-slate-800">Estás en el modo visual:</strong> construye la hoja agregando actividades.
              ¿No sabes por dónde empezar? Genera una{' '}
              <button type="button" className="font-bold text-spike underline hover:text-spike-dark" onClick={() => setMode('ai')}>
                plantilla rápida con IA
              </button>{' '}
              y luego vuelve a Visual para retocarla. El modo <strong>Script</strong> queda para usuarios avanzados.
            </p>
            <button type="button" className="shrink-0 text-slate-400 hover:text-slate-600" onClick={() => setGuideDismissed(true)} aria-label="Ocultar guía">✕</button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {mode === 'visual' && <AskAiEdit getScript={() => visualScriptRef.current?.() ?? scriptDraft} onApply={(s) => { onScriptChange(s); setMode('script'); }} />}
          <button type="button" onClick={clearAll} className="text-xs font-semibold text-slate-500 underline hover:text-red-600">↺ Empezar de cero (limpiar)</button>
        </div>

        {skippedWarning !== null && mode === 'visual' && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
            <span>⚠ {skippedWarning} actividad{skippedWarning !== 1 ? 's' : ''} no se importaron al modo visual.</span>
            <button type="button" className="shrink-0 font-bold hover:text-amber-900" onClick={() => setSkippedWarning(null)}>✕</button>
          </div>
        )}

        {mode === 'visual' && (
          <VisualWorksheetBuilder key={visualKey} initialState={visualState} maxAttemptsDraft={maxAttemptsDraft}
            isSaving={isSaving} isEditing={isEditing} message={message} onMaxAttemptsChange={onMaxAttemptsChange} onSave={handleVisualSave} getScriptRef={visualScriptRef} />
        )}

        {mode === 'ai' && <AiPanel aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} isGenerating={isGenerating}
          aiError={aiError} onGenerate={() => void handleGenerate()} />}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => tab.id === 'visual' ? switchToVisual() : setMode(tab.id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              mode === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {savedPanel}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <AskAiEdit getScript={() => scriptDraft} onApply={onScriptChange} />
        <button type="button" onClick={clearAll} className="text-xs font-semibold text-slate-500 underline hover:text-red-600">↺ Empezar de cero (limpiar)</button>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">{isEditing ? '✎ Editando evaluación existente' : 'Modo Script'}</p>
            <h2 className="text-2xl font-bold text-slate-900">{worksheet.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{isEditing ? 'Editas la MISMA hoja (no se crea una copia). Solo se puede mientras no tenga respuestas.' : 'Pega o escribe WorksheetScript y guárdalo en la base de datos.'}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">{worksheet.activities.length} actividades</span>
        </div>

        {/* ── Documentación / prompt para IA externa ── */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-spike/30 bg-spike/10 px-4 py-3">
          <p className="text-sm text-spike-dark">¿No conoces el formato? Copia el prompt y pégalo en tu IA favorita (ChatGPT, Claude, DeepSeek…) para que genere el WorksheetScript.</p>
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="flex shrink-0 items-center gap-2 rounded-2xl bg-spike px-4 py-2 text-sm font-semibold text-white transition hover:bg-spike-dark"
          >
            {promptCopied ? <Check size={16} /> : <ClipboardCopy size={16} />}
            {promptCopied ? 'Copiado ✓' : 'Copiar documentación/prompt'}
          </button>
        </div>

        {/* ── Plantillas listas para empezar ── */}
        <div className="mt-4 rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700">Plantillas rápidas</p>
          <p className="mt-0.5 text-xs text-slate-500">Un clic pone un WorksheetScript completo en el editor; luego lo adaptas o lo pasas a Visual.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {SCRIPT_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-rex hover:bg-rex-light"
                onClick={() => { if (scriptDraft.trim() && !window.confirm('Esto reemplazará el script actual del editor. ¿Continuar?')) return; onScriptChange(t.script); }}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{t.label}</span>
                  <span className="block text-xs text-slate-500">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {aiSuccess && (
          <div className="mt-4 rounded-2xl bg-spike/10 border border-spike/30 px-4 py-3 text-sm font-semibold text-spike-dark">
            {aiSuccess}
          </div>
        )}

        <label className="mt-6 block">
          <span className="text-sm font-semibold text-slate-700">WorksheetScript</span>
          <textarea
            ref={scriptTextareaRef}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100 outline-none transition focus:border-rex focus:ring-4 focus:ring-rex-light resize-none overflow-hidden"
            style={{ minHeight: '32rem' }}
            value={scriptDraft}
            onChange={(event) => onScriptChange(event.target.value)}
          />
        </label>

        <label className="mt-4 block max-w-xs">
          <span className="text-sm font-semibold text-slate-700">Intentos permitidos</span>
          <select
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-rex focus:ring-4 focus:ring-rex-light"
            value={maxAttemptsDraft}
            onChange={(event) => onMaxAttemptsChange(event.target.value)}
          >
            <option value="unlimited">Ilimitada</option>
            <option value="1">1 intento</option>
            <option value="2">2 intentos</option>
            <option value="3">3 intentos</option>
            <option value="4">4 intentos</option>
            <option value="5">5 intentos</option>
          </select>
        </label>

        <label className="mt-4 flex max-w-xl items-start gap-3 rounded-2xl border border-slate-200 p-4">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 rounded border-slate-300 text-rex focus:ring-rex-light"
            checked={aiGradingDraft}
            onChange={(event) => onAiGradingChange(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-slate-700">Autoevaluación con IA</span>
            <span className="block text-xs text-slate-500">Si está activa, la IA califica y comenta las respuestas abiertas/incorrectas al enviarse. Solo tú ves esta opción; el alumno no la percibe.</span>
          </span>
        </label>

        {/* Tolerancia: define cuánto perdona la IA los errores de forma (puntuación, dedazos)
            sin perdonar nunca el contenido que la actividad evalúa. */}
        {aiGradingDraft && (() => {
          const { title, detail } = toleranceLabel(aiToleranceDraft);
          return (
            <div className="mt-3 max-w-xl rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700">Tolerancia a errores de forma</span>
                <span className="rounded-full bg-rex-light px-3 py-0.5 text-xs font-bold text-rex-deep">{title} · {aiToleranceDraft}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={aiToleranceDraft}
                onChange={(event) => onAiToleranceChange(Number(event.target.value))}
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

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">Al guardar, el backend valida el script y almacena la evaluación.</p>
          <button
            className="rounded-2xl bg-rex px-5 py-3 font-semibold text-white shadow-lg shadow-rex-light transition hover:bg-rex-deep disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={isSaving}
            onClick={() => onSaveScript()}
          >
            <Save className="mr-2 inline" size={18} /> {isSaving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Guardar evaluación'}
          </button>
        </div>
        {message && <p className="mt-3 rounded-2xl bg-rex-light p-3 text-sm font-medium text-rex-deep">{message}</p>}
      </div>
    </div>
  );
}
