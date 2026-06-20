import { Activity, BarChart3, BookOpenCheck, ClipboardCheck, Database, FolderArchive, LogOut, PlusCircle, School, UserCog, UserPlus, UserRoundCheck, Users } from 'lucide-react';
import type { UsuarioSesion } from '../services/api';

export type TeacherMenu = 'dashboard' | 'crear' | 'evaluaciones' | 'archivadas' | 'aulas' | 'estudiantes' | 'profesores' | 'revision' | 'invitados' | 'actividad' | 'vocabulario' | 'lectores' | 'imagenes';

interface TeacherDashboardProps {
  user: UsuarioSesion;
  totalWorksheets: number;
  publishedCount: number;
  selectedMenu: TeacherMenu;
  notificationCount: number;
  onSelectMenu: (menu: TeacherMenu) => void;
  onLogout: () => void;
}

export function TeacherDashboard({ user, totalWorksheets, publishedCount, selectedMenu, notificationCount, onSelectMenu, onLogout }: TeacherDashboardProps) {
  const menuItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
    { id: 'crear' as const, label: 'Crear evaluación', icon: PlusCircle },
    { id: 'evaluaciones' as const, label: 'Evaluaciones guardadas', icon: BookOpenCheck },
    { id: 'archivadas' as const, label: 'Archivadas', icon: FolderArchive },
    { id: 'aulas' as const, label: 'Aulas', icon: School },
    { id: 'estudiantes' as const, label: 'Crear estudiante', icon: UserPlus },
    ...(user.role === 'admin' ? [{ id: 'profesores' as const, label: 'Crear profesor', icon: UserCog }] : []),
    { id: 'revision' as const, label: 'Revisión', icon: ClipboardCheck },
    { id: 'invitados' as const, label: 'Invitados', icon: Users },
    { id: 'actividad' as const, label: 'Actividad de estudiantes', icon: Activity },
  ];

  return (
    <aside className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 text-white"><UserRoundCheck size={24} /></span>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Menú {user.role === 'admin' ? 'admin' : 'profesor'}</p>
          <h2 className="text-lg font-bold text-slate-900">{user.name}</h2>
          <p className="text-sm text-slate-500">@{user.username}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {menuItems.map((item) => {
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
