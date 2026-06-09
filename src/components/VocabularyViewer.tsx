import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { VocabularyItem, VocabularyList, VocabularyWordType } from '../types';
import { TtsButton } from './AudioPlayer';
import { RichText } from './RichText';

// ── Colores por tipo de palabra ───────────────────────────────────────────────

const TYPE_COLORS: Record<string, { card: string; badge: string; label: string }> = {
  verb:           { card: 'border-indigo-200 bg-indigo-50',   badge: 'bg-indigo-100 text-indigo-700',   label: 'Verb' },
  noun:           { card: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', label: 'Noun' },
  adjective:      { card: 'border-amber-200 bg-amber-50',     badge: 'bg-amber-100 text-amber-700',     label: 'Adjective' },
  adverb:         { card: 'border-violet-200 bg-violet-50',   badge: 'bg-violet-100 text-violet-700',   label: 'Adverb' },
  connector:      { card: 'border-orange-200 bg-orange-50',   badge: 'bg-orange-100 text-orange-700',   label: 'Connector' },
  'linking word': { card: 'border-rose-200 bg-rose-50',       badge: 'bg-rose-100 text-rose-700',       label: 'Linking Word' },
  preposition:    { card: 'border-cyan-200 bg-cyan-50',       badge: 'bg-cyan-100 text-cyan-700',       label: 'Preposition' },
  phrase:         { card: 'border-teal-200 bg-teal-50',       badge: 'bg-teal-100 text-teal-700',       label: 'Phrase' },
};

function getTypeStyle(type: VocabularyWordType) {
  return TYPE_COLORS[type.toLowerCase()] ?? { card: 'border-slate-200 bg-slate-50', badge: 'bg-slate-100 text-slate-600', label: type };
}

// ── Tarjeta de palabra ────────────────────────────────────────────────────────

function WordCard({ item }: { item: VocabularyItem }) {
  const [expanded, setExpanded] = useState(false);
  const style = getTypeStyle(item.type);
  const isVerb = item.type.toLowerCase() === 'verb';
  const verbForms = isVerb && (item.v_past || item.v_participle || item.v_ing || item.v_3rd);

  return (
    <article className={`rounded-2xl border p-4 transition ${style.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-slate-900">{item.english}</span>
            <TtsButton text={item.english} />
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>{style.label}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{item.spanish}</p>
        </div>
        {verbForms && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 rounded-xl border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 flex items-center gap-1"
          >
            Formas {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {verbForms && expanded && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-xl bg-white/70 p-3 text-sm">
          {[
            { label: 'Base', value: item.english },
            { label: 'Simple Past', value: item.v_past },
            { label: 'Past Participle', value: item.v_participle },
            { label: '-ing', value: item.v_ing },
            { label: '3rd Person', value: item.v_3rd },
          ]
            .filter((f) => f.value)
            .map((f) => (
              <div key={f.label} className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2">
                <span className="text-xs text-indigo-400 font-medium shrink-0 w-24">{f.label}</span>
                <span className="font-semibold text-indigo-800 flex-1 min-w-0 break-all">{f.value}</span>
                <span className="shrink-0"><TtsButton text={f.value ?? ''} /></span>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

// ── Leyenda de colores ────────────────────────────────────────────────────────

const LEGEND_ENTRIES = Object.entries(TYPE_COLORS);

function ColorLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {LEGEND_ENTRIES.map(([key, style]) => (
        <span key={key} className={`rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>
          {style.label}
        </span>
      ))}
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Other</span>
    </div>
  );
}

// ── Viewer principal ──────────────────────────────────────────────────────────

interface VocabularyViewerProps {
  lists: VocabularyList[];
}

