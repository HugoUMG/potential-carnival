import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Code2, LayoutTemplate, Sparkles, Save, Loader2, Wand2, ClipboardCopy, Check } from 'lucide-react';
import { VisualWorksheetBuilder, worksheetToVisualState } from './VisualWorksheetBuilder';
import { emptyState } from '../utils/dslSerializer';
import { generateWorksheetWithAI } from '../services/api';
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
// [etiqueta amigable, tipo DSL] — se incluyen ambos en el prompt para guiar a la IA.
const ACTIVITIES: [string, string][] = [
  ['Multiple Choice', 'multiplechoice'], ['Fill in the Blank', 'fillblank'], ['True/False', 'truefalse'],
  ['Matching', 'matching'], ['Drag & Drop', 'dragdrop'], ['Reading', 'reading'], ['Image Question', 'imagequestion'],
  ['Listening', 'listening'], ['Listen & Order', 'listeningorder'], ['Conversation', 'conversation'], ['Speaking', 'speaking'],
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
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-violet-500 bg-violet-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'}`}>
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

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100">
          <Wand2 size={20} className="text-violet-600" />
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-violet-600">Generar con Inteligencia Artificial</p>
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
          <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
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
        <ChipGroup label="🧩 Actividades (opcional)">
          {ACTIVITIES.map(([l, v]) => <Chip key={v} active={b.activities.includes(v)} onClick={() => toggleActivity(v)}>{b.activities.includes(v) ? '✓ ' : ''}{l}</Chip>)}
        </ChipGroup>
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-semibold text-slate-700">📝 Prompt generado <span className="font-normal text-slate-400">(puedes ajustarlo a mano)</span></span>
        <textarea
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 min-h-28"
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
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-100 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
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
  isSaving?: boolean;
  isEditing?: boolean;
  message?: string;
  userId: string;
  onAddActivity: (activity: WorksheetActivity) => void;
  onScriptChange: (script: string) => void;
  onMaxAttemptsChange: (value: string) => void;
  onAiGradingChange: (value: boolean) => void;
  onSaveScript: () => void;
}

type EditorMode = 'script' | 'visual' | 'ai';

export function WorksheetEditor({
  worksheet, scriptDraft, maxAttemptsDraft, aiGradingDraft, isSaving, isEditing, message, userId,
  onScriptChange, onMaxAttemptsChange, onAiGradingChange, onSaveScript,
}: WorksheetEditorProps) {
  const [mode, setMode] = useState<EditorMode>('script');
  const [skippedWarning, setSkippedWarning] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuccess, setAiSuccess] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);

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
    el.style.height = `${el.scrollHeight}px`;
  }, [scriptDraft]);

  const buildVisualState = () => {
    const hasContent = worksheet.blocks?.length || worksheet.activities.length;
    if (!hasContent) return emptyState();
    const { state, skipped } = worksheetToVisualState(worksheet);
    if (skipped > 0) setSkippedWarning(skipped);
    return state;
  };

  const [visualState] = useState(() => buildVisualState());

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
    setTimeout(onSaveScript, 0);
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    setAiError('');
    setAiSuccess('');
    try {
      const generated = await generateWorksheetWithAI(aiPrompt.trim(), userId);
      onScriptChange((generated as any).script_content ?? generated.scriptContent ?? '');
      setAiSuccess('✓ Hoja generada. Revisa el script y guárdalo cuando estés listo.');
      setMode('script');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error al generar con IA. Intenta de nuevo.');
    } finally {
      setIsGenerating(false);
    }
  };

  const tabs: { id: EditorMode; label: string; icon: React.ReactNode }[] = [
    { id: 'script',  label: 'Script',      icon: <Code2 size={15} /> },
    { id: 'visual',  label: 'Visual',      icon: <LayoutTemplate size={15} /> },
    { id: 'ai',      label: 'Generar con IA', icon: <Sparkles size={15} /> },
  ];

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
                  ? tab.id === 'ai' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {skippedWarning !== null && mode === 'visual' && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
            <span>⚠ {skippedWarning} actividad{skippedWarning !== 1 ? 's' : ''} no se importaron al modo visual.</span>
            <button type="button" className="shrink-0 font-bold hover:text-amber-900" onClick={() => setSkippedWarning(null)}>✕</button>
          </div>
        )}

        {mode === 'visual' && (
          <VisualWorksheetBuilder initialState={visualState} maxAttemptsDraft={maxAttemptsDraft}
            isSaving={isSaving} isEditing={isEditing} message={message} onMaxAttemptsChange={onMaxAttemptsChange} onSave={handleVisualSave} />
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

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{isEditing ? '✎ Editando evaluación existente' : 'Modo Script'}</p>
            <h2 className="text-2xl font-bold text-slate-900">{worksheet.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{isEditing ? 'Editas la MISMA hoja (no se crea una copia). Solo se puede mientras no tenga respuestas.' : 'Pega o escribe WorksheetScript y guárdalo en la base de datos.'}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">{worksheet.activities.length} actividades</span>
        </div>

        {/* ── Documentación / prompt para IA externa ── */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-sm text-violet-800">¿No conoces el formato? Copia el prompt y pégalo en tu IA favorita (ChatGPT, Claude, DeepSeek…) para que genere el WorksheetScript.</p>
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="flex shrink-0 items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            {promptCopied ? <Check size={16} /> : <ClipboardCopy size={16} />}
            {promptCopied ? 'Copiado ✓' : 'Copiar documentación/prompt'}
          </button>
        </div>

        {aiSuccess && (
          <div className="mt-4 rounded-2xl bg-violet-50 border border-violet-200 px-4 py-3 text-sm font-semibold text-violet-700">
            {aiSuccess}
          </div>
        )}

        <label className="mt-6 block">
          <span className="text-sm font-semibold text-slate-700">WorksheetScript</span>
          <textarea
            ref={scriptTextareaRef}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 resize-none overflow-hidden"
            style={{ minHeight: '32rem' }}
            value={scriptDraft}
            onChange={(event) => onScriptChange(event.target.value)}
          />
        </label>

        <label className="mt-4 block max-w-xs">
          <span className="text-sm font-semibold text-slate-700">Intentos permitidos</span>
          <select
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
            className="mt-0.5 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
            checked={aiGradingDraft}
            onChange={(event) => onAiGradingChange(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-slate-700">Autoevaluación con IA</span>
            <span className="block text-xs text-slate-500">Si está activa, la IA califica y comenta las respuestas abiertas/incorrectas al enviarse. Solo tú ves esta opción; el alumno no la percibe.</span>
          </span>
        </label>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">Al guardar, el backend valida el script y almacena la evaluación.</p>
          <button
            className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={isSaving}
            onClick={onSaveScript}
          >
            <Save className="mr-2 inline" size={18} /> {isSaving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Guardar evaluación'}
          </button>
        </div>
        {message && <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-medium text-blue-700">{message}</p>}
      </div>
    </div>
  );
}
