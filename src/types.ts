import type React from 'react';

export type ActivityType =
  | 'fillblank'
  | 'multiplechoice'
  | 'textbox'
  | 'matching'
  | 'reading'
  | 'imagequestion'
  | 'listening';

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

export type WorksheetActivity =
  | FillBlankActivity
  | MultipleChoiceActivity
  | TextBoxActivity
  | MatchingActivity
  | ReadingActivity
  | ImageQuestionActivity
  | ListeningActivity;

export interface ActivityBlock {
  title?: string | null;
  instructions?: string | null;
  activities: WorksheetActivity[];
}

export interface Worksheet {
  id: string;
  title: string;
  description: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  status: 'draft' | 'published';
  archived: boolean;
  scriptContent: string;
  activities: WorksheetActivity[];
  blocks?: ActivityBlock[];
  createdBy: string;
  createdAt: string;
  analytics: WorksheetAnalytics;
  maxAttempts?: number | null;
  theme?: { primary_color?: string; background_color?: string; text_color?: string } | null;
}

export interface WorksheetAnalytics {
  completionRate: number;
  averageScore: number;
  attempts: number;
  mostMissedQuestions: string[];
}

export type StudentAnswer = string | string[] | Record<string, string>;
export type StudentAnswers = Record<string, StudentAnswer>;

export interface ActivityRendererProps<T extends WorksheetActivity = WorksheetActivity> {
  activity: T;
  value?: StudentAnswer;
  readonly?: boolean;
  onChange: (activityId: string, value: StudentAnswer) => void;
}

export interface ActivityDefinition<T extends WorksheetActivity = WorksheetActivity> {
  type: T['type'];
  label: string;
  description: string;
  icon: string;
  create: () => T;
  Renderer: React.ComponentType<ActivityRendererProps<T>>;
}
