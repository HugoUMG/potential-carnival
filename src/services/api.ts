import type { ActivityBlock, ActivityType, StudentAnswers, VocabularyItem, VocabularyList, Worksheet, WorksheetActivity } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const AUTH_STORAGE_KEY = 'worksheet_auth_session';

export interface UsuarioSesion {
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'teacher' | 'student' | 'reader';
  email?: string | null;
  accessToken?: string;
}

type EstadoDetalle = 'correct' | 'incorrect' | 'pending';

export interface DetalleRespuesta {
  activity_id: string;
  activity_type: string;
  prompt: string;
  student_answer: unknown;
  correct_answer: unknown;
  status: EstadoDetalle;
  teacher_comment: string;
}

interface BackendActivity {
  id: string;
  type: ActivityType;
  text?: string | null;
  question?: string | null;
  options?: string[] | null;
  answer?: string | string[] | null;
  prompt?: string | null;
  left?: string[] | null;
  right?: string[] | null;
  title?: string | null;
  content?: string | null;
  questions?: string[] | null;
  image?: string | null;
  instructions?: string | null;
  audio_text?: string | null;
  target?: string | null;
  bank?: string[] | null;
  pairs?: { audio_text: string; match: string }[] | null;
  statements?: { text: string; answer: boolean }[] | null;
}

interface BackendActivityBlock {
  title?: string | null;
  instructions?: string | null;
  activities: BackendActivity[];
}

interface BackendWorksheet {
  id: string;
  title: string;
  description: string;
  script_content: string;
  json_content: { title: string; description: string; activities?: BackendActivity[]; blocks?: BackendActivityBlock[] };
  created_by: string;
  created_at: string;
  published: boolean;
  archived: boolean;
  max_attempts?: number | null;
  theme?: { primary_color?: string; background_color?: string; text_color?: string } | null;
  ai_grading?: boolean;
  attempts_used?: number | null;
  attempts_remaining?: number | null;
}

export interface RespuestaEstudiante {
  id: string;
  worksheet_id: string;
  student_name: string;
  answers_json: StudentAnswers;
  details: DetalleRespuesta[];
  score: number | null;
  correct_count: number;
  pending_count: number;
  submitted_at: string;
  student_id?: string | null;
}

export interface Classroom {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  is_public: boolean;
}

export interface ClassroomDetail extends Classroom {
  students: UsuarioSesion[];
  worksheets: Worksheet[];
  student_statuses: Record<string, string>;
}

export interface TeacherStats {
  total_students: number;
  active_worksheets: number;
  total_responses: number;
  avg_scores: { worksheet_title: string; average_score: number }[];
  worksheet_stats: { worksheet_id: string; worksheet_title: string; responses: number; correct: number; incorrect: number; average_score: number }[];
  total_correct: number;
  total_incorrect: number;
  students_per_classroom: { classroom_name: string; student_count: number }[];
}

export interface UserSession {
  id: string;
  user_id: string;
  logged_in_at: string;
  logged_out_at: string | null;
}

export interface StudentActivity {
  student_id: string;
  student_name: string;
  username: string;
  last_login: string | null;
  is_online: boolean;
  total_sessions: number;
}

function getStoredSession(): UsuarioSesion | null {
  const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!rawSession) return null;
  try {
    return JSON.parse(rawSession) as UsuarioSesion;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function getCurrentSession(): UsuarioSesion | null {
  return getStoredSession();
}

export function logout(): void {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export async function logoutSession(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST' });
  } catch {
    // Token ya expirado o error de red — limpiar igualmente
  } finally {
    logout();
  }
}

interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
  ctx?: { min_length?: number; max_length?: number };
}

const FIELD_LABELS_ES: Record<string, string> = {
  password: 'La contraseña',
  new_password: 'La nueva contraseña',
  current_password: 'La contraseña actual',
  username: 'El usuario',
  name: 'El nombre',
  email: 'El correo',
  title: 'El título',
};

