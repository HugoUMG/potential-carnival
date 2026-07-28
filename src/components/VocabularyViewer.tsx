import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Printer, Link2, Wand2, Eye } from 'lucide-react';
import type { VocabularyItem, VocabularyList, VocabularyWordType } from '../types';
import { generateVocabularyWithAI } from '../services/api';
import { TtsButton } from './AudioPlayer';
import { RichText } from './RichText';
import { VocabularyPrint } from './VocabularyPrint';

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

// ── Palabras agrupadas por bloque (lo que ve el alumno) ───────────────────────

/** Agrupa por `block` conservando el orden de entrada. Sin blocks → un solo grupo. */
function groupByBlock(items: VocabularyItem[]): { label: string; items: VocabularyItem[] }[] {
  if (!items.some((i) => i.block?.trim())) return [{ label: '', items }];
  const groups: { label: string; items: VocabularyItem[] }[] = [];
  for (const item of items) {
    const label = item.block?.trim() || '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function VocabularyCards({ items }: { items: VocabularyItem[] }) {
  return (
    <>
      {groupByBlock(items).map((group, gi) => (
        <div key={gi} className={gi > 0 ? 'mt-8' : ''}>
          {group.label && (
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded-2xl bg-rex-light px-4 py-1.5 text-sm font-bold text-rex-deep">{group.label}</span>
              <span className="text-xs text-slate-400">{group.items.length} palabras</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item, index) => (
              <WordCard key={`${item.english}-${index}`} item={item} />
            ))}
          </div>
        </div>
      ))}
    </>
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
  const [printList, setPrintList] = useState<VocabularyList | null>(null);

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

        return (
          <section key={list.id} className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900">{list.title}</h3>
                {list.description && <p className="text-sm text-slate-500"><RichText text={list.description} /></p>}
                <p className="mt-1 text-xs text-slate-400">{filtered.length} {filtered.length === 1 ? 'palabra' : 'palabras'}</p>
              </div>
              <button
                type="button"
                onClick={() => setPrintList(list)}
                className="flex shrink-0 items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <Printer size={14} /> Imprimir PDF
              </button>
            </div>
            <VocabularyCards items={filtered} />
          </section>
        );
      })}

      {printList && <VocabularyPrint list={printList} onClose={() => setPrintList(null)} />}
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
    let block: string, english: string, spanish: string, type: string, v_past: string, v_participle: string, v_ing: string, v_3rd: string;
    // Detect format by checking if cols[3] is a known word type (Format A with block),
    // or cols[2] is a known word type (Format B without block).
    // This handles block names with special characters like "&", "-", etc.
    const KNOWN_TYPES = new Set(['verb', 'noun', 'adjective', 'adverb', 'connector', 'linking word', 'preposition', 'phrase', 'other']);
    const isFormatA = cols.length >= 4 && KNOWN_TYPES.has(cols[3]?.toLowerCase());
    if (isFormatA) {
      // Format A: block, english, spanish, type, v_past, v_participle, v_ing, v_3rd
      [block, english, spanish, type, v_past = '', v_participle = '', v_ing = '', v_3rd = ''] = cols;
    } else {
      // Format B: english, spanish, type, v_past, v_participle, v_ing, v_3rd
      block = '';
      [english, spanish, type, v_past = '', v_participle = '', v_ing = '', v_3rd = ''] = cols;
    }
    if (!english || !spanish) continue;
    items.push({ block: block || '', english, spanish, type: type || 'other', v_past, v_participle, v_ing, v_3rd });
  }
  return items;
}

// ── Generar vocabulario con IA ────────────────────────────────────────────────

// ponytail: copia de los chips del AiPanel (WorksheetEditor). Importarlos de allí
// metería el editor visual entero en el bundle del portal público de vocabulario.
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

