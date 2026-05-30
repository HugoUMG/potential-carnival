import { useMemo, useState } from 'react';
import { GraduationCap, MonitorSmartphone, PencilRuler } from 'lucide-react';
import { WorksheetEditor } from './components/WorksheetEditor';
import { WorksheetRenderer } from './components/WorksheetRenderer';
import { TeacherDashboard } from './components/TeacherDashboard';
import { sampleWorksheet } from './data/sampleWorksheet';
import type { StudentAnswer, StudentAnswers, Worksheet, WorksheetActivity } from './types';
import './styles/app.css';

type ViewMode = 'teacher' | 'student';

export default function App() {
  const [worksheet, setWorksheet] = useState<Worksheet>(sampleWorksheet);
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string>(sampleWorksheet.activities[0]?.id ?? '');
  const [viewMode, setViewMode] = useState<ViewMode>('teacher');

  const selectedActivity = useMemo(
    () => worksheet.activities.find((activity) => activity.id === selectedActivityId),
    [worksheet.activities, selectedActivityId],
  );

  function addActivity(activity: WorksheetActivity) {
    setWorksheet((current) => ({ ...current, activities: [...current.activities, activity] }));
    setSelectedActivityId(activity.id);
  }

  function updateAnswer(activityId: string, value: StudentAnswer) {
    setAnswers((current) => ({ ...current, [activityId]: value }));
  }

  function publishWorksheet() {
    setWorksheet((current) => ({ ...current, status: 'published' }));
  }

  function simulateAiGeneration() {
    setWorksheet((current) => ({
      ...current,
      title: 'AI Generated: Present Continuous Practice',
      description: 'Generated from a teacher prompt and stored as WorksheetScript plus JSON.',
      scriptContent: `${current.scriptContent}\n\nfillblank {\n  text: "She ____ reading now."\n  answer: "is"\n}`,
      activities: [
        ...current.activities,
        { id: `ai-${Date.now()}`, type: 'fillblank', text: 'She ____ reading now.', answer: 'is' },
      ],
    }));
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
              <GraduationCap />
            </span>
            <div>
              <h1 className="text-xl font-bold">AI Worksheet Builder</h1>
              <p className="text-sm text-slate-500">WorksheetScript → JSON → React activities</p>
            </div>
          </div>
          <div className="flex rounded-2xl bg-slate-100 p-1">
            <button className={`mode-tab ${viewMode === 'teacher' ? 'mode-tab-active' : ''}`} type="button" onClick={() => setViewMode('teacher')}>
              <PencilRuler size={16} /> Teacher
            </button>
            <button className={`mode-tab ${viewMode === 'student' ? 'mode-tab-active' : ''}`} type="button" onClick={() => setViewMode('student')}>
              <MonitorSmartphone size={16} /> Student
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8">
        {viewMode === 'teacher' ? (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <TeacherDashboard worksheet={worksheet} onGenerate={simulateAiGeneration} onPublish={publishWorksheet} />
            <WorksheetEditor
              worksheet={worksheet}
              selectedActivity={selectedActivity}
              onAddActivity={addActivity}
              onSelectActivity={(activity) => setSelectedActivityId(activity.id)}
              onScriptChange={(scriptContent) => setWorksheet((current) => ({ ...current, scriptContent }))}
            />
          </div>
        ) : (
          <div>
            <WorksheetRenderer worksheet={worksheet} answers={answers} onAnswerChange={updateAnswer} />
            <div className="mx-auto mt-6 flex max-w-4xl justify-end">
              <button className="rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-600" type="button">
                Submit responses
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
