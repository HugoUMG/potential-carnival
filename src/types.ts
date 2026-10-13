import type React from 'react';

export type ActivityType =
  | 'fillblank'
  | 'multiplechoice'
  | 'multiselect'
  | 'poll'
  | 'dragdrop'
  | 'textbox'
  | 'matching'
  | 'reading'
  | 'imagequestion'
  | 'imagechoice'
  | 'imagematching'
  | 'listening'
  | 'listeningfillblank'
  | 'listeningmultiplechoice'
  | 'listeningmatching'
  | 'listeningtruefalse'
  | 'listeningorder'
  | 'conversation'
  | 'content'
  | 'truefalse'
  | 'readingtruefalse'
  | 'speaking';

export interface BaseActivity {
  id: string;
  type: ActivityType;
  prompt?: string;
  answer?: string | string[];
  instructions?: string;
  /** Nota privada del profesor: solo la lee la IA al calificar. El backend la borra del payload
   *  del alumno, así que en el portal del alumno este campo siempre llega vacío. */
  note?: string;
  voice?: string; // 'male' | 'female' | nombre de voz edge-tts; solo listening
  rate?: string; // velocidad de síntesis '±NN%' (ya normalizada por el parser); solo listening
  male_voice?: string; // conversation: voz del hablante masculino ('male' | nombre de voz edge-tts)
  female_voice?: string; // conversation: voz del hablante femenino ('female' | nombre de voz edge-tts)
}

export interface FillBlankActivity extends BaseActivity {
  type: 'fillblank';
  text: string;
  answer: string | string[];
}

export interface MultipleChoiceActivity extends BaseActivity {
  type: 'multiplechoice';
  question: string;
  options: string[];
  answer: string | string[];
}

/** Encuesta de opinión: sin `answer` a propósito. No se califica en ningún sitio; en vivo el
 *  reveal proyecta el reparto de votos para abrir el debate. */
export interface PollActivity extends BaseActivity {
  type: 'poll';
  question: string;
  options: string[];
}

export interface MultiSelectActivity extends BaseActivity {
  type: 'multiselect';
  question: string;
  options: string[];
  answer: string[];
}

export interface DragDropActivity extends BaseActivity {
  type: 'dragdrop';
  text: string;        // oración con _____ por cada hueco
  answer: string[];    // palabra correcta por hueco (en orden)
  bank: string[];      // banco de palabras arrastrables (correctas + distractores)
}

export interface TextBoxActivity extends BaseActivity {
  type: 'textbox';
  prompt: string;
}

export interface MatchingActivity extends BaseActivity {
  type: 'matching';
  left: string[];
  right: string[];
}

export interface ReadingActivity extends BaseActivity {
  type: 'reading';
  title: string;
  content: string;
  questions: string[];
}

export interface ListeningActivity extends BaseActivity {
  type: 'listening';
  text: string;
  question: string;
  answer: string;
}

export interface ImageQuestionActivity extends BaseActivity {
  type: 'imagequestion';
  image: string;
  prompt: string;
}

export interface ImageChoiceActivity extends BaseActivity {
  type: 'imagechoice';
  image?: string;           // imagen del enunciado (opcional)
  question: string;
  options: string[];        // la clave sigue siendo el TEXTO, como en multiplechoice
  option_images?: string[]; // URL por opción, PARALELA a options; una entrada vacía deja texto
  answer: string | string[];
}

export interface ImageMatchingActivity extends BaseActivity {
  type: 'imagematching';
  left: string[];           // etiqueta de cada fila (clave legible); el alumno ve la imagen
  left_images: string[];    // URL por fila, PARALELA a left
  right: string[];          // pareja correcta de left[i], igual que en matching
}

export interface ListeningFillBlankActivity extends BaseActivity {
  type: 'listeningfillblank';
  audio_text: string;
  text: string;
  answer: string | string[];
}

export interface ListeningMultipleChoiceActivity extends BaseActivity {
  type: 'listeningmultiplechoice';
  audio_text: string;
  question: string;
  options: string[];
  answer: string;
}

export interface ListeningMatchingActivity extends BaseActivity {
  type: 'listeningmatching';
  pairs: { audio_text: string; match: string }[];
  options: string[];
}

export interface ListeningTrueFalseActivity extends BaseActivity {
  type: 'listeningtruefalse';
  audio_text: string;
  statements: { text: string; answer: boolean }[];
}

