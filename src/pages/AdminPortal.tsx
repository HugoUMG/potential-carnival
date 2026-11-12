import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Eye, KeyRound, LogOut, Pencil, School, Search, Trash2, UserCog, UserPlus, X } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { LoadingScreen } from '../components/LoadingScreen';
import RexMascot from '../components/RexMascot';
import {
  assignStudentToClassroom,
  changePassword,
  createClassroom,
  createStudent,
  createTeacher,
  deleteClassroom,
  deleteStudent,
  deleteTeacher,
  getAdminOverview,
  getCurrentSession,
  impersonateTeacher,
  logoutSession,
  renameClassroom,
  setClassroomOwner,
  setStudentOwner,
  shareClassroom,
  shareStudent,
  unassignStudentFromClassroom,
  unshareClassroom,
  unshareStudent,
  type AdminClassroom,
  type AdminOverview,
  type StudentSummary,
  type TeacherOverview,
} from '../services/api';
import '../styles/app.css';

type AdminSection = 'profesores' | 'aulas' | 'estudiantes';
const SECTIONS: { id: AdminSection; label: string; icon: typeof School }[] = [
  { id: 'profesores', label: 'Profesores', icon: UserCog },
  { id: 'aulas', label: 'Aulas', icon: School },
  { id: 'estudiantes', label: 'Estudiantes', icon: UserPlus },
];

const INPUT = 'rounded-2xl border p-3';
const SELECT = 'rounded-xl border bg-white px-3 py-2 text-sm';
const BTN = 'rounded-xl border border-rex/30 bg-white px-3 py-2 text-sm font-semibold text-rex-deep';
const BTN_DANGER = 'rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600';

/** Etiqueta con una X: un profesor invitado, un alumno del aula… */
function Chip({ children, onRemove, title }: { children: ReactNode; onRemove?: () => void; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rex-light px-3 py-1 text-sm font-semibold text-rex-deep">
      {children}
      {onRemove && <button type="button" title={title ?? 'Quitar'} aria-label={title ?? 'Quitar'} className="rounded-full p-0.5 hover:bg-white" onClick={onRemove}><X size={13} /></button>}
    </span>
  );
}

