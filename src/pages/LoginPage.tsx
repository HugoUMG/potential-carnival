import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronLeft, Eye, EyeOff, GraduationCap, LockKeyhole, UserPlus } from 'lucide-react';
import { getCurrentSession, login, loginWithGoogle } from '../services/api';
import { Spinner } from '../components/LoadingScreen';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { ThemeToggle } from '../components/ThemeToggle';
import RexMascot from '../components/RexMascot';
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
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState(expiredMessage);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Si ya hay sesión activa, redirigir directamente al portal
  useEffect(() => {
    const session = getCurrentSession();
    if (session) navigate(roleRoute(session.role), { replace: true });
  }, [navigate]);

  async function handleLogin() {
    if (isLoggingIn) return;
    setMessage('');
    setIsLoggingIn(true);
    try {
      const user = await login(username, password, role);
      navigate(roleRoute(user.role), { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión. Revisa que el backend esté activo.');
      setIsLoggingIn(false);
    }
    // En éxito no reactivamos: navegamos fuera y el spinner sigue hasta el cambio de ruta.
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleLogin();
  }

  /** Google entra y, si es la primera vez, crea la cuenta de profesor en el mismo paso. */
  async function handleGoogle(credential: string) {
    setMessage('');
    setIsLoggingIn(true);
    try {
      const user = await loginWithGoogle(credential);
      navigate(roleRoute(user.role), { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo entrar con Google.');
      setIsLoggingIn(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-10 text-ink">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <button
          className="rounded-full border border-rex/30 px-4 py-2 text-sm font-bold text-rex-deep transition hover:border-rex hover:bg-rex-light"
          type="button"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="mr-1 inline" size={16} /> Inicio
        </button>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            className="rounded-full border border-rex/30 bg-white px-4 py-2 text-sm font-bold text-rex-deep shadow-sm transition hover:border-rex hover:bg-rex-light"
            type="button"
            onClick={() => { setRole(role === 'teacher' ? 'student' : 'teacher'); setUsername(''); setPassword(''); setMessage(''); }}
          >
            {role === 'teacher' ? 'Entrar como estudiante' : 'Entrar como profesor'}
          </button>
        </div>
      </div>
      <section className="mx-auto mt-8 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-rex-light px-4 py-2 text-sm font-bold uppercase tracking-[0.2em] text-rex-deep">
            <GraduationCap size={18} /> Plataforma educativa
          </span>
          <div className="mt-6 flex items-center gap-4">
            <RexMascot
              title="RexLearn, la mascota de MyDinoEnglish"
              className="h-28 w-28 shrink-0 drop-shadow-md md:h-36 md:w-36"
            />
            <h1 className="text-5xl font-black tracking-tight text-ink md:text-7xl">
              <span className="text-spike">My</span>Dino<span className="text-rex">English</span>
            </h1>
          </div>
          <p className="mt-5 max-w-2xl text-xl font-semibold text-rex-deep">
            Create engaging English worksheets in seconds.
          </p>
        </div>
        <div className="rounded-3xl border border-rex/15 bg-white p-6 shadow-xl shadow-rex-deep/10">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">
              {role === 'teacher' ? 'Acceso docente' : 'Acceso estudiante'}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-ink">
              {role === 'teacher' ? 'Panel del profesor' : 'Portal del estudiante'}
            </h2>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-ink/80">Usuario</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-rex focus:ring-4 focus:ring-rex/20"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="username"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-semibold text-ink/80">Contraseña</span>
            <div className="relative mt-2">
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 pr-12 outline-none focus:border-rex focus:ring-4 focus:ring-rex/20"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-ink"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </label>
          <button
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-rex px-5 py-3 font-bold text-white shadow-lg shadow-rex/30 transition hover:bg-rex-dark disabled:opacity-70"
            type="button"
            disabled={isLoggingIn}
            onClick={() => void handleLogin()}
          >
            {isLoggingIn ? <><Spinner size={18} className="border-white/40 border-t-white" /> Entrando…</> : <><LockKeyhole size={18} /> Entrar</>}
          </button>
          {message && (
            <p className={`mt-4 rounded-2xl p-3 text-sm font-semibold ${message === expiredMessage && expiredMessage ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
              {message}
            </p>
          )}

          {/* ── Acceso con Google ───────────────────────────────────────── */}
          <div className="mt-5 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> o <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="mt-4">
            <GoogleSignInButton text="signin_with" onCredential={(c) => void handleGoogle(c)} onError={setMessage} />
          </div>

          {/* ── Crear cuenta (solo profesores) y vocabulario público ─────── */}
          <div className="mt-5 grid gap-2 border-t border-rex-light pt-4">
            <Link
              className="flex items-center justify-center gap-2 rounded-2xl bg-spike px-4 py-3 font-bold text-white shadow-lg shadow-spike/30 transition hover:bg-spike-dark"
              to="/registro"
            >
              <UserPlus size={18} /> Crear cuenta de profesor
            </Link>
            <p className="text-center text-xs text-slate-500">
              Las cuentas de estudiante las crea su profesor desde el panel.
            </p>
            <button
              className="mt-1 flex items-center justify-center gap-2 rounded-2xl bg-rex-deep px-4 py-3 font-bold text-white shadow-lg shadow-rex-deep/25 transition hover:bg-ink"
              type="button"
              onClick={() => navigate('/vocab')}
            >
              <BookOpen size={18} /> Vocabulario
            </button>
          </div>
          {/* ponytail: el modo invitado queda oculto a petición del profesor — el flujo vivo
              es el enlace directo por hoja (/w/:id). La ruta /guest sigue existiendo; para
              reactivarlo basta con volver a poner aquí un enlace a /guest. */}
        </div>
      </section>
    </main>
  );
}