// FastAPI devuelve los errores de validación (422) como un array de objetos.
// Esto los convierte en un mensaje legible en español en vez de "[object Object]".
function formatErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = (detail as ValidationErrorItem[]).map((item) => {
      const field = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1]) : '';
      const label = FIELD_LABELS_ES[field] ?? field ?? 'Este campo';
      if (item.type === 'string_too_short' && item.ctx?.min_length != null) {
        return `${label} debe tener al menos ${item.ctx.min_length} caracteres.`;
      }
      if (item.type === 'missing') return `${label} es obligatorio.`;
      return item.msg ? `${label}: ${item.msg}` : 'Dato inválido.';
    });
    return messages.filter(Boolean).join(' · ') || 'Datos inválidos.';
  }
  return 'Error inesperado';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredSession()?.accessToken;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Error inesperado' }));
    const detail: string = formatErrorDetail(error.detail);
    if (response.status === 401) {
      // Si es el endpoint de login, el 401 significa credenciales incorrectas — mostrar mensaje real
      if (path === '/auth/login') {
        throw new Error(detail);
      }
      // Para cualquier otro endpoint, el 401 significa token expirado o inválido
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('session-expired'));
      throw new Error('Tu sesión ha expirado. Por favor inicia sesión nuevamente.');
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function withInstructions<T extends WorksheetActivity>(activity: T, source: BackendActivity): T {
  return source.instructions ? { ...activity, instructions: source.instructions } : activity;
}

function normalizeActivity(activity: BackendActivity): WorksheetActivity {
  switch (activity.type) {
    case 'fillblank':
      return withInstructions({ id: activity.id, type: 'fillblank', text: activity.text ?? '', answer: activity.answer ?? '' }, activity);
    case 'multiplechoice':
      return withInstructions({ id: activity.id, type: 'multiplechoice', question: activity.question ?? '', options: activity.options ?? [], answer: activity.answer ?? '' }, activity);
    case 'multiselect':
      return withInstructions({ id: activity.id, type: 'multiselect', question: activity.question ?? '', options: activity.options ?? [], answer: Array.isArray(activity.answer) ? activity.answer : (activity.answer ? [activity.answer] : []) }, activity);
    case 'dragdrop':
      return withInstructions({ id: activity.id, type: 'dragdrop', text: activity.text ?? '', answer: Array.isArray(activity.answer) ? activity.answer : (activity.answer ? [activity.answer] : []), bank: activity.bank ?? [] }, activity);
    case 'textbox':
      return withInstructions({ id: activity.id, type: 'textbox', prompt: activity.prompt ?? '' }, activity);
    case 'matching':
      return withInstructions({ id: activity.id, type: 'matching', left: activity.left ?? [], right: activity.right ?? [] }, activity);
    case 'speaking':
      return withInstructions({ id: activity.id, type: 'speaking', prompt: activity.prompt ?? '', target: activity.target ?? undefined }, activity);
    case 'reading':
      return withInstructions({ id: activity.id, type: 'reading', title: activity.title ?? '', content: activity.content ?? '', questions: activity.questions ?? [] }, activity);
    case 'imagequestion':
      return withInstructions({ id: activity.id, type: 'imagequestion', image: activity.image ?? '', prompt: activity.prompt ?? '' }, activity);
    case 'listening':
      return withInstructions({ id: activity.id, type: 'listening', text: activity.text ?? '', question: activity.question ?? '', answer: String(activity.answer ?? '') }, activity);
    case 'listeningfillblank':
      return withInstructions({ id: activity.id, type: 'listeningfillblank', audio_text: activity.audio_text ?? '', text: activity.text ?? '', answer: activity.answer ?? '' }, activity);
    case 'listeningmultiplechoice':
      return withInstructions({ id: activity.id, type: 'listeningmultiplechoice', audio_text: activity.audio_text ?? '', question: activity.question ?? '', options: activity.options ?? [], answer: String(activity.answer ?? '') }, activity);
    case 'listeningmatching':
      return withInstructions({ id: activity.id, type: 'listeningmatching', pairs: activity.pairs ?? [], options: activity.options ?? [] }, activity);
    case 'listeningtruefalse':
      return withInstructions({ id: activity.id, type: 'listeningtruefalse', audio_text: activity.audio_text ?? '', statements: activity.statements ?? [] }, activity);
    case 'truefalse':
      return withInstructions({ id: activity.id, type: 'truefalse', statements: activity.statements ?? [] }, activity);
    case 'readingtruefalse':
      return withInstructions({ id: activity.id, type: 'readingtruefalse', title: activity.title ?? '', content: activity.content ?? '', statements: activity.statements ?? [] }, activity);
  }
}

function normalizeBlocks(jsonContent: BackendWorksheet['json_content']): ActivityBlock[] | undefined {
  return jsonContent.blocks?.map((block) => ({
    title: block.title ?? null,
    instructions: block.instructions ?? null,
    activities: block.activities.map(normalizeActivity),
  }));
}


