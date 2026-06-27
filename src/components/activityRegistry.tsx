/* eslint-disable react-refresh/only-export-components */
import { useRef, useState, type DragEvent } from 'react';
import { transcribeAudio } from '../services/api';
import type {
  ActivityDefinition,
  ActivityRendererProps,
  FillBlankActivity,
  ImageQuestionActivity,
  ListeningFillBlankActivity,
  ListeningMatchingActivity,
  ListeningMultipleChoiceActivity,
  ListeningTrueFalseActivity,
  MatchingActivity,
  MultipleChoiceActivity,
  MultiSelectActivity,
  DragDropActivity,
  SpeakingActivity,
  ReadingActivity,
  ReadingTrueFalseActivity,
  ListeningActivity,
  StudentAnswer,
  TextBoxActivity,
  TrueFalseActivity,
  WorksheetActivity,
} from '../types';
import { RichText } from './RichText';
import { AudioPlayer } from './AudioPlayer';

const inputClass = 'mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

function ActivityInstructions({ instructions }: { instructions?: string }) {
  if (!instructions) return null;
  return <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm italic text-amber-800">ℹ️ <RichText text={instructions} /></p>;
}

function asString(value: StudentAnswer | undefined): string {
  return typeof value === 'string' ? value : '';
}

function FillBlankRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<FillBlankActivity>) {
  const parts = activity.text.replace(/\\n/g, '\n').split('_____');
  const expected = Array.isArray(activity.answer) ? activity.answer : [activity.answer];
  const values = Array.isArray(value) ? value : [asString(value)];
  const updateBlank = (index: number, nextValue: string) => {
    const nextValues = [...values];
    nextValues[index] = nextValue;
    onChange(activity.id, parts.length > 2 ? nextValues : nextValue);
  };

  if (parts.length === 1) {
    return (
      <label className="block">
        <RichText className="text-base font-medium text-slate-800" text={activity.text} />
        <ActivityInstructions instructions={activity.instructions} />
        <input className={inputClass} disabled={readonly} placeholder="Type the missing word" value={asString(value)} onChange={(event) => onChange(activity.id, event.target.value)} />
      </label>
    );
  }

  return (
    <div>
      <div className="text-base font-medium leading-10 text-slate-800 whitespace-pre-line">
        {parts.map((part, index) => (
        <span key={`${activity.id}-${index}`}>
          {part}
          {index < parts.length - 1 && (
            <input
              className="mx-1 inline-block rounded-lg border border-slate-300 px-2 py-1 text-sm align-middle outline-none focus:border-blue-500"
              disabled={readonly}
              style={{ width: `${Math.max(80, Math.min(160, (expected[index]?.length ?? 8) * 12))}px` }}
              value={values[index] ?? ''}
              onChange={(event) => updateBlank(index, event.target.value)}
            />
          )}
        </span>
        ))}
      </div>
      <ActivityInstructions instructions={activity.instructions} />
    </div>
  );
}

function MultipleChoiceRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<MultipleChoiceActivity>) {
  return (
    <fieldset>
      <legend className="text-base font-medium text-slate-800"><RichText text={activity.question} /></legend>
      <ActivityInstructions instructions={activity.instructions} />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {activity.options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300">
            <input
              disabled={readonly}
              name={activity.id}
              type="radio"
              checked={value === option}
              onChange={() => onChange(activity.id, option)}
            />
            <span className="text-sm text-slate-700">{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MultiSelectRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<MultiSelectActivity>) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (option: string) => {
    const next = selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option];
    onChange(activity.id, next);
  };
  return (
    <fieldset>
      <legend className="text-base font-medium text-slate-800"><RichText text={activity.question} /></legend>
      <p className="mt-1 text-xs font-semibold text-blue-600">Puedes elegir más de una opción.</p>
      <ActivityInstructions instructions={activity.instructions} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {activity.options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300">
            <input
              disabled={readonly}
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
            />
            <span className="text-sm text-slate-700">{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type DragPayload = { word: string; from: 'bank' | number };

function DragDropRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<DragDropActivity>) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null); // qué se está arrastrando (para la silueta)
  const [overBlank, setOverBlank] = useState<number | null>(null);
  const parts = activity.text.replace(/\\n/g, '\n').split('_____');
  const blanks = parts.length - 1;
  const placed: string[] = Array.from({ length: blanks }, (_, i) => (Array.isArray(value) ? String(value[i] ?? '') : ''));

  // Banco disponible = palabras del banco menos las ya colocadas (por cantidad).
  const usedCopy = placed.filter(Boolean);
  const available: { word: string; key: number }[] = [];
  activity.bank.forEach((word, i) => {
    const idx = usedCopy.indexOf(word);
    if (idx >= 0) usedCopy.splice(idx, 1);
    else available.push({ word, key: i });
  });

  const apply = (next: string[]) => { onChange(activity.id, next); setSelected(null); };

  const startDrag = (e: DragEvent, payload: DragPayload, key: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDragKey(key);
  };
  const readPayload = (e: DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; }
  };

  const dropOnBlank = (targetIdx: number, p: DragPayload) => {
    const next = [...placed];
    if (p.from === 'bank') {
      next[targetIdx] = p.word; // el ocupante anterior vuelve al banco (se recalcula)
    } else {
      // mover desde otro hueco → si el destino tiene palabra, se intercambian
      next[targetIdx] = p.word;
      next[p.from] = placed[targetIdx];
    }
    apply(next);
  };

  const tapBlank = (index: number) => {
    if (readonly) return;
    if (selected) apply(Object.assign([...placed], { [index]: selected }));
    else if (placed[index]) apply(Object.assign([...placed], { [index]: '' }));
  };

  return (
    <div className="grid gap-4">
      <ActivityInstructions instructions={activity.instructions} />
      <div className="text-base font-medium leading-10 text-slate-800 whitespace-pre-line">
        {parts.map((part, index) => (
          <span key={`${activity.id}-${index}`}>
            {part}
            {index < blanks && (
              <span
                onDragOver={(e) => { if (!readonly) { e.preventDefault(); setOverBlank(index); } }}
                onDragLeave={() => setOverBlank((o) => (o === index ? null : o))}
                onDrop={(e) => { if (readonly) return; e.preventDefault(); setOverBlank(null); const p = readPayload(e); if (p) dropOnBlank(index, p); }}
                className={`mx-1 inline-flex min-w-[90px] items-center justify-center rounded-lg border-2 border-dashed px-3 py-1 align-middle text-sm transition ${overBlank === index ? 'border-blue-500 bg-blue-100 ring-2 ring-blue-300' : placed[index] ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-slate-50'}`}
              >
                {placed[index] ? (
                  <span
                    draggable={!readonly}
                    onDragStart={(e) => startDrag(e, { word: placed[index], from: index }, `blank-${index}`)}
                    onDragEnd={() => setDragKey(null)}
                    onClick={() => tapBlank(index)}
                    title="Arrastra a otro hueco, o clic para quitar"
                    className={`cursor-grab font-semibold text-blue-800 active:cursor-grabbing ${dragKey === `blank-${index}` ? 'opacity-40' : ''}`}
                  >
                    {placed[index]}
                  </span>
                ) : (
                  <span className="cursor-pointer text-slate-400" onClick={() => tapBlank(index)}>⬚</span>
                )}
              </span>
            )}
          </span>
        ))}
      </div>

      {!readonly && (
        <div
          className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const p = readPayload(e); if (p && typeof p.from === 'number') apply(Object.assign([...placed], { [p.from]: '' })); }}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Banco de palabras — arrastra o toca para colocar</p>
          <div className="flex flex-wrap gap-2">
            {available.map(({ word, key }) => (
              <span
                key={key}
                draggable
                onDragStart={(e) => startDrag(e, { word, from: 'bank' }, `bank-${key}`)}
                onDragEnd={() => setDragKey(null)}
                onClick={() => setSelected(selected === word ? null : word)}
                className={`cursor-grab select-none rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition active:cursor-grabbing ${dragKey === `bank-${key}` ? 'opacity-40 ring-2 ring-blue-300' : ''} ${selected === word ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'}`}
              >
                {word}
              </span>
            ))}
            {!available.length && <span className="text-sm text-slate-400">Todas las palabras están colocadas. Arrastra una de vuelta aquí para quitarla.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function TextBoxRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<TextBoxActivity>) {
  return (
    <label className="block">
      <RichText className="text-base font-medium text-slate-800" text={activity.prompt} />
      <ActivityInstructions instructions={activity.instructions} />
      <textarea
        className={`${inputClass} min-h-28 resize-y`}
        disabled={readonly}
        placeholder="Write your answer"
        value={asString(value)}
        onChange={(event) => onChange(activity.id, event.target.value)}
      />
    </label>
  );
}


function hashString(value: string): number {
  return [...value].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function getShuffledMatches(activity: MatchingActivity): string[] {
  const shuffled = [...activity.right].sort((first, second) => hashString(`${activity.id}:${first}`) - hashString(`${activity.id}:${second}`));
  const keptOriginalOrder = shuffled.every((rightItem, index) => rightItem === activity.right[index]);
  return keptOriginalOrder && shuffled.length > 1 ? [...shuffled.slice(1), shuffled[0]] : shuffled;
}

function MatchingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<MatchingActivity>) {
  const selections = typeof value === 'object' && !Array.isArray(value) && value !== null ? value : {};

  return (
    <div>
      <p className="text-base font-medium text-slate-800">Match each item with its meaning.</p>
      <ActivityInstructions instructions={activity.instructions} />
      <div className="mt-4 grid gap-3">
        {activity.left.map((leftItem) => (
          <label key={leftItem} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_2fr] sm:items-center">
            <span className="font-semibold text-slate-700">{leftItem}</span>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              disabled={readonly}
              value={selections[leftItem] ?? ''}
              onChange={(event) => onChange(activity.id, { ...selections, [leftItem]: event.target.value })}
            >
              <option value="">Select a match</option>
              {getShuffledMatches(activity).map((rightItem) => (
                <option key={rightItem} value={rightItem}>
                  {rightItem}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function TrueFalseButtons({ index, selected, readonly, onChange }: { index: number; selected: string | undefined; readonly?: boolean; onChange: (val: string) => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" disabled={readonly} onClick={() => onChange('true')}
        className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${selected === 'true' ? 'bg-emerald-500 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300'}`}>
        True
      </button>
      <button type="button" disabled={readonly} onClick={() => onChange('false')}
        className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${selected === 'false' ? 'bg-red-500 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-red-300'}`}>
        False
      </button>
    </div>
  );
}

function ReadingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ReadingActivity>) {
  const answers = typeof value === 'object' && !Array.isArray(value) && value !== null ? value : {};

  return (
    <article>
      <h3 className="text-lg font-semibold text-slate-900">{activity.title}</h3>
      <ActivityInstructions instructions={activity.instructions} />
      <p className="mt-3 rounded-xl bg-blue-50 p-4 leading-7 text-slate-700"><RichText text={activity.content} /></p>
      <div className="mt-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Listen to the text</p>
        <AudioPlayer text={activity.content} />
      </div>
      <div className="mt-4 grid gap-3">
        {activity.questions.map((question, index) => (
          <label key={question} className="block">
            <RichText className="text-sm font-medium text-slate-700" text={question} />
            <input
              className={inputClass}
              disabled={readonly}
              value={answers[String(index)] ?? ''}
              onChange={(event) => onChange(activity.id, { ...answers, [index]: event.target.value })}
            />
          </label>
        ))}
      </div>
    </article>
  );
}

function TrueFalseRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<TrueFalseActivity>) {
  const selections = typeof value === 'object' && !Array.isArray(value) && value !== null ? (value as Record<string, string>) : {};
  return (
    <div className="grid gap-3">
      <ActivityInstructions instructions={activity.instructions} />
      {activity.statements.map((stmt, index) => (
        <div key={index} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-sm font-medium text-slate-800">{stmt.text}</span>
          <TrueFalseButtons index={index} selected={selections[String(index)]} readonly={readonly} onChange={(val) => onChange(activity.id, { ...selections, [String(index)]: val })} />
        </div>
      ))}
    </div>
  );
}

function ReadingTrueFalseRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ReadingTrueFalseActivity>) {
  const selections = typeof value === 'object' && !Array.isArray(value) && value !== null ? (value as Record<string, string>) : {};
  return (
    <article className="grid gap-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{activity.title}</h3>
        <ActivityInstructions instructions={activity.instructions} />
        <p className="mt-3 rounded-xl bg-blue-50 p-4 leading-7 text-slate-700"><RichText text={activity.content} /></p>
        <div className="mt-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Listen to the text</p>
          <AudioPlayer text={activity.content} />
        </div>
      </div>
      <div className="grid gap-3">
        {activity.statements.map((stmt, index) => (
          <div key={index} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-sm font-medium text-slate-800">{stmt.text}</span>
            <TrueFalseButtons index={index} selected={selections[String(index)]} readonly={readonly} onChange={(val) => onChange(activity.id, { ...selections, [String(index)]: val })} />
          </div>
        ))}
      </div>
    </article>
  );
}

// Alinea la transcripción con la oración objetivo (LCS) y marca cada palabra del
// objetivo como dicha correctamente (ok) o no. Devuelve las palabras ORIGINALES para mostrar.
function speakingWordStatus(said: string, target: string): { word: string; ok: boolean }[] {
  const clean = (w: string) => w.toLowerCase().replace(/[^\w]/g, '');
  const targetWords = target.split(/\s+/).filter(Boolean);
  const a = targetWords.map(clean);
  const b = said.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const matched = new Set<number>();
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { matched.add(i - 1); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  return targetWords.map((word, idx) => ({ word, ok: matched.has(idx) }));
}

function speakingMatches(said: string, target: string): boolean {
  const words = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const a = words(target);
  const b = words(said);
  if (!a.length) return false;
  // Similitud por secuencia (LCS) → Dice. Detecta palabras erróneas y orden, no solo presencia.
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (2 * dp[m][n]) / (m + n) >= 0.85;
}

function SpeakingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<SpeakingActivity>) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [showFallback, setShowFallback] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcript = asString(value);
  const target = activity.target?.trim();
  const matched = target ? speakingMatches(transcript, target) : null;
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const start = async () => {
    setError('');
    if (!canRecord) { setShowFallback(true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) { setError('No se grabó audio. Inténtalo de nuevo.'); return; }
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          onChange(activity.id, text);
          if (!text.trim()) setError('No se entendió el audio. Habla claro y vuelve a intentar.');
        } catch {
          setError('No se pudo transcribir el audio. Inténtalo de nuevo o escribe tu respuesta abajo.');
          setShowFallback(true);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      setRecording(true);
    } catch {
      setError('No se pudo acceder al micrófono. Revisa el permiso (candado 🔒) o escribe tu respuesta abajo.');
      setShowFallback(true);
    }
  };

  const stop = () => { recorderRef.current?.stop(); };

  return (
    <div className="grid gap-3">
      <RichText className="text-base font-medium text-slate-800" text={activity.prompt} />
      <ActivityInstructions instructions={activity.instructions} />
      {target && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <AudioPlayer text={target} />
          <p className="text-lg font-semibold text-slate-900">“{target}”</p>
        </div>
      )}
      {!readonly && canRecord && (
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={transcribing}
          className={`flex w-fit items-center gap-2 rounded-2xl px-5 py-3 font-semibold text-white transition disabled:opacity-60 ${recording ? 'animate-pulse bg-red-500' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {transcribing ? '⏳ Transcribiendo…' : recording ? '⏹ Detener' : `🎤 ${transcript ? 'Repetir' : (target ? 'Leer en voz alta' : 'Hablar')}`}
        </button>
      )}
      {transcript && (
        <div className={`rounded-2xl border p-3 text-sm ${matched === null ? 'border-slate-200 bg-white' : matched ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className="text-slate-700">Dijiste: <span className="font-semibold">“{transcript}”</span></p>
          {target && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {speakingWordStatus(transcript, target).map((w, idx) => (
                <span
                  key={idx}
                  className={`rounded-md px-2 py-0.5 text-sm font-semibold ${w.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700 line-through decoration-red-400'}`}
                  title={w.ok ? 'Bien pronunciada' : 'No coincidió — repite esta palabra'}
                >
                  {w.word}
                </span>
              ))}
            </div>
          )}
          {matched === true && <p className="mt-2 font-semibold text-emerald-700">✓ ¡Bien! Coincide con la oración. Puedes continuar.</p>}
          {matched === false && <p className="mt-2 font-semibold text-amber-700">Repite las palabras en rojo. Escucha 🔊 la oración e inténtalo otra vez.</p>}
        </div>
      )}
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {(!canRecord || showFallback) && (
        <label className="block text-sm">
          <span className="text-slate-500">¿Problemas con el micrófono? Escribe lo que dirías:</span>
          <input className={inputClass} disabled={readonly} value={transcript} onChange={(e) => onChange(activity.id, e.target.value)} />
        </label>
      )}
    </div>
  );
}

function ListeningRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ListeningActivity>) {
  return (
    <div className="grid gap-3">
      <AudioPlayer text={activity.text} />
      <label className="block">
        <RichText className="text-base font-medium text-slate-800" text={activity.question} />
        <ActivityInstructions instructions={activity.instructions} />
        <input className={inputClass} disabled={readonly} value={asString(value)} onChange={(event) => onChange(activity.id, event.target.value)} />
      </label>
    </div>
  );
}

function ListeningFillBlankRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ListeningFillBlankActivity>) {
  const parts = activity.text.replace(/\\n/g, '\n').split('_____');
  const expected = Array.isArray(activity.answer) ? activity.answer : [activity.answer];
  const values = Array.isArray(value) ? value : [asString(value)];
  const updateBlank = (index: number, nextValue: string) => {
    const next = [...values];
    next[index] = nextValue;
    onChange(activity.id, parts.length > 2 ? next : nextValue);
  };
  return (
    <div className="grid gap-3">
      <AudioPlayer text={activity.audio_text} />
      <ActivityInstructions instructions={activity.instructions} />
      <div className="text-base font-medium leading-10 text-slate-800 whitespace-pre-line">
        {parts.map((part, index) => (
          <span key={`${activity.id}-${index}`}>
            {part}
            {index < parts.length - 1 && (
              <input
                className="mx-1 inline-block rounded-lg border border-slate-300 px-2 py-1 text-sm align-middle outline-none focus:border-blue-500"
                disabled={readonly}
                style={{ width: `${Math.max(80, Math.min(160, (expected[index]?.length ?? 8) * 12))}px` }}
                value={values[index] ?? ''}
                onChange={(e) => updateBlank(index, e.target.value)}
              />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function ListeningMultipleChoiceRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ListeningMultipleChoiceActivity>) {
  return (
    <div className="grid gap-3">
      <AudioPlayer text={activity.audio_text} />
      <fieldset>
        <legend className="text-base font-medium text-slate-800"><RichText text={activity.question} /></legend>
        <ActivityInstructions instructions={activity.instructions} />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {activity.options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300">
              <input disabled={readonly} name={activity.id} type="radio" checked={value === option} onChange={() => onChange(activity.id, option)} />
              <span className="text-sm text-slate-700">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function ListeningMatchingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ListeningMatchingActivity>) {
  const selections = typeof value === 'object' && !Array.isArray(value) && value !== null ? (value as Record<string, string>) : {};
  return (
    <div className="grid gap-4">
      <ActivityInstructions instructions={activity.instructions} />
      {activity.pairs.map((pair, index) => (
        <div key={index} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Audio {index + 1}</p>
            <AudioPlayer text={pair.audio_text} />
          </div>
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 self-center"
            disabled={readonly}
            value={selections[String(index)] ?? ''}
            onChange={(e) => onChange(activity.id, { ...selections, [String(index)]: e.target.value })}
          >
            <option value="">Select...</option>
            {activity.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function ListeningTrueFalseRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ListeningTrueFalseActivity>) {
  const selections = typeof value === 'object' && !Array.isArray(value) && value !== null ? (value as Record<string, string>) : {};
  return (
    <div className="grid gap-4">
      <AudioPlayer text={activity.audio_text} />
      <ActivityInstructions instructions={activity.instructions} />
      {activity.statements.map((stmt, index) => {
        const selected = selections[String(index)];
        return (
          <div key={index} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-sm font-medium text-slate-800">{stmt.text}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={readonly}
                onClick={() => onChange(activity.id, { ...selections, [String(index)]: 'true' })}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${selected === 'true' ? 'bg-emerald-500 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300'}`}
              >True</button>
              <button
                type="button"
                disabled={readonly}
                onClick={() => onChange(activity.id, { ...selections, [String(index)]: 'false' })}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${selected === 'false' ? 'bg-red-500 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-red-300'}`}
              >False</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ImageQuestionRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ImageQuestionActivity>) {
  return (
    <div>
      <img className="mb-4 h-56 w-full rounded-2xl object-cover" src={activity.image} alt="Worksheet prompt image" />
      <TextBoxRenderer activity={{ ...activity, type: 'textbox' }} value={value} readonly={readonly} onChange={onChange} />
    </div>
  );
}

const nextId = (type: string) => `${type}-${crypto.randomUUID()}`;

export const activityRegistry = {
  fillblank: {
    type: 'fillblank',
    label: 'Fill in the blank',
    description: 'The student types the missing word or phrase.',
    icon: '✏️',
    create: () => ({ id: nextId('fillblank'), type: 'fillblank', text: 'I ____ ready.', answer: 'am' }),
    Renderer: FillBlankRenderer,
  },
  multiplechoice: {
    type: 'multiplechoice',
    label: 'Multiple choice',
    description: 'The student chooses one correct option.',
    icon: '✅',
    create: () => ({ id: nextId('multiplechoice'), type: 'multiplechoice', question: 'Choose the correct answer.', options: ['am', 'is', 'are'], answer: 'am' }),
    Renderer: MultipleChoiceRenderer,
  },
  multiselect: {
    type: 'multiselect',
    label: 'Multiple answers',
    description: 'The student can choose several correct options.',
    icon: '🗹',
    create: () => ({ id: nextId('multiselect'), type: 'multiselect', question: 'Select all that apply.', options: ['run', 'runs', 'running', 'ran'], answer: ['run', 'runs'] }),
    Renderer: MultiSelectRenderer,
  },
  dragdrop: {
    type: 'dragdrop',
    label: 'Arrastrar palabras',
    description: 'Word bank dragged into blanks.',
    icon: '🧩',
    create: () => ({ id: nextId('dragdrop'), type: 'dragdrop', text: 'She _____ to school and _____ English.', answer: ['goes', 'studies'], bank: ['goes', 'go', 'studies', 'study'] }),
    Renderer: DragDropRenderer,
  },
  textbox: {
    type: 'textbox',
    label: 'Text box',
    description: 'Long written response.',
    icon: '📝',
    create: () => ({ id: nextId('textbox'), type: 'textbox', prompt: 'Describe your house.' }),
    Renderer: TextBoxRenderer,
  },
  matching: {
    type: 'matching',
    label: 'Matching',
    description: 'Match words with meanings.',
    icon: '🔗',
    create: () => ({ id: nextId('matching'), type: 'matching', left: ['dog', 'cat'], right: ['animal that barks', 'animal that meows'] }),
    Renderer: MatchingRenderer,
  },
  reading: {
    type: 'reading',
    label: 'Reading',
    description: 'Reading text with questions.',
    icon: '📖',
    create: () => ({ id: nextId('reading'), type: 'reading', title: 'My school', content: 'This is my school.', questions: ['What is the text about?'] }),
    Renderer: ReadingRenderer,
  },
  listening: {
    type: 'listening',
    label: 'Listening',
    description: 'Audio comprehension prompt',
    icon: '🎧',
    create: () => ({ id: nextId('listening'), type: 'listening', text: 'Listen to this sentence.', question: 'What did you hear?', answer: '' }),
    Renderer: ListeningRenderer,
  } satisfies ActivityDefinition<ListeningActivity>,
  imagequestion: {
    type: 'imagequestion',
    label: 'Image question',
    description: 'Visual prompt with written answer.',
    icon: '🖼️',
    create: () => ({ id: nextId('imagequestion'), type: 'imagequestion', image: 'https://placehold.co/900x500', prompt: 'Describe what you see.' }),
    Renderer: ImageQuestionRenderer,
  },
  listeningfillblank: {
    type: 'listeningfillblank',
    label: 'Listening + Fill blank',
    description: 'Listen and complete the missing words.',
    icon: '🎧✏️',
    create: () => ({ id: nextId('listeningfillblank'), type: 'listeningfillblank', audio_text: 'She goes to school every day.', text: 'She _____ to school every day.', answer: 'goes' }),
    Renderer: ListeningFillBlankRenderer,
  },
  listeningmultiplechoice: {
    type: 'listeningmultiplechoice',
    label: 'Listening + Multiple choice',
    description: 'Listen and choose the correct option.',
    icon: '🎧✅',
    create: () => ({ id: nextId('listeningmultiplechoice'), type: 'listeningmultiplechoice', audio_text: 'The meeting is on Friday at 3 PM.', question: 'When is the meeting?', options: ['Thursday at 3 PM', 'Friday at 3 PM', 'Friday at 5 PM'], answer: 'Friday at 3 PM' }),
    Renderer: ListeningMultipleChoiceRenderer,
  },
  listeningmatching: {
    type: 'listeningmatching',
    label: 'Listening + Matching',
    description: 'Match each audio with its meaning.',
    icon: '🎧🔗',
    create: () => ({ id: nextId('listeningmatching'), type: 'listeningmatching', pairs: [{ audio_text: 'It might rain later.', match: 'Possibility' }, { audio_text: 'You should rest more.', match: 'Advice' }], options: ['Possibility', 'Advice'] }),
    Renderer: ListeningMatchingRenderer,
  },
  listeningtruefalse: {
    type: 'listeningtruefalse',
    label: 'Listening + True/False',
    description: 'Listen and decide if each statement is true or false.',
    icon: '🎧❓',
    create: () => ({ id: nextId('listeningtruefalse'), type: 'listeningtruefalse', audio_text: 'The store opens at 9 AM and closes at 6 PM.', statements: [{ text: 'The store opens at 9 AM.', answer: true }, { text: 'The store closes at 8 PM.', answer: false }] }),
    Renderer: ListeningTrueFalseRenderer,
  },
  truefalse: {
    type: 'truefalse',
    label: 'True / False',
    description: 'Decide if each statement is true or false.',
    icon: '✔️❌',
    create: () => ({ id: nextId('truefalse'), type: 'truefalse', statements: [{ text: 'The Earth is round.', answer: true }, { text: 'The Sun orbits the Earth.', answer: false }] }),
    Renderer: TrueFalseRenderer,
  },
  readingtruefalse: {
    type: 'readingtruefalse',
    label: 'Reading + True/False',
    description: 'Read a text (with audio), then answer True or False.',
    icon: '📖❓',
    create: () => ({ id: nextId('readingtruefalse'), type: 'readingtruefalse', title: 'My School', content: 'My school is very big. There are many classrooms and a large library.', statements: [{ text: 'The school has a library.', answer: true }, { text: 'The school is small.', answer: false }] }),
    Renderer: ReadingTrueFalseRenderer,
  },
  speaking: {
    type: 'speaking',
    label: 'Speaking (micrófono)',
    description: 'Read a sentence aloud (or answer by voice); uses the microphone.',
    icon: '🎤',
    create: () => ({ id: nextId('speaking'), type: 'speaking', prompt: 'Read the sentence aloud.', target: 'She goes to school every day.' }),
    Renderer: SpeakingRenderer,
  },
} satisfies { [Type in WorksheetActivity['type']]: ActivityDefinition<Extract<WorksheetActivity, { type: Type }>> };

export const activityDefinitions = Object.values(activityRegistry);
