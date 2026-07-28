import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, GraduationCap, ShieldCheck } from 'lucide-react';
import { loginWithGoogle } from '../services/api';
import { Spinner } from '../components/LoadingScreen';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { ThemeToggle } from '../components/ThemeToggle';
import RexMascot from '../components/RexMascot';

/**
 * Alta de cuenta: SOLO con Google, y solo de PROFESOR.
 *
 * No hay formulario de usuario/contraseña a propósito. Google entrega el correo ya
 * verificado (`email_verified`), que es lo único que hace fiable el alta: un formulario
 * propio aceptaría cualquier correo escrito a mano sin forma de comprobarlo. El endpoint
 * público de registro con contraseña se eliminó por lo mismo — esconder el botón y dejar
 * la ruta abierta no habría cambiado nada.
 *
 * Salidas si Google no está disponible: el admin crea profesores desde su panel
 * (`POST /teachers`), y los alumnos los crea siempre su profesor.
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleGoogle(credential: string) {
    setMessage('');
    setIsSaving(true);
    try {
      const user = await loginWithGoogle(credential);
      navigate(user.role === 'admin' ? '/admin' : user.role === 'student' ? '/student' : '/teacher', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear la cuenta con Google.');
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-10 text-ink">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <Link
          className="rounded-full border border-rex/30 px-4 py-2 text-sm font-bold text-rex-deep transition hover:border-rex hover:bg-rex-light"
          to="/login"
        >
          <ChevronLeft className="mr-1 inline" size={16} /> Volver a entrar
        </Link>
        <ThemeToggle />
      </div>

      <section className="mx-auto mt-8 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-rex-light px-4 py-2 text-sm font-bold uppercase tracking-[0.2em] text-rex-deep">
            <GraduationCap size={18} /> Cuenta de profesor
          </span>
          <div className="mt-6 flex items-center gap-4">
            <RexMascot title="RexLearn, la mascota de MyDinoEnglish" className="h-28 w-28 shrink-0 drop-shadow-md md:h-36 md:w-36" />
            <h1 className="text-5xl font-black tracking-tight text-ink md:text-7xl">
              <span className="text-spike">My</span>Dino<span className="text-rex">English</span>
            </h1>
          </div>
          <p className="mt-5 max-w-2xl text-xl font-semibold text-rex-deep">
            Crea tu cuenta y arma tu primera hoja en minutos.
          </p>
          <ul className="mt-5 grid gap-2 text-sm text-ink/70">
            <li>· Tus aulas, tus alumnos y tus evaluaciones son solo tuyos.</li>
            <li>· Genera hojas con IA, con el constructor visual o escribiendo el DSL.</li>
            <li>· Comparte un enlace: el alumno responde y tú recibes la nota.</li>
          </ul>
        </div>

        <div className="rounded-3xl border border-rex/15 bg-white p-6 shadow-xl shadow-rex-deep/10">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-rex">Registro</p>
            <h2 className="mt-1 text-2xl font-extrabold text-ink">Crear cuenta de profesor</h2>
          </div>

          <div className="flex items-start gap-3 rounded-2xl bg-rex-light p-4">
            <ShieldCheck className="mt-0.5 shrink-0 text-rex-deep" size={20} />
            <p className="text-sm leading-relaxed text-rex-deep">
              El registro se hace <strong>con tu cuenta de Google</strong>. Así el correo llega
              verificado y no hay que inventar otra contraseña que recordar.
            </p>
          </div>

          <div className="mt-6">
            {isSaving
              ? <p className="flex items-center justify-center gap-2 py-3 text-sm font-semibold text-rex-deep"><Spinner size={18} /> Creando tu cuenta…</p>
              : <GoogleSignInButton text="signup_with" onCredential={(c) => void handleGoogle(c)} onError={setMessage} />}
          </div>

          {message && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{message}</p>}

          <p className="mt-6 border-t border-rex-light pt-4 text-sm leading-relaxed text-slate-500">
            ¿Eres <strong>estudiante</strong>? Tu cuenta la crea tu profesor: pídele tu usuario y
            contraseña y entra desde <Link className="font-bold text-rex-deep hover:underline" to="/login">Entrar</Link>.
          </p>
          <p className="mt-3 text-center text-sm text-slate-500">
            ¿Ya tienes cuenta? <Link className="font-bold text-rex-deep hover:underline" to="/login">Entrar</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
