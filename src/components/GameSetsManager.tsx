import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ClipboardPaste, Copy, ExternalLink, Gamepad2, MessagesSquare, Pencil, Plus, QrCode, Sparkles, Star, Trash2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createGameSet, deleteGameSet, generateGameQuestions, listGameSets, updateGameSet } from '../services/api';
import type { GameQuestion, GameSet, GameSetDraft } from '../types';
import { SAMPLE_GAME_SET } from '../data/sampleGameSet';
import { GAMES, SKILLS } from '../games/registry';
import { Spinner } from './LoadingScreen';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const COUNTS = [10, 20, 30, 40];
const FOCUS_PRESETS = ['Wh- questions with would', 'Be able to (present)', 'Present perfect: Have you ever…?', 'Second conditional', 'Going to (future plans)', 'Past simple'];
const EMPTY: GameSetDraft = { title: '', topic: '', level: 'B1', featured: false, questions: [] };
const blank = (): GameQuestion => ({ text: '', translation: '', hint: '', tag: '', emoji: '' });
const playUrl = (id: string) => `${window.location.origin}/j/${id}`;
const input = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-spike';

/** Sección "Juegos" del portal: sets de preguntas que se juegan en /j/:id con todos los juegos de `GAMES` (ADR-38). */
export function GameSetsManager() {
  const [sets, setSets] = useState<GameSet[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: GameSetDraft } | null>(null);
  const [saved, setSaved] = useState('');

  useEffect(() => { listGameSets().then(setSets, (e: Error) => setError(e.message)); }, []);

  if (editing) {
    return (
      <Editor
        id={editing.id}
        initial={editing.draft}
        onCancel={() => setEditing(null)}
        onSaved={(set) => {
          setSets((prev) => [set, ...(prev ?? []).filter((s) => s.id !== set.id)]);
          setSaved(set.id);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-spike/15"><Gamepad2 size={20} className="text-spike" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-wide text-spike">Juegos de práctica</p>
            <h2 className="text-xl font-bold text-slate-900">Un set de preguntas, {GAMES.length} juegos</h2>
          </div>
          <button type="button" className="flex items-center gap-2 rounded-2xl bg-spike px-4 py-2.5 font-semibold text-white hover:brightness-95"
            onClick={() => setEditing({ id: null, draft: { ...EMPTY } })}>
            <Plus size={16} /> Nuevo juego
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Escribe un tema y la IA arma las preguntas, o pega las tuyas. El alumno abre el enlace sin cuenta, en celular o PC, y
          puede tocar cada palabra para ver sus significados y escuchar su pronunciación.
        </p>
        <details className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-slate-700">¿Qué juegos incluye cada set y cómo usarlos en clase?</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {SKILLS.map((s) => (
              <div key={s.id}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">{s.emoji} {s.name}</p>
                <ul className="grid gap-2">
                  {GAMES.filter((g) => g.skill === s.id).map((g) => (
                    <li key={g.id}><b>{g.emoji} {g.name}:</b> {g.purpose} <span className="text-slate-500">{g.howTo}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </section>

      <RoleplayShare />

      {error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}
      {!sets && !error && <div className="grid place-items-center py-10"><Spinner /></div>}
      {sets && !sets.length && (
        <section className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
          <p className="font-semibold text-slate-700">Todavía no tienes juegos.</p>
          <p className="mt-1 text-sm text-slate-500">Crea uno con IA o empieza con el ejemplo de 40 preguntas B1.</p>
          <button type="button" className="mt-4 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-spike"
            onClick={() => setEditing({ id: null, draft: SAMPLE_GAME_SET })}>
            Cargar el ejemplo B1
          </button>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {sets?.map((s) => (
          <GameSetCard key={s.id} set={s} justSaved={saved === s.id}
            onEdit={() => setEditing({ id: s.id, draft: { title: s.title, topic: s.topic, level: s.level, featured: s.featured, questions: s.questions } })}
            onDeleted={() => setSets((prev) => (prev ?? []).filter((x) => x.id !== s.id))} />
        ))}
      </div>
    </div>
  );
}

/** La conversación con IA (ADR-39) no se configura: se comparte. Aquí está a la mano para la clase. */
function RoleplayShare() {
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/conversacion`;
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-100"><MessagesSquare size={20} className="text-violet-600" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-violet-600">Conversación con IA</p>
          <h2 className="text-lg font-bold text-slate-900">8 role-plays por voz, con nota al final</h2>
          <p className="text-sm text-slate-500">Para quienes se ponen nerviosos al hablar contigo: practican con un personaje de IA, sin cuenta y sin que nadie los juzgue.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/conversacion" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white"><ExternalLink size={15} /> Abrir</a>
          <SmallButton onClick={() => void navigator.clipboard.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => setQr(true))}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar enlace'}
          </SmallButton>
          <SmallButton onClick={() => setQr((v) => !v)}><QrCode size={15} /> QR</SmallButton>
        </div>
      </div>
      {qr && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl bg-slate-50 p-3">
          <div className="rounded-xl bg-white p-2"><QRCodeSVG value={url} size={132} level="M" /></div>
          <p className="select-all break-all font-mono text-xs text-slate-500">{url}</p>
        </div>
      )}
    </section>
  );
}

function GameSetCard({ set, justSaved, onEdit, onDeleted }: { set: GameSet; justSaved: boolean; onEdit: () => void; onDeleted: () => void }) {
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const url = playUrl(set.id);

  const copy = () => navigator.clipboard.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => setQr(true));
  const remove = async () => {
    if (!confirm) { setConfirm(true); window.setTimeout(() => setConfirm(false), 3000); return; }
    try { await deleteGameSet(set.id); onDeleted(); } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo borrar.'); }
  };

  return (
    <article className={`rounded-3xl bg-white p-5 shadow-sm ${justSaved ? 'ring-2 ring-spike' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        {set.level && <span className="rounded-full bg-rex/10 px-2.5 py-1 text-rex">Nivel {set.level}</span>}
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{set.questions.length} preguntas</span>
        {set.featured && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-700"><Star size={12} /> En /juegos</span>}
        {justSaved && <span className="rounded-full bg-spike/15 px-2.5 py-1 text-spike">Guardado</span>}
      </div>
      <h3 className="mt-3 text-lg font-bold text-slate-900">{set.title}</h3>
      {set.topic && <p className="text-sm text-slate-500">{set.topic}</p>}
      <p className="mt-2 line-clamp-2 text-sm italic text-slate-400">{set.questions.slice(0, 2).map((q) => q.text).join(' · ')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`/j/${set.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-spike px-3 py-2 text-sm font-semibold text-white hover:brightness-95">
          <ExternalLink size={15} /> Jugar
        </a>
        <SmallButton onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar enlace'}</SmallButton>
        <SmallButton onClick={() => setQr((v) => !v)}><QrCode size={15} /> QR</SmallButton>
        <SmallButton onClick={onEdit}><Pencil size={15} /> Editar</SmallButton>
        <SmallButton onClick={() => void remove()} danger={confirm}><Trash2 size={15} /> {confirm ? '¿Seguro? Toca otra vez' : 'Borrar'}</SmallButton>
      </div>
      {err && <p className="mt-2 text-sm font-semibold text-red-600">{err}</p>}
      {qr && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl bg-slate-50 p-3">
          <div className="rounded-xl bg-white p-2"><QRCodeSVG value={url} size={132} level="M" /></div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-slate-700">Proyéctalo y que lo escaneen con la cámara.</p>
            <p className="mt-2 select-all break-all font-mono text-xs text-slate-500">{url}</p>
          </div>
        </div>
      )}
    </article>
  );
}

function SmallButton({ children, onClick, danger = false }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold ${danger ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-600 hover:border-spike/50'}`}>
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-spike bg-spike text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-spike/40'}`}>
      {children}
    </button>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</p>;
}

/** "pregunta | traducción | pista" por línea. Lo que no traiga barra es solo la pregunta. */
function parsePasted(text: string): GameQuestion[] {
  return text.split('\n').map((line) => line.split('|').map((part) => part.trim())).filter(([q]) => q)
    .map(([q, translation = '', hint = '']) => ({ ...blank(), text: q, translation, hint }));
}

function Editor({ id, initial, onSaved, onCancel }: { id: string | null; initial: GameSetDraft; onSaved: (set: GameSet) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState(20);
  const [pasted, setPasted] = useState('');
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const filled = draft.questions.filter((q) => q.text.trim()).length;

  const patch = (p: Partial<GameSetDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchQ = (k: number, p: Partial<GameQuestion>) => setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === k ? { ...q, ...p } : q)) }));
  const add = (questions: GameQuestion[], title = '') => setDraft((d) => ({ ...d, title: d.title || title, questions: [...d.questions.filter((q) => q.text.trim()), ...questions] }));

  const generate = async () => {
    setWorking(true);
    setErr('');
    try {
      const res = await generateGameQuestions(draft.topic.trim(), draft.level, focus.trim(), count);
      add(res.questions, res.title);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'La IA no pudo generar las preguntas.');
    } finally {
      setWorking(false);
    }
  };
  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const clean = { ...draft, title: draft.title.trim(), questions: draft.questions.filter((q) => q.text.trim()) };
      onSaved(id ? await updateGameSet(id, clean) : await createGameSet(clean));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.');
      setSaving(false);
    }
  };
  const canSave = !!draft.title.trim() && filled >= 4 && filled <= 60 && !saving;

  return (
    <div className="grid gap-5">
      <section className="flex flex-wrap items-center gap-3 rounded-3xl bg-white p-4 shadow-sm">
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
          <ArrowLeft size={15} /> Volver
        </button>
        <h2 className="min-w-0 flex-1 text-lg font-bold text-slate-900">{id ? 'Editar juego' : 'Nuevo juego'}</h2>
        <button type="button" disabled={!canSave} onClick={() => void save()} className="rounded-2xl bg-spike px-5 py-2.5 font-semibold text-white disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </section>

      <section className="grid gap-4 rounded-3xl bg-white p-5 shadow-sm sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <Label>📝 Título del juego</Label>
          <input className={input} value={draft.title} maxLength={120} placeholder="Ej: Would you…? Speaking B1" onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label className="block">
          <Label>📖 Tema</Label>
          <input className={input} value={draft.topic} maxLength={300} placeholder="Ej: vacaciones, comida, tecnología…" onChange={(e) => patch({ topic: e.target.value })} />
        </label>
        <div>
          <Label>📚 Nivel</Label>
          <div className="flex flex-wrap gap-2">{LEVELS.map((l) => <Chip key={l} active={draft.level === l} onClick={() => patch({ level: l })}>{l}</Chip>)}</div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={draft.featured} onChange={(e) => patch({ featured: e.target.checked })} />
          Mostrar en el catálogo público /juegos (si no, solo con el enlace)
        </label>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-spike/15"><Sparkles size={20} className="text-spike" /></span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-spike">Generar con IA</p>
            <p className="text-sm text-slate-500">Usa el tema y el nivel de arriba. Las preguntas se agregan a la lista para que las revises.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4">
          <label className="block">
            <Label>🎯 Enfoque gramatical (opcional)</Label>
            <input className={input} value={focus} maxLength={200} placeholder="Ej: Wh- questions with would" onChange={(e) => setFocus(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">{FOCUS_PRESETS.map((f) => <Chip key={f} active={focus === f} onClick={() => setFocus(focus === f ? '' : f)}>{f}</Chip>)}</div>
          </label>
          <div>
            <Label>🔢 Cantidad</Label>
            <div className="flex flex-wrap gap-2">{COUNTS.map((c) => <Chip key={c} active={count === c} onClick={() => setCount(c)}>{c}</Chip>)}</div>
          </div>
        </div>
        <button type="button" disabled={working || draft.topic.trim().length < 2} onClick={() => void generate()}
          className="mt-4 flex items-center gap-2 rounded-2xl bg-spike px-5 py-3 font-semibold text-white disabled:opacity-60">
          <Sparkles size={16} /> {working ? 'Generando…' : `Generar ${count} preguntas`}
        </button>
        {draft.topic.trim().length < 2 && <p className="mt-2 text-xs text-slate-400">Escribe el tema arriba para poder generar.</p>}
      </section>

      <details className="rounded-3xl bg-white p-5 shadow-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700"><ClipboardPaste size={16} /> Pegar mis propias preguntas</summary>
        <p className="mt-3 text-sm text-slate-500">Una por línea. Opcional: traducción y pista separadas por <code>|</code></p>
        <textarea className={`${input} mt-2 min-h-32 font-mono`} value={pasted} onChange={(e) => setPasted(e.target.value)}
          placeholder={'Where would you like to travel? | ¿A dónde te gustaría viajar? | I would like to travel to…\nWhat can you cook?'} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={!pasted.trim()} onClick={() => { add(parsePasted(pasted)); setPasted(''); }}
            className="rounded-2xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Agregar a la lista</button>
          <button type="button" onClick={() => add(SAMPLE_GAME_SET.questions, SAMPLE_GAME_SET.title)}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Agregar el ejemplo B1 (40 preguntas)</button>
        </div>
      </details>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex-1 font-bold text-slate-900">Preguntas ({filled})</h3>
          {draft.questions.length > 0 && (
            <button type="button" className="text-sm font-semibold text-slate-400 hover:text-red-500" onClick={() => patch({ questions: [] })}>Vaciar lista</button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">Entre 4 y 60. La traducción alimenta los juegos de significado; la pista, cómo empezar a responder.</p>
        <div className="mt-4 grid gap-3">
          {draft.questions.map((q, k) => (
            <div key={k} className="grid gap-2 rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <span className="w-6 text-right text-xs font-bold text-slate-400">{k + 1}</span>
                <input className={`${input} !w-14 text-center`} value={q.emoji} maxLength={8} aria-label="Emoji" placeholder="🙂" onChange={(e) => patchQ(k, { emoji: e.target.value })} />
                <input className={`${input} font-semibold`} value={q.text} maxLength={300} aria-label="Pregunta en inglés" placeholder="Pregunta en inglés" onChange={(e) => patchQ(k, { text: e.target.value })} />
                <button type="button" aria-label="Quitar pregunta" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500"
                  onClick={() => patch({ questions: draft.questions.filter((_, i) => i !== k) })}><X size={16} /></button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem] sm:pl-[5.5rem]">
                <input className={input} value={q.translation} maxLength={300} aria-label="Traducción" placeholder="Traducción al español" onChange={(e) => patchQ(k, { translation: e.target.value })} />
                <input className={input} value={q.hint} maxLength={200} aria-label="Pista" placeholder="Pista: I would…" onChange={(e) => patchQ(k, { hint: e.target.value })} />
                <input className={input} value={q.tag} maxLength={40} aria-label="Subtema" placeholder="Subtema" onChange={(e) => patchQ(k, { tag: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
          onClick={() => patch({ questions: [...draft.questions, blank()] })}>
          <Plus size={15} /> Agregar pregunta
        </button>
      </section>

      {err && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{err}</p>}
      <div className="flex justify-end">
        <button type="button" disabled={!canSave} onClick={() => void save()} className="rounded-2xl bg-spike px-6 py-3 font-semibold text-white disabled:opacity-50">
          {saving ? 'Guardando…' : id ? 'Guardar cambios' : 'Guardar juego'}
        </button>
      </div>
      {!canSave && !saving && <p className="text-right text-xs text-slate-400">Para guardar: título y entre 4 y 60 preguntas.</p>}
    </div>
  );
}
