import type React from 'react';

export type ActivityType =
  | 'fillblank'
  | 'multiplechoice'
  | 'textbox'
  | 'matching'
  | 'reading'
  | 'imagequestion'
  | 'listening'
  | 'listeningfillblank'
  | 'listeningmultiplechoice'
  | 'listeningmatching'
  | 'listeningtruefalse'
  | 'truefalse'
  | 'readingtruefalse';

export interface BaseActivity {
  id: string;
  type: ActivityType;
  prompt?: string;
  answer?: string | string[];
  instructions?: string;
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

export type WorksheetActivity =
  | FillBlankActivity
  | MultipleChoiceActivity
  | TextBoxActivity
  | MatchingActivity
  | ReadingActivity
  | ImageQuestionActivity
  | ListeningActivity
  | ListeningFillBlankActivity
  | ListeningMultipleChoiceActivity
  | ListeningMatchingActivity
  | ListeningTrueFalseActivity
  | TrueFalseActivity
  | ReadingTrueFalseActivity;

export interface ActivityBlock {
  title?: string | null;
  instructions?: string | null;
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
