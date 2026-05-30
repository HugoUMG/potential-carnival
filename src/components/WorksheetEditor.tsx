import { activityDefinitions } from './activityRegistry';
import type { Worksheet, WorksheetActivity } from '../types';

interface WorksheetEditorProps {
  worksheet: Worksheet;
  selectedActivity?: WorksheetActivity;
  onAddActivity: (activity: WorksheetActivity) => void;
  onSelectActivity: (activity: WorksheetActivity) => void;
  onScriptChange: (script: string) => void;
}

export function WorksheetEditor({ worksheet, selectedActivity, onAddActivity, onSelectActivity, onScriptChange }: WorksheetEditorProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[250px_1fr_280px]">
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Activity library</p>
        <div className="mt-4 grid gap-3">
          {activityDefinitions.map((definition) => (
            <button
              key={definition.type}
              className="rounded-2xl border border-slate-100 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
              type="button"
              onClick={() => onAddActivity(definition.create())}
            >
              <span className="text-2xl">{definition.icon}</span>
              <h3 className="mt-2 font-semibold text-slate-900">{definition.label}</h3>
              <p className="mt-1 text-sm text-slate-500">{definition.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Worksheet canvas</p>
            <h2 className="text-2xl font-bold text-slate-900">{worksheet.title}</h2>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">{worksheet.activities.length} activities</span>
        </div>

        <div className="mt-5 grid gap-3">
          {worksheet.activities.map((activity, index) => {
            const definition = activityDefinitions.find((item) => item.type === activity.type);
            return (
              <button
                key={activity.id}
                className={`rounded-2xl border p-4 text-left transition ${selectedActivity?.id === activity.id ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:border-blue-200'}`}
                type="button"
                onClick={() => onSelectActivity(activity)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Block {index + 1}</p>
                    <h3 className="font-semibold text-slate-900">{definition?.icon} {definition?.label}</h3>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">{activity.type}</span>
                </div>
              </button>
            );
          })}
        </div>

        <label className="mt-6 block">
          <span className="text-sm font-semibold text-slate-700">WorksheetScript</span>
          <textarea
            className="mt-2 min-h-80 w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            value={worksheet.scriptContent}
            onChange={(event) => onScriptChange(event.target.value)}
          />
        </label>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Properties</p>
        {selectedActivity ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Activity ID</p>
              <p className="font-mono text-sm text-slate-700">{selectedActivity.id}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Type</p>
              <p className="font-semibold capitalize text-slate-900">{selectedActivity.type}</p>
            </div>
            <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(selectedActivity, null, 2)}</pre>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Select an activity on the canvas to inspect its reusable JSON configuration.</p>
        )}
      </section>
    </div>
  );
}
