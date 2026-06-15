import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, GraduationCap, LockKeyhole } from 'lucide-react';
import { getCurrentSession, login } from '../services/api';
import type { UsuarioSesion } from '../services/api';

function roleRoute(role: UsuarioSesion['role']): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  if (role === 'reader') return '/reader';
  return '/student';
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const expiredMessage = (location.state as { message?: string } | null)?.message ?? '';

  const [role, setRole] = useState<UsuarioSesion['role']>('student');
  // Ciclo de roles visibles en el toggle: student → teacher → student
  // El rol reader se activa por un enlace discreto aparte
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(expiredMessage);

  // Si ya hay sesión activa, redirigir directamente al portal
  useEffect(() => {
    const session = getCurrentSession();
    if (session) navigate(roleRoute(session.role), { replace: true });
  }, [navigate]);

  async function handleLogin() {
    setMessage('');
    try {
      const user = await login(username, password, role);
      navigate(roleRoute(user.role), { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión. Revisa que el backend esté activo.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleLogin();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto flex max-w-6xl items-center justify-end gap-3">
        <button
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
          type="button"
          onClick={() => { setRole(role === 'teacher' ? 'student' : 'teacher'); setUsername(''); setPassword(''); setMessage(''); }}
        >
          {role === 'teacher' ? 'Entrar como estudiante' : 'Entrar como profesor'}
        </button>
      </div>
      <section className="mx-auto mt-8 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-bold uppercase tracking-[0.2em] text-blue-700">
            <GraduationCap size={18} /> Plataforma educativa
          </span>
          <h1 className="mt-6 text-5xl font-black uppercase tracking-tight text-slate-950 md:text-7xl">
            English Worksheet Platform
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Un entorno profesional para asignar, resolver y revisar actividades de inglés de forma organizada.
          </p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-slate-200/70">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
              {role === 'teacher' ? 'Acceso docente' : 'Acceso estudiante'}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-950">
              {role === 'teacher' ? 'Panel del profesor' : 'Portal del estudiante'}
            </h2>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Usuario</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="username"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-semibold text-slate-700">Contraseña</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="current-password"
            />
          </label>
          <button
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700"
            type="button"
            onClick={() => void handleLogin()}
          >
            <LockKeyhole size={18} /> Entrar
          </button>
          {message && (
            <p className={`mt-4 rounded-2xl p-3 text-sm font-semibold ${message === expiredMessage && expiredMessage ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
              {message}
            </p>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-600"
              type="button"
              onClick={() => navigate('/vocab')}
            >
              <BookOpen size={18} /> Vocabulario
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
