import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, Bell, BookOpen, BookText, Check, ChevronLeft, ChevronRight, Copy, Download, Eye, GraduationCap, History, ImageIcon, Link2, LockKeyhole, LogOut, MoreHorizontal, Pencil, Printer, RefreshCw, Search, Send, Trash2, UserCircle, Users, X } from 'lucide-react';
import { ThemeToggle } from './components/ThemeToggle';
import { WorksheetEditor } from './components/WorksheetEditor';
import { WorksheetRenderer } from './components/WorksheetRenderer';
import { SubmitResult } from './components/submitAnimations';
import { LoadingScreen, LoadingOverlay } from './components/LoadingScreen';
import { SubmitConfirmModal, missingNameLabel, type SubmitPrompt } from './components/SubmitConfirmModal';
import { WorksheetPrint } from './components/WorksheetPrint';
import { VocabularyManager, VocabularyViewer } from './components/VocabularyViewer';
import { ImageLibraryPage } from './pages/ImageLibraryPage';
import { RichText } from './components/RichText';
import RexMascot from './components/RexMascot';
import { TeacherDashboard, type TeacherMenu } from './components/TeacherDashboard';
import { sampleWorksheet } from './data/sampleWorksheet';
import {
  archiveWorksheet,
  assignStudentToClassroom,
  assignWorksheetToClassroom,
  assignVocabularyToClassroom,
  unassignVocabularyFromClassroom,
  assignReaderToList,
  unassignReaderFromList,
  listReadersForList,
  changePassword,
  createVocabularyList,
  createClassroom,
  createStudent,
  createTeacher,
  createWorksheet,
  updateWorksheet,
  deleteStudent,
  deleteTeacher,
  deleteWorksheet,
  deleteVocabularyList,
  deleteResponse,
  duplicateWorksheet,
  getStudentsActivity,
  listClassrooms,
  listReaders,
  listStudentClassrooms,
  listStudentResponses,
  listStudentSessions,
  listStudentVocabulary,
  listStudents,
  listStudentWorksheets,
  listTeachers,
  listTeacherWorksheets,
  listVocabularyClassrooms,
  listVocabularyLists,
  listWorksheetClassrooms,
  getWorksheetClassroomAssignments,
  listWorksheetResponses,
  getWorksheetResponseCounts,
  getWorksheetSummary,
  getTeacherActivityFeed,
  type ActivityEvent,
  logoutSession,
  getClassroom,
  getCurrentSession,
  getTeacherDashboard,
  getTeacherNotifications,
  getGuestAccessLogs,
  getGuestDetail,
  type TeacherNotification,
  type GuestAccessLog,
  type GuestDetail,
  publishWorksheet,
  reviewAnswer,
  submitResponse,
  practiceGrade,
  type ResultadoPractica,
  unassignStudentFromClassroom,
  unassignWorksheetFromClassroom,
  deleteClassroom,
  setClassroomVisibility,
  type Classroom,
  type ClassroomDetail,
  type DetalleRespuesta,
  type RespuestaEstudiante,
  type StudentActivity,
  type TeacherStats,
  type UserSession,
  type UsuarioSesion,
} from './services/api';
import type { StudentAnswer, StudentAnswers, VocabularyList, Worksheet, WorksheetActivity } from './types';
import './styles/app.css';


function statusBadge(status: DetalleRespuesta['status']) {
  if (status === 'correct') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'incorrect') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k} → ${v}`).join('\n');
  return String(value);
}

/** Estado por actividad para el resaltado inline del modo práctica. matching/truefalse generan
 *  varios detalles con id `actividadId:índice`; se agregan al id base (incorrecto > abierta > correcto). */
function buildGradeStatus(details: DetalleRespuesta[]): Record<string, 'correct' | 'incorrect' | 'pending'> {
  const map: Record<string, 'correct' | 'incorrect' | 'pending'> = {};
  for (const d of details) {
    const base = d.activity_id.split(':')[0];
    if (map[base] === 'incorrect') continue;
    if (d.status === 'incorrect') map[base] = 'incorrect';
    else if (d.status === 'pending') map[base] = 'pending';
    else if (map[base] !== 'pending') map[base] = 'correct';
  }
  return map;
}

function ResponseDetails({ response }: { response: RespuestaEstudiante }) {
  return (
    <div className="mt-3 grid gap-2">
      {response.details.map((detail) => (
        <div key={detail.activity_id} className={`rounded-xl border p-3 text-sm ${statusBadge(detail.status)}`}>
          <div className="font-semibold"><RichText text={detail.prompt} /></div>
          <div>Respuesta: <RichText text={answerText(detail.student_answer)} /></div>
          {detail.correct_answer !== null && <div>Correcta: <RichText text={answerText(detail.correct_answer)} /></div>}
          {detail.teacher_comment && <div className="mt-1 italic opacity-80">💬 {detail.teacher_comment}</div>}
          {detail.graded_by && <div className="mt-1 text-xs text-slate-400" title="IA que calificó esta respuesta (solo tú lo ves)">✦ Calificado por {detail.graded_by}</div>}
        </div>
      ))}
    </div>
  );
}

const FEED_META: Record<ActivityEvent['tipo'], { label: string; icon: typeof Bell; color: string }> = {
  nota: { label: 'Nueva entrega', icon: Check, color: 'text-emerald-600 bg-emerald-50' },
  ingreso_alumno: { label: 'Ingreso de alumno', icon: GraduationCap, color: 'text-rex bg-rex-light' },
  ingreso_invitado: { label: 'Ingreso de invitado', icon: Users, color: 'text-amber-600 bg-amber-50' },
  ingreso_lector: { label: 'Ingreso de lector', icon: UserCircle, color: 'text-spike bg-spike/10' },
};

/** Una línea del feed de actividad (campanita y historial semanal comparten formato). */
function FeedRow({ event }: { event: ActivityEvent }) {
  const meta = FEED_META[event.tipo];
  const MetaIcon = meta.icon;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${meta.color}`}><MetaIcon size={16} /></span>
      <div className="min-w-0">
        <p className="text-sm text-slate-800"><span className="font-semibold">{event.nombre}</span> · {meta.label}</p>
        {event.detalle && <p className="truncate text-xs text-slate-500">{event.detalle}</p>}
        <p className="text-xs text-slate-400">{timeAgo(event.ts)} · {new Date(event.ts).toLocaleString()}</p>
      </div>
    </li>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString();
}

/** Secciones del portal docente que existen como URL propia (/teacher/revision, …). */
const TEACHER_SECTIONS: TeacherMenu[] = ['dashboard', 'crear', 'evaluaciones', 'archivadas', 'aulas', 'estudiantes', 'profesores', 'revision', 'invitados', 'actividad', 'vocabulario', 'imagenes'];
type StudentTab = 'activas' | 'calificadas' | 'vocabulario' | 'perfil';
const STUDENT_TABS: StudentTab[] = ['activas', 'calificadas', 'vocabulario', 'perfil'];

