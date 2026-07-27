import { Activity, BarChart3, BookOpenCheck, ClipboardCheck, Database, FolderArchive, LogOut, PlusCircle, School, UserCog, UserPlus, UserRoundCheck, Users } from 'lucide-react';
import type { UsuarioSesion } from '../services/api';

export type TeacherMenu = 'dashboard' | 'crear' | 'evaluaciones' | 'archivadas' | 'aulas' | 'estudiantes' | 'profesores' | 'revision' | 'invitados' | 'actividad' | 'vocabulario' | 'imagenes';

interface TeacherDashboardProps {
  user: UsuarioSesion;
  totalWorksheets: number;
  publishedCount: number;
  selectedMenu: TeacherMenu;
  notificationCount: number;
  onSelectMenu: (menu: TeacherMenu) => void;
  onLogout: () => void;
}

/** El menú va agrupado por momento del trabajo (crear → repartir → revisar → seguimiento):
 *  antes eran diez botones seguidos y había que leerlos todos para encontrar uno. */
const GROUPS: { label: string; items: { id: TeacherMenu; label: string; icon: typeof BarChart3; adminOnly?: boolean }[] }[] = [
  {
    label: 'Resumen',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: BarChart3 }],
  },
  {
    label: 'Contenido',
    items: [
      { id: 'crear', label: 'Crear evaluación', icon: PlusCircle },
      { id: 'evaluaciones', label: 'Evaluaciones guardadas', icon: BookOpenCheck },
      { id: 'archivadas', label: 'Archivadas', icon: FolderArchive },
    ],
  },
  {
    label: 'Mis grupos',
    items: [
      { id: 'aulas', label: 'Aulas', icon: School },
      { id: 'estudiantes', label: 'Estudiantes', icon: UserPlus },
      { id: 'profesores', label: 'Profesores', icon: UserCog, adminOnly: true },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { id: 'revision', label: 'Revisión', icon: ClipboardCheck },
      { id: 'actividad', label: 'Actividad de estudiantes', icon: Activity },
      { id: 'invitados', label: 'Invitados', icon: Users },
    ],
  },
];

export function TeacherDashboard({ user, totalWorksheets, publishedCount, selectedMenu, notificationCount, onSelectMenu, onLogout }: TeacherDashboardProps) {
  return (
    <aside className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rex text-white"><UserRoundCheck size={24} /></span>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-rex">Menú {user.role === 'admin' ? 'admin' : 'profesor'}</p>
          <h2 className="text-lg font-bold text-ink">{user.name}</h2>
          <p className="text-sm text-slate-500">@{user.username}</p>
        </div>
      </div>

      <nav className="mt-6 grid gap-5">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || user.role === 'admin');
          if (!items.length) return null;
          return (
            <div key={group.label} className="grid gap-2">
              <p className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{group.label}</p>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} className={`dashboard-action ${selectedMenu === item.id ? 'dashboard-action-active' : ''}`} type="button" onClick={() => onSelectMenu(item.id)}>
                    <Icon size={18} /> {item.label}
                    {item.id === 'revision' && notificationCount > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                        {notificationCount > 99 ? '99+' : notificationCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-6 rounded-2xl bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-slate-800"><Database size={18} /><h3 className="font-semibold">Base de datos</h3></div>
        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-xl bg-white p-3"><span className="text-sm text-slate-500">Evaluaciones</span><strong>{totalWorksheets}</strong></div>
          <div className="flex items-center justify-between rounded-xl bg-white p-3"><span className="text-sm text-slate-500">Habilitadas</span><strong className="text-emerald-600">{publishedCount}</strong></div>
        </div>
      </div>

      <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600" type="button" onClick={onLogout}>
        <LogOut size={18} /> Cerrar sesión
      </button>
    </aside>
  );
}
