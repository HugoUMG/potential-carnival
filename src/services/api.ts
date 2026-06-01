import type { StudentAnswers, Worksheet, WorksheetActivity } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface UsuarioSesion {
  id: string;
  name: string;
  username: string;
  role: 'teacher' | 'student';
  email?: string | null;
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
  type: WorksheetActivity['type'];
  text?: string | null;
  question?: string | null;
  options?: string[] | null;
  answer?: string | null;
  prompt?: string | null;
  left?: string[] | null;
  right?: string[] | null;
  title?: string | null;
  content?: string | null;
  questions?: string[] | null;
  image?: string | null;
}

interface BackendWorksheet {
  id: string;
  title: string;
  description: string;
  script_content: string;
  json_content: { title: string; description: string; activities: BackendActivity[] };
  created_by: string;
  created_at: string;
  published: boolean;
  max_attempts?: number | null;
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Error inesperado' }));
    throw new Error(error.detail ?? 'Error inesperado');
  }
  return response.json() as Promise<T>;
}

function normalizeActivity(activity: BackendActivity): WorksheetActivity {
  switch (activity.type) {
    case 'fillblank':
      return { id: activity.id, type: 'fillblank', text: activity.text ?? '', answer: activity.answer ?? '' };
    case 'multiplechoice':
      return { id: activity.id, type: 'multiplechoice', question: activity.question ?? '', options: activity.options ?? [], answer: activity.answer ?? '' };
    case 'textbox':
      return { id: activity.id, type: 'textbox', prompt: activity.prompt ?? '' };
    case 'matching':
      return { id: activity.id, type: 'matching', left: activity.left ?? [], right: activity.right ?? [] };
    case 'speaking':
      return { id: activity.id, type: 'speaking', prompt: activity.prompt ?? '' };
    case 'reading':
      return { id: activity.id, type: 'reading', title: activity.title ?? '', content: activity.content ?? '', questions: activity.questions ?? [] };
    case 'imagequestion':
      return { id: activity.id, type: 'imagequestion', image: activity.image ?? '', prompt: activity.prompt ?? '' };
  }
}

export function normalizeWorksheet(worksheet: BackendWorksheet): Worksheet {
  return {
    id: worksheet.id,
    title: worksheet.title,
    description: worksheet.description,
    level: 'A1',
    status: worksheet.published ? 'published' : 'draft',
    scriptContent: worksheet.script_content,
    activities: worksheet.json_content.activities.map(normalizeActivity),
    createdBy: worksheet.created_by,
    createdAt: worksheet.created_at,
    maxAttempts: worksheet.max_attempts ?? null,
    analytics: { completionRate: 0, averageScore: 0, attempts: 0, mostMissedQuestions: [] },
  };
}

export async function login(username: string, password: string, role: UsuarioSesion['role']): Promise<UsuarioSesion> {
  const data = await request<{ user: UsuarioSesion }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, role }) });
  return data.user;
}

export async function createStudent(name: string, username: string, password: string): Promise<UsuarioSesion> {
  return request<UsuarioSesion>('/students', { method: 'POST', body: JSON.stringify({ name, username, password }) });
}

export async function listStudents(): Promise<UsuarioSesion[]> {
  return request<UsuarioSesion[]>('/students');
}

export async function createWorksheet(scriptContent: string, createdBy: string, maxAttempts: number | null): Promise<Worksheet> {
  const worksheet = await request<BackendWorksheet>('/worksheets', { method: 'POST', body: JSON.stringify({ script_content: scriptContent, created_by: createdBy, max_attempts: maxAttempts }) });
  return normalizeWorksheet(worksheet);
}

export async function listTeacherWorksheets(createdBy: string): Promise<Worksheet[]> {
  const worksheets = await request<BackendWorksheet[]>(`/worksheets?created_by=${createdBy}`);
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

export async function submitResponse(worksheet: Worksheet, user: UsuarioSesion, answers: StudentAnswers): Promise<RespuestaEstudiante> {
  return request<RespuestaEstudiante>('/responses', { method: 'POST', body: JSON.stringify({ worksheet_id: worksheet.id, student_id: user.id, student_name: user.name, answers_json: answers }) });
}

export async function listStudentResponses(studentId: string): Promise<RespuestaEstudiante[]> {
  return request<RespuestaEstudiante[]>(`/students/${studentId}/responses`);
}

export async function listWorksheetResponses(worksheetId: string): Promise<RespuestaEstudiante[]> {
  return request<RespuestaEstudiante[]>(`/worksheets/${worksheetId}/responses`);
}

export async function reviewAnswer(responseId: string, activityId: string, status: 'correct' | 'incorrect', comment: string): Promise<RespuestaEstudiante> {
  return request<RespuestaEstudiante>(`/responses/${responseId}/review`, { method: 'POST', body: JSON.stringify({ activity_id: activityId, status, comment }) });
}