export interface ListeningOrderActivity extends BaseActivity {
  type: 'listeningorder';
  audio_text: string;        // oración hablada (oculta al estudiante)
  answer: string[];          // fichas en el orden correcto
  bank?: string[];           // fichas a mostrar (desordenadas); si falta, el front baraja answer
}

export interface ConversationActivity extends BaseActivity {
  type: 'conversation';
  lines: { speaker: 'male' | 'female'; text: string }[]; // turnos hablados (ocultos); voces alternadas
  question: string;
  answer?: string; // opcional: con respuesta se autocalifica; sin ella queda pendiente (IA/profesor)
}

export interface ContentActivity extends BaseActivity {
  type: 'content';
  title?: string;
  html: string; // HTML del repaso. Solo lectura, sin calificación.
  sandbox?: boolean; // true → render en iframe aislado (HTML+CSS+JS propio). false/undefined → saneado inline (DOMPurify).
}

export interface TrueFalseActivity extends BaseActivity {
  type: 'truefalse';
  statements: { text: string; answer: boolean }[];
}

export interface ReadingTrueFalseActivity extends BaseActivity {
  type: 'readingtruefalse';
  title: string;
  content: string;
  statements: { text: string; answer: boolean }[];
}

export interface SpeakingActivity extends BaseActivity {
  type: 'speaking';
  prompt: string;
  target?: string; // oración a leer en voz alta; si falta, es pregunta abierta (IA)
}

export type WorksheetActivity =
  | FillBlankActivity
  | MultipleChoiceActivity
  | MultiSelectActivity
  | PollActivity
  | DragDropActivity
  | TextBoxActivity
  | MatchingActivity
  | ReadingActivity
  | ImageQuestionActivity
  | ImageChoiceActivity
  | ImageMatchingActivity
  | ListeningActivity
  | ListeningFillBlankActivity
  | ListeningMultipleChoiceActivity
  | ListeningMatchingActivity
  | ListeningTrueFalseActivity
  | ListeningOrderActivity
  | ConversationActivity
  | ContentActivity
  | TrueFalseActivity
  | ReadingTrueFalseActivity
  | SpeakingActivity;

export interface ActivityBlock {
  title?: string | null;
  instructions?: string | null;
  /** Estímulo compartido: se muestra UNA vez arriba del bloque y todas sus actividades
   *  (de cualquier tipo) responden sobre él. `text` es visible; `audioText`/`lines` son audio
   *  TTS y quedan ocultos, igual que en las actividades listening. */
  text?: string | null;
  audioText?: string | null;
  lines?: { speaker: 'male' | 'female'; text: string }[] | null;
  voice?: string | null; // 'male' | 'female'; solo con audioText
  rate?: string | null; // velocidad de síntesis '±NN%'; solo con audioText o lines
  male_voice?: string | null; // conversación compartida: voz del hablante masculino; solo con lines
  female_voice?: string | null; // conversación compartida: voz del hablante femenino; solo con lines
  activities: WorksheetActivity[];
}

export interface Worksheet {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  archived: boolean;
  scriptContent: string;
  activities: WorksheetActivity[];
  blocks?: ActivityBlock[];
  createdBy: string;
  createdAt: string;
  maxAttempts?: number | null;
  theme?: { primary_color?: string; background_color?: string; text_color?: string } | null;
  attemptsUsed?: number | null;
  attemptsRemaining?: number | null;
  dueDate?: string | null;
  infoFields?: string[];
  aiGrading?: boolean;
  /** Tolerancia a errores de forma al calificar con IA: 0 estricto … 100 permisivo. */
  aiTolerance?: number;
}

export type StudentAnswer = string | string[] | Record<string, string>;
export type StudentAnswers = Record<string, StudentAnswer>;

export interface ActivityRendererProps<T extends WorksheetActivity = WorksheetActivity> {
  activity: T;
  value?: StudentAnswer;
  readonly?: boolean;
  onChange: (activityId: string, value: StudentAnswer) => void;
}

// ── Vocabulario ───────────────────────────────────────────────────────────────

export type VocabularyWordType =
  | 'verb'
  | 'noun'
  | 'adjective'
  | 'adverb'
  | 'connector'
  | 'linking word'
  | 'preposition'
  | 'phrase'
  | string;

