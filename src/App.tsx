import { useEffect, useMemo, useState } from 'react';
import { BookOpen, GraduationCap, LockKeyhole, MonitorSmartphone, PencilRuler, Send } from 'lucide-react';
import { WorksheetEditor } from './components/WorksheetEditor';
import { WorksheetRenderer } from './components/WorksheetRenderer';
import { TeacherDashboard } from './components/TeacherDashboard';
import { sampleWorksheet } from './data/sampleWorksheet';
import {
  createWorksheet,
  listStudentResponses,
  listStudentWorksheets,
  listTeacherWorksheets,
  login,
  publishWorksheet,
  submitResponse,
  type RespuestaEstudiante,
  type UsuarioSesion,
} from './services/api';
import type { StudentAnswer, StudentAnswers, Worksheet, WorksheetActivity } from './types';
import './styles/app.css';

type AdminMenu = 'crear' | 'evaluaciones';

const teacherDemo = { email: 'profesor@demo.com', password: 'profesor123' };
const studentDemo = { email: 'estudiante@demo.com', password: 'estudiante123' };

function LoginPanel({ onLogin }: { onLogin: (user: UsuarioSesion) => void }) {
  const [role, setRole] = useState<UsuarioSesion['role']>('teacher');
  const [email, setEmail] = useState(teacherDemo.email);
  const [password, setPassword] = useState(teacherDemo.password);
  const [message, setMessage] = useState('');

  function selectRole(nextRole: UsuarioSesion['role']) {
    setRole(nextRole);
    setEmail(nextRole === 'teacher' ? teacherDemo.email : studentDemo.email);
    setPassword(nextRole === 'teacher' ? teacherDemo.password : studentDemo.password);
  }

  async function handleLogin() {
    setMessage('');
    try {
      const user = await login(email, password, role);
      onLogin(user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión. Revisa que el backend esté activo.');
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <section className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700">
            <GraduationCap size={18} /> Constructor de evaluaciones con IA
          </span>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-950 md:text-6xl">Dos accesos simples: profesor y estudiante.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            El profesor pega WorksheetScript, guarda evaluaciones permanentes en base de datos y habilita las que verá el estudiante. El estudiante entra con su login, resuelve hojas habilitadas y conserva registros de sus envíos.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {['Login separado', 'SQLite permanente', 'Habilitar evaluaciones'].map((item) => (
              <div key={item} className="rounded-2xl bg-white p-4 font-semibold text-slate-700 shadow-sm">{item}</div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-slate-200/70">
          <div className="mb-5 flex rounded-2xl bg-slate-100 p-1">
            <button className={`mode-tab flex-1 ${role === 'teacher' ? 'mode-tab-active' : ''}`} type="button" onClick={() => selectRole('teacher')}>
              <PencilRuler size={16} /> Profesor
            </button>
            <button className={`mode-tab flex-1 ${role === 'student' ? 'mode-tab-active' : ''}`} type="button" onClick={() => selectRole('student')}>
              <MonitorSmartphone size={16} /> Estudiante
            </button>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Correo</span>
            <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-semibold text-slate-700">Contraseña</span>
            <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700" type="button" onClick={handleLogin}>
            <LockKeyhole size={18} /> Entrar como {role === 'teacher' ? 'profesor' : 'estudiante'}
          </button>
          {message && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{message}</p>}
          <p className="mt-5 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Usuarios demo: profesor@demo.com / profesor123 y estudiante@demo.com / estudiante123.</p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<UsuarioSesion | null>(null);
  const [adminMenu, setAdminMenu] = useState<AdminMenu>('crear');
  const [worksheets, setWorksheets] = useState<Worksheet[]>([sampleWorksheet]);
  const [activeWorksheet, setActiveWorksheet] = useState<Worksheet>(sampleWorksheet);
  const [scriptDraft, setScriptDraft] = useState(sampleWorksheet.scriptContent);
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [responses, setResponses] = useState<RespuestaEstudiante[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string>(sampleWorksheet.activities[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const selectedActivity = useMemo(
    () => activeWorksheet.activities.find((activity) => activity.id === selectedActivityId),
    [activeWorksheet.activities, selectedActivityId],
  );

  useEffect(() => {
    if (!user) return;
    void refreshData(user);
    // refreshData se declara debajo porque también se reutiliza manualmente en acciones de pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function refreshData(currentUser = user) {
    if (!currentUser) return;
    try {
      if (currentUser.role === 'teacher') {
        const teacherWorksheets = await listTeacherWorksheets(currentUser.id);
        setWorksheets(teacherWorksheets.length ? teacherWorksheets : [sampleWorksheet]);
        if (teacherWorksheets[0]) {
          setActiveWorksheet(teacherWorksheets[0]);
          setScriptDraft(teacherWorksheets[0].scriptContent);
        }
      } else {
        const availableWorksheets = await listStudentWorksheets(currentUser.id);
        const studentResponses = await listStudentResponses(currentUser.id);
        setWorksheets(availableWorksheets);
        setResponses(studentResponses);
        if (availableWorksheets[0]) setActiveWorksheet(availableWorksheets[0]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo conectar con el backend.');
    }
  }

  function addActivity(activity: WorksheetActivity) {
    setActiveWorksheet((current) => ({ ...current, activities: [...current.activities, activity] }));
    setSelectedActivityId(activity.id);
  }

  function updateAnswer(activityId: string, value: StudentAnswer) {
    setAnswers((current) => ({ ...current, [activityId]: value }));
  }

  async function saveScript() {
    if (!user) return;
    setIsSaving(true);
    setMessage('');
    try {
      const worksheet = await createWorksheet(scriptDraft, user.id);
      setActiveWorksheet(worksheet);
      setWorksheets((current) => [worksheet, ...current.filter((item) => item.id !== sampleWorksheet.id)]);
      setSelectedActivityId(worksheet.activities[0]?.id ?? '');
      setAdminMenu('evaluaciones');
      setMessage('Evaluación guardada correctamente en la base de datos. Ahora puedes habilitarla.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la evaluación.');
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePublished(worksheet: Worksheet) {
    setMessage('');
    try {
      const updated = await publishWorksheet(worksheet.id, worksheet.status !== 'published');
      setWorksheets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setActiveWorksheet(updated);
      setMessage(updated.status === 'published' ? 'Evaluación habilitada para estudiantes.' : 'Evaluación deshabilitada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar la evaluación.');
    }
  }

  async function sendAnswers() {
    if (!user) return;
    try {
      const response = await submitResponse(activeWorksheet, user, answers);
      setResponses((current) => [response, ...current]);
      setAnswers({});
      setMessage(`Respuestas enviadas. Puntuación: ${response.score ?? 'sin calificación automática'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron enviar las respuestas.');
    }
  }

  if (!user) return <LoginPanel onLogin={setUser} />;

  if (user.role === 'student') {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <nav className="border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
            <div>
              <h1 className="text-xl font-bold">Portal del estudiante</h1>
              <p className="text-sm text-slate-500">Hola, {user.name}. Estas son tus hojas habilitadas.</p>
            </div>
            <button className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold text-slate-600" type="button" onClick={() => setUser(null)}>Cerrar sesión</button>
          </div>
        </nav>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Hojas disponibles</h2>
            <div className="mt-4 grid gap-3">
              {worksheets.map((worksheet) => (
                <button key={worksheet.id} className={`rounded-2xl border p-4 text-left ${activeWorksheet.id === worksheet.id ? 'border-blue-500 bg-blue-50' : 'border-slate-100'}`} type="button" onClick={() => setActiveWorksheet(worksheet)}>
                  <BookOpen className="mb-2 text-blue-600" size={20} />
                  <strong>{worksheet.title}</strong>
                  <p className="mt-1 text-sm text-slate-500">{worksheet.description}</p>
                </button>
              ))}
              {!worksheets.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay evaluaciones habilitadas.</p>}
            </div>
            <h3 className="mt-6 font-bold text-slate-900">Mis registros</h3>
            <div className="mt-3 grid gap-2 text-sm text-slate-600">
              {responses.map((response) => (
                <div key={response.id} className="rounded-xl bg-slate-50 p-3">{new Date(response.submitted_at).toLocaleString()} · Puntaje: {response.score ?? 'sin nota'}</div>
              ))}
              {!responses.length && <p className="rounded-xl bg-slate-50 p-3">Sin envíos todavía.</p>}
            </div>
          </aside>
          <section>
            {worksheets.length > 0 && <WorksheetRenderer worksheet={activeWorksheet} answers={answers} onAnswerChange={updateAnswer} />}
            {message && <p className="mx-auto mt-4 max-w-4xl rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{message}</p>}
            {worksheets.length > 0 && (
              <div className="mx-auto mt-6 flex max-w-4xl justify-end">
                <button className="rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-600" type="button" onClick={sendAnswers}>
                  <Send className="mr-2 inline" size={18} /> Enviar respuestas
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  const publishedCount = worksheets.filter((worksheet) => worksheet.status === 'published').length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">Panel del profesor</h1>
            <p className="text-sm text-slate-500">Crea, guarda y habilita evaluaciones permanentes.</p>
          </div>
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
        <TeacherDashboard
          user={user}
          totalWorksheets={worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id).length}
          publishedCount={publishedCount}
          selectedMenu={adminMenu}
          onSelectMenu={setAdminMenu}
          onLogout={() => setUser(null)}
        />
        {adminMenu === 'crear' ? (
          <WorksheetEditor
            worksheet={activeWorksheet}
            selectedActivity={selectedActivity}
            scriptDraft={scriptDraft}
            isSaving={isSaving}
            message={message}
            onAddActivity={addActivity}
            onScriptChange={setScriptDraft}
            onSaveScript={saveScript}
          />
        ) : (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Evaluaciones guardadas</p>
                <h2 className="text-2xl font-bold text-slate-900">Base de datos</h2>
                <p className="mt-1 text-sm text-slate-500">Habilita solo las evaluaciones que el estudiante debe ver.</p>
              </div>
              <button className="rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white" type="button" onClick={() => setAdminMenu('crear')}>Nueva evaluación</button>
            </div>
            {message && <p className="mt-4 rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{message}</p>}
            <div className="mt-5 grid gap-4">
              {worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id).map((worksheet) => (
                <article key={worksheet.id} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${worksheet.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {worksheet.status === 'published' ? 'Habilitada' : 'Borrador'}
                      </span>
                      <h3 className="mt-3 text-lg font-bold text-slate-900">{worksheet.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">{worksheet.description}</p>
                      <p className="mt-2 text-xs text-slate-400">{worksheet.activities.length} actividades · ID: {worksheet.id}</p>
                    </div>
                    <button className="rounded-2xl border border-blue-200 px-4 py-2 font-semibold text-blue-700 transition hover:bg-blue-50" type="button" onClick={() => togglePublished(worksheet)}>
                      {worksheet.status === 'published' ? 'Deshabilitar' : 'Habilitar'}
                    </button>
                  </div>
                </article>
              ))}
              {!worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id).length && <p className="rounded-2xl bg-slate-50 p-5 text-slate-500">Aún no has guardado evaluaciones. Crea la primera desde el menú “Crear evaluación”.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
