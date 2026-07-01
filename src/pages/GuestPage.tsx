import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Send, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WorksheetRenderer } from '../components/WorksheetRenderer';
import { RichText } from '../components/RichText';
import { RocketFueling, RocketResult } from '../components/RocketLaunch';
import type { RespuestaEstudiante } from '../services/api';
import { normalizeWorksheet } from '../services/api';
import type { StudentAnswer, StudentAnswers, Worksheet } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k} → ${v}`).join('\n');
  return String(value);
}

interface GuestSession {
  name: string;
  token: string;
  classroomId: string;
  classroomName: string;
}

interface PublicClassroom {
  id: string;
  name: string;
}

// Token determinístico: la misma aula + el mismo nombre producen el mismo token en
// cualquier dispositivo, de modo que las respuestas se comparten ("merge") entre ellos.
function guestToken(classroomId: string, name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return `g:${classroomId}:${normalized}`;
}

function getOrCreateSession(): GuestSession | null {
  try {
    const stored = localStorage.getItem('guestSession');
    if (stored) {
      const parsed = JSON.parse(stored) as GuestSession;
      // Descartar sesiones antiguas sin classroomId o sin nombre
      if (!parsed.classroomId || !parsed.name) {
        localStorage.removeItem('guestSession');
        return null;
      }
      // Recalcular el token determinístico (actualiza sesiones antiguas con token aleatorio)
      const upgraded = { ...parsed, token: guestToken(parsed.classroomId, parsed.name) };
      localStorage.setItem('guestSession', JSON.stringify(upgraded));
      return upgraded;
    }
  } catch {}
  return null;
}

function saveSession(session: GuestSession) {
  localStorage.setItem('guestSession', JSON.stringify(session));
}

async function fetchPublicClassrooms(): Promise<PublicClassroom[]> {
  const r = await fetch(`${API_BASE}/public/classrooms`);
  if (!r.ok) return [];
  return r.json() as Promise<PublicClassroom[]>;
}

async function fetchClassroomWorksheets(classroomId: string): Promise<Worksheet[]> {
  const r = await fetch(`${API_BASE}/public/classrooms/${encodeURIComponent(classroomId)}/worksheets`);
  if (!r.ok) throw new Error('No se pudieron cargar las hojas');
  const data = await r.json() as Parameters<typeof normalizeWorksheet>[0][];
  return data.map(normalizeWorksheet);
}

async function logGuestAccess(session: GuestSession): Promise<void> {
  try {
    await fetch(`${API_BASE}/public/guest-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_token: session.token,
        name: session.name,
        classroom_id: session.classroomId,
        classroom_name: session.classroomName,
      }),
    });
  } catch { /* no interrumpir el flujo si el log falla */ }
}

async function fetchGuestResponses(token: string): Promise<RespuestaEstudiante[]> {
  const r = await fetch(`${API_BASE}/public/responses?guest_token=${encodeURIComponent(token)}`);
  if (!r.ok) return [];
  return r.json() as Promise<RespuestaEstudiante[]>;
}

async function submitGuestResponse(
  worksheetId: string,
  studentName: string,
  guestToken: string,
  answers: StudentAnswers,
): Promise<RespuestaEstudiante> {
  const r = await fetch(`${API_BASE}/public/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worksheet_id: worksheetId, student_name: studentName, guest_token: guestToken, answers_json: answers }),
  });
  const data = await r.json() as Record<string, unknown>;
  if (!r.ok) throw new Error(String((data as { detail?: string })['detail'] ?? 'Error al enviar'));
  return data as unknown as RespuestaEstudiante;
}

// ── Entry screen: classroom + name ───────────────────────────────────────────

function NameEntry({ onEnter }: { onEnter: (name: string, classroom: PublicClassroom) => void }) {
  const [classrooms, setClassrooms] = useState<PublicClassroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<PublicClassroom | null>(null);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchPublicClassrooms().then((data) => {
      setClassrooms(data);
      if (data.length === 1) setSelectedClassroom(data[0]);
    });
  }, []);

  useEffect(() => {
    if (selectedClassroom) inputRef.current?.focus();
  }, [selectedClassroom]);

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length < 2 || !selectedClassroom) return;
    onEnter(trimmed, selectedClassroom);
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
          <User className="text-violet-600" size={26} />
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900">Acceso invitado</h1>
        <p className="mt-1 text-sm text-slate-500">Selecciona tu clase y escribe tu nombre.</p>

        {/* Selector de aula */}
        <div className="mt-5 grid gap-2">
          {classrooms.length === 0 && (
            <p className="text-sm text-slate-400">Cargando aulas…</p>
          )}
          {classrooms.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${selectedClassroom?.id === c.id ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700 hover:border-violet-300 hover:bg-violet-50'}`}
              onClick={() => setSelectedClassroom(c)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Nombre */}
        {selectedClassroom && (
          <>
            <input
              ref={inputRef}
              className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
              placeholder="Tu nombre completo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
            <button
              className="mt-3 w-full rounded-2xl bg-violet-600 px-5 py-3 font-bold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
              disabled={name.trim().length < 2}
              onClick={submit}
            >
              Entrar →
            </button>
          </>
        )}

        <button
          className="mt-3 text-sm text-slate-400 hover:text-slate-600"
          onClick={() => { window.location.href = '/login'; }}
        >
          ← Volver al inicio
        </button>
      </div>
    </main>
  );
}

