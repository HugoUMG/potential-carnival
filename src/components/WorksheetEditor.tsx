import { useState } from 'react';
import { Code2, LayoutTemplate, Sparkles, Save, Loader2, Wand2 } from 'lucide-react';
import { VisualWorksheetBuilder, worksheetToVisualState } from './VisualWorksheetBuilder';
import { emptyState } from '../utils/dslSerializer';
import { generateWorksheetWithAI } from '../services/api';
import type { Worksheet, WorksheetActivity } from '../types';

// ── Panel de generación con IA ────────────────────────────────────────────────

function AiPanel({ aiPrompt, setAiPrompt, isGenerating, aiError, onGenerate }: {
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
  isGenerating: boolean;
  aiError: string;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100">
          <Wand2 size={20} className="text-violet-600" />
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-violet-600">Generar con Inteligencia Artificial</p>
          <h2 className="text-xl font-bold text-slate-900">Describe la hoja que necesitas</h2>
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500 mb-5">
        Escribe en español qué quieres que la IA cree. Sé específico: nivel, tema, tipos de actividad y cantidad de preguntas.
      </p>

      <div className="rounded-2xl bg-violet-50 border border-violet-100 p-4 mb-5">
        <p className="text-xs font-semibold text-violet-700 mb-2">Ejemplos de prompts:</p>
        <div className="grid gap-2">
          {[
            'Hoja de A2 sobre Present Perfect con 8 preguntas: 3 fillblank, 3 multiplechoice y 2 matching.',
            'Actividades de listening para B1 sobre rutinas diarias: 2 listeningfillblank y 2 listeningtruefalse.',
            'Worksheet de A1 sobre colores y objetos del salón, 10 preguntas simples con truefalse y multiplechoice.',
          ].map((example) => (
            <button key={example} type="button" onClick={() => setAiPrompt(example)}
              className="text-left text-xs text-violet-600 hover:text-violet-800 rounded-xl hover:bg-violet-100 px-3 py-2 transition">
              → {example}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-slate-700">Tu descripción</span>
        <textarea
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 min-h-36"
          placeholder="Ej: Hoja para estudiantes de A1 sobre los colores, 10 preguntas con multiplechoice y truefalse..."
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onGenerate(); }}
        />
        <p className="mt-1 text-xs text-slate-400">Ctrl+Enter para generar</p>
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
  isSaving?: boolean;
  message?: string;
  userId: string;
  onAddActivity: (activity: WorksheetActivity) => void;
  onScriptChange: (script: string) => void;
  onMaxAttemptsChange: (value: string) => void;
  onSaveScript: () => void;
}

type EditorMode = 'script' | 'visual' | 'ai';

export function WorksheetEditor({
  worksheet, selectedActivity, scriptDraft, maxAttemptsDraft, isSaving, message, userId,
  onAddActivity, onScriptChange, onMaxAttemptsChange, onSaveScript,
}: WorksheetEditorProps) {
  const [mode, setMode] = useState<EditorMode>('script');
  const [skippedWarning, setSkippedWarning] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuccess, setAiSuccess] = useState('');

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
            isSaving={isSaving} message={message} onMaxAttemptsChange={onMaxAttemptsChange} onSave={handleVisualSave} />
        )}

        {mode === 'ai' && <AiPanel aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} isGenerating={isGenerating}
          aiError={aiError} onGenerate={() => void handleGenerate()} />}
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[240px_1fr_280px]">
      {/* ── Biblioteca lateral ── */}
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Biblioteca rápida</p>
        <p className="mt-1 text-sm text-slate-500">Haz clic para agregar bloques al lienzo de prueba.</p>
        <div className="mt-4 grid gap-3">
          {[
            { type: 'fillblank',    icon: '📝', label: 'Fill in the Blank',  desc: 'Espacios en blanco inline' },
            { type: 'multiplechoice',icon: '☑️', label: 'Multiple Choice',   desc: 'Selección múltiple' },
            { type: 'matching',     icon: '🔗', label: 'Matching',            desc: 'Emparejar columnas' },
            { type: 'textbox',      icon: '✍️', label: 'Open Answer',         desc: 'Respuesta abierta' },
            { type: 'truefalse',    icon: '✅', label: 'True / False',        desc: 'Verdadero o falso' },
            { type: 'reading',      icon: '📖', label: 'Reading',             desc: 'Texto + preguntas' },
            { type: 'listening',    icon: '🔊', label: 'Listening',           desc: 'Audio TTS + pregunta' },
            { type: 'imagequestion',icon: '🖼️', label: 'Image Question',     desc: 'Imagen + pregunta abierta' },
          ].map((def) => (
            <button key={def.type} type="button"
              className="rounded-2xl border border-slate-100 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
              onClick={() => onAddActivity({ id: `${def.type}-${crypto.randomUUID()}`, type: def.type as any } as WorksheetActivity)}
            >
              <span className="text-2xl">{def.icon}</span>
              <h3 className="mt-2 font-semibold text-slate-900">{def.label}</h3>
              <p className="mt-1 text-sm text-slate-500">{def.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Editor central ── */}
      <section>
        {/* Tabs */}
        <div className="mb-4 flex items-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Modo Script</p>
                <h2 className="text-2xl font-bold text-slate-900">{worksheet.title}</h2>
                <p className="mt-1 text-sm text-slate-500">Pega o escribe WorksheetScript y guárdalo en la base de datos.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">{worksheet.activities.length} actividades</span>
            </div>
            {aiSuccess && (
              <div className="mt-4 rounded-2xl bg-violet-50 border border-violet-200 px-4 py-3 text-sm font-semibold text-violet-700">
                {aiSuccess}
              </div>
            )}
            <label className="mt-6 block">
              <span className="text-sm font-semibold text-slate-700">WorksheetScript</span>
              <textarea
                className="mt-2 min-h-96 w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Al guardar, el backend valida el script y almacena la evaluación.</p>
              <button
                className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={isSaving}
                onClick={onSaveScript}
              >
                <Save className="mr-2 inline" size={18} /> {isSaving ? 'Guardando...' : 'Guardar evaluación'}
              </button>
            </div>
            {message && <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-medium text-blue-700">{message}</p>}
          </div>

      </section>

      {/* ── Vista JSON lateral ── */}
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Vista JSON</p>
        {selectedActivity ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">ID de actividad</p>
              <p className="font-mono text-sm text-slate-700">{selectedActivity.id}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Tipo</p>
              <p className="font-semibold capitalize text-slate-900">{selectedActivity.type}</p>
            </div>
            <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
              {JSON.stringify(selectedActivity, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            Selecciona una actividad de la biblioteca para revisar su JSON reutilizable.
          </p>
        )}
      </section>
    </div>
  );
}
