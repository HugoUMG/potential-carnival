import type React from 'react';
import { activityRegistry } from './activityRegistry';
import type { StudentAnswers, StudentAnswer, Worksheet, WorksheetActivity } from '../types';

interface WorksheetRendererProps {
  worksheet: Worksheet;
  answers: StudentAnswers;
  readonly?: boolean;
  onAnswerChange: (activityId: string, value: StudentAnswer) => void;
}

function ActivityCard({ activity, answer, readonly, onAnswerChange, index }: {
  activity: WorksheetActivity;
  answer?: StudentAnswer;
  readonly?: boolean;
  onAnswerChange: (activityId: string, value: StudentAnswer) => void;
  index: number;
}) {
  const definition = activityRegistry[activity.type];
  const Renderer = definition.Renderer as React.ComponentType<{
    activity: WorksheetActivity;
    value?: StudentAnswer;
    readonly?: boolean;
    onChange: (activityId: string, value: StudentAnswer) => void;
  }>;

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-lg">{definition.icon}</span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Actividad {index + 1}</p>
            <h2 className="font-semibold text-slate-900">{definition.label}</h2>
          </div>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Interactiva</span>
      </div>
      <Renderer activity={activity} value={answer} readonly={readonly} onChange={onAnswerChange} />
    </section>
  );
}

export function WorksheetRenderer({ worksheet, answers, readonly, onAnswerChange }: WorksheetRendererProps) {
  const completedCount = worksheet.activities.filter((activity) => Boolean(answers[activity.id])).length;
  const progress = worksheet.activities.length === 0 ? 0 : Math.round((completedCount / worksheet.activities.length) * 100);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">Worksheet</span>
            <h1 className="mt-4 text-3xl font-bold">{worksheet.title}</h1>
            <p className="mt-2 max-w-2xl text-blue-50">{worksheet.description}</p>
          </div>
          <div className="rounded-2xl bg-white/15 p-4 text-center backdrop-blur">
            <p className="text-3xl font-bold">{progress}%</p>
            <p className="text-sm text-blue-50">completado</p>
          </div>
        </div>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="grid gap-5">
        {worksheet.activities.map((activity, index) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            answer={answers[activity.id]}
            readonly={readonly}
            onAnswerChange={onAnswerChange}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}