// ── Main guest portal ─────────────────────────────────────────────────────────

export function GuestPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<GuestSession | null>(getOrCreateSession);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [responses, setResponses] = useState<RespuestaEstudiante[]>([]);
  const [activeWorksheet, setActiveWorksheet] = useState<Worksheet | null>(null);
  const [tab, setTab] = useState<'activas' | 'calificadas'>('activas');
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ score: number | null; worksheetId: string; worksheetTitle: string; correct: number; incorrect: number } | null>(null);
  const [error, setError] = useState('');

  function handleEnterName(name: string, classroom: PublicClassroom) {
    const token = guestToken(classroom.id, name);
    const s: GuestSession = { name, token, classroomId: classroom.id, classroomName: classroom.name };
    saveSession(s);
    setSession(s);
    void logGuestAccess(s);
  }

  useEffect(() => {
    if (!session) return;
    // Log returning visits (session already existed in localStorage)
    void logGuestAccess(session);
    void fetchClassroomWorksheets(session.classroomId).then(setWorksheets).catch(() => setError('No se pudieron cargar las evaluaciones.'));
    void fetchGuestResponses(session.token).then(setResponses).catch(() => {});
  }, [session?.token]);

  useEffect(() => {
    if (!session || worksheets.length === 0) return;
    const answeredIds = new Set(responses.map((r) => r.worksheet_id));
    const firstActive = worksheets.find((w) => !answeredIds.has(w.id));
    setActiveWorksheet(firstActive ?? worksheets[0]);
  }, [worksheets, responses, session?.token]);

  if (!session) return <NameEntry onEnter={handleEnterName} />;

  const answeredIds = new Set(responses.map((r) => r.worksheet_id));
  const activeWorksheets = worksheets.filter((w) => !answeredIds.has(w.id));
  const gradedWorksheets = worksheets.filter((w) => answeredIds.has(w.id));
  const responseByWorksheet = new Map(responses.map((r) => [r.worksheet_id, r]));

  async function sendAnswers() {
    if (!activeWorksheet || !session || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const response = await submitGuestResponse(activeWorksheet.id, session.name, session.token, answers);
      setResponses((prev) => [response, ...prev]);
      setAnswers({});
      const incorrect = response.details.filter((d) => d.status === 'incorrect').length;
      setSubmitResult({ score: response.score, worksheetId: activeWorksheet.id, worksheetTitle: activeWorksheet.title, correct: response.correct_count, incorrect });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const isActiveCurrent = activeWorksheet ? !answeredIds.has(activeWorksheet.id) : false;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {isSubmitting && <RocketFueling />}
      {/* Navbar */}
      <nav className="border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs text-slate-500">Invitado · {session.classroomName}</p>
            <p className="font-bold leading-tight">{session.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {(['activas', 'calificadas'] as const).map((t) => (
              <button
                key={t}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setTab(t)}
              >
                {t === 'activas' ? 'Activas' : 'Calificadas'}
              </button>
            ))}
            <button
              className="ml-2 rounded-2xl border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
              onClick={() => navigate('/login')}
            >
              Salir
            </button>
          </div>
        </div>
      </nav>

      {/* ── ACTIVAS ── */}
      {tab === 'activas' && (
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="font-bold">Evaluaciones disponibles</h2>
            <div className="mt-4 grid gap-3">
              {activeWorksheets.map((ws) => (
                <button
                  key={ws.id}
                  className={`rounded-2xl border p-4 text-left transition-colors ${activeWorksheet?.id === ws.id ? 'border-violet-500 bg-violet-50' : 'border-slate-100 hover:border-slate-300'}`}
                  onClick={() => { setActiveWorksheet(ws); setError(''); }}
                >
                  <BookOpen className="mb-2 text-violet-600" size={20} />
                  <strong className="block">{ws.title}</strong>
                  <p className="text-sm text-slate-500"><RichText text={ws.description} /></p>
                </button>
              ))}
              {activeWorksheets.length === 0 && (
                <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">¡Todo listo! No tienes evaluaciones pendientes.</p>
              )}
            </div>
          </aside>
          <section>
            {activeWorksheet && isActiveCurrent && (
              <WorksheetRenderer worksheet={activeWorksheet} answers={answers} onAnswerChange={(id, val: StudentAnswer) => setAnswers((prev: StudentAnswers) => ({ ...prev, [id]: val }))} />
            )}
            {error && <p className="mx-auto mt-4 max-w-4xl rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}
            {activeWorksheet && isActiveCurrent && (
              <div className="mx-auto mt-6 flex max-w-4xl justify-end">
                <button
                  className="rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-white disabled:opacity-60 hover:bg-emerald-600 transition-colors"
                  disabled={isSubmitting}
                  onClick={() => void sendAnswers()}
                >
                  <Send className="mr-2 inline" size={18} /> {isSubmitting ? 'Enviando...' : 'Enviar respuestas'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── CALIFICADAS ── */}
      {tab === 'calificadas' && (
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="font-bold">Evaluaciones calificadas</h2>
            <div className="mt-4 grid gap-3">
              {gradedWorksheets.map((ws) => {
                const resp = responseByWorksheet.get(ws.id)!;
                return (
                  <button
                    key={ws.id}
                    className={`rounded-2xl border p-4 text-left transition-colors ${activeWorksheet?.id === ws.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 hover:border-slate-300'}`}
                    onClick={() => setActiveWorksheet(ws)}
                  >
                    <Check className="mb-2 text-emerald-600" size={20} />
                    <strong className="block">{ws.title}</strong>
                    <p className="mt-1 text-xs font-semibold text-slate-600">Nota: {resp.score ?? 'pendiente'} · Aciertos: {resp.correct_count}</p>
                    <p className="text-xs text-slate-400">{new Date(resp.submitted_at).toLocaleDateString()}</p>
                  </button>
                );
              })}
              {gradedWorksheets.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Aún no has entregado ninguna evaluación.</p>}
            </div>
          </aside>
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            {(() => {
              const resp = activeWorksheet ? responseByWorksheet.get(activeWorksheet.id) : null;
              if (!resp) return <p className="text-sm text-slate-500">Selecciona una evaluación para ver tu resultado.</p>;
              const incorrect = resp.details.filter((d) => d.status === 'incorrect').length;
              return (
                <>
                  <h2 className="text-xl font-bold">{activeWorksheet?.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">Entregado: {new Date(resp.submitted_at).toLocaleString()}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
                    <span className="rounded-xl bg-emerald-50 px-3 py-1 text-emerald-700">Aciertos: {resp.correct_count}</span>
                    <span className="rounded-xl bg-red-50 px-3 py-1 text-red-700">Fallos: {incorrect}</span>
                    {resp.pending_count > 0 && <span className="rounded-xl bg-amber-50 px-3 py-1 text-amber-700">Pendientes: {resp.pending_count}</span>}
                    {resp.score !== null && <span className="rounded-xl bg-blue-50 px-3 py-1 text-blue-700">Nota: {resp.score}</span>}
                  </div>
                  <div className="mt-5 grid gap-3">
                    {resp.details.map((d) => (
                      <div key={d.activity_id} className={`rounded-2xl border p-4 text-sm ${d.status === 'correct' ? 'border-emerald-100 bg-emerald-50' : d.status === 'incorrect' ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50'}`}>
                        <p className={`font-semibold ${d.status === 'correct' ? 'text-emerald-800' : d.status === 'incorrect' ? 'text-red-800' : 'text-amber-800'}`}>{d.prompt}</p>
                        <p className="mt-1 text-slate-600">Respuesta: <span className="font-medium"><RichText text={answerText(d.student_answer)} /></span></p>
                        {d.status !== 'pending' && <p className="text-slate-500">Correcta: <RichText text={answerText(d.correct_answer)} /></p>}
                        {d.teacher_comment && <p className="mt-1 italic text-slate-500">✦ {d.teacher_comment}</p>}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </section>
        </div>
      )}

      {/* ── MODAL resultado ── */}
      {submitResult && (
        <RocketResult
          score={submitResult.score}
          correct={submitResult.correct}
          incorrect={submitResult.incorrect}
          worksheetTitle={submitResult.worksheetTitle}
          onSeeAnswers={() => {
            const ws = worksheets.find((w) => w.id === submitResult.worksheetId);
            if (ws) setActiveWorksheet(ws);
            setTab('calificadas');
            setSubmitResult(null);
          }}
          onClose={() => setSubmitResult(null)}
        />
      )}
    </main>
  );
}
