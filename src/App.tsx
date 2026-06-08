import { useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, Check, GraduationCap, LockKeyhole, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { WorksheetEditor } from './components/WorksheetEditor';
import { WorksheetRenderer } from './components/WorksheetRenderer';
import { RichText } from './components/RichText';
import { TeacherDashboard, type TeacherMenu } from './components/TeacherDashboard';
import { sampleWorksheet } from './data/sampleWorksheet';
import {
  archiveWorksheet,
  assignStudentToClassroom,
  assignWorksheetToClassroom,
  changePassword,
  createClassroom,
  createStudent,
  createTeacher,
  createWorksheet,
  deleteStudent,
  deleteTeacher,
  deleteWorksheet,
  deleteResponse,
  listClassrooms,
  listStudentClassrooms,
  listStudentResponses,
  listStudents,
  listStudentWorksheets,
  listTeachers,
  listTeacherWorksheets,
  listWorksheetClassrooms,
  listWorksheetResponses,
  login,
  logout,
  getClassroom,
  getCurrentSession,
  getTeacherDashboard,
  publishWorksheet,
  reviewAnswer,
  submitResponse,
  unassignStudentFromClassroom,
  unassignWorksheetFromClassroom,
  type Classroom,
  type ClassroomDetail,
  type DetalleRespuesta,
  type RespuestaEstudiante,
  type TeacherStats,
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
          <div className="font-semibold"><RichText text={detail.prompt} /></div>
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
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [activeClassroomId, setActiveClassroomId] = useState('');
  const [classroomDetail, setClassroomDetail] = useState<ClassroomDetail | null>(null);
  const [classroomName, setClassroomName] = useState('');
  const [studentClassroomSelection, setStudentClassroomSelection] = useState<Record<string, string>>({});
  const [assignmentWorksheet, setAssignmentWorksheet] = useState<Worksheet | null>(null);
  const [selectedAssignmentClassrooms, setSelectedAssignmentClassrooms] = useState<string[]>([]);
  const [teacherStats, setTeacherStats] = useState<TeacherStats | null>(null);
  const [worksheetClassrooms, setWorksheetClassrooms] = useState<Record<string, Classroom[]>>({});
  const [studentForm, setStudentForm] = useState({ name: '', username: '', password: '' });
  const [teacherForm, setTeacherForm] = useState({ name: '', username: '', password: '', email: '' });
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string>(sampleWorksheet.activities[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewWorksheet, setPreviewWorksheet] = useState<Worksheet | null>(null);
  const [refreshCooldowns, setRefreshCooldowns] = useState<Set<string>>(new Set());
  const [studentTab, setStudentTab] = useState<'activas' | 'calificadas' | 'perfil'>('activas');
  const [studentClassrooms, setStudentClassrooms] = useState<Classroom[]>([]);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordMsg, setPasswordMsg] = useState('');

  function withCooldown(key: string, fn: () => void) {
    if (refreshCooldowns.has(key)) return;
    fn();
    setRefreshCooldowns((prev) => new Set([...prev, key]));
    setTimeout(() => setRefreshCooldowns((prev) => { const next = new Set(prev); next.delete(key); return next; }), 3000);
  }

  const selectedActivity = useMemo(() => activeWorksheet.activities.find((activity) => activity.id === selectedActivityId), [activeWorksheet.activities, selectedActivityId]);

  useEffect(() => {
    if (!user) return;
    void refreshData(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user || user.role === 'student' || !activeClassroomId) return;
    void refreshClassroomDetail(activeClassroomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClassroomId, user?.id]);

  async function refreshData(currentUser = user) {
    if (!currentUser) return;
    try {
      if (currentUser.role !== 'student') {
        const [teacherWorksheets, allStudents, allTeachers, teacherClassrooms, dashboardStats] = await Promise.all([listTeacherWorksheets(currentUser.role === 'admin' ? undefined : currentUser.id), listStudents(), currentUser.role === 'admin' ? listTeachers() : Promise.resolve([]), listClassrooms(), getTeacherDashboard()]);
        setWorksheets(teacherWorksheets.length ? teacherWorksheets : [sampleWorksheet]);
        setStudents(allStudents);
        setTeachers(allTeachers);
        setClassrooms(teacherClassrooms);
        setTeacherStats(dashboardStats);
        const classroomAssignments = await Promise.all(teacherWorksheets.map(async (worksheet) => [worksheet.id, await listWorksheetClassrooms(worksheet.id)] as const));
        setWorksheetClassrooms(Object.fromEntries(classroomAssignments));
        if (!activeClassroomId && teacherClassrooms[0]) setActiveClassroomId(teacherClassrooms[0].id);
        if (teacherWorksheets[0]) {
          setActiveWorksheet(teacherWorksheets[0]);
          setScriptDraft(teacherWorksheets[0].scriptContent);
          setMaxAttemptsDraft(teacherWorksheets[0].maxAttempts ? String(teacherWorksheets[0].maxAttempts) : 'unlimited');
          setResponses(await listWorksheetResponses(teacherWorksheets[0].id));
        }
      } else {
        const [availableWorksheets, studentResponses, myClassrooms] = await Promise.all([listStudentWorksheets(currentUser.id), listStudentResponses(currentUser.id), listStudentClassrooms(currentUser.id)]);
        setWorksheets(availableWorksheets);
        setResponses(studentResponses);
        setStudentClassrooms(myClassrooms);
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
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await submitResponse(activeWorksheet, user, answers);
      setResponses((current) => [response, ...current]);
      setAnswers({});
      setMessage(`Respuestas enviadas. Puntuación: ${response.score ?? 'pendiente'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron enviar las respuestas.');
    } finally {
      setIsSubmitting(false);
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

  async function removeResponse(response: RespuestaEstudiante) {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar la respuesta de ${response.student_name}? Esta acción no se puede deshacer`)) return;
    await deleteResponse(response.id);
    setResponses((current) => current.filter((item) => item.id !== response.id));
    setMessage('Respuesta eliminada. El estudiante podrá volver a enviar si tiene intentos disponibles.');
  }

  async function review(response: RespuestaEstudiante, detail: DetalleRespuesta, status: 'correct' | 'incorrect') {
    const key = `${response.id}-${detail.activity_id}`;
    const updated = await reviewAnswer(response.id, detail.activity_id, status, reviewComments[key] ?? '');
    setResponses((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }



  async function refreshClassroomDetail(classroomId = activeClassroomId) {
    if (!classroomId) {
      setClassroomDetail(null);
      return;
    }
    const detail = await getClassroom(classroomId);
    setClassroomDetail(detail);
    setActiveClassroomId(classroomId);
  }

  async function createNewClassroom() {
    if (!classroomName.trim()) return;
    const created = await createClassroom(classroomName.trim());
    setClassrooms((current) => [...current, created]);
    setClassroomName('');
    await refreshClassroomDetail(created.id);
    setMessage('Aula creada correctamente.');
  }

  async function assignStudentFromClassroom(studentId: string, classroomId = activeClassroomId) {
    if (!classroomId) return;
    await assignStudentToClassroom(classroomId, studentId);
    await refreshClassroomDetail(classroomId);
    setMessage('Estudiante asignado al aula.');
  }

  async function unassignStudentFromActiveClassroom(studentId: string) {
    if (!activeClassroomId) return;
    await unassignStudentFromClassroom(activeClassroomId, studentId);
    await refreshClassroomDetail(activeClassroomId);
    setMessage('Estudiante desasignado del aula.');
  }

  async function openAssignWorksheetModal(worksheet: Worksheet) {
    setAssignmentWorksheet(worksheet);
    const assignedClassrooms = await listWorksheetClassrooms(worksheet.id);
    setSelectedAssignmentClassrooms(assignedClassrooms.map((classroom) => classroom.id));
  }

  async function saveWorksheetClassroomAssignments() {
    if (!assignmentWorksheet) return;
    const selected = new Set(selectedAssignmentClassrooms);
    // Only call assign/unassign for classrooms whose state actually changed
    const previouslyAssigned = new Set((worksheetClassrooms[assignmentWorksheet.id] ?? []).map((c) => c.id));
    const toAssign = classrooms.filter((c) => selected.has(c.id) && !previouslyAssigned.has(c.id));
    const toUnassign = classrooms.filter((c) => !selected.has(c.id) && previouslyAssigned.has(c.id));
    await Promise.all([
      ...toAssign.map((c) => assignWorksheetToClassroom(c.id, assignmentWorksheet.id)),
      ...toUnassign.map((c) => unassignWorksheetFromClassroom(c.id, assignmentWorksheet.id)),
    ]);
    const updatedClassrooms = classrooms.filter((c) => selected.has(c.id));
    setWorksheetClassrooms((current) => ({ ...current, [assignmentWorksheet.id]: updatedClassrooms }));
    // Only refresh detail if active classroom was actually affected
    if (activeClassroomId && (toAssign.some((c) => c.id === activeClassroomId) || toUnassign.some((c) => c.id === activeClassroomId))) {
      await refreshClassroomDetail(activeClassroomId);
    }
    setAssignmentWorksheet(null);
    setMessage('Asignaciones de aula actualizadas.');
  }

  if (!user) return <LoginPanel onLogin={setUser} />;

  if (user.role === 'student') {
    const responseByWorksheet = responses.reduce((latestResponses, response) => {
      if (!latestResponses.has(response.worksheet_id)) latestResponses.set(response.worksheet_id, response);
      return latestResponses;
    }, new Map<string, RespuestaEstudiante>());

    const activeWorksheets = worksheets.filter((w) => w.status === 'published');
    const gradedWorksheets = worksheets.filter((w) => responseByWorksheet.has(w.id));

    const activeResponse = responseByWorksheet.get(activeWorksheet.id);
    const isActiveWorksheetPublished = activeWorksheet.status === 'published';

    async function handleChangePassword() {
      if (!user) return;
      if (passwordForm.next !== passwordForm.confirm) { setPasswordMsg('Las contraseñas nuevas no coinciden.'); return; }
      if (!passwordForm.next) { setPasswordMsg('La nueva contraseña no puede estar vacía.'); return; }
      try {
        await changePassword(user.id, passwordForm.next, passwordForm.current || undefined);
        setPasswordMsg('Contraseña actualizada correctamente.');
        setPasswordForm({ current: '', next: '', confirm: '' });
      } catch (err) {
        setPasswordMsg(err instanceof Error ? err.message : 'Error al cambiar contraseña.');
      }
    }

    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        {/* Navbar */}
        <nav className="border-b border-slate-200 bg-white/85">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div>
              <h1 className="text-xl font-bold">Portal del estudiante</h1>
              <p className="text-sm text-slate-500">Hola, {user.name} (@{user.username})</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Tabs en navbar */}
              <div className="hidden sm:flex rounded-2xl border border-slate-200 bg-slate-50 p-1 gap-1">
                {(['activas', 'calificadas', 'perfil'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={`rounded-xl px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${studentTab === tab ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => setStudentTab(tab)}
                  >
                    {tab === 'activas' ? 'Activas' : tab === 'calificadas' ? 'Calificadas' : 'Mi Perfil'}
                  </button>
                ))}
              </div>
              <button className="rounded-2xl border px-4 py-2 text-sm" onClick={() => { logout(); setUser(null); }}>Cerrar sesión</button>
            </div>
          </div>
          {/* Tabs móvil */}
          <div className="flex sm:hidden border-t border-slate-100">
            {(['activas', 'calificadas', 'perfil'] as const).map((tab) => (
              <button
                key={tab}
                className={`flex-1 py-2 text-sm font-semibold capitalize transition-colors ${studentTab === tab ? 'border-b-2 border-blue-500 text-blue-600' : 'text-slate-500'}`}
                onClick={() => setStudentTab(tab)}
              >
                {tab === 'activas' ? 'Activas' : tab === 'calificadas' ? 'Calificadas' : 'Mi Perfil'}
              </button>
            ))}
          </div>
        </nav>

        {/* ── PESTAÑA ACTIVAS ── */}
        {studentTab === 'activas' && (
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
            <aside className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">Evaluaciones activas</h2>
                <button className={`rounded-full p-2 transition-colors ${refreshCooldowns.has('student-refresh') ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-100'}`} type="button" title="Actualizar" disabled={refreshCooldowns.has('student-refresh')} onClick={() => withCooldown('student-refresh', () => refreshData(user))}><RefreshCw size={16} /></button>
              </div>
              <div className="mt-4 grid gap-3">
                {activeWorksheets.map((worksheet) => {
                  const response = responseByWorksheet.get(worksheet.id);
                  return (
                    <button key={worksheet.id} className={`rounded-2xl border p-4 text-left transition-colors ${activeWorksheet.id === worksheet.id ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`} onClick={() => setActiveWorksheet(worksheet)}>
                      <BookOpen className="mb-2 text-blue-600" size={20} />
                      <strong className="block">{worksheet.title}</strong>
                      <p className="text-sm text-slate-500">{worksheet.description}</p>
                      <p className="mt-2 text-xs font-semibold">{response ? `Nota: ${response.score ?? 'pendiente'} · Aciertos: ${response.correct_count}` : 'Sin responder'}</p>
                    </button>
                  );
                })}
                {!activeWorksheets.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay evaluaciones activas en este momento.</p>}
              </div>
            </aside>
            <section>
              {activeWorksheets.length > 0 && isActiveWorksheetPublished && <WorksheetRenderer worksheet={activeWorksheet} answers={answers} onAnswerChange={updateAnswer} />}
              {activeWorksheets.length > 0 && !isActiveWorksheetPublished && (
                <div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-800 shadow-sm">
                  <h2 className="text-xl font-extrabold">Selecciona una evaluación activa de la lista.</h2>
                </div>
              )}
              {message && <p className="mx-auto mt-4 max-w-4xl rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{message}</p>}
              {activeWorksheets.length > 0 && isActiveWorksheetPublished && (
                <div className="mx-auto mt-6 flex max-w-4xl justify-end">
                  <button className="rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-white disabled:opacity-60" disabled={isSubmitting} onClick={sendAnswers}>
                    <Send className="mr-2 inline" size={18} /> {isSubmitting ? 'Enviando...' : 'Enviar respuestas'}
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── PESTAÑA CALIFICADAS ── */}
        {studentTab === 'calificadas' && (
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
            <aside className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="font-bold">Evaluaciones calificadas</h2>
              <div className="mt-4 grid gap-3">
                {gradedWorksheets.map((worksheet) => {
                  const response = responseByWorksheet.get(worksheet.id)!;
                  return (
                    <button key={worksheet.id} className={`rounded-2xl border p-4 text-left transition-colors ${activeWorksheet.id === worksheet.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 hover:border-slate-300'}`} onClick={() => setActiveWorksheet(worksheet)}>
                      <Check className="mb-2 text-emerald-600" size={20} />
                      <strong className="block">{worksheet.title}</strong>
                      <p className="mt-1 text-xs font-semibold text-slate-600">Nota: {response.score ?? 'pendiente'} · Aciertos: {response.correct_count} · Pendientes: {response.pending_count}</p>
                      <p className="text-xs text-slate-400">{new Date(response.submitted_at).toLocaleDateString()}</p>
                    </button>
                  );
                })}
                {!gradedWorksheets.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Aún no has entregado ninguna evaluación.</p>}
              </div>
            </aside>
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              {(() => {
                const resp = responseByWorksheet.get(activeWorksheet.id);
                if (!resp) return <p className="text-sm text-slate-500">Selecciona una evaluación para ver tu resultado.</p>;
                return (
                  <>
                    <h2 className="text-xl font-bold">{activeWorksheet.title}</h2>
                    <p className="mt-1 text-sm text-slate-500">Entregado: {new Date(resp.submitted_at).toLocaleString()}</p>
                    <div className="mt-3 flex gap-4 text-sm font-semibold">
                      <span className="rounded-xl bg-emerald-50 px-3 py-1 text-emerald-700">Aciertos: {resp.correct_count}</span>
                      <span className="rounded-xl bg-red-50 px-3 py-1 text-red-700">Pendientes: {resp.pending_count}</span>
                      {resp.score !== null && <span className="rounded-xl bg-blue-50 px-3 py-1 text-blue-700">Nota: {resp.score}</span>}
                    </div>
                    <div className="mt-5">
                      {activeWorksheet.status !== 'published' && (
                        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 font-semibold">
                          Esta hoja fue deshabilitada por tu profesor — ya no puedes volver a responderla.
                        </div>
                      )}
                      <ResponseDetails response={resp} />
                    </div>
                  </>
                );
              })()}
            </section>
          </div>
        )}

        {/* ── PESTAÑA MI PERFIL ── */}
        {studentTab === 'perfil' && (
          <div className="mx-auto max-w-3xl px-4 py-8 grid gap-6">
            {/* Info personal */}
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">Mi información</h2>
              <div className="mt-4 grid gap-2 text-sm">
                <div className="flex gap-3"><span className="w-28 font-semibold text-slate-500">Nombre</span><span>{user.name}</span></div>
                <div className="flex gap-3"><span className="w-28 font-semibold text-slate-500">Usuario</span><span>@{user.username}</span></div>
                {user.email && <div className="flex gap-3"><span className="w-28 font-semibold text-slate-500">Email</span><span>{user.email}</span></div>}
              </div>
            </section>

            {/* Aulas */}
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">Mis aulas</h2>
              {studentClassrooms.length > 0
                ? <ul className="mt-3 grid gap-2">{studentClassrooms.map((c) => <li key={c.id} className="rounded-2xl border border-slate-100 px-4 py-3 text-sm font-semibold">{c.name}</li>)}</ul>
                : <p className="mt-3 text-sm text-slate-500">No estás asignado a ningún aula todavía.</p>}
            </section>

            {/* Historial */}
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">Historial de evaluaciones</h2>
              {responses.length > 0
                ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-left text-slate-500"><th className="pb-2 pr-4 font-semibold">Evaluación</th><th className="pb-2 pr-4 font-semibold">Fecha</th><th className="pb-2 pr-4 font-semibold">Nota</th><th className="pb-2 font-semibold">Aciertos</th></tr></thead>
                      <tbody>
                        {responses.map((resp) => {
                          const ws = worksheets.find((w) => w.id === resp.worksheet_id);
                          return (
                            <tr key={resp.id} className="border-b last:border-0">
                              <td className="py-2 pr-4 font-semibold">{ws?.title ?? resp.worksheet_id}</td>
                              <td className="py-2 pr-4 text-slate-500">{new Date(resp.submitted_at).toLocaleDateString()}</td>
                              <td className="py-2 pr-4">{resp.score ?? <span className="text-amber-600 font-semibold">Pendiente</span>}</td>
                              <td className="py-2 text-emerald-700 font-semibold">{resp.correct_count}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
                : <p className="mt-3 text-sm text-slate-500">Aún no has entregado ninguna evaluación.</p>}
            </section>

            {/* Cambiar contraseña */}
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">Cambiar contraseña</h2>
              <div className="mt-4 grid gap-3 max-w-sm">
                <input className="rounded-2xl border p-3 text-sm" type="password" placeholder="Contraseña actual" value={passwordForm.current} onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))} />
                <input className="rounded-2xl border p-3 text-sm" type="password" placeholder="Nueva contraseña" value={passwordForm.next} onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))} />
                <input className="rounded-2xl border p-3 text-sm" type="password" placeholder="Confirmar nueva contraseña" value={passwordForm.confirm} onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))} />
                {passwordMsg && <p className={`rounded-2xl p-3 text-sm font-semibold ${passwordMsg.includes('correctamente') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{passwordMsg}</p>}
                <button className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700" onClick={handleChangePassword}>
                  <LockKeyhole className="mr-2 inline" size={16} /> Actualizar contraseña
                </button>
              </div>
            </section>
          </div>
        )}
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
        {adminMenu === 'dashboard' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Dashboard</p>
            <h2 className="text-2xl font-bold">Resumen del profesor</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-blue-50 p-5"><p className="text-sm text-blue-700">Total de estudiantes</p><strong className="text-4xl">{teacherStats?.total_students ?? students.length}</strong></div>
              <div className="rounded-2xl bg-emerald-50 p-5"><p className="text-sm text-emerald-700">Hojas activas</p><strong className="text-4xl">{teacherStats?.active_worksheets ?? publishedCount}</strong></div>
            </div>
            <div className="mt-6 grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border p-4">
                <h3 className="font-bold">Promedio de notas por hoja</h3>
                <div className="mt-4 grid gap-3">
                  {(teacherStats?.avg_scores ?? []).map((item) => (
                    <div key={item.worksheet_title}>
                      <div className="mb-1 flex justify-between text-sm"><span>{item.worksheet_title}</span><strong>{item.average_score}%</strong></div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, item.average_score)}%` }} /></div>
                    </div>
                  ))}
                  {!(teacherStats?.avg_scores?.length) && <p className="text-sm text-slate-500">Aún no hay notas para graficar.</p>}
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <h3 className="font-bold">Aciertos vs desaciertos</h3>
                {(() => {
                  const correct = teacherStats?.total_correct ?? 0;
                  const incorrect = teacherStats?.total_incorrect ?? 0;
                  const total = correct + incorrect;
                  const correctPct = total ? Math.round((correct / total) * 100) : 0;
                  return <div className="mt-4 flex items-center gap-5"><div className="h-32 w-32 rounded-full" style={{ background: `conic-gradient(#10b981 0 ${correctPct}%, #ef4444 ${correctPct}% 100%)` }} /><div className="grid gap-2 text-sm"><span className="font-semibold text-emerald-700">Aciertos: {correct}</span><span className="font-semibold text-red-600">Desaciertos: {incorrect}</span></div></div>;
                })()}
              </div>
              <div className="rounded-2xl border p-4 xl:col-span-2">
                <h3 className="font-bold">Alumnos por aula</h3>
                <div className="mt-4 grid gap-3">
                  {(teacherStats?.students_per_classroom ?? []).map((item) => (
                    <div key={item.classroom_name}>
                      <div className="mb-1 flex justify-between text-sm"><span>{item.classroom_name}</span><strong>{item.student_count}</strong></div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, item.student_count * 10)}%` }} /></div>
                    </div>
                  ))}
                  {!(teacherStats?.students_per_classroom?.length) && <p className="text-sm text-slate-500">Crea aulas para ver esta gráfica.</p>}
                </div>
              </div>
            </div>
          </section>
        )}
        {adminMenu === 'aulas' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Aulas</p><h2 className="text-2xl font-bold">Gestión de aulas</h2></div>
              <div className="flex gap-2"><input className="rounded-2xl border p-3" placeholder="Nombre del aula" value={classroomName} onChange={(e) => setClassroomName(e.target.value)} /><button className="rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white" onClick={createNewClassroom}>Crear aula</button></div>
            </div>
            {message && <p className="mt-4 rounded-2xl bg-blue-50 p-3 text-blue-700">{message}</p>}
            <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
              <aside className="grid content-start gap-2">
                {classrooms.map((classroom) => <button key={classroom.id} className={`rounded-2xl border p-3 text-left font-semibold ${activeClassroomId === classroom.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100'}`} onClick={() => setActiveClassroomId(classroom.id)}>{classroom.name}</button>)}
                {!classrooms.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay aulas creadas.</p>}
              </aside>
              <div className="rounded-2xl border border-slate-100 p-4">
                {classroomDetail ? (
                  <div className="grid gap-6">
                    <div><h3 className="text-xl font-bold">{classroomDetail.name}</h3><p className="text-sm text-slate-500">Estudiantes y hojas asignadas a esta aula.</p></div>
                    <div>
                      <h4 className="font-bold">Estudiantes asignados</h4>
                      <div className="mt-3 grid gap-2">
                        {classroomDetail.students.map((student) => <div key={student.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><span>{student.name} · @{student.username}</span><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{classroomDetail.student_statuses[student.id]}</span><button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" onClick={() => unassignStudentFromActiveClassroom(student.id)}>Desasignar</button></div>)}
                        {!classroomDetail.students.length && <p className="text-sm text-slate-500">Sin estudiantes asignados.</p>}
                      </div>
                      <h5 className="mt-4 text-sm font-bold">Asignar estudiante</h5>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {students.filter((student) => !classroomDetail.students.some((assigned) => assigned.id === student.id)).map((student) => <button key={student.id} className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700" onClick={() => assignStudentFromClassroom(student.id)}>{student.name}</button>)}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold">Hojas asignadas</h4>
                      <div className="mt-3 grid gap-2">
                        {classroomDetail.worksheets.map((worksheet) => <div key={worksheet.id} className="rounded-xl bg-slate-50 p-3"><strong>{worksheet.title}</strong><p className="text-sm text-slate-500">{worksheet.description}</p></div>)}
                        {!classroomDetail.worksheets.length && <p className="text-sm text-slate-500">Sin hojas asignadas.</p>}
                      </div>
                    </div>
                  </div>
                ) : <p className="text-sm text-slate-500">Selecciona o crea un aula para ver el detalle.</p>}
              </div>
            </div>
          </section>
        )}
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
                  <div className="flex flex-wrap gap-2">
                    <select className="rounded-xl border bg-white px-3 py-2 text-sm" value={studentClassroomSelection[student.id] ?? ''} onChange={(e) => setStudentClassroomSelection((current) => ({ ...current, [student.id]: e.target.value }))}>
                      <option value="">Asignar a aula...</option>
                      {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
                    </select>
                    <button className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700" type="button" onClick={() => assignStudentFromClassroom(student.id, studentClassroomSelection[student.id])}>Asignar</button>
                    <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" type="button" onClick={() => removeStudent(student)}><Trash2 className="mr-1 inline" size={15} /> Eliminar</button>
                  </div>
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
                      <p className="mt-1 text-xs font-semibold text-emerald-700">Aulas: {worksheetClassrooms[worksheet.id]?.map((classroom) => classroom.name).join(', ') || 'Sin asignar'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-2xl border border-blue-200 px-4 py-2 font-semibold text-blue-700" onClick={() => togglePublished(worksheet)}>{worksheet.status === 'published' ? 'Deshabilitar' : 'Habilitar'}</button>
                      <button className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold" onClick={() => loadWorksheetResponses(worksheet)}>Ver respuestas</button><button className="rounded-2xl border border-indigo-200 px-4 py-2 font-semibold text-indigo-700" onClick={() => setPreviewWorksheet(worksheet)}>Vista previa</button><button className="rounded-2xl border border-emerald-200 px-4 py-2 font-semibold text-emerald-700" onClick={() => openAssignWorksheetModal(worksheet)}>Asignar a aula</button>
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
            <div className="flex items-start justify-between gap-3"><h2 className="text-2xl font-bold">Revisión de {activeWorksheet.title}</h2><button className={`rounded-full p-2 transition-colors ${refreshCooldowns.has('responses-refresh') ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-100'}`} type="button" title="Actualizar" disabled={refreshCooldowns.has('responses-refresh')} onClick={() => withCooldown('responses-refresh', () => loadWorksheetResponses(activeWorksheet))}><RefreshCw size={16} /></button></div>
            <p className="text-sm text-slate-500">Nombre, fecha, puntuación, aciertos y pendientes permanecen guardados aunque la evaluación se deshabilite. Las respuestas incorrectas de fill in the blank se pueden corregir manualmente por errores de escritura.</p>
            <div className="mt-5 grid gap-4">
              {responses.map((response) => (
                <article key={response.id} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3"><h3 className="font-bold">{response.student_name}</h3><button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" type="button" onClick={() => removeResponse(response)}>Eliminar respuesta</button></div>
                  <p className="text-sm text-slate-500">Fecha: {new Date(response.submitted_at).toLocaleString()} · Puntuación: {response.score ?? 'pendiente'} · Aciertos: {response.correct_count} · Pendientes: {response.pending_count}</p>
                  {response.details.map((detail) => {
                    const key = `${response.id}-${detail.activity_id}`;
                    const canReview = detail.status === 'pending' || detail.activity_type === 'fillblank' || detail.activity_type === 'listeningfillblank';
                    return (
                      <div key={detail.activity_id} className={`mt-3 rounded-xl border p-3 ${statusBadge(detail.status)}`}>
                        <strong><RichText text={detail.prompt} /></strong>
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
      {assignmentWorksheet && (
        <div className="fixed inset-0 z-50 overflow-auto bg-slate-900/60 p-6">
          <div className="mx-auto max-w-xl rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-bold">Asignar a aula</h2><p className="text-sm text-slate-500">{assignmentWorksheet.title}</p></div>
              <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setAssignmentWorksheet(null)}>Cancelar</button>
            </div>
            <label className="mt-4 flex items-center gap-2 rounded-2xl bg-blue-50 p-3 font-semibold text-blue-700">
              <input type="checkbox" checked={classrooms.length > 0 && selectedAssignmentClassrooms.length === classrooms.length} onChange={(e) => setSelectedAssignmentClassrooms(e.target.checked ? classrooms.map((classroom) => classroom.id) : [])} />
              Todas las aulas
            </label>
            <div className="mt-3 grid gap-2">
              {classrooms.map((classroom) => (
                <label key={classroom.id} className="flex items-center gap-2 rounded-xl border p-3">
                  <input
                    type="checkbox"
                    checked={selectedAssignmentClassrooms.includes(classroom.id)}
                    onChange={(e) => setSelectedAssignmentClassrooms((current) => e.target.checked ? [...new Set([...current, classroom.id])] : current.filter((id) => id !== classroom.id))}
                  />
                  {classroom.name}
                </label>
              ))}
              {!classrooms.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Primero crea un aula.</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setAssignmentWorksheet(null)}>Cancelar</button>
              <button className="rounded-2xl bg-emerald-600 px-4 py-2 font-semibold text-white" onClick={saveWorksheetClassroomAssignments}>Guardar asignación</button>
            </div>
          </div>
        </div>
      )}
      {previewWorksheet && (
        <div className="fixed inset-0 z-50 overflow-auto bg-slate-900/60 p-6">
          <div className="mx-auto max-w-5xl rounded-3xl bg-slate-50 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Vista previa: {previewWorksheet.title}</h2>
              <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setPreviewWorksheet(null)}>Cerrar</button>
            </div>
            <WorksheetRenderer worksheet={previewWorksheet} answers={{}} readonly onAnswerChange={() => undefined} />
          </div>
        </div>
      )}
    </main>
  );
}
