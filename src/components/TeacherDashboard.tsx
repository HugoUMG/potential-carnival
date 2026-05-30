import { BarChart3, Copy, FilePlus2, Send, Sparkles, Trash2 } from 'lucide-react';
import type { Worksheet } from '../types';

interface TeacherDashboardProps {
  worksheet: Worksheet;
  onGenerate: () => void;
  onPublish: () => void;
}

export function TeacherDashboard({ worksheet, onGenerate, onPublish }: TeacherDashboardProps) {
  const stats = [
    { label: 'Completion rate', value: `${worksheet.analytics.completionRate}%` },
    { label: 'Average score', value: `${worksheet.analytics.averageScore}%` },
    { label: 'Student attempts', value: worksheet.analytics.attempts.toString() },
  ];

  return (
    <aside className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Teacher Dashboard</p>
          <h2 className="text-xl font-bold text-slate-900">My worksheets</h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">JWT-ready</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <button className="dashboard-action" type="button">
          <FilePlus2 size={18} /> Create worksheet
        </button>
        <button className="dashboard-action" type="button" onClick={onGenerate}>
          <Sparkles size={18} /> AI generation
        </button>
        <button className="dashboard-action" type="button" onClick={onPublish}>
          <Send size={18} /> Publish worksheet
        </button>
        <button className="dashboard-action" type="button">
          <Copy size={18} /> Duplicate worksheet
        </button>
        <button className="dashboard-action" type="button">
          <Trash2 size={18} /> Delete worksheet
        </button>
      </div>

      <div className="mt-6 rounded-2xl bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-slate-800">
          <BarChart3 size={18} />
          <h3 className="font-semibold">Analytics</h3>
        </div>
        <div className="grid gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between rounded-xl bg-white p-3">
              <span className="text-sm text-slate-500">{stat.label}</span>
              <strong className="text-slate-900">{stat.value}</strong>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-700">Most missed</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-500">
            {worksheet.analytics.mostMissedQuestions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
