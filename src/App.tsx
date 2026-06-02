import { useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, Check, GraduationCap, LockKeyhole, Send, Trash2, X } from 'lucide-react';
import { WorksheetEditor } from './components/WorksheetEditor';
import { WorksheetRenderer } from './components/WorksheetRenderer';
import { TeacherDashboard, type TeacherMenu } from './components/TeacherDashboard';
import { sampleWorksheet } from './data/sampleWorksheet';
import {
  archiveWorksheet,
  createStudent,
  createTeacher,
  createWorksheet,
  deleteStudent,
  deleteTeacher,
  deleteWorksheet,
  listStudentResponses,
  listStudents,
  listStudentWorksheets,
  listTeachers,
  listTeacherWorksheets,
  listWorksheetResponses,
  login,
  logout,
  getCurrentSession,
  publishWorksheet,
  reviewAnswer,
  submitResponse,
  type DetalleRespuesta,
  type RespuestaEstudiante,
  type UsuarioSesion,
} from './services/api';
import type { StudentAnswer, StudentAnswers, Worksheet, WorksheetActivity } from './types';
import './styles/app.css';


function statusBadge(status: DetalleRespuesta['status']) {
  if (status === 'correct') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'incorrect') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function LoginPanel({ onLogin }: { onLogin: (user: UsuarioSesion) => void }) {
  const [role, setRole] = useState<UsuarioSesion['role']>('student');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function handleLogin() {
    setMessage('');
    try {
      onLogin(await login(username, password, role));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión. Revisa que el backend esté activo.');
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto flex max-w-6xl justify-end">
        <button
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
          type="button"
          onClick={() => {
            setRole(role === 'teacher' ? 'student' : 'teacher');
            setUsername('');
            setPassword('');
            setMessage('');
          }}
        >
          {role === 'teacher' ? 'Entrar como estudiante' : 'Entrar como profesor'}
        </button>
      </div>
      <section className="mx-auto mt-8 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-bold uppercase tracking-[0.2em] text-blue-700"><GraduationCap size={18} /> Plataforma educativa</span>
          <h1 className="mt-6 text-5xl font-black uppercase tracking-tight text-slate-950 md:text-7xl">English Worksheet Platform</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">Un entorno profesional para asignar, resolver y revisar actividades de inglés de forma organizada.</p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-slate-200/70">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Acceso {role === 'teacher' ? 'docente' : 'estudiante'}</p>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-950">{role === 'teacher' ? 'Panel del profesor' : 'Portal del estudiante'}</h2>
          </div>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Usuario</span><input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="mt-4 block"><span className="text-sm font-semibold text-slate-700">Contraseña</span><input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700" type="button" onClick={handleLogin}><LockKeyhole size={18} /> Entrar</button>
          {message && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{message}</p>}
        </div>
      </section>
    </main>
  );
}

function ResponseDetails({ response }: { response: RespuestaEstudiante }) {
  return (
    <div className="mt-3 grid gap-2">
      {response.details.map((detail) => (
        <div key={detail.activity_id} className={`rounded-xl border p-3 text-sm ${statusBadge(detail.status)}`}>
          <div className="font-semibold">{detail.prompt}</div>
          <div>Respuesta: {JSON.stringify(detail.student_answer ?? '')}</div>
          {detail.correct_answer !== null && <div>Correcta: {JSON.stringify(detail.correct_answer)}</div>}
          {detail.teacher_comment && <div>Comentario: {detail.teacher_comment}</div>}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<UsuarioSesion | null>(() => getCurrentSession());
  const [adminMenu, setAdminMenu] = useState<TeacherMenu>('crear');
  const [worksheets, setWorksheets] = useState<Worksheet[]>([sampleWorksheet]);
  const [activeWorksheet, setActiveWorksheet] = useState<Worksheet>(sampleWorksheet);
  const [scriptDraft, setScriptDraft] = useState(sampleWorksheet.scriptContent);
  const [maxAttemptsDraft, setMaxAttemptsDraft] = useState('unlimited');
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [responses, setResponses] = useState<RespuestaEstudiante[]>([]);
  const [students, setStudents] = useState<UsuarioSesion[]>([]);
  const [teachers, setTeachers] = useState<UsuarioSesion[]>([]);
  const [studentForm, setStudentForm] = useState({ name: '', username: '', password: '' });
  const [teacherForm, setTeacherForm] = useState({ name: '', username: '', password: '', email: '' });
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string>(sampleWorksheet.activities[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const selectedActivity = useMemo(() => activeWorksheet.activities.find((activity) => activity.id === selectedActivityId), [activeWorksheet.activities, selectedActivityId]);

  useEffect(() => {
    if (!user) return;
    void refreshData(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function refreshData(currentUser = user) {
    if (!currentUser) return;
    try {
      if (currentUser.role !== 'student') {
        const [teacherWorksheets, allStudents, allTeachers] = await Promise.all([listTeacherWorksheets(currentUser.role === 'admin' ? undefined : currentUser.id), listStudents(), currentUser.role === 'admin' ? listTeachers() : Promise.resolve([])]);
        setWorksheets(teacherWorksheets.length ? teacherWorksheets : [sampleWorksheet]);
        setStudents(allStudents);
        setTeachers(allTeachers);
        if (teacherWorksheets[0]) {
          setActiveWorksheet(teacherWorksheets[0]);
          setScriptDraft(teacherWorksheets[0].scriptContent);
          setMaxAttemptsDraft(teacherWorksheets[0].maxAttempts ? String(teacherWorksheets[0].maxAttempts) : 'unlimited');
          setResponses(await listWorksheetResponses(teacherWorksheets[0].id));
        }
      } else {
        const [availableWorksheets, studentResponses] = await Promise.all([listStudentWorksheets(currentUser.id), listStudentResponses(currentUser.id)]);
        setWorksheets(availableWorksheets);
        setResponses(studentResponses);
        if (availableWorksheets[0]) setActiveWorksheet(availableWorksheets[0]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo conectar con el backend.');
    }
  }

  function updateAnswer(activityId: string, value: StudentAnswer) {
    setAnswers((current) => ({ ...current, [activityId]: value }));
  }

  async function saveScript() {
    if (!user) return;
    setIsSaving(true);
    setMessage('');
    try {
      const maxAttempts = maxAttemptsDraft === 'unlimited' ? null : Number(maxAttemptsDraft);
      const worksheet = await createWorksheet(scriptDraft, user.id, maxAttempts);
      setActiveWorksheet(worksheet);
      setWorksheets((current) => [worksheet, ...current.filter((item) => item.id !== sampleWorksheet.id)]);
      setSelectedActivityId(worksheet.activities[0]?.id ?? '');
      setAdminMenu('evaluaciones');
      setMessage('Evaluación guardada. Ahora puedes habilitarla.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la evaluación.');
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePublished(worksheet: Worksheet) {
    const updated = await publishWorksheet(worksheet.id, worksheet.status !== 'published');
    setWorksheets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActiveWorksheet(updated);
  }

  async function toggleArchived(worksheet: Worksheet) {
    const updated = await archiveWorksheet(worksheet.id, !worksheet.archived);
    setWorksheets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActiveWorksheet(updated);
    setMessage(updated.archived ? 'Evaluación archivada. Los estudiantes no podrán verla ni ver sus respuestas hasta que se desarchive.' : 'Evaluación desarchivada.');
  }

  async function removeWorksheet(worksheet: Worksheet) {
    if (!window.confirm(`¿Eliminar definitivamente "${worksheet.title}" y todas sus respuestas?`)) return;
    await deleteWorksheet(worksheet.id);
    setWorksheets((current) => {
      const remaining = current.filter((item) => item.id !== worksheet.id);
      if (activeWorksheet.id === worksheet.id) setActiveWorksheet(remaining[0] ?? sampleWorksheet);
      return remaining.length ? remaining : [sampleWorksheet];
    });
    setMessage('Evaluación eliminada permanentemente.');
  }

  async function sendAnswers() {
    if (!user) return;
    try {
      const response = await submitResponse(activeWorksheet, user, answers);
      setResponses((current) => [response, ...current]);
      setAnswers({});
      setMessage(`Respuestas enviadas. Puntuación: ${response.score ?? 'pendiente'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron enviar las respuestas.');
    }
  }

  async function createNewStudent() {
    try {
      const created = await createStudent(studentForm.name, studentForm.username, studentForm.password);
      setStudents((current) => [created, ...current]);
      setStudentForm({ name: '', username: '', password: '' });
      setMessage('Estudiante creado correctamente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear el estudiante.');
    }
  }

  async function createNewTeacher() {
    try {
      const created = await createTeacher(teacherForm.name, teacherForm.username, teacherForm.password, teacherForm.email);
      setTeachers((current) => [created, ...current]);
      setTeacherForm({ name: '', username: '', password: '', email: '' });
      setMessage('Profesor creado correctamente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear el profesor.');
    }
  }


  async function removeStudent(student: UsuarioSesion) {
    if (!window.confirm(`¿Eliminar definitivamente al estudiante "${student.name}"? Sus respuestas históricas conservarán el nombre, pero se desvincularán de su usuario.`)) return;
    try {
      await deleteStudent(student.id);
      setStudents((current) => current.filter((item) => item.id !== student.id));
      setMessage('Estudiante eliminado correctamente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el estudiante.');
    }
  }

  async function removeTeacher(teacher: UsuarioSesion) {
    if (!window.confirm(`¿Eliminar definitivamente al profesor "${teacher.name}"? Sus evaluaciones se reasignarán al administrador actual.`)) return;
    try {
      await deleteTeacher(teacher.id);
      setTeachers((current) => current.filter((item) => item.id !== teacher.id));
      setMessage('Profesor eliminado correctamente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el profesor.');
    }
  }

  async function loadWorksheetResponses(worksheet: Worksheet) {
    setActiveWorksheet(worksheet);
    setResponses(await listWorksheetResponses(worksheet.id));
    setAdminMenu('revision');
  }

  async function review(response: RespuestaEstudiante, detail: DetalleRespuesta, status: 'correct' | 'incorrect') {
    const key = `${response.id}-${detail.activity_id}`;
    const updated = await reviewAnswer(response.id, detail.activity_id, status, reviewComments[key] ?? '');
    setResponses((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  if (!user) return <LoginPanel onLogin={setUser} />;

  if (user.role === 'student') {
    const responseByWorksheet = responses.reduce((latestResponses, response) => {
      if (!latestResponses.has(response.worksheet_id)) latestResponses.set(response.worksheet_id, response);
      return latestResponses;
    }, new Map<string, RespuestaEstudiante>());
    const activeResponse = responseByWorksheet.get(activeWorksheet.id);
    const isActiveWorksheetPublished = activeWorksheet.status === 'published';

    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <nav className="border-b border-slate-200 bg-white/85"><div className="mx-auto flex max-w-7xl justify-between px-4 py-4"><div><h1 className="text-xl font-bold">Portal del estudiante</h1><p className="text-sm text-slate-500">Hola, {user.name} (@{user.username}).</p></div><button className="rounded-2xl border px-4 py-2" onClick={() => { logout(); setUser(null); }}>Cerrar sesión</button></div></nav>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="font-bold">Evaluaciones</h2>
            <div className="mt-4 grid gap-3">
              {worksheets.map((worksheet) => {
                const response = responseByWorksheet.get(worksheet.id);
                return <button key={worksheet.id} className={`rounded-2xl border p-4 text-left ${activeWorksheet.id === worksheet.id ? 'border-blue-500 bg-blue-50' : 'border-slate-100'}`} onClick={() => setActiveWorksheet(worksheet)}><BookOpen className="mb-2 text-blue-600" size={20} /><strong>{worksheet.title}</strong><p className="text-sm text-slate-500">{worksheet.description}</p><p className="mt-2 text-xs font-semibold">{response ? `Nota: ${response.score ?? 'pendiente'} · Aciertos: ${response.correct_count}` : 'Sin responder'}</p>{response && <ResponseDetails response={response} />}</button>;
              })}
              {!worksheets.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay evaluaciones habilitadas o respondidas.</p>}
            </div>
          </aside>
          <section>
            {worksheets.length > 0 && isActiveWorksheetPublished && <WorksheetRenderer worksheet={activeWorksheet} answers={answers} onAnswerChange={updateAnswer} />}
            {worksheets.length > 0 && !isActiveWorksheetPublished && (
              <div className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
                <h2 className="text-xl font-extrabold">Esta hoja de trabajo fue deshabilitada por tu profesor.</h2>
                <p className="mt-2 text-sm font-semibold">Ya no puedes ver ni volver a responder esta hoja, pero tus respuestas guardadas permanecen disponibles.</p>
                {activeResponse && (
                  <div className="mt-5 rounded-2xl bg-white/80 p-4 text-slate-700">
                    <p className="text-sm font-bold text-slate-900">Último intento enviado: {new Date(activeResponse.submitted_at).toLocaleString()}</p>
                    <p className="mt-1 text-sm font-semibold">Nota: {activeResponse.score ?? 'pendiente'} · Aciertos: {activeResponse.correct_count}</p>
                    <ResponseDetails response={activeResponse} />
                  </div>
                )}
              </div>
            )}
            {message && <p className="mx-auto mt-4 max-w-4xl rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{message}</p>}
            {worksheets.length > 0 && isActiveWorksheetPublished && <div className="mx-auto mt-6 flex max-w-4xl justify-end"><button className="rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-white" onClick={sendAnswers}><Send className="mr-2 inline" size={18} /> Enviar respuestas</button></div>}
          </section>
        </div>
      </main>
    );
  }

  const savedWorksheets = worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id && !worksheet.archived);
  const archivedWorksheets = worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id && worksheet.archived);
  const publishedCount = savedWorksheets.filter((worksheet) => worksheet.status === 'published').length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white/85"><div className="mx-auto max-w-7xl px-4 py-4"><h1 className="text-xl font-bold">Panel del profesor</h1><p className="text-sm text-slate-500">Crea estudiantes, guarda evaluaciones, limita intentos y revisa respuestas.</p></div></nav>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
        <TeacherDashboard user={user} totalWorksheets={savedWorksheets.length} publishedCount={publishedCount} selectedMenu={adminMenu} onSelectMenu={setAdminMenu} onLogout={() => { logout(); setUser(null); }} />
        {adminMenu === 'crear' && <WorksheetEditor worksheet={activeWorksheet} selectedActivity={selectedActivity} scriptDraft={scriptDraft} maxAttemptsDraft={maxAttemptsDraft} isSaving={isSaving} message={message} onAddActivity={(activity: WorksheetActivity) => { setActiveWorksheet((current) => ({ ...current, activities: [...current.activities, activity] })); setSelectedActivityId(activity.id); }} onScriptChange={setScriptDraft} onMaxAttemptsChange={setMaxAttemptsDraft} onSaveScript={saveScript} />}
        {adminMenu === 'estudiantes' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-bold">Crear estudiante</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input className="rounded-2xl border p-3" placeholder="Nombre" value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Usuario" value={studentForm.username} onChange={(e) => setStudentForm({ ...studentForm, username: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Contraseña" value={studentForm.password} onChange={(e) => setStudentForm({ ...studentForm, password: e.target.value })} />
            </div>
            <button className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white" onClick={createNewStudent}>Guardar estudiante</button>
            {message && <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-blue-700">{message}</p>}
            <h3 className="mt-6 font-bold">Estudiantes</h3>
            <div className="mt-3 grid gap-2">
              {students.map((student) => (
                <div key={student.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                  <span>{student.name} · @{student.username}</span>
                  <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" type="button" onClick={() => removeStudent(student)}><Trash2 className="mr-1 inline" size={15} /> Eliminar</button>
                </div>
              ))}
            </div>
          </section>
        )}
        {adminMenu === 'evaluaciones' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Evaluaciones guardadas</p>
                <h2 className="text-2xl font-bold">Base de datos</h2>
              </div>
              <button className="rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white" onClick={() => setAdminMenu('crear')}>Nueva evaluación</button>
            </div>
            {message && <p className="mt-4 rounded-2xl bg-blue-50 p-3 text-blue-700">{message}</p>}
            <div className="mt-5 grid gap-4">
              {savedWorksheets.map((worksheet) => (
                <article key={worksheet.id} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${worksheet.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{worksheet.status === 'published' ? 'Habilitada' : 'Borrador'}</span>
                      <h3 className="mt-3 text-lg font-bold">{worksheet.title}</h3>
                      <p className="text-sm text-slate-500">{worksheet.description}</p>
                      <p className="mt-2 text-xs text-slate-400">Intentos: {worksheet.maxAttempts ?? 'Ilimitada'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-2xl border border-blue-200 px-4 py-2 font-semibold text-blue-700" onClick={() => togglePublished(worksheet)}>{worksheet.status === 'published' ? 'Deshabilitar' : 'Habilitar'}</button>
                      <button className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold" onClick={() => loadWorksheetResponses(worksheet)}>Ver respuestas</button>
                      <button className="rounded-2xl border border-amber-200 px-4 py-2 font-semibold text-amber-700" onClick={() => toggleArchived(worksheet)}><Archive className="mr-1 inline" size={16} /> Archivar</button>
                      <button className="rounded-2xl border border-red-200 px-4 py-2 font-semibold text-red-600" onClick={() => removeWorksheet(worksheet)}><Trash2 className="mr-1 inline" size={16} /> Borrar</button>
                    </div>
                  </div>
                </article>
              ))}
              {!savedWorksheets.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No hay evaluaciones activas en el menú.</p>}
            </div>
            <div className="mt-8 border-t border-slate-100 pt-5">
              <h3 className="text-lg font-bold">Archivadas</h3>
              <p className="text-sm text-slate-500">Las hojas archivadas quedan almacenadas, pero los estudiantes no pueden verlas ni ver sus respuestas hasta desarchivarlas.</p>
              <div className="mt-4 grid gap-3">
                {archivedWorksheets.map((worksheet) => (
                  <article key={worksheet.id} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Archivada</span>
                        <h4 className="mt-3 font-bold">{worksheet.title}</h4>
                        <p className="text-sm text-slate-500">{worksheet.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button className="rounded-2xl border border-amber-200 bg-white px-4 py-2 font-semibold text-amber-700" onClick={() => toggleArchived(worksheet)}>Desarchivar</button>
                        <button className="rounded-2xl border border-red-200 bg-white px-4 py-2 font-semibold text-red-600" onClick={() => removeWorksheet(worksheet)}><Trash2 className="mr-1 inline" size={16} /> Borrar</button>
                      </div>
                    </div>
                  </article>
                ))}
                {!archivedWorksheets.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay evaluaciones archivadas.</p>}
              </div>
            </div>
          </section>
        )}
        {user.role === 'admin' && adminMenu === 'profesores' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-bold">Crear profesor</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <input className="rounded-2xl border p-3" placeholder="Nombre" value={teacherForm.name} onChange={(e) => setTeacherForm({ ...teacherForm, name: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Usuario" value={teacherForm.username} onChange={(e) => setTeacherForm({ ...teacherForm, username: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Contraseña" value={teacherForm.password} onChange={(e) => setTeacherForm({ ...teacherForm, password: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Correo opcional" value={teacherForm.email} onChange={(e) => setTeacherForm({ ...teacherForm, email: e.target.value })} />
            </div>
            <button className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white" onClick={createNewTeacher}>Guardar profesor</button>
            {message && <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-blue-700">{message}</p>}
            <h3 className="mt-6 font-bold">Profesores y administradores</h3>
            <div className="mt-3 grid gap-2">
              {teachers.map((teacher) => (
                <div key={teacher.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                  <span>{teacher.name} · @{teacher.username} · {teacher.role === 'admin' ? 'Admin' : 'Profesor'}</span>
                  {teacher.role === 'teacher' && <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" type="button" onClick={() => removeTeacher(teacher)}><Trash2 className="mr-1 inline" size={15} /> Eliminar</button>}
                </div>
              ))}
            </div>
          </section>
        )}
        {adminMenu === 'revision' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-bold">Revisión de {activeWorksheet.title}</h2>
            <p className="text-sm text-slate-500">Nombre, fecha, puntuación, aciertos y pendientes permanecen guardados aunque la evaluación se deshabilite. Las respuestas incorrectas de fill in the blank se pueden corregir manualmente por errores de escritura.</p>
            <div className="mt-5 grid gap-4">
              {responses.map((response) => (
                <article key={response.id} className="rounded-2xl border p-4">
                  <h3 className="font-bold">{response.student_name}</h3>
                  <p className="text-sm text-slate-500">Fecha: {new Date(response.submitted_at).toLocaleString()} · Puntuación: {response.score ?? 'pendiente'} · Aciertos: {response.correct_count} · Pendientes: {response.pending_count}</p>
                  {response.details.map((detail) => {
                    const key = `${response.id}-${detail.activity_id}`;
                    const canReview = detail.status === 'pending' || (detail.activity_type === 'fillblank' && detail.status === 'incorrect');
                    return (
                      <div key={detail.activity_id} className={`mt-3 rounded-xl border p-3 ${statusBadge(detail.status)}`}>
                        <strong>{detail.prompt}</strong>
                        <p>Respuesta: {JSON.stringify(detail.student_answer ?? '')}</p>
                        {detail.correct_answer !== null && <p>Correcta: {JSON.stringify(detail.correct_answer)}</p>}
                        {canReview && (
                          <div className="mt-2 grid gap-2">
                            <textarea className="rounded-xl border p-2" placeholder="Comentario opcional para el estudiante" value={reviewComments[key] ?? ''} onChange={(e) => setReviewComments({ ...reviewComments, [key]: e.target.value })} />
                            <div className="flex gap-2">
                              <button className="rounded-xl bg-emerald-600 px-3 py-2 text-white" type="button" onClick={() => review(response, detail, 'correct')}><Check size={16} /></button>
                              <button className="rounded-xl bg-red-600 px-3 py-2 text-white" type="button" onClick={() => review(response, detail, 'incorrect')}><X size={16} /></button>
                            </div>
                          </div>
                        )}
                        {detail.teacher_comment && <p>Comentario: {detail.teacher_comment}</p>}
                      </div>
                    );
                  })}
                </article>
              ))}
              {!responses.length && <p className="rounded-2xl bg-slate-50 p-5">Esta evaluación aún no tiene respuestas.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