export function normalizeWorksheet(worksheet: BackendWorksheet): Worksheet {
  const blocks = normalizeBlocks(worksheet.json_content);
  const activities = blocks?.flatMap((block) => block.activities) ?? (worksheet.json_content.activities ?? []).map(normalizeActivity);
  return {
    id: worksheet.id,
    title: worksheet.title,
    description: worksheet.description,
    status: worksheet.published ? 'published' : 'draft',
    archived: worksheet.archived,
    scriptContent: worksheet.script_content,
    activities,
    blocks,
    createdBy: worksheet.created_by,
    createdAt: worksheet.created_at,
    maxAttempts: worksheet.max_attempts ?? null,
    theme: worksheet.theme ?? null,
    attemptsUsed: worksheet.attempts_used ?? null,
    attemptsRemaining: worksheet.attempts_remaining ?? null,
    aiGrading: worksheet.ai_grading ?? true,
    infoFields: (worksheet.json_content as { info_fields?: string[] }).info_fields ?? [],
  };
}

export async function login(username: string, password: string, role: UsuarioSesion['role']): Promise<UsuarioSesion> {
  const data = await request<{ user: UsuarioSesion; access_token: string; token_type: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, role }) });
  const session = { ...data.user, accessToken: data.access_token };
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export async function createStudent(name: string, username: string, password: string): Promise<UsuarioSesion> {
  return request<UsuarioSesion>('/students', { method: 'POST', body: JSON.stringify({ name, username, password }) });
}

export async function createTeacher(name: string, username: string, password: string, email?: string): Promise<UsuarioSesion> {
  return request<UsuarioSesion>('/teachers', { method: 'POST', body: JSON.stringify({ name, username, password, email: email || null }) });
}

export async function listStudents(): Promise<UsuarioSesion[]> {
  return request<UsuarioSesion[]>('/students');
}

export async function listTeachers(): Promise<UsuarioSesion[]> {
  return request<UsuarioSesion[]>('/teachers');
}

export async function deleteStudent(studentId: string): Promise<void> {
  await request<void>(`/students/${studentId}`, { method: 'DELETE' });
}

export async function deleteTeacher(teacherId: string): Promise<void> {
  await request<void>(`/teachers/${teacherId}`, { method: 'DELETE' });
}

export async function createWorksheet(scriptContent: string, createdBy: string, maxAttempts: number | null, aiGrading = true): Promise<Worksheet> {
  const worksheet = await request<BackendWorksheet>('/worksheets', { method: 'POST', body: JSON.stringify({ script_content: scriptContent, created_by: createdBy, max_attempts: maxAttempts, ai_grading: aiGrading }) });
  return normalizeWorksheet(worksheet);
}

export async function listTeacherWorksheets(createdBy?: string): Promise<Worksheet[]> {
  const path = createdBy ? `/worksheets?created_by=${createdBy}` : '/worksheets';
  const worksheets = await request<BackendWorksheet[]>(path);
  return worksheets.map(normalizeWorksheet);
}

export async function listStudentWorksheets(studentId: string): Promise<Worksheet[]> {
  const worksheets = await request<BackendWorksheet[]>(`/students/${studentId}/worksheets`);
  return worksheets.map(normalizeWorksheet);
}

export async function publishWorksheet(worksheetId: string, enabled: boolean): Promise<Worksheet> {
  const worksheet = await request<BackendWorksheet>(`/worksheets/${worksheetId}/${enabled ? 'publish' : 'unpublish'}`, { method: 'POST' });
  return normalizeWorksheet(worksheet);
}

