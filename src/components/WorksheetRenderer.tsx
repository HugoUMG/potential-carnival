import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { activityRegistry } from './activityRegistry';
import { RichText } from './RichText';
import type { StudentAnswers, StudentAnswer, Worksheet, WorksheetActivity } from '../types';
import { acquireActivityLock, getActiveLocks, releaseActivityLock, renewActivityLock } from '../services/api';
import type { ActivityLock } from '../services/api';

interface WorksheetRendererProps {
  worksheet: Worksheet;
  answers: StudentAnswers;
  readonly?: boolean;
  onAnswerChange: (activityId: string, value: StudentAnswer) => void;
  /** Si se pasa, activa el modo grupal con bloqueo de actividades. */
  groupId?: string | null;
}

/** Índice global de la actividad dentro de todas las actividades del worksheet (aplana bloques). */
function buildActivityIndexMap(worksheet: Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  const blocks = worksheet.blocks?.length
    ? worksheet.blocks
    : [{ title: null, instructions: null, activities: worksheet.activities }];
  let idx = 0;
  for (const block of blocks) {
    for (const activity of block.activities) {
      map.set(activity.id, idx++);
    }
  }
  return map;
}

function ActivityCard({
  activity,
  answer,
  readonly,
  onAnswerChange,
  index,
  lock,
  onFocus,
  onBlur,
}: {
  activity: WorksheetActivity;
  answer?: StudentAnswer;
  readonly?: boolean;
  onAnswerChange: (activityId: string, value: StudentAnswer) => void;
  index: number;
  lock?: ActivityLock | null;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const definition = activityRegistry[activity.type];
  const Renderer = definition.Renderer as React.ComponentType<{
    activity: WorksheetActivity;
    value?: StudentAnswer;
    readonly?: boolean;
    onChange: (activityId: string, value: StudentAnswer) => void;
  }>;

  const isLockedByOther = !!lock;

  return (
    <section
      className={`rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md ${isLockedByOther ? 'border-amber-300 bg-amber-50/40' : 'border-slate-100'}`}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-lg">{definition.icon}</span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Actividad {index + 1}</p>
            <h2 className="font-semibold text-slate-900">{definition.label}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLockedByOther && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              ✏️ {lock.locked_by_name} está editando esto
            </span>
          )}
          {!isLockedByOther && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Interactiva</span>
          )}
        </div>
      </div>
      <Renderer
        activity={activity}
        value={answer}
        readonly={readonly || isLockedByOther}
        onChange={onAnswerChange}
      />
    </section>
  );
}

const LOCK_POLL_INTERVAL = 5000; // 5s
const HEARTBEAT_INTERVAL = 30000; // 30s

export function WorksheetRenderer({ worksheet, answers, readonly, onAnswerChange, groupId }: WorksheetRendererProps) {
  const completedCount = worksheet.activities.filter((activity) => Boolean(answers[activity.id])).length;
  const progress = worksheet.activities.length === 0 ? 0 : Math.round((completedCount / worksheet.activities.length) * 100);
  const blocks = worksheet.blocks?.length ? worksheet.blocks : [{ title: null, instructions: null, activities: worksheet.activities }];

  // Map activityId → global index
  const activityIndexMap = useRef(buildActivityIndexMap(worksheet));
  useEffect(() => {
    activityIndexMap.current = buildActivityIndexMap(worksheet);
  }, [worksheet]);

  // Estado de locks: Map<activityIndex, ActivityLock>
  const [locks, setLocks] = useState<Map<number, ActivityLock>>(new Map());
  const focusedIndexRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLocks = useCallback(async () => {
    if (!groupId) return;
    try {
      const activeLocks = await getActiveLocks(groupId, worksheet.id);
      setLocks(new Map(activeLocks.map((l) => [l.activity_index, l])));
    } catch {
      // silencioso
    }
  }, [groupId, worksheet.id]);

  // Polling de locks cada 5s cuando hay groupId
  useEffect(() => {
    if (!groupId || readonly) return;
    void fetchLocks();
    pollTimerRef.current = setInterval(() => void fetchLocks(), LOCK_POLL_INTERVAL);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [groupId, readonly, fetchLocks]);

  // Limpiar locks propios al desmontar
  useEffect(() => {
    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (groupId && focusedIndexRef.current !== null) {
        void releaseActivityLock(groupId, worksheet.id, focusedIndexRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, worksheet.id]);

  async function handleFocus(activityId: string) {
    if (!groupId || readonly) return;
    const idx = activityIndexMap.current.get(activityId);
    if (idx === undefined || idx === focusedIndexRef.current) return;

    // Liberar el anterior si había
    if (focusedIndexRef.current !== null) {
      await releaseActivityLock(groupId, worksheet.id, focusedIndexRef.current).catch(() => {});
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    }

    try {
      await acquireActivityLock(groupId, worksheet.id, idx);
      focusedIndexRef.current = idx;
      // Heartbeat mientras edita
      heartbeatTimerRef.current = setInterval(() => {
        void renewActivityLock(groupId, worksheet.id, idx).catch(() => {});
      }, HEARTBEAT_INTERVAL);
      // Refrescar locks localmente
      void fetchLocks();
    } catch {
      // Si falla (actividad tomada), no hacer nada — el poll mostrará el estado real
    }
  }

  async function handleBlur(activityId: string) {
    if (!groupId || readonly) return;
    const idx = activityIndexMap.current.get(activityId);
    if (idx === undefined || idx !== focusedIndexRef.current) return;

    await releaseActivityLock(groupId, worksheet.id, idx).catch(() => {});
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    focusedIndexRef.current = null;
    void fetchLocks();
  }

  return (
    <div className="mx-auto max-w-4xl" style={{ backgroundColor: worksheet.theme?.background_color, color: worksheet.theme?.text_color }}>
      <header className="mb-6 rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 p-6 text-white shadow-lg" style={{ background: worksheet.theme?.primary_color }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">Worksheet</span>
              {worksheet.groupName && (
                <span className="rounded-full bg-violet-400/80 px-3 py-1 text-sm font-semibold">👥 {worksheet.groupName}</span>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-bold">{worksheet.title}</h1>
            <p className="mt-2 max-w-2xl text-blue-50"><RichText text={worksheet.description} /></p>
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

      <div className="grid gap-6">
        {blocks.map((block, blockIndex) => (
          <section key={`${block.title ?? 'block'}-${blockIndex}`} className="grid gap-5">
            {(block.title || block.instructions) && (
              <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5">
                {block.title && <h2 className="text-xl font-extrabold text-slate-900"><RichText text={block.title} /></h2>}
                {block.instructions && <p className="mt-2 text-sm italic leading-6 text-blue-800">ℹ️ <RichText text={block.instructions} /></p>}
              </div>
            )}
            {block.activities.map((activity, activityIndex) => {
              const globalIdx = activityIndexMap.current.get(activity.id) ?? activityIndex;
              const lockByOther = locks.get(globalIdx);
              return (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  answer={answers[activity.id]}
                  readonly={readonly}
                  onAnswerChange={onAnswerChange}
                  index={activityIndex}
                  lock={lockByOther}
                  onFocus={() => void handleFocus(activity.id)}
                  onBlur={() => void handleBlur(activity.id)}
                />
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
