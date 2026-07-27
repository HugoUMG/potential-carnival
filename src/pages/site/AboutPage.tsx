import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpen, Eye, GraduationCap, KeyRound, Link2, School,
  ShieldCheck, Sparkles, UserRound, Users,
} from 'lucide-react';

const ROLES = [
  { icon: GraduationCap, title: 'Profesor', text: 'Crea hojas y listas de vocabulario, arma aulas, asigna contenido y revisa cada respuesta.' },
  { icon: Users, title: 'Estudiante', text: 'Ve solo las hojas de su aula, las responde y consulta su nota y sus aciertos.' },
  { icon: ShieldCheck, title: 'Admin', text: 'Gestiona profesores y estudiantes, y todo lo que puede hacer un profesor.' },
  { icon: Eye, title: 'Lector', text: 'Acceso al portal de vocabulario, sin evaluaciones.' },
];

const ACCESS = [
  { icon: Link2, title: 'Enlace directo', text: 'La forma más simple: el profesor copia el enlace de la hoja y el alumno la abre, la resuelve y la envía. Sin cuenta, sin menús. Su nombre lo pide la propia hoja.' },
  { icon: UserRound, title: 'Modo invitado', text: 'El alumno entra con su nombre y elige un aula pública. Ve todas las hojas de esa aula sin registrarse.' },
  { icon: KeyRound, title: 'Cuenta con usuario', text: 'Estudiante registrado: entra con usuario y contraseña, y conserva su historial de notas entre sesiones.' },
  { icon: BookOpen, title: 'Portal de vocabulario', text: 'Las listas de vocabulario se pueden consultar en abierto, sin iniciar sesión.' },
];

const GRADING = [
  { title: 'Automática', text: 'Opción múltiple, verdadero/falso, arrastrar palabras, unir con líneas, completar espacios y todas las de escucha se corrigen en el momento del envío.' },
  { title: 'Con IA', text: 'Las respuestas abiertas (texto largo, imagen, oral) las evalúa la IA: da estado y un comentario en español. Nunca marca como incorrecto algo que ya salió correcto.' },
  { title: 'Manual', text: 'El profesor tiene la última palabra: puede corregir a mano cualquier actividad, típicamente por un typo o una respuesta válida equivalente.' },
];

export function AboutPage() {
  return (
    <>
      <header className="max-w-3xl">
        <p className="site-eyebrow site-neon-spike">Acerca de</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight md:text-6xl">
          <span className="site-chrome">Una hoja de trabajo</span>
          <span className="block site-neon">que hace todo el trabajo.</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-site-fg/70">
          DinoEnglish Studio es una plataforma web para clases de inglés. Reemplaza la fotocopia por
          una hoja interactiva: el alumno escucha audios, habla al micrófono, arrastra palabras y une
          columnas; al enviar, la hoja ya viene calificada. El profesor recupera el tiempo que se le
          iba en corregir.
        </p>
      </header>

      {/* ── En una línea ─────────────────────────────────────────────────── */}
      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        {[
          ['El profesor crea', 'Con IA, arrastrando bloques o escribiendo el DSL. Publica y comparte.'],
          ['El alumno responde', 'Abre el enlace o entra a su aula. Responde en el navegador, sin instalar nada.'],
          ['El sistema califica', 'Nota inmediata, resumen por hoja y detalle actividad por actividad.'],
        ].map(([title, text]) => (
          <article key={title} className="site-glass p-6">
            <h2 className="text-lg font-bold site-neon">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-site-fg/60">{text}</p>
          </article>
        ))}
      </section>

      {/* ── Roles ────────────────────────────────────────────────────────── */}
      <section className="mt-20">
        <p className="site-eyebrow site-neon-spike">Quién usa la plataforma</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Cuatro roles, cada uno con su portal</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map(({ icon: Icon, title, text }) => (
            <article key={title} className="site-glass site-glass-hover p-6">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-site-acc/15 text-site-acc ring-1 ring-site-acc/30">
                <Icon size={20} />
              </span>
              <h3 className="mt-4 font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-site-fg/60">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Formas de entrar ─────────────────────────────────────────────── */}
      <section className="mt-20">
        <p className="site-eyebrow site-neon-spike">Acceso</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">El alumno no necesita cuenta</h2>
        <p className="mt-3 max-w-2xl text-site-fg/60">
          Crear usuarios para treinta alumnos es fricción. Por eso hay cuatro puertas de entrada y
          tres de ellas no piden contraseña.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {ACCESS.map(({ icon: Icon, title, text }) => (
            <article key={title} className="site-glass site-glass-hover flex gap-4 p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-site-acc2/15 text-site-acc2 ring-1 ring-site-acc2/30">
                <Icon size={20} />
              </span>
              <div>
                <h3 className="font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-site-fg/60">{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Aulas ────────────────────────────────────────────────────────── */}
      <section className="mt-20 site-glass p-8">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-site-fg/8 text-site-acc ring-1 ring-site-fg/15">
            <School size={22} />
          </span>
          <div className="min-w-[16rem] flex-1">
            <h2 className="text-2xl font-black tracking-tight">Aulas: el orden de todo</h2>
            <p className="mt-2 max-w-3xl leading-relaxed text-site-fg/60">
              Un aula agrupa estudiantes y hojas. El alumno registrado ve exactamente las hojas de su
              aula y nada más. Las hojas pueden llevar fecha de entrega y un límite de intentos, y las
              listas de vocabulario se asignan igual: por aula o directo a un lector.
            </p>
          </div>
        </div>
      </section>

      {/* ── Calificación ─────────────────────────────────────────────────── */}
      <section className="mt-20">
        <p className="site-eyebrow site-neon-spike">Calificación</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Tres capas de corrección</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {GRADING.map(({ title, text }, i) => (
            <article key={title} className="site-glass p-6">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-site-acc/15 text-xs font-black text-site-acc ring-1 ring-site-acc/30">{i + 1}</span>
                <h3 className="font-bold">{title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-site-fg/60">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="mt-20 site-glass p-10 text-center">
        <Sparkles size={24} className="mx-auto text-site-acc" />
        <h2 className="mt-4 text-3xl font-black tracking-tight">¿Listo para armar la primera hoja?</h2>
        <p className="mx-auto mt-3 max-w-xl text-site-fg/60">
          Mira las tres formas de crearla, con capturas de cada camino.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/aprende" className="site-btn site-btn-primary">Aprende a crearlas <ArrowRight size={18} /></Link>
          <Link to="/actividades" className="site-btn site-btn-ghost">Ver las 19 actividades</Link>
        </div>
      </section>
    </>
  );
}