export interface VocabularyItem {
  english: string;
  spanish: string;
  type: VocabularyWordType;
  block?: string;
  v_past?: string;
  v_participle?: string;
  v_ing?: string;
  v_3rd?: string;
}

export interface VocabularyList {
  id: string;
  title: string;
  description: string;
  created_by: string;
  created_at: string;
  items: VocabularyItem[];
}

export interface ActivityDefinition<T extends WorksheetActivity = WorksheetActivity> {
  type: T['type'];
  label: string;
  description: string;
  icon: string;
  create: () => T;
  Renderer: React.ComponentType<ActivityRendererProps<T>>;
}

// ─── Juegos de práctica (ADR-38) ───────────────────────────────────────────

/** Una pregunta de un set. Todos los juegos salen de estos campos. */
export interface GameQuestion {
  text: string;
  translation: string;
  hint: string;
  tag: string;
  emoji: string;
}

export interface GameSetDraft {
  title: string;
  topic: string;
  level: string;
  featured: boolean;
  questions: GameQuestion[];
}

export interface GameSet extends GameSetDraft {
  id: string;
  created_by: string;
  created_at: string;
}

export interface GameSetSummary {
  id: string;
  title: string;
  topic: string;
  level: string;
  question_count: number;
}

export interface WordMeaning {
  word: string;
  lemma: string;
  senses: { pos: string; meanings: string[] }[];
}

export interface PublicGameSet {
  id: string;
  title: string;
  topic: string;
  level: string;
  questions: GameQuestion[];
  glossary: Record<string, WordMeaning>;
}

// ─── Salas de juego (ADR-40, backend/app/rooms.py) ─────────────────────────

export type RoomMode = 'turnos' | 'presentador';
export type RoomLend = 'once' | 'always';

export interface RoomPlayer {
  id: string;
  name: string;
  online: boolean;
}

/** Estado público de una sala. `state` (el blob del juego) solo viaja si cambió desde `since`. */
export interface RoomState {
  code: string;
  game: string;
  set_id: string;
  mode: RoomMode;
  host_id: string;
  turn: string;
  lend: RoomLend | null;
  version: number;
  players: RoomPlayer[];
  state?: Record<string, unknown>;
  /** Lo último que dijo un jugador (respuesta por voz transcrita). Cualquiera puede escribirlo. */
  said?: { pid: string; name: string; text: string; n: number } | null;
}

// ─── Conversación con IA por role-play (ADR-39) ────────────────────────────

export type RoleplayLevel = 'beginner' | 'intermediate' | 'advanced';

export interface RoleplayScenario {
  id: string;
  emoji: string;
  title: string;
  description: string;
  roles: { id: string; label: string; emoji: string }[];
}

export interface RoleplayCard {
  kind: string;
  title: string;
  subtitle: string;
  sections: { title: string; rows: { label: string; value: string; detail: string }[] }[];
  notes: string[];
}

export interface RoleplayStart {
  seed: number;
  scenario: string;
  role: string;
  level: RoleplayLevel;
  title: string;
  place: string;
  ai_name: string;
  ai_role: string;
  ai_emoji: string;
  ai_voice: string;
  rate: string;
  max_turns: number;
  clarity_ok: number;
  cards: RoleplayCard[];
  missions: string[];
  with_info: boolean;     // false = conversación libre (sin tarjetas)
  with_missions: boolean;
}

export interface RoleplayMessage {
  who: 'ai' | 'user';
  text: string;
  clarity?: number | null;
}

export interface RoleplayReply {
  reply: string;
  reply_es: string;
  done: boolean;
}

export interface RoleplayTurnReview {
  n: number;
  asked: string;
  said: string;
  status: 'ok' | 'better' | 'wrong';
  better: string;
  why_es: string;
  clarity: number | null;
  clear: boolean | null;
}

export interface RoleplayReport {
  grade: number;
  scores: Record<'communication' | 'grammar' | 'vocabulary' | 'pronunciation', number | null>;
  weights: Record<string, number>;
  summary_es: string;
  tips_es: string[];
  missions: { text: string; done: boolean }[];
  turns: RoleplayTurnReview[];
  clarity_ok: number;
  next_level: RoleplayLevel | null; // con nota alta: el nivel que se le propone probar
}