export function VocabularyViewer({ lists }: VocabularyViewerProps) {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  if (!lists.length) {
    return (
      <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-sm">
        <p className="text-4xl">📚</p>
        <p className="mt-3 font-semibold text-slate-600">Tu profesor aún no ha asignado listas de vocabulario.</p>
      </div>
    );
  }

  // Grupos por block (lista)
  return (
    <div className="grid gap-8">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Vocabulario</h2>
        <div className="mt-3"><ColorLegend /></div>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm flex-1 min-w-48"
            placeholder="Buscar palabra..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos los tipos</option>
            {LEGEND_ENTRIES.map(([key, style]) => (
              <option key={key} value={key}>{style.label}</option>
            ))}
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {lists.map((list) => {
        const filtered = list.items.filter((item) => {
          const matchesType = filter === 'all' || item.type.toLowerCase() === filter || (filter === 'other' && !TYPE_COLORS[item.type.toLowerCase()]);
          const matchesSearch = !search || item.english.toLowerCase().includes(search.toLowerCase()) || item.spanish.toLowerCase().includes(search.toLowerCase());
          return matchesType && matchesSearch;
        });

        if (!filtered.length) return null;

        // Agrupar por block: usamos el campo de block que puede venir en los items
        // No hay campo block en item directamente (items es plano), así que mostramos por lista
        return (
          <section key={list.id} className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-1">
              <h3 className="text-lg font-bold text-slate-900">{list.title}</h3>
              {list.description && <p className="text-sm text-slate-500"><RichText text={list.description} /></p>}
              <p className="mt-1 text-xs text-slate-400">{filtered.length} {filtered.length === 1 ? 'palabra' : 'palabras'}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item, index) => (
                <WordCard key={`${item.english}-${index}`} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Manager para el profesor ──────────────────────────────────────────────────

interface Reader { id: string; name: string; username: string; }

interface VocabularyManagerProps {
  lists: VocabularyList[];
  classrooms: { id: string; name: string }[];
  readers: Reader[];
  onCreate: (title: string, description: string, items: VocabularyItem[]) => Promise<void>;
  onDeleted: (listId: string) => void;
  onAssign: (listId: string, classroomId: string) => void;
  onUnassign: (listId: string, classroomId: string) => void;
  assignedClassrooms: Record<string, string[]>;
  onAssignReader: (listId: string, readerId: string) => void;
  onUnassignReader: (listId: string, readerId: string) => void;
  assignedReaders: Record<string, string[]>;
}

/** Splits a CSV line into columns respecting double-quoted fields that may contain commas. */
function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Escaped quote inside quoted field ("" → ")
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseCsv(csv: string): VocabularyItem[] {
  const lines = csv.trim().split('\n');
  if (!lines.length) return [];
  // Skip header row if it starts with "block" or "english"
  const start = lines[0].toLowerCase().startsWith('block') || lines[0].toLowerCase().startsWith('english') ? 1 : 0;
  const items: VocabularyItem[] = [];
  for (const line of lines.slice(start)) {
    const cols = splitCsvLine(line);
    if (cols.length < 3) continue;
    // Support both formats:
    // Format A: block, english, spanish, type, v_past, v_participle, v_ing, v_3rd
    // Format B: english, spanish, type, v_past, v_participle, v_ing, v_3rd
    let english: string, spanish: string, type: string, v_past: string, v_participle: string, v_ing: string, v_3rd: string;
    // Detect format by checking if cols[3] is a known word type (Format A with block),
    // or cols[2] is a known word type (Format B without block).
    // This handles block names with special characters like "&", "-", etc.
    const KNOWN_TYPES = new Set(['verb', 'noun', 'adjective', 'adverb', 'connector', 'linking word', 'preposition', 'phrase', 'other']);
    const isFormatA = cols.length >= 4 && KNOWN_TYPES.has(cols[3]?.toLowerCase());
    if (isFormatA) {
      // Format A: block, english, spanish, type, v_past, v_participle, v_ing, v_3rd
      [, english, spanish, type, v_past = '', v_participle = '', v_ing = '', v_3rd = ''] = cols;
    } else {
      // Format B: english, spanish, type, v_past, v_participle, v_ing, v_3rd
      [english, spanish, type, v_past = '', v_participle = '', v_ing = '', v_3rd = ''] = cols;
    }
    if (!english || !spanish) continue;
    items.push({ english, spanish, type: type || 'other', v_past, v_participle, v_ing, v_3rd });
  }
  return items;
}

export function VocabularyManager({ lists, classrooms, readers, onCreate, onDeleted, onAssign, onUnassign, assignedClassrooms, onAssignReader, onUnassignReader, assignedReaders }: VocabularyManagerProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<VocabularyItem[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);

  function handleCsvChange(value: string) {
    setCsvText(value);
    setPreview(parseCsv(value));
  }

  async function handleCreate() {
    if (!title.trim() || !preview.length) {
      setMessage('Escribe un título y pega el CSV con las palabras.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onCreate(title.trim(), description.trim(), preview);
      setTitle('');
      setDescription('');
      setCsvText('');
      setPreview([]);
      setMessage(`Lista creada correctamente con ${preview.length} palabras.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error al crear la lista.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6">
      {/* Formulario creación */}
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Nueva lista de vocabulario</h2>
        <p className="mt-1 text-sm text-slate-500">Pega el contenido del CSV directamente. La primera fila puede ser el encabezado.</p>
        <div className="mt-4 grid gap-3">
          <input className="rounded-2xl border p-3 text-sm" placeholder="Título de la lista (ej: Unit 3 — Past Tense)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="rounded-2xl border p-3 text-sm" placeholder="Descripción opcional" value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea
            className="rounded-2xl border p-3 text-sm font-mono"
            rows={8}
            placeholder={`block,english,spanish,type,v_past,v_participle,v_ing,v_3rd\nCommon Verbs,go,ir,verb,went,gone,going,goes\nConnectors,however,sin embargo,connector,,,,\nLinking Words,furthermore,además,linking word,,,,`}
            value={csvText}
            onChange={(e) => handleCsvChange(e.target.value)}
          />
        </div>
        {preview.length > 0 && (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-600">Vista previa: {preview.length} palabras detectadas</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 max-h-72 overflow-y-auto">
              {preview.map((item, i) => {
                const style = getTypeStyle(item.type);
                return (
                  <div key={i} className={`rounded-xl border p-3 text-sm ${style.card}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{item.english}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>{style.label}</span>
                    </div>
                    <p className="text-slate-500">{item.spanish}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {message && <p className={`mt-3 rounded-2xl p-3 text-sm font-semibold ${message.includes('creada') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{message}</p>}
        <button
          className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
          disabled={saving || !title.trim() || !preview.length}
          onClick={handleCreate}
        >
          {saving ? 'Guardando...' : 'Guardar lista'}
        </button>
      </section>

      {/* Listas existentes */}
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Listas guardadas</h2>
        <div className="mt-4 grid gap-4">
          {lists.map((list) => (
            <article key={list.id} className="rounded-2xl border border-slate-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{list.title}</h3>
                  {list.description && <p className="text-sm text-slate-500"><RichText text={list.description} /></p>}
                  <p className="mt-1 text-xs text-slate-400">{list.items.length} palabras</p>
                  {(assignedClassrooms[list.id] ?? []).length > 0 && (
                    <p className="mt-1 text-xs font-semibold text-emerald-700">
                      Aulas: {classrooms.filter((c) => (assignedClassrooms[list.id] ?? []).includes(c.id)).map((c) => c.name).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                    onClick={() => setExpandedListId(expandedListId === list.id ? null : list.id)}
                  >
                    {expandedListId === list.id ? 'Ocultar' : 'Ver palabras'}
                  </button>
                  <button
                    className="rounded-2xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600"
                    onClick={() => { if (window.confirm(`¿Eliminar la lista "${list.title}"?`)) onDeleted(list.id); }}
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Asignación a aulas */}
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-400 mb-1.5">Aulas</p>
                <div className="flex flex-wrap gap-2">
                  {classrooms.map((classroom) => {
                    const isAssigned = (assignedClassrooms[list.id] ?? []).includes(classroom.id);
                    return (
                      <button
                        key={classroom.id}
                        type="button"
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${isAssigned ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'}`}
                        onClick={() => isAssigned ? onUnassign(list.id, classroom.id) : onAssign(list.id, classroom.id)}
                      >
                        {isAssigned ? '✓ ' : '+ '}{classroom.name}
                      </button>
                    );
                  })}
                  {!classrooms.length && <p className="text-xs text-slate-400">Primero crea aulas.</p>}
                </div>
              </div>

              {/* Asignación a lectores */}
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-400 mb-1.5">Lectores</p>
                <div className="flex flex-wrap gap-2">
                  {readers.map((reader) => {
                    const isAssigned = (assignedReaders[list.id] ?? []).includes(reader.id);
                    return (
                      <button
                        key={reader.id}
                        type="button"
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${isAssigned ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-600'}`}
                        onClick={() => isAssigned ? onUnassignReader(list.id, reader.id) : onAssignReader(list.id, reader.id)}
                      >
                        {isAssigned ? '✓ ' : '+ '}{reader.name}
                      </button>
                    );
                  })}
                  {!readers.length && <p className="text-xs text-slate-400">Aún no hay lectores creados.</p>}
                </div>
              </div>

              {/* Vista expandida */}
              {expandedListId === list.id && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {list.items.map((item, i) => <WordCard key={i} item={item} />)}
                </div>
              )}
            </article>
          ))}
          {!lists.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Aún no has creado ninguna lista.</p>}
        </div>
      </section>
    </div>
  );
}