const VOCAB_PRESETS: { icon: string; label: string; topic: string; types: string[] }[] = [
  { icon: '✈️', label: 'Viajes', topic: 'travel and airports', types: [] },
  { icon: '🍎', label: 'Comida', topic: 'food and cooking', types: ['noun', 'adjective'] },
  { icon: '🏫', label: 'Escuela', topic: 'school and classroom', types: [] },
  { icon: '💼', label: 'Trabajo', topic: 'work and office', types: [] },
  { icon: '🔁', label: 'Verbos irregulares', topic: 'common irregular verbs', types: ['verb'] },
  { icon: '🔗', label: 'Conectores', topic: 'connectors and linking words for essays', types: ['connector', 'linking word'] },
];
const VOCAB_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const VOCAB_COUNTS = [10, 15, 20, 30, 40];
const VOCAB_TYPES: [string, string][] = [
  ['Verbos', 'verb'], ['Sustantivos', 'noun'], ['Adjetivos', 'adjective'], ['Adverbios', 'adverb'],
  ['Conectores', 'connector'], ['Linking words', 'linking word'], ['Preposiciones', 'preposition'], ['Frases', 'phrase'],
];

function composeVocabPrompt(topic: string, level: string, count: number, types: string[]): string {
  if (!topic.trim()) return '';
  const parts = [`Genera ${count} palabras de vocabulario en inglés sobre "${topic.trim()}"`];
  if (level) parts.push(`para estudiantes de nivel ${level}`);
  if (types.length) parts.push(`usando solo estos tipos: ${types.join(', ')}`);
  return `${parts.join(' ')}.`;
}