export default function App() {
  const navigate = useNavigate();
  // Cada opción del portal es su propia URL: se comparte, se marca y el botón "atrás"
  // del navegador funciona. El estado de la pestaña ES el parámetro de la ruta.
  const { section } = useParams<{ section?: string }>();
  const [user, setUser] = useState<UsuarioSesion | null>(() => getCurrentSession());
  const portalBase = user?.role === 'admin' ? '/admin' : user?.role === 'student' ? '/student' : '/teacher';
  const adminMenu: TeacherMenu = TEACHER_SECTIONS.includes(section as TeacherMenu) ? (section as TeacherMenu) : 'crear';
  const studentTab: StudentTab = STUDENT_TABS.includes(section as StudentTab) ? (section as StudentTab) : 'activas';
  const setAdminMenu = (menu: TeacherMenu) => navigate(`${portalBase}/${menu}`);
  const setStudentTab = (tab: StudentTab) => navigate(`${portalBase}/${tab}`);
  const [notificationCount, setNotificationCount] = useState(0);
  const prevNotifCount = useRef(0);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  // Historial completo (7 días). null = cargando.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFeed, setHistoryFeed] = useState<ActivityEvent[] | null>(null);
  const [bellSeen, setBellSeen] = useState<string>('1970-01-01T00:00:00.000Z');
  // Conteo de respuestas "ya visto" por hoja (se actualiza al abrir esa hoja en Revisión).
  // Si hay más respuestas que las vistas → marca roja "!" pendiente hasta que el profesor entre.
  const [responseSeen, setResponseSeen] = useState<Record<string, number>>({});
  // IDs de respuestas individuales ya vistas → botón de alumno en rojo "!" hasta seleccionarla.
  const [seenResponseIds, setSeenResponseIds] = useState<Set<string>>(new Set());
  const [guestLogs, setGuestLogs] = useState<GuestAccessLog[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<GuestAccessLog | null>(null);
  const [guestDetail, setGuestDetail] = useState<GuestDetail | null>(null);
  const [expandedResponseId, setExpandedResponseId] = useState<string | null>(null);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([sampleWorksheet]);
  const [activeWorksheet, setActiveWorksheet] = useState<Worksheet>(sampleWorksheet);
  const [scriptDraft, setScriptDraft] = useState(sampleWorksheet.scriptContent);
  const [maxAttemptsDraft, setMaxAttemptsDraft] = useState('unlimited');
  const [aiGradingDraft, setAiGradingDraft] = useState(true);
  const [aiToleranceDraft, setAiToleranceDraft] = useState(50);
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [responses, setResponses] = useState<RespuestaEstudiante[]>([]);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [revisionSelectedId, setRevisionSelectedId] = useState<string | null>(null);
  const [selectedResponseId, setSelectedResponseId] = useState<string | null>(null);
  const [students, setStudents] = useState<UsuarioSesion[]>([]);
  const [teachers, setTeachers] = useState<UsuarioSesion[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [activeClassroomId, setActiveClassroomId] = useState('');
  const [classroomDetail, setClassroomDetail] = useState<ClassroomDetail | null>(null);
  const latestClassroomFetch = useRef('');
  const [classroomName, setClassroomName] = useState('');
  const [studentClassroomSelection, setStudentClassroomSelection] = useState<Record<string, string>>({});
  const [assignmentWorksheet, setAssignmentWorksheet] = useState<Worksheet | null>(null);
  const [selectedAssignmentClassrooms, setSelectedAssignmentClassrooms] = useState<string[]>([]);
  const [teacherStats, setTeacherStats] = useState<TeacherStats | null>(null);
  const [summaryByWs, setSummaryByWs] = useState<Record<string, string>>({});
  const [summaryLoading, setSummaryLoading] = useState<string | null>(null);
  const [worksheetClassrooms, setWorksheetClassrooms] = useState<Record<string, Classroom[]>>({});
  const [studentForm, setStudentForm] = useState({ name: '', username: '', password: '' });
  const [teacherForm, setTeacherForm] = useState({ name: '', username: '', password: '', email: '' });
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string>(sampleWorksheet.activities[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ score: number | null; worksheetId: string; worksheetTitle: string; correct: number; incorrect: number } | null>(null);
  const [submitPrompt, setSubmitPrompt] = useState<SubmitPrompt | null>(null);
  const [previewWorksheet, setPreviewWorksheet] = useState<Worksheet | null>(null);
  // Modo práctica: el profesor resuelve la hoja para verificar sus respuestas (no se guarda nada).
  const [practiceWorksheet, setPracticeWorksheet] = useState<Worksheet | null>(null);
  const [practiceAnswers, setPracticeAnswers] = useState<StudentAnswers>({});
  const [practiceResult, setPracticeResult] = useState<ResultadoPractica | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [printWorksheet, setPrintWorksheet] = useState<Worksheet | null>(null);
  // Si está seteado, "Guardar" edita esta hoja en el sitio en vez de crear una nueva.
  const [editingWorksheetId, setEditingWorksheetId] = useState<string | null>(null);
  const [refreshCooldowns, setRefreshCooldowns] = useState<Set<string>>(new Set());
  const [studentClassrooms, setStudentClassrooms] = useState<Classroom[]>([]);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordMsg, setPasswordMsg] = useState('');
  const [studentsActivity, setStudentsActivity] = useState<StudentActivity[]>([]);
  const [sessionModal, setSessionModal] = useState<{ student: StudentActivity; sessions: UserSession[] } | null>(null);
  const [vocabularyLists, setVocabularyLists] = useState<VocabularyList[]>([]);
  const [vocabAssignedClassrooms, setVocabAssignedClassrooms] = useState<Record<string, string[]>>({});
  const [vocabAssignedReaders, setVocabAssignedReaders] = useState<Record<string, string[]>>({});
  const [studentVocabularyLists, setStudentVocabularyLists] = useState<VocabularyList[]>([]);
  const [readers, setReaders] = useState<UsuarioSesion[]>([]);
  // Evaluaciones: search + pagination
  const [wsSearch, setWsSearch] = useState('');
  const [wsPage, setWsPage] = useState(1);
  const WS_PAGE_SIZE = 10;
  // Due date for worksheet assignment
  const [assignDueDate, setAssignDueDate] = useState('');
  // Duplicate loading state
  const [isDuplicating, setIsDuplicating] = useState<string | null>(null);
  // Primera carga de datos desde la BD (Aiven puede tardar unos segundos): muestra spinner.
  const [initialLoading, setInitialLoading] = useState(true);

  function withCooldown(key: string, fn: () => void) {
    if (refreshCooldowns.has(key)) return;
    fn();
    setRefreshCooldowns((prev) => new Set([...prev, key]));
    setTimeout(() => setRefreshCooldowns((prev) => { const next = new Set(prev); next.delete(key); return next; }), 3000);
  }

  const selectedActivity = useMemo(() => activeWorksheet.activities.find((activity) => activity.id === selectedActivityId), [activeWorksheet.activities, selectedActivityId]);

  // Redirigir a /login cuando el token expira (evento disparado por api.ts en 401)
  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      navigate('/login', { replace: true, state: { message: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.' } });
    };
    window.addEventListener('session-expired', handleExpired);
    return () => window.removeEventListener('session-expired', handleExpired);
  }, [navigate]);

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

  useEffect(() => {
    if (!user || user.role === 'student' || adminMenu !== 'actividad') return;
    void getStudentsActivity().then(setStudentsActivity).catch(() => {});
    void getGuestAccessLogs().then(setGuestLogs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMenu, user?.id]);

  useEffect(() => {
    if (!user || user.role === 'student') return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user || user.role === 'student') return;
    const storageKey = `teacher_notif_since_${user.id}`;

    async function poll() {
      const since = localStorage.getItem(storageKey) ?? new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      try {
        const notifs: TeacherNotification[] = await getTeacherNotifications(since);
        const count = notifs.length;
        setNotificationCount(count);
        if (count > prevNotifCount.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const diff = count - prevNotifCount.current;
          const body = diff === 1
            ? `${notifs[0].student_name} entregó "${notifs[0].worksheet_title}"`
            : `${diff} nuevas respuestas de estudiantes`;
          new Notification('Nueva respuesta recibida 📋', { body, icon: '/favicon.ico' });
        }
        prevNotifCount.current = count;
      } catch { /* silent — no interrumpir la UI */ }
    }

    void poll();
    const id = setInterval(() => void poll(), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Feed de actividad para la campanita (ingresos + notas)
  useEffect(() => {
    if (!user || user.role === 'student') return;
    setBellSeen(localStorage.getItem(`teacher_bell_seen_${user.id}`) ?? '1970-01-01T00:00:00.000Z');
    try { setResponseSeen(JSON.parse(localStorage.getItem(`review_seen_${user.id}`) ?? '{}')); } catch { /* vacío */ }
    try { setSeenResponseIds(new Set(JSON.parse(localStorage.getItem(`review_seen_resp_${user.id}`) ?? '[]'))); } catch { /* vacío */ }
    async function pollFeed() {
      try {
        setFeed(await getTeacherActivityFeed());
        await loadResponseCounts();
      } catch { /* silencioso — no interrumpe la UI */ }
    }
    void pollFeed();
    const id = setInterval(() => void pollFeed(), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function refreshData(currentUser = user) {
    if (!currentUser) return;
    try {
      if (currentUser.role !== 'student') {
        const [teacherWorksheets, allStudents, allTeachers, teacherClassrooms, dashboardStats, vocabLists, allReaders] = await Promise.all([listTeacherWorksheets(currentUser.role === 'admin' ? undefined : currentUser.id), listStudents(), currentUser.role === 'admin' ? listTeachers() : Promise.resolve([]), listClassrooms(), getTeacherDashboard(), listVocabularyLists(), listReaders()]);
        // Garantizar orden más reciente primero, independientemente del backend
        const sortedWorksheets = [...teacherWorksheets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setWorksheets(sortedWorksheets.length ? sortedWorksheets : [sampleWorksheet]);
        setStudents(allStudents);
        setTeachers(allTeachers);
        setClassrooms(teacherClassrooms);
        setTeacherStats(dashboardStats);
        setVocabularyLists(vocabLists);
        setReaders(allReaders);
        const [classroomAssignments, vocabClassroomAssignments, vocabReaderAssignments] = await Promise.all([
          getWorksheetClassroomAssignments(),
          Promise.all(vocabLists.map(async (vl) => [vl.id, await listVocabularyClassrooms(vl.id)] as const)),
          Promise.all(vocabLists.map(async (vl) => [vl.id, (await listReadersForList(vl.id)).map((r) => r.id)] as const)),
        ]);
        setWorksheetClassrooms(classroomAssignments);
        setVocabAssignedClassrooms(Object.fromEntries(vocabClassroomAssignments));
        setVocabAssignedReaders(Object.fromEntries(vocabReaderAssignments));
        if (!activeClassroomId && teacherClassrooms[0]) setActiveClassroomId(teacherClassrooms[0].id);
        if (sortedWorksheets[0]) {
          setActiveWorksheet(sortedWorksheets[0]);
          setScriptDraft(sortedWorksheets[0].scriptContent);
          setMaxAttemptsDraft(sortedWorksheets[0].maxAttempts ? String(sortedWorksheets[0].maxAttempts) : 'unlimited');
          setAiGradingDraft(sortedWorksheets[0].aiGrading ?? true);
          setAiToleranceDraft(sortedWorksheets[0].aiTolerance ?? 50);
          setResponses(await listWorksheetResponses(sortedWorksheets[0].id));
        }
      } else {
        const [availableWorksheets, studentResponses, myClassrooms, myVocab] = await Promise.all([listStudentWorksheets(currentUser.id), listStudentResponses(currentUser.id), listStudentClassrooms(currentUser.id), listStudentVocabulary(currentUser.id)]);
        setWorksheets(availableWorksheets);
        setResponses(studentResponses);
        setStudentClassrooms(myClassrooms);
        setStudentVocabularyLists(myVocab);
        // Seleccionar la primera hoja que aún tenga intentos disponibles
        const firstActive = availableWorksheets.find((w) =>
          w.status === 'published' && w.attemptsRemaining !== 0
        );
        if (firstActive) setActiveWorksheet(firstActive);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo conectar con el backend.');
    } finally {
      setInitialLoading(false);
    }
  }

  function updateAnswer(activityId: string, value: StudentAnswer) {
    setAnswers((current) => ({ ...current, [activityId]: value }));
  }

  // ── Modo práctica (profesor resuelve la hoja; nada se guarda) ────────────────
  function openPractice(worksheet: Worksheet) {
    setPracticeWorksheet(worksheet);
    setPracticeAnswers({});
    setPracticeResult(null);
  }

  function updatePracticeAnswer(activityId: string, value: StudentAnswer) {
    setPracticeAnswers((current) => ({ ...current, [activityId]: value }));
    setPracticeResult(null); // las respuestas cambiaron: invalida el resultado anterior
  }

  async function runPractice() {
    if (!practiceWorksheet || practiceLoading) return;
    setPracticeLoading(true);
    try {
      setPracticeResult(await practiceGrade(practiceWorksheet.id, practiceAnswers));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo calificar la práctica.');
    } finally {
      setPracticeLoading(false);
    }
  }

  /** Abre el editor sobre una hoja existente para editarla EN EL SITIO (misma hoja).
   *  Bloquea si ya tiene respuestas registradas (para no invalidar lo entregado). */
  function startEditWorksheet(worksheet: Worksheet) {
    if ((responseCounts[worksheet.id] ?? 0) > 0) {
      setActiveWorksheet(worksheet);
      setAdminMenu('evaluaciones');
      setMessage('Esta evaluación ya tiene respuestas, no se puede editar. Duplícala si necesitas cambiarla.');
      return;
    }
    setEditingWorksheetId(worksheet.id);
    setActiveWorksheet(worksheet);
    setScriptDraft(worksheet.scriptContent);
    setMaxAttemptsDraft(worksheet.maxAttempts ? String(worksheet.maxAttempts) : 'unlimited');
    setAiGradingDraft(worksheet.aiGrading ?? true);
    setAiToleranceDraft(worksheet.aiTolerance ?? 50);
    setMessage('');
    setAdminMenu('crear');
  }

  async function saveScript(scriptOverride?: string) {
    if (!user) return;
    // scriptOverride: lo pasa el modo visual con el DSL recién serializado (evita el closure viejo de scriptDraft).
    const script = scriptOverride ?? scriptDraft;
    if (scriptOverride != null) setScriptDraft(scriptOverride);
    setIsSaving(true);
    setMessage('');
    try {
      const maxAttempts = maxAttemptsDraft === 'unlimited' ? null : Number(maxAttemptsDraft);
      if (editingWorksheetId) {
        const worksheet = await updateWorksheet(editingWorksheetId, script, maxAttempts, aiGradingDraft, aiToleranceDraft);
        setActiveWorksheet(worksheet);
        setWorksheets((current) => current.map((item) => (item.id === worksheet.id ? worksheet : item)));
        setSelectedActivityId(worksheet.activities[0]?.id ?? '');
        setEditingWorksheetId(null);
        setAdminMenu('evaluaciones');
        setMessage('Evaluación actualizada.');
        setPreviewWorksheet(worksheet); // vista previa de cómo la verá el estudiante
      } else {
        const worksheet = await createWorksheet(script, user.id, maxAttempts, aiGradingDraft, aiToleranceDraft);
        setActiveWorksheet(worksheet);
        setWorksheets((current) => [worksheet, ...current.filter((item) => item.id !== sampleWorksheet.id)]);
        setSelectedActivityId(worksheet.activities[0]?.id ?? '');
        setAdminMenu('evaluaciones');
        setMessage('Evaluación guardada. Ahora puedes habilitarla.');
        setPreviewWorksheet(worksheet); // vista previa de cómo la verá el estudiante
      }
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

  /** Abre el modal de confirmación (o el aviso de nombre faltante) del propio frontend. */
  function requestSendAnswers() {
    if (!user || isSubmitting) return;
    const missing = missingNameLabel(activeWorksheet, answers);
    setSubmitPrompt(missing ? { kind: 'missing-name', field: missing } : { kind: 'confirm' });
  }

  async function sendAnswers() {
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await submitResponse(activeWorksheet, user, answers);
      setResponses((current) => [response, ...current]);
      setAnswers({});
      const incorrect = response.details.filter((d) => d.status === 'incorrect').length;
      setSubmitResult({ score: response.score, worksheetId: activeWorksheet.id, worksheetTitle: activeWorksheet.title, correct: response.correct_count, incorrect });
      // Refrescar lista para que attempts_remaining se actualice y la hoja se mueva de pestaña
      void refreshData(user);
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
    setRevisionSelectedId(worksheet.id);
    const loaded = await listWorksheetResponses(worksheet.id);
    setResponses(loaded);
    setSelectedResponseId(null); // al entrar no hay ningún alumno seleccionado
    setResponseCounts((current) => ({ ...current, [worksheet.id]: loaded.length }));
    markWorksheetReviewed(worksheet.id, loaded.length);
    const preloaded: Record<string, string> = {};
    for (const resp of loaded) {
      for (const detail of resp.details) {
        if (detail.teacher_comment) {
          preloaded[`${resp.id}-${detail.activity_id}`] = detail.teacher_comment;
        }
      }
    }
    setReviewComments(preloaded);
    setAdminMenu('revision');
  }

  async function loadResponseCounts() {
    try {
      setResponseCounts(await getWorksheetResponseCounts());
    } catch {
      // Conteo es informativo; si falla no bloquea la revisión.
    }
  }

  function markWorksheetReviewed(worksheetId: string, count: number) {
    setResponseSeen((current) => {
      const next = { ...current, [worksheetId]: count };
      if (user) localStorage.setItem(`review_seen_${user.id}`, JSON.stringify(next));
      return next;
    });
  }

  function markResponseSeen(responseId: string) {
    setSeenResponseIds((current) => {
      if (current.has(responseId)) return current;
      const next = new Set(current);
      next.add(responseId);
      if (user) localStorage.setItem(`review_seen_resp_${user.id}`, JSON.stringify([...next]));
      return next;
    });
  }

  async function loadSummary(worksheetId: string) {
    setSummaryLoading(worksheetId);
    try {
      const s = await getWorksheetSummary(worksheetId);
      setSummaryByWs((cur) => ({ ...cur, [worksheetId]: s || 'No hay datos suficientes para un resumen.' }));
    } catch {
      setSummaryByWs((cur) => ({ ...cur, [worksheetId]: 'No se pudo generar el resumen. Intenta de nuevo.' }));
    } finally {
      setSummaryLoading(null);
    }
  }

  function openWorksheetResponsesById(worksheetId: string) {
    const ws = worksheets.find((w) => w.id === worksheetId);
    if (ws) void loadWorksheetResponses(ws);
  }

  async function openGuest(log: GuestAccessLog) {
    setSelectedGuest(log);
    setGuestDetail(null);
    setExpandedResponseId(null);
    try {
      setGuestDetail(await getGuestDetail(log.guest_token, log.classroom_id));
    } catch {
      setGuestDetail({ responses: [], pending: [] });
    }
  }

  function handleSelectMenu(menu: TeacherMenu) {
    // Ir a "Crear" desde el menú (dejando una edición) empieza una hoja NUEVA en blanco.
    if (menu === 'crear' && editingWorksheetId) {
      setEditingWorksheetId(null);
      setScriptDraft('');
      setMaxAttemptsDraft('unlimited');
      setAiGradingDraft(true);
      setAiToleranceDraft(50);
      setMessage('');
    }
    if (menu === 'revision' && user) {
      localStorage.setItem(`teacher_notif_since_${user.id}`, new Date().toISOString());
      setNotificationCount(0);
      prevNotifCount.current = 0;
      setRevisionSelectedId(null);
      void loadResponseCounts();
    }
    if (menu === 'evaluaciones' || menu === 'archivadas') void loadResponseCounts();
    if (menu === 'invitados') { setSelectedGuest(null); setGuestDetail(null); void getGuestAccessLogs().then(setGuestLogs).catch(() => {}); }
    setAdminMenu(menu);
  }

  /** Historial completo de la campanita: una semana de vigencia (el endpoint acepta `since`). */
  async function openHistory() {
    setHistoryOpen(true);
    setHistoryFeed(null);
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    try {
      setHistoryFeed(await getTeacherActivityFeed(since));
    } catch {
      setHistoryFeed([]);
    }
  }

  function toggleBell() {
    const willOpen = !bellOpen;
    setBellOpen(willOpen);
    if (willOpen && user) {
      const now = new Date().toISOString();
      setBellSeen(now);
      localStorage.setItem(`teacher_bell_seen_${user.id}`, now);
    }
  }

  function exportResponsesCsv() {
    if (!responses.length) return;
    const header = ['Estudiante', 'Fecha', 'Nota', 'Aciertos', 'Pendientes'];
    const rows = responses.map((r) => [
      r.student_name,
      new Date(r.submitted_at).toLocaleString(),
      r.score ?? '',
      r.correct_count,
      r.pending_count,
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respuestas_${activeWorksheet.title.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    latestClassroomFetch.current = classroomId;
    const detail = await getClassroom(classroomId);
    if (latestClassroomFetch.current === classroomId) {
      setClassroomDetail(detail);
    }
  }

  async function createNewClassroom() {
    if (!classroomName.trim()) return;
    const created = await createClassroom(classroomName.trim());
    setClassrooms((current) => [...current, created]);
    setClassroomName('');
    setActiveClassroomId(created.id);
    await refreshClassroomDetail(created.id);
    setMessage('Aula creada correctamente.');
  }

  async function deleteClassroomHandler(classroomId: string, classroomName: string) {
    if (!window.confirm(`¿Eliminar el aula "${classroomName}"? Se perderán todos los estudiantes y hojas asignadas.`)) return;
    await deleteClassroom(classroomId);
    setClassrooms((current) => current.filter((c) => c.id !== classroomId));
    if (activeClassroomId === classroomId) {
      setActiveClassroomId('');
      setClassroomDetail(null);
    }
    setMessage('Aula eliminada.');
  }

  async function toggleClassroomVisibility() {
    if (!classroomDetail) return;
    const next = !classroomDetail.is_public;
    await setClassroomVisibility(classroomDetail.id, next);
    setClassroomDetail((d) => d ? { ...d, is_public: next } : d);
    setClassrooms((current) => current.map((c) => c.id === classroomDetail.id ? { ...c, is_public: next } : c));
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
    setAssignDueDate('');
    const assignedClassrooms = await listWorksheetClassrooms(worksheet.id);
    setSelectedAssignmentClassrooms(assignedClassrooms.map((classroom) => classroom.id));
  }

  async function handleDuplicateWorksheet(worksheet: Worksheet) {
    if (isDuplicating) return;
    setIsDuplicating(worksheet.id);
    try {
      const duped = await duplicateWorksheet(worksheet.id);
      setWorksheets((prev) => [duped, ...prev]);
      setWorksheetClassrooms((prev) => ({ ...prev, [duped.id]: [] }));
      setMessage(`Evaluación duplicada: "${duped.title}"`);
    } catch {
      setMessage('Error al duplicar la evaluación.');
    } finally {
      setIsDuplicating(null);
    }
  }

  async function saveWorksheetClassroomAssignments() {
    if (!assignmentWorksheet) return;
    const selected = new Set(selectedAssignmentClassrooms);
    // Only call assign/unassign for classrooms whose state actually changed
    const previouslyAssigned = new Set((worksheetClassrooms[assignmentWorksheet.id] ?? []).map((c) => c.id));
    const toAssign = classrooms.filter((c) => selected.has(c.id) && !previouslyAssigned.has(c.id));
    const toUnassign = classrooms.filter((c) => !selected.has(c.id) && previouslyAssigned.has(c.id));
    await Promise.all([
      ...toAssign.map((c) => assignWorksheetToClassroom(c.id, assignmentWorksheet.id, assignDueDate || null)),
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

  async function handleVocabAssign(listId: string, classroomId: string) {
    await assignVocabularyToClassroom(listId, classroomId);
    setVocabAssignedClassrooms((prev) => ({ ...prev, [listId]: [...(prev[listId] ?? []), classroomId] }));
  }

  async function handleVocabUnassign(listId: string, classroomId: string) {
    await unassignVocabularyFromClassroom(listId, classroomId);
    setVocabAssignedClassrooms((prev) => ({ ...prev, [listId]: (prev[listId] ?? []).filter((id) => id !== classroomId) }));
  }

  async function handleVocabDelete(listId: string) {
    await deleteVocabularyList(listId);
    setVocabularyLists((prev) => prev.filter((vl) => vl.id !== listId));
    setVocabAssignedClassrooms((prev) => { const next = { ...prev }; delete next[listId]; return next; });
    setVocabAssignedReaders((prev) => { const next = { ...prev }; delete next[listId]; return next; });
  }

  async function handleReaderAssignToList(listId: string, readerId: string) {
    await assignReaderToList(listId, readerId);
    setVocabAssignedReaders((prev) => ({ ...prev, [listId]: [...(prev[listId] ?? []), readerId] }));
  }

  async function handleReaderUnassignFromList(listId: string, readerId: string) {
    await unassignReaderFromList(listId, readerId);
    setVocabAssignedReaders((prev) => ({ ...prev, [listId]: (prev[listId] ?? []).filter((id) => id !== readerId) }));
  }

  // ProtectedRoute en main.tsx garantiza que user no es null en estas rutas.
  // Este fallback solo se activa si App se renderiza fuera del contexto esperado.
  if (!user) return null;

  // Primera carga de datos: spinner en vez de un portal vacío mientras responde la BD.
  if (initialLoading) return <LoadingScreen message="Cargando tu información…" />;

  if (user.role === 'student') {
    const responseByWorksheet = responses.reduce((latestResponses, response) => {
      if (!latestResponses.has(response.worksheet_id)) latestResponses.set(response.worksheet_id, response);
      return latestResponses;
    }, new Map<string, RespuestaEstudiante>());

    // Activas: publicadas, con intentos restantes, y sin respuesta ya enviada cuando no hay límite
    const activeWorksheets = worksheets.filter((w) => {
      if (w.status !== 'published') return false;
      if (w.attemptsRemaining === 0) return false;
      // Ilimitada o con intentos restantes → permanece en Activas para re-hacerla.
      return true;
    });
    // Calificadas: tiene al menos una respuesta enviada
    const gradedWorksheets = worksheets.filter((w) => responseByWorksheet.has(w.id));

    // Verdadera si la hoja activa aún está en la lista de activas (no solo publicada)
    const isActiveWorksheetPublished = activeWorksheets.some((w) => w.id === activeWorksheet.id);

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
      <main className="min-h-screen bg-cream text-ink">
        {isSubmitting && <LoadingOverlay message="Calificando tus respuestas…" />}
        {/* Navbar */}
        <nav className="border-b border-rex/15 bg-white/85">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <RexMascot mood="wave" className="h-11 w-11 shrink-0" />
              <div>
                <h1 className="whitespace-nowrap text-xl font-black tracking-tight">Dino<span className="text-rex">English</span> <span className="text-spike">Studio</span></h1>
                <p className="text-sm text-ink/60">Hola, {user.name} (@{user.username})</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Tabs en navbar */}
              <div className="hidden sm:flex rounded-2xl border border-slate-200 bg-slate-50 p-1 gap-1">
                {(['activas', 'calificadas', 'vocabulario', 'perfil'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={`rounded-xl px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${studentTab === tab ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => setStudentTab(tab)}
                  >
                    {tab === 'activas' ? 'Activas' : tab === 'calificadas' ? 'Calificadas' : tab === 'vocabulario' ? 'Vocabulario' : 'Mi Perfil'}
                  </button>
                ))}
              </div>
              <ThemeToggle />
              <button className="rounded-2xl border px-4 py-2 text-sm" onClick={() => { void logoutSession().then(() => navigate('/login', { replace: true })); setUser(null); }}>Cerrar sesión</button>
            </div>
          </div>
          {/* Tabs móvil */}
          <div className="flex sm:hidden border-t border-slate-100">
            {(['activas', 'calificadas', 'vocabulario', 'perfil'] as const).map((tab) => (
              <button
                key={tab}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${studentTab === tab ? 'border-b-2 border-rex text-rex' : 'text-slate-500'}`}
                onClick={() => setStudentTab(tab)}
              >
                {tab === 'activas' ? 'Activas' : tab === 'calificadas' ? 'Calif.' : tab === 'vocabulario' ? 'Vocab.' : 'Perfil'}
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
                    <button key={worksheet.id} className={`rounded-2xl border p-4 text-left transition-colors ${activeWorksheet.id === worksheet.id ? 'border-rex bg-rex-light' : 'border-slate-100 hover:border-slate-300'}`} onClick={() => { setActiveWorksheet(worksheet); setMessage(''); }}>
                      <BookOpen className="mb-2 text-rex" size={20} />
                      <strong className="block">{worksheet.title}</strong>
                      <p className="text-sm text-slate-500"><RichText text={worksheet.description} /></p>
                      {worksheet.dueDate && (() => {
                        const due = new Date(worksheet.dueDate);
                        const now = Date.now();
                        const diffMs = due.getTime() - now;
                        const diffH = Math.ceil(diffMs / 3600000);
                        const isPast = diffMs < 0;
                        const label = isPast ? 'Vencida' : diffH <= 24 ? `Vence en ${diffH}h` : `Vence ${due.toLocaleDateString()}`;
                        return <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${isPast ? 'bg-red-100 text-red-700' : diffH <= 24 ? 'bg-amber-100 text-amber-700' : 'bg-rex-light text-rex'}`}>{label}</span>;
                      })()}
                      <p className="mt-2 text-xs font-semibold">{response ? `Nota: ${response.score ?? 'pendiente'} · Aciertos: ${response.correct_count}` : 'Sin responder'}</p>
                    </button>
                  );
                })}
                {!activeWorksheets.length && <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">¡Todo listo! No tienes hojas de trabajo pendientes.</p>}
              </div>
            </aside>
            <section>
              {activeWorksheets.length > 0 && isActiveWorksheetPublished && <WorksheetRenderer worksheet={activeWorksheet} answers={answers} onAnswerChange={updateAnswer} />}
              {activeWorksheets.length > 0 && !isActiveWorksheetPublished && (
                <div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-800 shadow-sm">
                  <h2 className="text-xl font-extrabold">Selecciona una evaluación activa de la lista.</h2>
                </div>
              )}
              {message && !submitResult && <p className="mx-auto mt-4 max-w-4xl rounded-2xl bg-rex-light p-3 text-sm font-semibold text-rex-deep">{message}</p>}
              {activeWorksheets.length > 0 && isActiveWorksheetPublished && (
                <div className="mx-auto mt-6 flex max-w-4xl justify-end">
                  <button className="rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-white disabled:opacity-60" disabled={isSubmitting} onClick={requestSendAnswers}>
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
                      <span className="rounded-xl bg-red-50 px-3 py-1 text-red-700">Fallos: {resp.details.filter((d) => d.status === 'incorrect').length}</span>
                      {resp.pending_count > 0 && <span className="rounded-xl bg-amber-50 px-3 py-1 text-amber-700">Pendientes: {resp.pending_count}</span>}
                      {resp.score !== null && <span className="rounded-xl bg-rex-light px-3 py-1 text-rex-deep">Nota: {resp.score}</span>}
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

        {/* ── PESTAÑA VOCABULARIO ── */}
        {studentTab === 'vocabulario' && (
          <div className="mx-auto max-w-7xl px-4 py-8">
            <VocabularyViewer lists={studentVocabularyLists} />
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
                      <thead><tr className="border-b text-left text-slate-500"><th className="pb-2 pr-4 font-semibold">Evaluación</th><th className="pb-2 pr-4 font-semibold">Fecha</th><th className="pb-2 pr-4 font-semibold">Nota</th><th className="pb-2 pr-4 font-semibold text-emerald-700">Aciertos</th><th className="pb-2 font-semibold text-red-600">Fallos</th></tr></thead>
                      <tbody>
                        {responses.map((resp) => {
                          const ws = worksheets.find((w) => w.id === resp.worksheet_id);
                          const incorrect = resp.details.filter((d) => d.status === 'incorrect').length;
                          return (
                            <tr key={resp.id} className="border-b last:border-0">
                              <td className="py-2 pr-4 font-semibold">{ws?.title ?? resp.worksheet_id}</td>
                              <td className="py-2 pr-4 text-slate-500">{new Date(resp.submitted_at).toLocaleDateString()}</td>
                              <td className="py-2 pr-4">{resp.score ?? <span className="text-amber-600 font-semibold">Pendiente</span>}</td>
                              <td className="py-2 pr-4 text-emerald-700 font-semibold">{resp.correct_count}</td>
                              <td className="py-2 text-red-600 font-semibold">{incorrect}</td>
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
                <button className="rounded-2xl bg-rex px-5 py-3 font-semibold text-white hover:bg-rex-dark" onClick={handleChangePassword}>
                  <LockKeyhole className="mr-2 inline" size={16} /> Actualizar contraseña
                </button>
              </div>
            </section>
          </div>
        )}
      {/* ── Confirmación de envío (frontend propio, no window.confirm) ── */}
      {submitPrompt && (
        <SubmitConfirmModal
          prompt={submitPrompt}
          onClose={() => setSubmitPrompt(null)}
          onConfirm={() => { setSubmitPrompt(null); void sendAnswers(); }}
        />
      )}
      {/* ── Resultado de envío (animación al azar) ── */}
      {submitResult && (
        <SubmitResult
          score={submitResult.score}
          correct={submitResult.correct}
          incorrect={submitResult.incorrect}
          worksheetTitle={submitResult.worksheetTitle}
          onSeeAnswers={() => {
            const ws = [...activeWorksheets, ...gradedWorksheets].find((w) => w.id === submitResult.worksheetId);
            if (ws) setActiveWorksheet(ws);
            setStudentTab('calificadas');
            setSubmitResult(null);
          }}
          onClose={() => setSubmitResult(null)}
        />
      )}
      </main>
    );
  }

  const savedWorksheets = worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id && !worksheet.archived);
  const archivedWorksheets = worksheets.filter((worksheet) => worksheet.id !== sampleWorksheet.id && worksheet.archived);
  const publishedCount = savedWorksheets.filter((worksheet) => worksheet.status === 'published').length;
  const filteredWorksheets = savedWorksheets.filter((w) => wsSearch === '' || w.title.toLowerCase().includes(wsSearch.toLowerCase()) || w.description.toLowerCase().includes(wsSearch.toLowerCase()));
  const wsPageCount = Math.max(1, Math.ceil(filteredWorksheets.length / WS_PAGE_SIZE));
  const pagedWorksheets = filteredWorksheets.slice((wsPage - 1) * WS_PAGE_SIZE, wsPage * WS_PAGE_SIZE);

  return (
    <main className="min-h-screen bg-cream text-ink">
      {/* relative z-50: el panel de la campanita es `absolute` dentro de esta barra. Sin un
          z-index propio en la barra, las secciones de abajo (que crean su propio contexto de
          apilamiento con blur/sombra) le pasaban por encima y tapaban las notificaciones. */}
      <nav className="relative z-50 border-b border-rex/15 bg-white/85">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <RexMascot mood="wave" className="h-11 w-11 shrink-0" />
            <div>
              <h1 className="whitespace-nowrap text-xl font-black tracking-tight">Dino<span className="text-rex">English</span> <span className="text-spike">Studio</span></h1>
              <p className="text-sm text-ink/60">Crea estudiantes, guarda evaluaciones, limita intentos y revisa respuestas.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { id: 'vocabulario' as const, label: 'Vocabulario', icon: BookText },
              { id: 'imagenes' as const, label: 'Imágenes', icon: ImageIcon },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleSelectMenu(id)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${adminMenu === id ? 'bg-rex text-white shadow-sm' : 'border border-slate-200 text-slate-600 hover:border-rex/40 hover:text-rex-deep'}`}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={toggleBell}
                title="Notificaciones"
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-rex/40 hover:text-rex-deep"
              >
                <Bell size={18} />
                {feed.filter((e) => e.ts > bellSeen).length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                    {feed.filter((e) => e.ts > bellSeen).length > 99 ? '99+' : feed.filter((e) => e.ts > bellSeen).length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} />
                  {/* notif-panel: fondo opaco. Con el cristal de .bg-white se transparentaba
                      y el menú de abajo se leía a través del panel. */}
                  <div className="notif-panel absolute right-0 z-50 mt-2 flex max-h-[28rem] w-80 flex-col rounded-2xl border border-slate-200 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <h3 className="font-bold text-slate-900">Notificaciones</h3>
                      <span className="text-xs text-slate-400">Últimas 48 h</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {feed.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-slate-500">Sin actividad reciente.</p>
                      ) : (
                        <ul className="divide-y divide-slate-50">
                          {feed.map((e, i) => <FeedRow key={i} event={e} />)}
                        </ul>
                      )}
                    </div>
                    <button
                      type="button"
                      className="flex items-center justify-center gap-2 border-t border-slate-100 px-4 py-3 text-sm font-bold text-rex-deep hover:bg-rex-light"
                      onClick={() => { setBellOpen(false); void openHistory(); }}
                    >
                      <History size={15} /> Ver historial completo
                    </button>
                  </div>
                </>
              )}
            </div>
            <ThemeToggle />
            <button
              type="button"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              onClick={() => { void logoutSession().then(() => navigate('/login', { replace: true })); setUser(null); }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
        <TeacherDashboard user={user} totalWorksheets={savedWorksheets.length} publishedCount={publishedCount} selectedMenu={adminMenu} notificationCount={notificationCount} onSelectMenu={handleSelectMenu} onLogout={() => { void logoutSession().then(() => navigate('/login', { replace: true })); setUser(null); }} />
        {adminMenu === 'dashboard' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Dashboard</p>
            <h2 className="text-2xl font-bold">Resumen del profesor</h2>
            <p className="mt-1 text-sm text-slate-500">Cómo va tu grupo de un vistazo: cuántos alumnos tienes, qué hojas están habilitadas, cuántas respuestas han llegado y qué porcentaje se está acertando. Toca el título de una hoja para saltar directo a sus respuestas.</p>
            {(() => {
              const correct = teacherStats?.total_correct ?? 0;
              const incorrect = teacherStats?.total_incorrect ?? 0;
              const graded = correct + incorrect;
              const accuracy = graded ? Math.round((correct / graded) * 100) : 0;
              return (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-rex-light p-5"><p className="text-sm text-rex-deep">Total de estudiantes</p><strong className="text-4xl">{teacherStats?.total_students ?? students.length}</strong></div>
                  <div className="rounded-2xl bg-emerald-50 p-5"><p className="text-sm text-emerald-700">Hojas activas</p><strong className="text-4xl">{teacherStats?.active_worksheets ?? publishedCount}</strong></div>
                  <div className="rounded-2xl bg-spike/10 p-5"><p className="text-sm text-spike-dark">Respuestas recibidas</p><strong className="text-4xl">{teacherStats?.total_responses ?? 0}</strong></div>
                  <div className="rounded-2xl bg-amber-50 p-5"><p className="text-sm text-amber-700">% de acierto global</p><strong className="text-4xl">{accuracy}%</strong></div>
                </div>
              );
            })()}

            <div className="mt-6 rounded-2xl border p-4">
              <h3 className="font-bold">Rendimiento por hoja activa</h3>
              <p className="text-sm text-slate-500">Aciertos y desaciertos de cada hoja publicada.</p>
              <div className="mt-4 grid gap-4">
                {(teacherStats?.worksheet_stats ?? []).map((w) => {
                  const graded = w.correct + w.incorrect;
                  const pct = graded ? Math.round((w.correct / graded) * 100) : 0;
                  return (
                    <div key={w.worksheet_id} className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openWorksheetResponsesById(w.worksheet_id)}
                          className="text-left font-semibold text-slate-900 hover:text-rex-deep hover:underline"
                          title="Ver respuestas de esta hoja"
                        >
                          {w.worksheet_title}
                        </button>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">{w.responses} {w.responses === 1 ? 'respuesta' : 'respuestas'}</span>
                          <span className="font-bold text-emerald-700">✓ {w.correct}</span>
                          <span className="font-bold text-red-600">✗ {w.incorrect}</span>
                          <span className="font-bold text-rex-deep">{w.average_score}%</span>
                          {w.responses > 0 && (
                            <button
                              type="button"
                              onClick={() => void loadSummary(w.worksheet_id)}
                              disabled={summaryLoading === w.worksheet_id}
                              className="rounded-full border border-spike/40 px-3 py-1 text-xs font-bold text-spike-dark transition hover:bg-spike/10 disabled:opacity-60"
                            >
                              {summaryLoading === w.worksheet_id ? 'Analizando…' : '✦ Resumen IA'}
                            </button>
                          )}
                        </div>
                      </div>
                      {graded > 0 && (
                        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          <div className="h-full bg-red-400" style={{ width: `${100 - pct}%` }} />
                        </div>
                      )}
                      {summaryByWs[w.worksheet_id] && (
                        <div className="mt-3 rounded-2xl border border-spike/30 bg-spike/10 p-4">
                          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-spike-dark">✦ Resumen de desempeño (IA)</p>
                          <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{summaryByWs[w.worksheet_id]}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!(teacherStats?.worksheet_stats?.some((w) => w.responses > 0)) && <p className="text-sm text-slate-500">Aún no hay respuestas en las hojas activas.</p>}
              </div>
            </div>

            <div className="mt-6 grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border p-4">
                <h3 className="font-bold">Aciertos vs desaciertos (global)</h3>
                {(() => {
                  const correct = teacherStats?.total_correct ?? 0;
                  const incorrect = teacherStats?.total_incorrect ?? 0;
                  const total = correct + incorrect;
                  const correctPct = total ? Math.round((correct / total) * 100) : 0;
                  return <div className="mt-4 flex items-center gap-5"><div className="h-32 w-32 rounded-full" style={{ background: `conic-gradient(#10b981 0 ${correctPct}%, #ef4444 ${correctPct}% 100%)` }} /><div className="grid gap-2 text-sm"><span className="font-semibold text-emerald-700">Aciertos: {correct}</span><span className="font-semibold text-red-600">Desaciertos: {incorrect}</span></div></div>;
                })()}
              </div>
              <div className="rounded-2xl border p-4">
                <h3 className="font-bold">Alumnos por aula</h3>
                <div className="mt-4 grid gap-3">
                  {(teacherStats?.students_per_classroom ?? []).map((item) => (
                    <div key={item.classroom_name}>
                      <div className="mb-1 flex justify-between text-sm"><span>{item.classroom_name}</span><strong>{item.student_count}</strong></div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-rex" style={{ width: `${Math.min(100, item.student_count * 10)}%` }} /></div>
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
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-rex">Aulas</p>
                <h2 className="text-2xl font-bold">Gestión de aulas</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">Un aula agrupa a tus alumnos y las hojas que les toca resolver: el alumno solo ve lo asignado a su aula. Solo aparecen las aulas que tú creaste.</p>
              </div>
              <div className="flex gap-2"><input className="rounded-2xl border p-3" placeholder="Nombre del aula" value={classroomName} onChange={(e) => setClassroomName(e.target.value)} /><button className="rounded-2xl bg-rex px-4 py-3 font-semibold text-white" onClick={createNewClassroom}>Crear aula</button></div>
            </div>
            {message && <p className="mt-4 rounded-2xl bg-rex-light p-3 text-rex-deep">{message}</p>}
            <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
              <aside className="grid content-start gap-2">
                {classrooms.map((classroom) => (
                  <div key={classroom.id} className={`flex items-center justify-between rounded-2xl border ${activeClassroomId === classroom.id ? 'border-rex bg-rex-light' : 'border-slate-100'}`}>
                    <button className={`flex-1 p-3 text-left font-semibold ${activeClassroomId === classroom.id ? 'text-rex-deep' : ''}`} onClick={() => setActiveClassroomId(classroom.id)}>{classroom.name}</button>
                    <button className="mr-2 rounded-xl border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50" onClick={() => void deleteClassroomHandler(classroom.id, classroom.name)} title="Eliminar aula">✕</button>
                  </div>
                ))}
                {!classrooms.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay aulas creadas.</p>}
              </aside>
              <div className="rounded-2xl border border-slate-100 p-4">
                {classroomDetail ? (
                  <div className="grid gap-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h3 className="text-xl font-bold">{classroomDetail.name}</h3><p className="text-sm text-slate-500">Estudiantes y hojas asignadas a esta aula.</p></div>
                      <button
                        onClick={() => void toggleClassroomVisibility()}
                        className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition ${classroomDetail.is_public ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                      >
                        <span className={`h-3 w-3 rounded-full ${classroomDetail.is_public ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {classroomDetail.is_public ? 'Visible para invitados' : 'Solo acceso con login'}
                      </button>
                    </div>
                    <div>
                      <h4 className="font-bold">Estudiantes asignados</h4>
                      <div className="mt-3 grid gap-2">
                        {classroomDetail.students.map((student) => <div key={student.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><span>{student.name} · @{student.username}</span><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{classroomDetail.student_statuses[student.id]}</span><button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" onClick={() => unassignStudentFromActiveClassroom(student.id)}>Desasignar</button></div>)}
                        {!classroomDetail.students.length && <p className="text-sm text-slate-500">Sin estudiantes asignados.</p>}
                      </div>
                      <h5 className="mt-4 text-sm font-bold">Asignar estudiante</h5>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {students.filter((student) => !classroomDetail.students.some((assigned) => assigned.id === student.id)).map((student) => <button key={student.id} className="rounded-xl border border-rex/30 px-3 py-2 text-sm font-semibold text-rex-deep" onClick={() => assignStudentFromClassroom(student.id)}>{student.name}</button>)}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold">Hojas asignadas</h4>
                      <div className="mt-3 grid gap-2">
                        {classroomDetail.worksheets.map((worksheet) => <div key={worksheet.id} className="rounded-xl bg-slate-50 p-3"><strong>{worksheet.title}</strong><p className="text-sm text-slate-500"><RichText text={worksheet.description} /></p></div>)}
                        {!classroomDetail.worksheets.length && <p className="text-sm text-slate-500">Sin hojas asignadas.</p>}
                      </div>
                    </div>
                  </div>
                ) : <p className="text-sm text-slate-500">Selecciona o crea un aula para ver el detalle.</p>}
              </div>
            </div>
          </section>
        )}
        {adminMenu === 'crear' && <WorksheetEditor worksheet={activeWorksheet} selectedActivity={selectedActivity} scriptDraft={scriptDraft} maxAttemptsDraft={maxAttemptsDraft} aiGradingDraft={aiGradingDraft} aiToleranceDraft={aiToleranceDraft} isSaving={isSaving} isEditing={!!editingWorksheetId} message={message} userId={user?.id ?? ''} onAddActivity={(activity: WorksheetActivity) => { setActiveWorksheet((current) => ({ ...current, activities: [...current.activities, activity] })); setSelectedActivityId(activity.id); }} onScriptChange={setScriptDraft} onMaxAttemptsChange={setMaxAttemptsDraft} onAiGradingChange={setAiGradingDraft} onAiToleranceChange={setAiToleranceDraft} onSaveScript={saveScript} />}
        {adminMenu === 'estudiantes' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Estudiantes</p>
            <h2 className="text-2xl font-bold">Tus alumnos</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Da de alta a cada alumno con su usuario y contraseña, y asígnalo a un aula para que empiece a ver hojas. Solo ves y editas los alumnos que tú creaste.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input className="rounded-2xl border p-3" placeholder="Nombre" value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Usuario" value={studentForm.username} onChange={(e) => setStudentForm({ ...studentForm, username: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Contraseña" value={studentForm.password} onChange={(e) => setStudentForm({ ...studentForm, password: e.target.value })} />
            </div>
            <button className="mt-4 rounded-2xl bg-rex px-5 py-3 font-semibold text-white" onClick={createNewStudent}>Guardar estudiante</button>
            {message && <p className="mt-3 rounded-2xl bg-rex-light p-3 text-rex-deep">{message}</p>}
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
                    <button className="rounded-xl border border-rex/30 bg-white px-3 py-2 text-sm font-semibold text-rex-deep" type="button" onClick={() => assignStudentFromClassroom(student.id, studentClassroomSelection[student.id])}>Asignar</button>
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
                <p className="text-sm font-semibold uppercase tracking-wide text-rex">Evaluaciones guardadas</p>
                <h2 className="text-2xl font-bold">Tus hojas de trabajo</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">Todo lo que has creado. Desde aquí habilitas una hoja para que se pueda responder, la asignas a un aula o copias su enlace directo, y en “Más” la editas, duplicas, imprimes o archivas.</p>
              </div>
              <button className="rounded-2xl bg-rex px-4 py-3 font-semibold text-white" onClick={() => { setEditingWorksheetId(null); setScriptDraft(''); setMaxAttemptsDraft('unlimited'); setAiGradingDraft(true); setAiToleranceDraft(50); setMessage(''); setAdminMenu('crear'); }}>Nueva evaluación</button>
            </div>
            {/* Search */}
            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="w-full rounded-2xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-rex/40"
                placeholder="Buscar por título o descripción..."
                value={wsSearch}
                onChange={(e) => { setWsSearch(e.target.value); setWsPage(1); }}
              />
            </div>
            {message && <p className="mt-4 rounded-2xl bg-rex-light p-3 text-rex-deep">{message}</p>}
            <div className="mt-5 grid gap-4">
              {pagedWorksheets.map((worksheet) => (
                <article key={worksheet.id} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const newCount = (responseCounts[worksheet.id] ?? 0) - (responseSeen[worksheet.id] ?? 0);
                          if (newCount <= 0) return null;
                          return <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-black text-white" title={`${newCount} respuesta${newCount !== 1 ? 's' : ''} nueva${newCount !== 1 ? 's' : ''} sin revisar`}>{newCount === 1 ? '!' : newCount}</span>;
                        })()}
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${worksheet.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{worksheet.status === 'published' ? 'Habilitada' : 'Borrador'}</span>
                        {(responseCounts[worksheet.id] ?? 0) > 0 ? (
                          <span className="rounded-full bg-rex-light px-3 py-1 text-xs font-bold text-rex-deep">{responseCounts[worksheet.id]} {responseCounts[worksheet.id] === 1 ? 'respuesta' : 'respuestas'}</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Sin respuestas</span>
                        )}
                      </div>
                      <h3 className="mt-3 text-lg font-bold">{worksheet.title}</h3>
                      <p className="text-sm text-slate-500"><RichText text={worksheet.description} /></p>
                      <p className="mt-2 text-xs text-slate-400">Intentos: {worksheet.maxAttempts ?? 'Ilimitada'}</p>
                      <p className="mt-1 text-xs font-semibold text-emerald-700">Aulas: {worksheetClassrooms[worksheet.id]?.map((classroom) => classroom.name).join(', ') || 'Sin asignar'}</p>
                    </div>
                    {/* Acciones: las 4 de uso diario quedan a la vista; el resto vive en "⋯ Más"
                        (<details> nativo, sin estado) para que la fila no sea un muro de botones. */}
                    <div className="flex flex-wrap items-start gap-2 text-sm">
                      <button className="rounded-2xl border border-rex/30 px-4 py-2 font-semibold text-rex-deep" onClick={() => togglePublished(worksheet)}>{worksheet.status === 'published' ? 'Deshabilitar' : 'Habilitar'}</button>
                      {worksheet.status === 'published' && (
                        <button
                          className="rounded-2xl border border-rex/30 px-4 py-2 font-semibold text-rex-deep"
                          title="Copia un enlace directo: el alumno entra sin login ni menú, resuelve y envía"
                          onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/w/${worksheet.id}`); setMessage('Enlace directo copiado. Compártelo con los alumnos — entran sin login y sus respuestas llegan a tus respuestas.'); }}
                        ><Link2 className="mr-1 inline" size={16} /> Copiar enlace</button>
                      )}
                      <button className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold" onClick={() => loadWorksheetResponses(worksheet)}>Ver respuestas</button>
                      <button className="rounded-2xl border border-emerald-200 px-4 py-2 font-semibold text-emerald-700" onClick={() => openAssignWorksheetModal(worksheet)}>Asignar a aula</button>

                      <details className="row-menu">
                        <summary className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold text-slate-600" title="Más acciones">
                          <MoreHorizontal className="mr-1 inline" size={16} /> Más
                        </summary>
                        <div className="row-menu-panel" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
                          <button
                            className="rounded-xl border border-rex/30 px-3 py-2 font-semibold text-rex-deep disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={(responseCounts[worksheet.id] ?? 0) > 0}
                            title={(responseCounts[worksheet.id] ?? 0) > 0 ? 'No se puede editar: ya tiene respuestas. Duplícala.' : 'Editar esta evaluación'}
                            onClick={() => startEditWorksheet(worksheet)}
                          ><Pencil className="mr-2 inline" size={15} /> Editar</button>
                          <button className="rounded-xl border border-rex/30 px-3 py-2 font-semibold text-rex-deep" onClick={() => setPreviewWorksheet(worksheet)}><Eye className="mr-2 inline" size={15} /> Vista previa</button>
                          <button className="rounded-xl border border-spike/30 px-3 py-2 font-semibold text-spike-dark" onClick={() => openPractice(worksheet)} title="Resuelve la hoja tú mismo para revisar las respuestas (no se guarda nada)"><GraduationCap className="mr-2 inline" size={15} /> Modo práctica</button>
                          <button className="rounded-xl border border-slate-300 px-3 py-2 font-semibold text-slate-700" onClick={() => setPrintWorksheet(worksheet)}><Printer className="mr-2 inline" size={15} /> Imprimir PDF</button>
                          <button className="rounded-xl border border-spike/30 px-3 py-2 font-semibold text-spike-dark disabled:opacity-50" disabled={isDuplicating === worksheet.id} onClick={() => handleDuplicateWorksheet(worksheet)}><Copy className="mr-2 inline" size={15} />{isDuplicating === worksheet.id ? 'Duplicando...' : 'Duplicar'}</button>
                          <button className="rounded-xl border border-amber-200 px-3 py-2 font-semibold text-amber-700" onClick={() => toggleArchived(worksheet)}><Archive className="mr-2 inline" size={15} /> Archivar</button>
                          <button className="rounded-xl border border-red-200 px-3 py-2 font-semibold text-red-600" onClick={() => removeWorksheet(worksheet)}><Trash2 className="mr-2 inline" size={15} /> Borrar</button>
                        </div>
                      </details>
                    </div>
                  </div>
                </article>
              ))}
              {!filteredWorksheets.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{wsSearch ? 'No se encontraron evaluaciones con ese término.' : 'No hay evaluaciones activas en el menú.'}</p>}
            </div>
            {/* Pagination */}
            {wsPageCount > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-500">{filteredWorksheets.length} evaluaciones · página {wsPage} de {wsPageCount}</span>
                <div className="flex gap-2">
                  <button className="rounded-xl border px-3 py-1.5 font-semibold disabled:opacity-40" disabled={wsPage <= 1} onClick={() => setWsPage((p) => p - 1)}><ChevronLeft size={16} /></button>
                  <button className="rounded-xl border px-3 py-1.5 font-semibold disabled:opacity-40" disabled={wsPage >= wsPageCount} onClick={() => setWsPage((p) => p + 1)}><ChevronRight size={16} /></button>
                </div>
              </div>
            )}
          </section>
        )}
        {adminMenu === 'archivadas' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-600">Archivadas</p>
            <h2 className="text-2xl font-bold">Almacén de hojas</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Guarda aquí lo que ya no está en uso sin perderlo: la hoja y sus respuestas se conservan, pero desaparecen del portal del alumno hasta que la desarchives. Es la alternativa segura a borrar.</p>
            <div className="mt-5 grid gap-3">
              {archivedWorksheets.map((worksheet) => (
                <article key={worksheet.id} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Archivada</span>
                        {(responseCounts[worksheet.id] ?? 0) > 0 ? (
                          <span className="rounded-full bg-rex-light px-3 py-1 text-xs font-bold text-rex-deep">{responseCounts[worksheet.id]} {responseCounts[worksheet.id] === 1 ? 'respuesta' : 'respuestas'}</span>
                        ) : (
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500">Sin respuestas</span>
                        )}
                      </div>
                      <h4 className="mt-3 font-bold">{worksheet.title}</h4>
                      <p className="text-sm text-slate-500"><RichText text={worksheet.description} /></p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(responseCounts[worksheet.id] ?? 0) > 0 && (
                        <button className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold" onClick={() => loadWorksheetResponses(worksheet)}>Ver respuestas</button>
                      )}
                      <button className="rounded-2xl border border-amber-200 bg-white px-4 py-2 font-semibold text-amber-700" onClick={() => toggleArchived(worksheet)}>Desarchivar</button>
                      <button className="rounded-2xl border border-red-200 bg-white px-4 py-2 font-semibold text-red-600" onClick={() => removeWorksheet(worksheet)}><Trash2 className="mr-1 inline" size={16} /> Borrar</button>
                    </div>
                  </div>
                </article>
              ))}
              {!archivedWorksheets.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No hay evaluaciones archivadas.</p>}
            </div>
          </section>
        )}
        {user.role === 'admin' && adminMenu === 'profesores' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Administración</p>
            <h2 className="text-2xl font-bold">Profesores</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Alta de cuentas docentes. Cada profesor trabaja aislado: solo ve sus propias aulas, alumnos y evaluaciones. Los profesores también pueden registrarse ellos mismos desde la pantalla de acceso.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <input className="rounded-2xl border p-3" placeholder="Nombre" value={teacherForm.name} onChange={(e) => setTeacherForm({ ...teacherForm, name: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Usuario" value={teacherForm.username} onChange={(e) => setTeacherForm({ ...teacherForm, username: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Contraseña" value={teacherForm.password} onChange={(e) => setTeacherForm({ ...teacherForm, password: e.target.value })} />
              <input className="rounded-2xl border p-3" placeholder="Correo opcional" value={teacherForm.email} onChange={(e) => setTeacherForm({ ...teacherForm, email: e.target.value })} />
            </div>
            <button className="mt-4 rounded-2xl bg-rex px-5 py-3 font-semibold text-white" onClick={createNewTeacher}>Guardar profesor</button>
            {message && <p className="mt-3 rounded-2xl bg-rex-light p-3 text-rex-deep">{message}</p>}
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
        {adminMenu === 'actividad' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-rex">Sesiones</p>
                <h2 className="text-2xl font-bold">Actividad de estudiantes</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">Quién está conectado ahora, cuándo entró por última vez y cuántas veces ha usado la plataforma. Útil para saber si un alumno no entregó porque no entró o porque se le complicó la hoja.</p>
              </div>
              <button
                className={`rounded-full p-2 transition-colors ${refreshCooldowns.has('activity-refresh') ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-100'}`}
                type="button" title="Actualizar" disabled={refreshCooldowns.has('activity-refresh')}
                onClick={() => withCooldown('activity-refresh', () => { void getStudentsActivity().then(setStudentsActivity).catch(() => {}); })}
              ><RefreshCw size={16} /></button>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="pb-3 pr-4 font-semibold">Estudiante</th>
                    <th className="pb-3 pr-4 font-semibold">Estado</th>
                    <th className="pb-3 pr-4 font-semibold">Último acceso</th>
                    <th className="pb-3 pr-4 font-semibold">Sesiones</th>
                    <th className="pb-3 font-semibold">Historial</th>
                  </tr>
                </thead>
                <tbody>
                  {studentsActivity.map((sa) => {
                    const lastLogin = sa.last_login ? new Date(sa.last_login) : null;
                    const now = Date.now();
                    let lastLoginLabel = 'Sin acceso';
                    if (lastLogin) {
                      const diffMs = now - lastLogin.getTime();
                      const diffMins = Math.floor(diffMs / 60000);
                      const diffHrs = Math.floor(diffMins / 60);
                      const diffDays = Math.floor(diffHrs / 24);
                      if (diffMins < 1) lastLoginLabel = 'Hace un momento';
                      else if (diffMins < 60) lastLoginLabel = `Hace ${diffMins} min`;
                      else if (diffHrs < 24) lastLoginLabel = `Hace ${diffHrs}h`;
                      else if (diffDays === 1) lastLoginLabel = 'Ayer';
                      else lastLoginLabel = `Hace ${diffDays} días`;
                    }
                    return (
                      <tr key={sa.student_id} className="border-b last:border-0">
                        <td className="py-3 pr-4">
                          <div className="font-semibold">{sa.student_name}</div>
                          <div className="text-xs text-slate-400">@{sa.username}</div>
                        </td>
                        <td className="py-3 pr-4">
                          {sa.is_online
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />En línea</span>
                            : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500"><span className="h-2 w-2 rounded-full bg-slate-400" />Desconectado</span>}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{lastLoginLabel}</td>
                        <td className="py-3 pr-4 font-semibold">{sa.total_sessions}</td>
                        <td className="py-3">
                          <button
                            className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
                            type="button"
                            onClick={() => {
                              void listStudentSessions(sa.student_id).then((sessions) => setSessionModal({ student: sa, sessions }));
                            }}
                          >Ver historial</button>
                        </td>
                      </tr>
                    );
                  })}
                  {!studentsActivity.length && (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-400">No hay estudiantes registrados aún.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {adminMenu === 'vocabulario' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <VocabularyManager
              lists={vocabularyLists}
              classrooms={classrooms}
              readers={readers.map((r) => ({ id: r.id, name: r.name, username: r.username }))}
              onCreate={async (title, description, items) => {
                if (!user) return;
                const created = await createVocabularyList(title, description, user.id, items);
                setVocabularyLists((prev) => [created, ...prev]);
                setVocabAssignedClassrooms((prev) => ({ ...prev, [created.id]: [] }));
                setVocabAssignedReaders((prev) => ({ ...prev, [created.id]: [] }));
              }}
              onDeleted={handleVocabDelete}
              onAssign={handleVocabAssign}
              onUnassign={handleVocabUnassign}
              assignedClassrooms={vocabAssignedClassrooms}
              onAssignReader={handleReaderAssignToList}
              onUnassignReader={handleReaderUnassignFromList}
              assignedReaders={vocabAssignedReaders}
            />
          </section>
        )}
        {adminMenu === 'revision' && revisionSelectedId === null && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-rex">Revisión</p>
                <h2 className="text-2xl font-bold">Hojas de trabajo</h2>
              </div>
              <button className={`rounded-full p-2 transition-colors ${refreshCooldowns.has('revision-counts') ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-100'}`} type="button" title="Actualizar conteos" disabled={refreshCooldowns.has('revision-counts')} onClick={() => withCooldown('revision-counts', () => loadResponseCounts())}><RefreshCw size={16} /></button>
            </div>
            <p className="max-w-3xl text-sm text-slate-500">Aquí llegan las entregas. Abre una hoja para ver, alumno por alumno, qué respondió y qué se le calificó: lo cerrado se corrige solo, lo abierto lo evalúa la IA (si la activaste) y tú tienes la última palabra sobre cualquier respuesta. El número grande es cuántos han contestado; la marca roja, las entregas que aún no has abierto.</p>
            <div className="mt-5 grid gap-3">
              {savedWorksheets.map((worksheet) => {
                const count = responseCounts[worksheet.id] ?? 0;
                const newCount = count - (responseSeen[worksheet.id] ?? 0);
                const hasNew = newCount > 0;
                return (
                  <button
                    key={worksheet.id}
                    type="button"
                    className={`flex items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-colors hover:border-rex/40 hover:bg-rex-light/40 ${hasNew ? 'border-red-300 bg-red-50/40' : 'border-slate-100'}`}
                    onClick={() => loadWorksheetResponses(worksheet)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {hasNew && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-black text-white" title={`${newCount} respuesta${newCount !== 1 ? 's' : ''} nueva${newCount !== 1 ? 's' : ''} sin revisar`}>{newCount === 1 ? '!' : newCount}</span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${worksheet.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{worksheet.status === 'published' ? 'Habilitada' : 'Borrador'}</span>
                        <h3 className="truncate text-lg font-bold">{worksheet.title}</h3>
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-500"><RichText text={worksheet.description} /></p>
                    </div>
                    <div className="shrink-0 text-center">
                      <p className={`text-3xl font-bold ${hasNew ? 'text-red-600' : count > 0 ? 'text-rex' : 'text-slate-300'}`}>{count}</p>
                      <p className="text-xs text-slate-400">{count === 1 ? 'respuesta' : 'respuestas'}</p>
                    </div>
                  </button>
                );
              })}
              {!savedWorksheets.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No hay hojas de trabajo activas.</p>}
            </div>
          </section>
        )}
        {adminMenu === 'revision' && revisionSelectedId !== null && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap gap-2">
              <button className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50" type="button" onClick={() => { setRevisionSelectedId(null); void loadResponseCounts(); }}><ChevronLeft size={16} /> Volver a la lista</button>
              <button className="inline-flex items-center gap-1 rounded-2xl border border-rex/30 px-3 py-1.5 text-sm font-semibold text-rex-deep hover:bg-rex-light" type="button" title="Ir a las evaluaciones guardadas" onClick={() => handleSelectMenu('evaluaciones')}><BookOpen size={15} /> Evaluaciones guardadas</button>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-2xl font-bold">Revisión de {activeWorksheet.title}</h2>
              <div className="flex flex-wrap gap-2">
                {responses.length > 0 && (
                  <button className="rounded-2xl border border-emerald-200 px-4 py-2 font-semibold text-emerald-700 text-sm" type="button" title="Descarga la tabla de notas para abrirla en Excel" onClick={exportResponsesCsv}><Download className="mr-1 inline" size={15} /> Exportar CSV</button>
                )}
                <button className="rounded-2xl border border-rex/30 px-4 py-2 font-semibold text-rex-deep text-sm" type="button" title="Ver la hoja tal como la ve el alumno" onClick={() => setPreviewWorksheet(activeWorksheet)}><Eye className="mr-1 inline" size={15} /> Vista previa</button>
                <button
                  className="rounded-2xl border border-rex/30 px-4 py-2 font-semibold text-rex-deep text-sm"
                  type="button"
                  title="Editar esta hoja de trabajo"
                  onClick={() => startEditWorksheet(activeWorksheet)}
                >
                  <Pencil className="mr-1 inline" size={15} /> Editar hoja
                </button>
                <button className="rounded-2xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 text-sm" type="button" title="Imprimir en papel / PDF" onClick={() => setPrintWorksheet(activeWorksheet)}><Printer className="mr-1 inline" size={15} /> Imprimir PDF</button>
                <button className={`rounded-full p-2 transition-colors ${refreshCooldowns.has('responses-refresh') ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-100'}`} type="button" title="Actualizar" disabled={refreshCooldowns.has('responses-refresh')} onClick={() => withCooldown('responses-refresh', () => loadWorksheetResponses(activeWorksheet))}><RefreshCw size={16} /></button>
            </div>
            </div>
            <p className="text-sm text-slate-500">Elige un alumno para ver su entrega actividad por actividad. Puedes ajustar a mano lo que la IA o el corrector automático marcaron mal (típico en fill in the blank con un dedazo) y dejarle un comentario. La nota, la fecha y los aciertos quedan guardados aunque después deshabilites la evaluación.</p>
            {/* Botones por alumno: seleccionar para ver solo sus respuestas */}
            {responses.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {responses.map((r) => {
                  const active = selectedResponseId === r.id;
                  const isNew = !active && !seenResponseIds.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { setSelectedResponseId(r.id); markResponseSeen(r.id); }}
                      title={isNew ? 'Respuesta nueva sin revisar' : undefined}
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${active ? 'bg-rex text-white shadow-sm' : isNew ? 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100' : 'border border-slate-200 text-slate-600 hover:border-rex/40 hover:text-rex-deep'}`}
                    >
                      {isNew && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">!</span>}
                      {r.student_name}
                      <span className={`rounded-full px-1.5 text-xs font-bold ${active ? 'bg-white/20' : isNew ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{r.score ?? '—'}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!responses.length && <p className="mt-5 rounded-2xl bg-slate-50 p-5">Esta evaluación aún no tiene respuestas.</p>}
            <div className="mt-4">
              {(() => {
                const response = responses.find((r) => r.id === selectedResponseId);
                if (!response) return responses.length
                  ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Selecciona un alumno arriba para ver sus respuestas.</p>
                  : null;
                return (
                <article key={response.id} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3"><h3 className="font-bold">{response.student_name}</h3><button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600" type="button" onClick={() => removeResponse(response)}>Eliminar respuesta</button></div>
                  <p className="text-sm text-slate-500">Fecha: {new Date(response.submitted_at).toLocaleString()} · Puntuación: {response.score ?? 'pendiente'} · Aciertos: {response.correct_count} · Pendientes: {response.pending_count}</p>
                  {/* Campos de identificación (_info_*) */}
                  {(activeWorksheet.infoFields?.length ?? 0) > 0 && (() => {
                    const infoAnswers = activeWorksheet.infoFields!.map((label, i) => ({
                      label,
                      value: String((response.answers_json as Record<string, unknown>)?.[`_info_${i}`] ?? '—'),
                    }));
                    return (
                      <div className="mt-3 flex flex-wrap gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        {infoAnswers.map(({ label, value }) => (
                          <div key={label} className="text-sm">
                            <span className="font-semibold text-amber-800">{label}:</span>{' '}
                            <span className="text-slate-700">{value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {response.details.map((detail) => {
                    const key = `${response.id}-${detail.activity_id}`;
                    const canReview = detail.status === 'pending' || detail.activity_type === 'fillblank' || detail.activity_type === 'listeningfillblank';
                    const hasAiComment = !!detail.teacher_comment;
                    return (
                      <div key={detail.activity_id} className={`mt-3 rounded-xl border p-3 ${statusBadge(detail.status)}`}>
                        <div className="flex items-start justify-between gap-2">
                          <strong className="text-sm"><RichText text={detail.prompt} /></strong>
                          {hasAiComment && (
                            <span className="shrink-0 rounded-full bg-spike/15 px-2 py-0.5 text-xs font-bold text-spike-dark">✦ IA</span>
                          )}
                        </div>
                        <p className="text-sm">Respuesta: <RichText text={answerText(detail.student_answer)} /></p>
                        {detail.correct_answer !== null && <p className="text-sm">Correcta: <RichText text={answerText(detail.correct_answer)} /></p>}
                        {hasAiComment && !canReview && (
                          <p className="mt-1 text-sm italic opacity-80">💬 {detail.teacher_comment}</p>
                        )}
                        {canReview && (
                          <div className="mt-2 grid gap-2">
                            <textarea
                              className="rounded-xl border p-2 text-sm"
                              placeholder="Comentario para el estudiante (pre-cargado por IA)"
                              value={reviewComments[key] ?? ''}
                              onChange={(e) => setReviewComments({ ...reviewComments, [key]: e.target.value })}
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button className="rounded-xl bg-emerald-600 px-3 py-2 text-white" type="button" onClick={() => review(response, detail, 'correct')}><Check size={16} /></button>
                              <button className="rounded-xl bg-red-600 px-3 py-2 text-white" type="button" onClick={() => review(response, detail, 'incorrect')}><X size={16} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </article>
                );
              })()}
            </div>
          </section>
        )}
        {adminMenu === 'invitados' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            {!selectedGuest ? (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-spike">Invitados</p>
                <h2 className="text-2xl font-bold">Seguimiento de invitados</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">Alumnos que respondieron sin cuenta. Se identifican por aula + nombre escrito al entrar. Abre uno para ver qué hojas ya entregó, con qué nota, y cuáles le faltan.</p>
                <div className="mt-5 grid gap-3">
                  {guestLogs.map((log) => (
                    <button
                      key={`${log.guest_token}-${log.classroom_id}`}
                      type="button"
                      onClick={() => void openGuest(log)}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 p-4 text-left transition-colors hover:border-spike/40 hover:bg-spike/10/40"
                    >
                      <div>
                        <h3 className="text-lg font-bold">{log.name}</h3>
                        <span className="rounded-full bg-spike/10 px-3 py-1 text-xs font-semibold text-spike-dark">{log.classroom_name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span>Último acceso: {new Date(log.last_accessed_at).toLocaleString()}</span>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{log.visit_count}× ingresos</span>
                      </div>
                    </button>
                  ))}
                  {!guestLogs.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Sin invitados registrados aún.</p>}
                </div>
              </>
            ) : (
              <>
                <button className="mb-4 inline-flex items-center gap-1 rounded-2xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50" type="button" onClick={() => setSelectedGuest(null)}><ChevronLeft size={16} /> Volver a la lista</button>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedGuest.name}</h2>
                    <span className="rounded-full bg-spike/10 px-3 py-1 text-xs font-semibold text-spike-dark">{selectedGuest.classroom_name}</span>
                  </div>
                  <div className="grid gap-1 text-right text-sm text-slate-500">
                    <span>Última sesión: {new Date(selectedGuest.last_accessed_at).toLocaleString()}</span>
                    <span>Ingresos: <strong className="text-emerald-700">{selectedGuest.visit_count}</strong></span>
                  </div>
                </div>

                {!guestDetail ? (
                  <p className="mt-6 text-sm text-slate-500">Cargando…</p>
                ) : (
                  <div className="mt-6 grid gap-6">
                    <div>
                      <h3 className="font-bold">Hojas pendientes <span className="text-sm font-normal text-slate-400">({guestDetail.pending.length})</span></h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {guestDetail.pending.map((w) => (
                          <span key={w.id} className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700">{w.title}</span>
                        ))}
                        {!guestDetail.pending.length && <p className="text-sm text-slate-500">Sin hojas pendientes. ¡Completó todo lo habilitado! 🎉</p>}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-bold">Hojas realizadas <span className="text-sm font-normal text-slate-400">({guestDetail.responses.length})</span></h3>
                      <div className="mt-3 grid gap-3">
                        {guestDetail.responses.map((response) => (
                          <article key={response.id} className="rounded-2xl border p-4">
                            <button
                              type="button"
                              onClick={() => setExpandedResponseId(expandedResponseId === response.id ? null : response.id)}
                              className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                            >
                              <div>
                                <h4 className="font-bold">{response.worksheet_title}</h4>
                                <p className="text-xs text-slate-500">Enviada: {new Date(response.submitted_at).toLocaleString()}</p>
                              </div>
                              <div className="flex items-center gap-3 text-sm">
                                <span className="font-bold text-rex-deep">{response.score ?? '—'}%</span>
                                <span className="font-bold text-emerald-700">✓ {response.correct_count}</span>
                                {response.pending_count > 0 && <span className="font-bold text-amber-600">⏳ {response.pending_count}</span>}
                                <ChevronRight size={16} className={`transition-transform ${expandedResponseId === response.id ? 'rotate-90' : ''}`} />
                              </div>
                            </button>
                            {expandedResponseId === response.id && <ResponseDetails response={response} />}
                          </article>
                        ))}
                        {!guestDetail.responses.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Aún no ha enviado ninguna hoja.</p>}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {adminMenu === 'imagenes' && <ImageLibraryPage />}
      </div>
      {sessionModal && (
        <div className="fixed inset-0 z-50 overflow-auto bg-slate-900/60 p-6" onClick={() => setSessionModal(null)}>
          <div className="mx-auto max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-xl font-bold">Historial de sesiones</h2>
                <p className="text-sm text-slate-500">{sessionModal.student.student_name} (@{sessionModal.student.username})</p>
              </div>
              <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setSessionModal(null)}>Cerrar</button>
            </div>
            {sessionModal.sessions.length === 0
              ? <p className="text-sm text-slate-500">Este estudiante no tiene sesiones registradas.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left text-slate-500"><th className="pb-2 pr-3 font-semibold">Entrada</th><th className="pb-2 pr-3 font-semibold">Salida</th><th className="pb-2 font-semibold">Duración</th></tr></thead>
                    <tbody>
                      {sessionModal.sessions.map((s) => {
                        const inTime = new Date(s.logged_in_at);
                        const outTime = s.logged_out_at ? new Date(s.logged_out_at) : null;
                        const durMs = outTime ? outTime.getTime() - inTime.getTime() : null;
                        const durLabel = durMs === null ? '—' : durMs < 60000 ? `${Math.round(durMs / 1000)}s` : durMs < 3600000 ? `${Math.round(durMs / 60000)}min` : `${(durMs / 3600000).toFixed(1)}h`;
                        return (
                          <tr key={s.id} className="border-b last:border-0">
                            <td className="py-2 pr-3">{inTime.toLocaleString()}</td>
                            <td className="py-2 pr-3">{outTime ? outTime.toLocaleString() : <span className="text-emerald-600 font-semibold">Activa</span>}</td>
                            <td className="py-2">{durLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}
      {assignmentWorksheet && (
        <div className="fixed inset-0 z-50 overflow-auto bg-slate-900/60 p-6">
          <div className="mx-auto max-w-xl rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-bold">Asignar a aula</h2><p className="text-sm text-slate-500">{assignmentWorksheet.title}</p></div>
              <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setAssignmentWorksheet(null)}>Cancelar</button>
            </div>
            <label className="mt-4 flex items-center gap-2 rounded-2xl bg-rex-light p-3 font-semibold text-rex-deep">
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
            {/* Due date */}
            <div className="mt-4">
              <label className="block text-sm font-semibold text-slate-600 mb-1">Fecha límite (opcional)</label>
              <input
                type="datetime-local"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                value={assignDueDate}
                onChange={(e) => setAssignDueDate(e.target.value)}
              />
              {assignDueDate && (
                <button className="mt-1 text-xs text-slate-400 hover:text-red-500" type="button" onClick={() => setAssignDueDate('')}>✕ Quitar fecha límite</button>
              )}
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Vista previa: {previewWorksheet.title}</h2>
              <div className="flex gap-2">
                <button
                  className="rounded-2xl border border-rex/30 px-4 py-2 font-semibold text-rex-deep disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={(responseCounts[previewWorksheet.id] ?? 0) > 0}
                  title={(responseCounts[previewWorksheet.id] ?? 0) > 0 ? 'No se puede editar: ya tiene respuestas.' : 'Editar esta evaluación'}
                  onClick={() => { const w = previewWorksheet; setPreviewWorksheet(null); startEditWorksheet(w); }}
                ><Pencil className="mr-1 inline" size={16} /> Editar</button>
                <button className="rounded-2xl border border-spike/30 px-4 py-2 font-semibold text-spike-dark" onClick={() => { const w = previewWorksheet; setPreviewWorksheet(null); openPractice(w); }} title="Resuélvela tú mismo para revisar las respuestas"><GraduationCap className="mr-1 inline" size={16} /> Modo práctica</button>
                <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setPreviewWorksheet(null)}>Cerrar</button>
              </div>
            </div>
            <p className="mb-4 text-sm text-slate-500">Así verá la hoja el estudiante. Puedes editarla mientras no tenga respuestas.</p>
            <WorksheetRenderer worksheet={previewWorksheet} answers={{}} readonly onAnswerChange={() => undefined} />
          </div>
        </div>
      )}
      {practiceWorksheet && (
        <div className="fixed inset-0 z-50 overflow-auto bg-slate-900/60 p-6">
          <div className="mx-auto max-w-5xl rounded-3xl bg-slate-50 p-5 shadow-2xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold"><GraduationCap className="mr-1 inline text-spike" size={20} /> Modo práctica: {practiceWorksheet.title}</h2>
              <div className="flex gap-2">
                <button className="rounded-2xl bg-spike px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={practiceLoading} onClick={() => void runPractice()}>{practiceLoading ? 'Revisando...' : 'Revisar respuestas'}</button>
                <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => { setPracticeAnswers({}); setPracticeResult(null); }}>Reiniciar</button>
                <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setPracticeWorksheet(null)}>Cerrar</button>
              </div>
            </div>
            <p className="mb-4 rounded-xl bg-spike/10 px-4 py-2 text-sm text-spike-dark">Estás resolviendo la hoja como un alumno para verificar las respuestas. <b>Nada se guarda</b> — es solo para revisar tu clave de respuestas.</p>
            {practiceResult && (() => {
              const incorrect = practiceResult.details.filter((d) => d.status === 'incorrect').length;
              return (
                <div className="mb-4 rounded-2xl border border-spike/30 bg-white p-4">
                  <p className="text-lg font-bold text-slate-800">
                    Puntaje: <span className="text-spike-dark">{practiceResult.score ?? 0}</span>
                    <span className="ml-3 text-sm font-semibold text-emerald-700">✓ {practiceResult.correct_count} correctas</span>
                    <span className="ml-3 text-sm font-semibold text-red-600">✗ {incorrect} incorrectas</span>
                    {practiceResult.pending_count > 0 && <span className="ml-3 text-sm font-semibold text-amber-600">… {practiceResult.pending_count} abiertas (las califica IA/profesor)</span>}
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-500">Ver detalle por actividad</summary>
                    <div className="mt-2 grid gap-2">
                      {practiceResult.details.map((d, i) => (
                        <div key={i} className={`rounded-xl border p-2 text-sm ${d.status === 'correct' ? 'border-emerald-200 bg-emerald-50' : d.status === 'incorrect' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                          <p className="font-semibold text-slate-700">{d.status === 'correct' ? '✓' : d.status === 'incorrect' ? '✗' : '…'} {String(d.prompt).slice(0, 90)}</p>
                          <p className="text-slate-500">Tu respuesta: {answerText(d.student_answer)}{d.status === 'incorrect' && <> · Correcta: <b>{answerText(d.correct_answer)}</b></>}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              );
            })()}
            <WorksheetRenderer worksheet={practiceWorksheet} answers={practiceAnswers} onAnswerChange={updatePracticeAnswer} gradeStatus={practiceResult ? buildGradeStatus(practiceResult.details) : undefined} />
          </div>
        </div>
      )}
      {historyOpen && (
        <div className="fixed inset-0 z-[60] overflow-auto bg-slate-900/60 p-6" onClick={() => setHistoryOpen(false)}>
          <div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold"><History className="mr-2 inline text-rex" size={20} /> Historial de notificaciones</h2>
                <p className="text-sm text-slate-500">Entregas e ingresos de los últimos 7 días. Pasada esa semana los eventos dejan de listarse.</p>
              </div>
              <button className="rounded-2xl border px-4 py-2 font-semibold" onClick={() => setHistoryOpen(false)}>Cerrar</button>
            </div>
            {historyFeed === null
              ? <p className="py-8 text-center text-sm text-slate-500">Cargando historial…</p>
              : historyFeed.length === 0
                ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No hubo actividad en los últimos 7 días.</p>
                : <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-auto rounded-2xl border border-slate-100">
                    {historyFeed.map((e, i) => <FeedRow key={i} event={e} />)}
                  </ul>}
          </div>
        </div>
      )}
      {printWorksheet && <WorksheetPrint worksheet={printWorksheet} onClose={() => setPrintWorksheet(null)} />}
    </main>
  );
}