/** Selector "añadir uno": elige y se aplica; vuelve solo a la opción vacía. */
function AddSelect({ placeholder, options, onPick }: { placeholder: string; options: { id: string; label: string }[]; onPick: (id: string) => void }) {
  if (!options.length) return null;
  return (
    <select className={SELECT} value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{label}: <strong className="text-slate-900">{value}</strong></span>;
}

/**
 * Portal del administrador. No es el portal docente: aquí se administran los PROFESORES
 * (qué aulas y alumnos tiene cada uno, quién comparte con quién) y se arman aulas para ellos.
 * Para trabajar el contenido de un profesor se entra a su vista ("Ver como profesor").
 */
export function AdminPortal() {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const active: AdminSection = SECTIONS.some((s) => s.id === section) ? (section as AdminSection) : 'profesores';
  const me = getCurrentSession();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [message, setMessage] = useState('');
  const [openTeacher, setOpenTeacher] = useState<string | null>(null);
  const [openClassroom, setOpenClassroom] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ teacher: TeacherOverview; heir: string } | null>(null);
  const [teacherForm, setTeacherForm] = useState({ name: '', username: '', password: '', email: '' });
  const [classroomForm, setClassroomForm] = useState({ name: '', owner: '' });
  const [studentForm, setStudentForm] = useState({ name: '', username: '', password: '', owner: '' });
  const [studentSearch, setStudentSearch] = useState('');

  async function reload() {
    setData(await getAdminOverview());
  }

  useEffect(() => {
    reload().catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo cargar el panel.'));
    const expired = () => navigate('/login', { replace: true, state: { message: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.' } });
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [navigate]);

  /** Ejecuta un cambio, recarga el panel y deja el aviso (o el error del backend). */
  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await reload();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la acción.');
    }
  }

  const teachers = useMemo(() => data?.teachers ?? [], [data]);
  const classrooms = useMemo(() => data?.classrooms ?? [], [data]);
  const students = useMemo(() => data?.students ?? [], [data]);
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const teacherOptions = teachers.map((t) => ({ id: t.id, label: `${t.name}${t.role === 'admin' ? ' (admin)' : ''}` }));
  const classroomsOf = (studentId: string) => classrooms.filter((c) => c.student_ids.includes(studentId));

  if (!me) return null;
  if (!data && !message) return <LoadingScreen message="Cargando el panel de administración…" />;

  async function viewAs(teacher: TeacherOverview) {
    try {
      await impersonateTeacher(teacher.id);
      // Recarga completa: el portal docente arranca limpio con la sesión del profesor.
      window.location.assign('/teacher/dashboard');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo abrir la vista de profesor.');
    }
  }

  function resetPassword(student: StudentSummary) {
    const next = window.prompt(`Nueva contraseña para ${student.name} (mínimo 8 caracteres):`);
    if (!next) return;
    void run(() => changePassword(student.id, next), `Contraseña de ${student.name} actualizada.`);
  }

  function rename(classroom: AdminClassroom) {
    const next = window.prompt('Nuevo nombre del aula:', classroom.name)?.trim();
    if (!next || next === classroom.name) return;
    void run(() => renameClassroom(classroom.id, next), 'Aula renombrada.');
  }

  const filteredStudents = students.filter((s) => {
    const q = studentSearch.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.username.toLowerCase().includes(q) || (s.owner_name ?? '').toLowerCase().includes(q);
  });

  return (
    <main className="min-h-screen bg-cream text-ink">
      <nav className="relative z-50 border-b border-rex/15 bg-white/85">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <RexMascot mood="wave" className="h-11 w-11 shrink-0" />
            <div>
              <h1 className="whitespace-nowrap text-xl font-black tracking-tight"><span className="text-spike">My</span>Dino<span className="text-rex">English</span></h1>
              <p className="text-sm text-ink/60">Administración · {me.name}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => { setMessage(''); navigate(`/admin/${id}`); }} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${active === id ? 'bg-rex text-white shadow-sm' : 'border border-slate-200 text-slate-600 hover:border-rex/40 hover:text-rex-deep'}`}>
                <Icon size={16} /> {label}
              </button>
            ))}
            <button type="button" title="Tus propias evaluaciones, aulas y alumnos" onClick={() => navigate('/teacher/dashboard')} className="flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-rex/40 hover:text-rex-deep">
              <Eye size={16} /> Mi vista de profesor
            </button>
            <ThemeToggle />
            <button type="button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={() => { void logoutSession().then(() => navigate('/login', { replace: true })); }} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8">
        {message && <p className="rounded-2xl bg-rex-light p-3 text-rex-deep">{message}</p>}

        {active === 'profesores' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Administración</p>
            <h2 className="text-2xl font-bold">Profesores</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Cada profesor trabaja con sus propias aulas, alumnos y evaluaciones. Aquí ves qué tiene cada uno; para trabajar su contenido tal como él lo ve, entra a su vista. Los profesores también pueden registrarse ellos mismos con Google.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <input className={INPUT} placeholder="Nombre" value={teacherForm.name} onChange={(e) => setTeacherForm({ ...teacherForm, name: e.target.value })} />
              <input className={INPUT} placeholder="Usuario" value={teacherForm.username} onChange={(e) => setTeacherForm({ ...teacherForm, username: e.target.value })} />
              <input className={INPUT} placeholder="Contraseña (mín. 8)" value={teacherForm.password} onChange={(e) => setTeacherForm({ ...teacherForm, password: e.target.value })} />
              <input className={INPUT} placeholder="Correo opcional" value={teacherForm.email} onChange={(e) => setTeacherForm({ ...teacherForm, email: e.target.value })} />
            </div>
            <button className="mt-4 rounded-2xl bg-rex px-5 py-3 font-semibold text-white" type="button" onClick={() => void run(async () => { await createTeacher(teacherForm.name, teacherForm.username, teacherForm.password, teacherForm.email); setTeacherForm({ name: '', username: '', password: '', email: '' }); }, 'Profesor creado correctamente.')}>Guardar profesor</button>

            <div className="mt-6 grid gap-3">
              {teachers.map((teacher) => {
                const isOpen = openTeacher === teacher.id;
                const owned = classrooms.filter((c) => c.created_by === teacher.id);
                const invited = classrooms.filter((c) => c.teachers?.some((t) => t.id === teacher.id));
                const ownStudents = students.filter((s) => s.created_by === teacher.id);
                const sharedStudents = students.filter((s) => s.shared_with?.some((t) => t.id === teacher.id));
                // Los que alcanza solo por estar en una de sus aulas (ni los creó ni se los compartieron).
                const direct = new Set([...ownStudents, ...sharedStudents].map((s) => s.id));
                const viaClassroom = [...new Set([...owned, ...invited].flatMap((c) => c.student_ids))].filter((id) => !direct.has(id)).map((id) => studentById.get(id)).filter((s): s is StudentSummary => !!s);
                return (
                  <div key={teacher.id} className="rounded-2xl border border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpenTeacher(isOpen ? null : teacher.id)}>
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        <span className="min-w-0">
                          <strong>{teacher.name}</strong> <span className="text-sm text-slate-500">@{teacher.username}{teacher.email ? ` · ${teacher.email}` : ''}</span>
                          {teacher.role === 'admin' && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">Admin</span>}
                        </span>
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        <Stat label="Aulas" value={teacher.classrooms_owned} />
                        <Stat label="Compartidas" value={teacher.classrooms_shared} />
                        <Stat label="Alumnos" value={teacher.students} />
                        <Stat label="Evaluaciones" value={teacher.worksheets} />
                        {teacher.role === 'teacher' && <button className={BTN} type="button" onClick={() => void viewAs(teacher)}><Eye className="mr-1 inline" size={15} /> Ver como profesor</button>}
                        {teacher.role === 'teacher' && <button className={BTN_DANGER} type="button" onClick={() => setDeleting({ teacher, heir: me.id })}><Trash2 className="mr-1 inline" size={15} /> Eliminar</button>}
                      </div>
                    </div>
                    {deleting?.teacher.id === teacher.id && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-red-50 p-3 text-sm text-red-700">
                        <span>Sus evaluaciones, aulas, alumnos y listas pasan a:</span>
                        <select className={SELECT} value={deleting.heir} onChange={(e) => setDeleting({ teacher, heir: e.target.value })}>
                          {teacherOptions.filter((o) => o.id !== teacher.id).map((o) => <option key={o.id} value={o.id}>{o.id === me.id ? `${o.label} — yo` : o.label}</option>)}
                        </select>
                        <button className={BTN_DANGER} type="button" onClick={() => { const { heir } = deleting; setDeleting(null); void run(() => deleteTeacher(teacher.id, heir), 'Profesor eliminado; su contenido fue reasignado.'); }}>Eliminar definitivamente</button>
                        <button className={BTN} type="button" onClick={() => setDeleting(null)}>Cancelar</button>
                      </div>
                    )}
                    {isOpen && (
                      <div className="grid gap-4 border-t border-slate-100 p-4 md:grid-cols-2">
                        <div>
                          <h4 className="font-bold">Aulas</h4>
                          <div className="mt-2 grid gap-2">
                            {owned.map((c) => <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span><strong>{c.name}</strong> · {c.student_ids.length} alumnos · {c.worksheet_count} hojas</span><button type="button" className="text-sm font-semibold text-rex-deep underline" onClick={() => { setOpenClassroom(c.id); navigate('/admin/aulas'); }}>Administrar</button></div>)}
                            {invited.map((c) => <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span><strong>{c.name}</strong> · compartida por {c.owner_name ?? 'otro profesor'}</span><button type="button" className="text-sm font-semibold text-rex-deep underline" onClick={() => { setOpenClassroom(c.id); navigate('/admin/aulas'); }}>Administrar</button></div>)}
                            {!owned.length && !invited.length && <p className="text-sm text-slate-500">Sin aulas.</p>}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-bold">Alumnos</h4>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {ownStudents.map((s) => <Chip key={s.id}>{s.name}</Chip>)}
                            {sharedStudents.map((s) => <Chip key={s.id}>{s.name} · de {s.owner_name ?? 'otro profesor'}</Chip>)}
                            {viaClassroom.map((s) => <Chip key={s.id}>{s.name} · por aula</Chip>)}
                            {!ownStudents.length && !sharedStudents.length && !viaClassroom.length && <p className="text-sm text-slate-500">Sin alumnos.</p>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {active === 'aulas' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Administración</p>
            <h2 className="text-2xl font-bold">Aulas</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Crea un aula a nombre de un profesor, súmale otros profesores y asígnale alumnos. El dueño es quien puede borrarla o compartirla; los profesores invitados ven el aula y asignan alumnos y sus propias hojas.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <input className={INPUT} placeholder="Nombre del aula" value={classroomForm.name} onChange={(e) => setClassroomForm({ ...classroomForm, name: e.target.value })} />
              <select className={`${INPUT} bg-white`} value={classroomForm.owner} onChange={(e) => setClassroomForm({ ...classroomForm, owner: e.target.value })}>
                <option value="">Profesor a cargo…</option>
                {teacherOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <button className="rounded-2xl bg-rex px-4 py-3 font-semibold text-white disabled:opacity-50" type="button" disabled={!classroomForm.name.trim() || !classroomForm.owner} onClick={() => void run(async () => { const created = await createClassroom(classroomForm.name.trim(), classroomForm.owner); setClassroomForm({ name: '', owner: '' }); setOpenClassroom(created.id); }, 'Aula creada. Ya puedes asignarle profesores y alumnos.')}>Crear aula</button>
            </div>

            <div className="mt-6 grid gap-3">
              {classrooms.map((classroom) => {
                const isOpen = openClassroom === classroom.id;
                const invited = classroom.teachers ?? [];
                return (
                  <div key={classroom.id} className="rounded-2xl border border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpenClassroom(isOpen ? null : classroom.id)}>
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        <span><strong>{classroom.name}</strong> <span className="text-sm text-slate-500">· {classroom.owner_name ?? 'sin dueño'}{invited.length ? ` + ${invited.length} invitado${invited.length > 1 ? 's' : ''}` : ''}</span></span>
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        <Stat label="Alumnos" value={classroom.student_ids.length} />
                        <Stat label="Hojas" value={classroom.worksheet_count} />
                        <button className={BTN} type="button" title="Renombrar aula" aria-label="Renombrar aula" onClick={() => rename(classroom)}><Pencil size={15} /></button>
                        <button className={BTN_DANGER} type="button" title="Eliminar aula" aria-label="Eliminar aula" onClick={() => { if (window.confirm(`¿Eliminar el aula "${classroom.name}"? Los alumnos no se borran, pero dejan de ver las hojas de esta aula.`)) void run(() => deleteClassroom(classroom.id), 'Aula eliminada.'); }}><Trash2 size={15} /></button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="grid gap-4 border-t border-slate-100 p-4">
                        <div>
                          <h4 className="font-bold">Profesores</h4>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-500">Dueño:</span>
                            <select className={SELECT} value={classroom.created_by} onChange={(e) => void run(() => setClassroomOwner(classroom.id, e.target.value), 'Dueño del aula actualizado.')}>
                              {teacherOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                            {invited.map((t) => <Chip key={t.id} title="Quitar del aula" onRemove={() => void run(() => unshareClassroom(classroom.id, t.id), `${t.name} ya no está en el aula.`)}>{t.name}</Chip>)}
                            <AddSelect placeholder="Añadir profesor…" options={teacherOptions.filter((o) => o.id !== classroom.created_by && !invited.some((t) => t.id === o.id))} onPick={(id) => void run(() => shareClassroom(classroom.id, { teacherId: id }), 'Profesor añadido al aula.')} />
                          </div>
                        </div>
                        <div>
                          <h4 className="font-bold">Alumnos</h4>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {classroom.student_ids.map((id) => <Chip key={id} title="Quitar del aula" onRemove={() => void run(() => unassignStudentFromClassroom(classroom.id, id), 'Alumno quitado del aula.')}>{studentById.get(id)?.name ?? 'Alumno'}</Chip>)}
                            {!classroom.student_ids.length && <span className="text-sm text-slate-500">Sin alumnos asignados.</span>}
                            <AddSelect placeholder="Añadir alumno…" options={students.filter((s) => !classroom.student_ids.includes(s.id)).map((s) => ({ id: s.id, label: `${s.name} (@${s.username})` }))} onPick={(id) => void run(() => assignStudentToClassroom(classroom.id, id), 'Alumno asignado al aula.')} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!classrooms.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay aulas.</p>}
            </div>
          </section>
        )}

        {active === 'estudiantes' && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Administración</p>
            <h2 className="text-2xl font-bold">Estudiantes</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Todos los alumnos de la plataforma. Cada uno tiene un profesor dueño (quien puede borrarlo) y se puede compartir con otros profesores para que también lo vean y lo asignen a sus aulas.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <input className={INPUT} placeholder="Nombre" value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} />
              <input className={INPUT} placeholder="Usuario" value={studentForm.username} onChange={(e) => setStudentForm({ ...studentForm, username: e.target.value })} />
              <input className={INPUT} placeholder="Contraseña (mín. 8)" value={studentForm.password} onChange={(e) => setStudentForm({ ...studentForm, password: e.target.value })} />
              <select className={`${INPUT} bg-white`} value={studentForm.owner} onChange={(e) => setStudentForm({ ...studentForm, owner: e.target.value })}>
                <option value="">Profesor a cargo…</option>
                {teacherOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <button className="mt-4 rounded-2xl bg-rex px-5 py-3 font-semibold text-white disabled:opacity-50" type="button" disabled={!studentForm.owner} onClick={() => void run(async () => { await createStudent(studentForm.name, studentForm.username, studentForm.password, studentForm.owner); setStudentForm({ name: '', username: '', password: '', owner: '' }); }, 'Estudiante creado correctamente.')}>Guardar estudiante</button>

            <label className="mt-6 flex items-center gap-2 rounded-2xl border px-3">
              <Search size={16} className="text-slate-400" />
              <input className="w-full bg-transparent p-3 outline-none" placeholder="Buscar por nombre, usuario o profesor" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
            </label>
            <div className="mt-3 grid gap-2">
              {filteredStudents.map((student) => {
                const shared = student.shared_with ?? [];
                const inClassrooms = classroomsOf(student.id);
                return (
                  <div key={student.id} className="grid gap-2 rounded-xl bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><strong>{student.name}</strong> · @{student.username}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button className={BTN} type="button" onClick={() => resetPassword(student)}><KeyRound className="mr-1 inline" size={15} /> Contraseña</button>
                        <button className={BTN_DANGER} type="button" onClick={() => { if (window.confirm(`¿Eliminar definitivamente al estudiante "${student.name}"? Sus respuestas históricas conservarán el nombre.`)) void run(() => deleteStudent(student.id), 'Estudiante eliminado.'); }}><Trash2 className="mr-1 inline" size={15} /> Eliminar</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-slate-500">Dueño:</span>
                      <select className={SELECT} value={student.created_by ?? ''} onChange={(e) => { if (e.target.value) void run(() => setStudentOwner(student.id, e.target.value), 'Dueño del alumno actualizado.'); }}>
                        {!student.created_by && <option value="">Sin dueño</option>}
                        {teacherOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      {shared.map((t) => <Chip key={t.id} title="Dejar de compartir" onRemove={() => void run(() => unshareStudent(student.id, t.id), `${student.name} ya no está compartido con ${t.name}.`)}>{t.name}</Chip>)}
                      <AddSelect placeholder="Compartir con…" options={teacherOptions.filter((o) => o.id !== student.created_by && !shared.some((t) => t.id === o.id))} onPick={(id) => void run(() => shareStudent(student.id, { teacherId: id }), 'Alumno compartido.')} />
                    </div>
                    <p className="text-xs text-slate-500">{inClassrooms.length ? `Aulas: ${inClassrooms.map((c) => c.name).join(', ')}` : 'Sin aula asignada.'}</p>
                  </div>
                );
              })}
              {!filteredStudents.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay estudiantes que coincidan.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
