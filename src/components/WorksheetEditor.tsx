import { useState } from 'react';
import { Code2, LayoutTemplate, Save } from 'lucide-react';
import { activityDefinitions } from './activityRegistry';
import { VisualWorksheetBuilder, worksheetToVisualState } from './VisualWorksheetBuilder';
import { emptyState } from '../utils/dslSerializer';
import type { Worksheet, WorksheetActivity } from '../types';

interface WorksheetEditorProps {
  worksheet: Worksheet;
  selectedActivity?: WorksheetActivity;
  scriptDraft: string;
  maxAttemptsDraft: string;
  isSaving?: boolean;
  message?: string;
  onAddActivity: (activity: WorksheetActivity) => void;
  onScriptChange: (script: string) => void;
  onMaxAttemptsChange: (value: string) => void;
  onSaveScript: () => void;
}

export function WorksheetEditor({
  worksheet, selectedActivity, scriptDraft, maxAttemptsDraft, isSaving, message,
  onAddActivity, onScriptChange, onMaxAttemptsChange, onSaveScript,
}: WorksheetEditorProps) {
  const [mode, setMode] = useState<'script' | 'visual'>('script');
  const [skippedWarning, setSkippedWarning] = useState<number | null>(null);

  // Inicializa el estado visual desde la hoja guardada
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

  const switchToScript = () => setMode('script');

  const handleVisualSave = (script: string) => {
    onScriptChange(script);
    // pequeño delay para que React actualice el scriptDraft antes de guardar
    setTimeout(onSaveScript, 0);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[240px_1fr_280px]">
      {/* ── Biblioteca lateral ── */}
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Biblioteca rápida</p>
        <p className="mt-1 text-sm text-slate-500">Haz clic para agregar bloques al lienzo de prueba.</p>
        <div className="mt-4 grid gap-3">
          {activityDefinitions.map((definition) => (
            <button
              key={definition.type}
              className="rounded-2xl border border-slate-100 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
              type="button"
              onClick={() => onAddActivity(definition.create())}
            >
              <span className="text-2xl">{definition.icon}</span>
              <h3 className="mt-2 font-semibold text-slate-900">{definition.label}</h3>
              <p className="mt-1 text-sm text-slate-500">{definition.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Editor central ── */}
      <section>
        {/* Toggle Script / Visual */}
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-slate-100 p-1 w-fit">
          <button
            type="button"
            onClick={switchToScript}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${mode === 'script' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Code2 size={15} /> Script
          </button>
          <button
            type="button"
            onClick={switchToVisual}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${mode === 'visual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <LayoutTemplate size={15} /> Visual
          </button>
        </div>

        {/* Advertencia de tipos no soportados */}
        {skippedWarning !== null && mode === 'visual' && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
            <span>⚠ {skippedWarning} actividad{skippedWarning !== 1 ? 's' : ''} con tipos no visuales (listening, reading, etc.) no se importaron. Edítalas en modo Script.</span>
            <button type="button" className="shrink-0 font-bold hover:text-amber-900" onClick={() => setSkippedWarning(null)}>✕</button>
          </div>
        )}

        {mode === 'script' ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Crear evaluación con script</p>
                <h2 className="text-2xl font-bold text-slate-900">{worksheet.title}</h2>
                <p className="mt-1 text-sm text-slate-500">Pega o escribe WorksheetScript y guárdalo en la base de datos.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">{worksheet.activities.length} actividades</span>
            </div>

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
        ) : (
          <VisualWorksheetBuilder
            initialState={visualState}
            maxAttemptsDraft={maxAttemptsDraft}
            isSaving={isSaving}
            message={message}
            onMaxAttemptsChange={onMaxAttemptsChange}
            onSave={handleVisualSave}
          />
        )}
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