export async function archiveWorksheet(worksheetId: string, archived: boolean): Promise<Worksheet> {
  const worksheet = await request<BackendWorksheet>(`/worksheets/${worksheetId}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' });
  return normalizeWorksheet(worksheet);
}

export async function deleteWorksheet(worksheetId: string): Promise<void> {
  await request<void>(`/worksheets/${worksheetId}`, { method: 'DELETE' });
}

export async function submitResponse(worksheet: Worksheet, user: UsuarioSesion, answers: StudentAnswers): Promise<RespuestaEstudiante> {
  return request<RespuestaEstudiante>('/responses', { method: 'POST', body: JSON.stringify({ worksheet_id: worksheet.id, student_id: user.id, student_name: user.name, answers_json: answers }) });
}

export async function listStudentResponses(studentId: string): Promise<RespuestaEstudiante[]> {
  return request<RespuestaEstudiante[]>(`/students/${studentId}/responses`);
}

export async function listStudentClassrooms(studentId: string): Promise<Classroom[]> {
  return request<Classroom[]>(`/students/${studentId}/classrooms`);
}

export async function changePassword(userId: string, newPassword: string, currentPassword?: string): Promise<void> {
  await request<void>(`/users/${userId}/password`, {
    method: 'PUT',
    body: JSON.stringify({ new_password: newPassword, ...(currentPassword ? { current_password: currentPassword } : {}) }),
  });
}

export async function listWorksheetResponses(worksheetId: string): Promise<RespuestaEstudiante[]> {
  return request<RespuestaEstudiante[]>(`/worksheets/${worksheetId}/responses`);
}

export async function getWorksheetResponseCounts(): Promise<Record<string, number>> {
  return request<Record<string, number>>('/worksheets/response-counts');
}

export interface ActivityEvent {
  tipo: 'nota' | 'ingreso_invitado' | 'ingreso_lector' | 'ingreso_alumno';
  nombre: string;
  detalle: string;
  ts: string;
}

export async function getTeacherActivityFeed(since?: string): Promise<ActivityEvent[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  return request<ActivityEvent[]>(`/teacher/activity-feed${q}`);
}

export async function reviewAnswer(responseId: string, activityId: string, status: 'correct' | 'incorrect', comment: string): Promise<RespuestaEstudiante> {
  return request<RespuestaEstudiante>(`/responses/${responseId}/review`, { method: 'POST', body: JSON.stringify({ activity_id: activityId, status, comment }) });
}


export async function deleteResponse(responseId: string): Promise<void> {
  await request<void>(`/responses/${responseId}`, { method: 'DELETE' });
}


export async function listClassrooms(): Promise<Classroom[]> {
  return request<Classroom[]>('/classrooms');
}

export async function createClassroom(name: string): Promise<Classroom> {
  return request<Classroom>('/classrooms', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function getClassroom(classroomId: string): Promise<ClassroomDetail> {
  const detail = await request<Omit<ClassroomDetail, 'worksheets'> & { worksheets: BackendWorksheet[] }>(`/classrooms/${classroomId}`);
  return { ...detail, worksheets: detail.worksheets.map(normalizeWorksheet) };
}

export async function assignStudentToClassroom(classroomId: string, studentId: string): Promise<void> {
  await request<void>(`/classrooms/${classroomId}/students`, { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
}

export async function unassignStudentFromClassroom(classroomId: string, studentId: string): Promise<void> {
  await request<void>(`/classrooms/${classroomId}/students/${studentId}`, { method: 'DELETE' });
}

export async function assignWorksheetToClassroom(classroomId: string, worksheetId: string, dueDate?: string | null): Promise<void> {
  await request<void>(`/classrooms/${classroomId}/worksheets`, { method: 'POST', body: JSON.stringify({ worksheet_id: worksheetId, due_date: dueDate ?? null }) });
}

export async function duplicateWorksheet(worksheetId: string): Promise<Worksheet> {
  return request<Worksheet>(`/worksheets/${worksheetId}/duplicate`, { method: 'POST' });
}

export async function unassignWorksheetFromClassroom(classroomId: string, worksheetId: string): Promise<void> {
  await request<void>(`/classrooms/${classroomId}/worksheets/${worksheetId}`, { method: 'DELETE' });
}

export async function deleteClassroom(classroomId: string): Promise<void> {
  await request<void>(`/classrooms/${classroomId}`, { method: 'DELETE' });
}

export async function setClassroomVisibility(classroomId: string, isPublic: boolean): Promise<void> {
  await request<void>(`/classrooms/${classroomId}/visibility`, { method: 'PATCH', body: JSON.stringify({ is_public: isPublic }) });
}

export interface TeacherNotification {
  id: string;
  student_name: string;
  worksheet_title: string;
  submitted_at: string;
  score: number | null;
}

export async function getTeacherNotifications(since?: string): Promise<TeacherNotification[]> {
  const url = since ? `/teacher/notifications?since=${encodeURIComponent(since)}` : '/teacher/notifications';
  return request<TeacherNotification[]>(url);
}

export interface GuestAccessLog {
  guest_token: string;
  name: string;
  classroom_id: string;
  classroom_name: string;
  visit_count: number;
  last_accessed_at: string;
}

export async function getGuestAccessLogs(): Promise<GuestAccessLog[]> {
  return request<GuestAccessLog[]>('/teacher/guest-logs');
}

export interface GuestDetail {
  responses: (RespuestaEstudiante & { worksheet_title: string })[];
  pending: { id: string; title: string }[];
}

export async function getGuestDetail(guestToken: string, classroomId: string): Promise<GuestDetail> {
  return request<GuestDetail>(`/teacher/guest-detail?guest_token=${encodeURIComponent(guestToken)}&classroom_id=${encodeURIComponent(classroomId)}`);
}

export interface ReaderAccessLog {
  reader_id: string;
  reader_name: string;
  visit_count: number;
  last_accessed_at: string;
}

export async function logReaderSession(): Promise<void> {
  await request<void>('/reader/log-session', { method: 'POST' });
}

export async function getReaderAccessLogs(): Promise<ReaderAccessLog[]> {
  return request<ReaderAccessLog[]>('/teacher/reader-logs');
}

export async function listWorksheetClassrooms(worksheetId: string): Promise<Classroom[]> {
  return request<Classroom[]>(`/worksheets/${worksheetId}/classrooms`);
}

export async function getWorksheetClassroomAssignments(): Promise<Record<string, Classroom[]>> {
  return request<Record<string, Classroom[]>>('/worksheets/classroom-assignments');
}

export async function getTeacherDashboard(): Promise<TeacherStats> {
  return request<TeacherStats>('/dashboard/teacher');
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', blob, `speech.${ext}`);
  // multipart: no fijar Content-Type (el navegador pone el boundary). Endpoint público.
  const response = await fetch(`${API_BASE_URL}/public/transcribe`, { method: 'POST', body: form });
  if (!response.ok) throw new Error('No se pudo transcribir el audio');
  const data = await response.json() as { transcript?: string };
  return data.transcript ?? '';
}

export async function getWorksheetSummary(worksheetId: string): Promise<string> {
  const res = await request<{ summary: string }>(`/teacher/worksheet-summary/${worksheetId}`);
  return res.summary;
}

export async function getStudentsActivity(): Promise<StudentActivity[]> {
  return request<StudentActivity[]>('/students/activity');
}

export async function listStudentSessions(studentId: string): Promise<UserSession[]> {
  return request<UserSession[]>(`/students/${studentId}/sessions`);
}

// ── Vocabulario ───────────────────────────────────────────────────────────────

export async function createVocabularyList(title: string, description: string, createdBy: string, items: VocabularyItem[]): Promise<VocabularyList> {
  return request<VocabularyList>('/vocabulary', { method: 'POST', body: JSON.stringify({ title, description, created_by: createdBy, items }) });
}

export async function listVocabularyLists(): Promise<VocabularyList[]> {
  return request<VocabularyList[]>('/vocabulary');
}

export async function deleteVocabularyList(listId: string): Promise<void> {
  await request<void>(`/vocabulary/${listId}`, { method: 'DELETE' });
}

export async function assignVocabularyToClassroom(listId: string, classroomId: string): Promise<void> {
  await request<void>(`/vocabulary/${listId}/assign`, { method: 'POST', body: JSON.stringify({ classroom_id: classroomId }) });
}

export async function unassignVocabularyFromClassroom(listId: string, classroomId: string): Promise<void> {
  await request<void>(`/vocabulary/${listId}/assign/${classroomId}`, { method: 'DELETE' });
}

export async function listVocabularyClassrooms(listId: string): Promise<string[]> {
  return request<string[]>(`/vocabulary/${listId}/classrooms`);
}

export async function listStudentVocabulary(studentId: string): Promise<VocabularyList[]> {
  return request<VocabularyList[]>(`/students/${studentId}/vocabulary`);
}

// ── Lectores ──────────────────────────────────────────────────────────────────

export async function createReader(name: string, username: string, password: string): Promise<UsuarioSesion> {
  return request<UsuarioSesion>('/readers', { method: 'POST', body: JSON.stringify({ name, username, password }) });
}

export async function listReaders(): Promise<UsuarioSesion[]> {
  return request<UsuarioSesion[]>('/readers');
}

export async function deleteReader(readerId: string): Promise<void> {
  await request<void>(`/readers/${readerId}`, { method: 'DELETE' });
}

export async function listReaderVocabulary(readerId: string): Promise<VocabularyList[]> {
  return request<VocabularyList[]>(`/readers/${readerId}/vocabulary`);
}

export async function assignReaderToList(listId: string, readerId: string): Promise<void> {
  await request<void>(`/vocabulary/${listId}/readers`, { method: 'POST', body: JSON.stringify({ reader_id: readerId }) });
}

export async function unassignReaderFromList(listId: string, readerId: string): Promise<void> {
  await request<void>(`/vocabulary/${listId}/readers/${readerId}`, { method: 'DELETE' });
}

export async function listReadersForList(listId: string): Promise<UsuarioSesion[]> {
  return request<UsuarioSesion[]>(`/vocabulary/${listId}/readers`);
}

export async function generateWorksheetWithAI(prompt: string, createdBy: string): Promise<Worksheet> {
  return request<Worksheet>('/worksheets/ai-generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, created_by: createdBy }),
  });
}