function VocabAiPanel({ onResult }: { onResult: (topic: string, csv: string) => void }) {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('A2');
  const [count, setCount] = useState(20);
  const [types, setTypes] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');

  const prompt = composeVocabPrompt(topic, level, count, types);
  const toggleType = (t: string) => setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  async function run() {
    if (!prompt || working) return;
    setWorking(true);
    setErr('');
    try {
      onResult(topic.trim(), await generateVocabularyWithAI(prompt));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'La IA no pudo generar el vocabulario.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-spike/15">
          <Wand2 size={20} className="text-spike" />
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-spike">Generar con Inteligencia Artificial</p>
          <h2 className="text-xl font-bold text-slate-900">Vocabulario por tema, con un clic</h2>
        </div>
      </div>
      <p className="mt-2 mb-5 text-sm text-slate-500">Escribe un tema (o elige un preset) y la IA arma la lista. Se llena la vista previa de abajo: revísala antes de guardar.</p>

      <ChipGroup label="⭐ Presets (un clic)">
        {VOCAB_PRESETS.map((p) => (
          <Chip key={p.label} active={false} onClick={() => { setTopic(p.topic); setTypes(p.types); }}>{p.icon} {p.label}</Chip>
        ))}
      </ChipGroup>

      <div className="mt-5 grid gap-4">
        <label className="block">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">📖 Tema</p>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-spike"
            placeholder="Ej: animales de granja, ropa, phrasal verbs con 'get'…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <ChipGroup label="📚 Nivel">
            {VOCAB_LEVELS.map((l) => <Chip key={l} active={level === l} onClick={() => setLevel(level === l ? '' : l)}>{l}</Chip>)}
          </ChipGroup>
          <ChipGroup label="🔢 Cantidad">
            {VOCAB_COUNTS.map((c) => <Chip key={c} active={count === c} onClick={() => setCount(c)}>{c}</Chip>)}
          </ChipGroup>
        </div>
        <ChipGroup label="🧩 Tipos de palabra (opcional, vacío = mezcla)">
          {VOCAB_TYPES.map(([label, v]) => <Chip key={v} active={types.includes(v)} onClick={() => toggleType(v)}>{types.includes(v) ? '✓ ' : ''}{label}</Chip>)}
        </ChipGroup>
      </div>

      {err && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{err}</p>}

      <button
        className="mt-5 flex items-center gap-2 rounded-2xl bg-spike px-5 py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
        disabled={working || !prompt}
        onClick={() => void run()}
      >
        <Wand2 size={16} /> {working ? 'Generando…' : 'Generar vocabulario'}
      </button>
      {prompt && <p className="mt-2 text-xs text-slate-400">Se le pedirá: {prompt}</p>}
    </section>
  );
}

/** Muestra la lista tal cual la ve el alumno (mismo VocabularyViewer del portal). */
function StudentPreviewModal({ list, onClose }: { list: VocabularyList; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-slate-900/60 p-4" onClick={onClose}>
      <div className="my-auto w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
          <p className="text-sm font-semibold text-slate-600">👁 Así lo ve el alumno</p>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600">Cerrar</button>
        </div>
        <VocabularyViewer lists={[list]} />
      </div>
    </div>
  );
}

/** Lista sin guardar: lo que hay en el formulario, con la forma que espera el viewer. */
function draftList(title: string, description: string, items: VocabularyItem[]): VocabularyList {
  return { id: 'draft', title: title.trim() || 'Lista sin título', description, created_by: '', created_at: '', items };
}

export function VocabularyManager({ lists, classrooms, readers, onCreate, onDeleted, onAssign, onUnassign, assignedClassrooms, onAssignReader, onUnassignReader, assignedReaders }: VocabularyManagerProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<VocabularyItem[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [printList, setPrintList] = useState<VocabularyList | null>(null);
  const [studentPreview, setStudentPreview] = useState<VocabularyList | null>(null);

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
      <VocabAiPanel
        onResult={(aiTopic, csv) => {
          if (!title.trim()) setTitle(aiTopic);
          handleCsvChange(csv);
          setMessage('Vocabulario generado. Revísalo abajo y guarda la lista.');
        }}
      />

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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-600">Vista previa: {preview.length} palabras detectadas</p>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-2xl border border-rex/30 bg-white px-3 py-2 text-sm font-semibold text-rex-deep"
                onClick={() => setStudentPreview(draftList(title, description, preview))}
              >
                <Eye size={15} /> Vista previa del alumno
              </button>
            </div>
            <div className="mt-3 max-h-96 overflow-y-auto">
              <VocabularyCards items={preview} />
            </div>
          </div>
        )}
        {message && <p className={`mt-3 rounded-2xl p-3 text-sm font-semibold ${/creada|generad/.test(message) ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{message}</p>}
        <button
          className="mt-4 rounded-2xl bg-rex px-5 py-3 font-semibold text-white transition hover:bg-rex-dark disabled:opacity-60"
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
                    className="flex items-center gap-1.5 rounded-2xl border border-rex/30 px-3 py-2 text-sm font-semibold text-rex-deep"
                    title="Ver la lista tal como la ve el alumno"
                    onClick={() => setStudentPreview(list)}
                  >
                    <Eye size={15} /> Vista alumno
                  </button>
                  <button
                    className="flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                    onClick={() => setPrintList(list)}
                  >
                    <Printer size={15} /> Imprimir PDF
                  </button>
                  <button
                    className="flex items-center gap-1.5 rounded-2xl border border-rex/30 px-3 py-2 text-sm font-semibold text-rex-deep"
                    title="Copia un enlace directo: se ve sin login ni menú, solo este vocabulario"
                    onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/v/${list.id}`); setMessage('Enlace del vocabulario copiado. Compártelo — se abre sin login, solo esa lista.'); }}
                  >
                    <Link2 size={15} /> Copiar enlace
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
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${isAssigned ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-rex/40 hover:text-rex-deep'}`}
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
                <div className="mt-4">
                  <VocabularyCards items={list.items} />
                </div>
              )}
            </article>
          ))}
          {!lists.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Aún no has creado ninguna lista.</p>}
        </div>
      </section>

      {studentPreview && <StudentPreviewModal list={studentPreview} onClose={() => setStudentPreview(null)} />}
      {printList && <VocabularyPrint list={printList} onClose={() => setPrintList(null)} />}
    </div>
  );
}
