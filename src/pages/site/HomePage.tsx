import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpenCheck, BookText, ClipboardCheck, Headphones, Info, LayoutGrid,
  Mic, Send, Share2, Sparkles, UserPlus, Wand2,
} from 'lucide-react';
import RexMascot from '../../components/RexMascot';

const PILLARS = [
  {
    icon: Wand2,
    title: 'Créala en 3 formas',
    text: 'Constructor visual, lenguaje DSL o un prompt a la IA. La misma hoja, el camino que prefieras.',
  },
  {
    icon: LayoutGrid,
    title: '19 tipos de actividad',
    text: 'Gramática, lectura, escucha fina, producción oral y escritura abierta · todo en una hoja.',
  },
  {
    icon: ClipboardCheck,
    title: 'Se califica sola',
    text: 'Lo cerrado se corrige al instante; lo abierto lo evalúa la IA o tú, con comentario en español.',
  },
];

const STEPS = [
  { n: '01', icon: Sparkles, title: 'Crea la hoja', text: 'Escribe un prompt, arrastra bloques o teclea el DSL. Vista previa inmediata.' },
  { n: '02', icon: Share2, title: 'Compártela', text: 'Asígnala a un aula o copia el enlace directo: el alumno entra sin cuenta.' },
  { n: '03', icon: Send, title: 'El alumno responde', text: 'Escucha audios, habla al micrófono, arrastra, une con líneas y envía.' },
  { n: '04', icon: BookOpenCheck, title: 'Revisa y ajusta', text: 'Notas, aciertos por hoja, resumen de desempeño con IA y corrección manual.' },
];

const ROUTES = [
  { to: '/acerca', icon: Info, title: 'Acerca de', text: 'Qué es la plataforma, para quién es y cómo funciona por dentro.' },
  { to: '/actividades', icon: LayoutGrid, title: 'Actividades', text: 'Los 19 tipos disponibles, agrupados por habilidad.' },
  { to: '/aprende', icon: Wand2, title: 'Aprende', text: 'Las tres formas de crear una hoja, con capturas paso a paso.' },
];

export function HomePage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <span className="site-eyebrow site-neon inline-flex items-center gap-2 rounded-full border border-site-fg/15 bg-site-fg/5 px-4 py-2">
            <Sparkles size={13} /> Plataforma educativa de inglés
          </span>

          <h1 className="mt-6 text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">
            <span className="site-chrome">Hojas de trabajo</span>
            <span className="block site-neon">que se corrigen solas.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-site-fg/70">
            MyDinoEnglish es un constructor de hojas de trabajo de inglés. El profesor arma la
            actividad (con IA, arrastrando bloques o escribiendo el DSL), la comparte con un enlace y
            recibe las respuestas ya calificadas. El alumno solo abre el enlace y responde.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/aprende" className="site-btn site-btn-primary">
              Ver cómo se crea <ArrowRight size={18} />
            </Link>
            {/* El acceso de invitado vive en el login, no aquí. Hoy está oculto: el flujo
                vivo para el alumno es el enlace directo por hoja (/w/:id). */}
            <Link to="/registro" className="site-btn site-btn-spike">
              <UserPlus size={18} /> Crear cuenta de profesor
            </Link>
            <Link to="/actividades" className="site-btn site-btn-ghost">
              Actividades
            </Link>
            <Link to="/vocab" className="site-btn site-btn-ghost">
              <BookText size={18} /> Conoce nuestro vocabulario gratuito
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-site-fg/50">
            <span className="inline-flex items-center gap-2"><Headphones size={15} /> Audio generado con voz sintética</span>
            <span className="inline-flex items-center gap-2"><Mic size={15} /> Práctica oral con micrófono</span>
          </div>
        </div>

        {/* Tarjeta de vidrio con la mascota */}
        <div className="site-glass site-glass-hover p-8 text-center">
          <RexMascot
            title="RexLearn, la mascota de MyDinoEnglish"
            className="mx-auto h-52 w-52 drop-shadow-[0_18px_30px_rgba(132,184,76,0.35)]"
          />
          <p className="mt-4 text-2xl font-black tracking-tight">
            <span className="site-neon-spike">My</span>Dino<span className="site-neon">English</span>
          </p>
          <div className="site-rule my-6" />
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['19', 'tipos'], ['3', 'formas'], ['0', 'instalación']].map(([big, small]) => (
              <div key={small}>
                <p className="text-3xl font-black site-neon">{big}</p>
                <p className="text-xs uppercase tracking-wider text-site-fg/45">{small}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pilares ──────────────────────────────────────────────────────── */}
      <section className="mt-20 grid gap-5 md:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, text }) => (
          <article key={title} className="site-glass site-glass-hover p-6">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-site-acc/15 text-site-acc ring-1 ring-site-acc/30">
              <Icon size={20} />
            </span>
            <h2 className="mt-4 text-lg font-bold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-site-fg/60">{text}</p>
          </article>
        ))}
      </section>

      {/* ── Cómo funciona ────────────────────────────────────────────────── */}
      <section className="mt-20">
        <p className="site-eyebrow site-neon-spike">Cómo funciona</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">De la idea a la nota, en cuatro pasos</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, icon: Icon, title, text }) => (
            <article key={n} className="site-glass site-glass-hover p-6">
              <div className="flex items-center justify-between">
                <Icon size={20} className="text-site-acc" />
                <span className="text-3xl font-black text-site-fg/10">{n}</span>
              </div>
              <h3 className="mt-3 font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-site-fg/60">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Secciones del sitio ──────────────────────────────────────────── */}
      <section className="mt-20">
        <div className="site-rule mb-10" />
        <div className="grid gap-4 md:grid-cols-3">
          {ROUTES.map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="site-glass site-glass-hover block p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-site-fg/8 text-site-acc ring-1 ring-site-fg/15">
                <Icon size={18} />
              </span>
              <h3 className="mt-4 flex items-center gap-2 text-lg font-bold">
                {title} <ArrowRight size={16} className="text-site-acc" />
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-site-fg/60">{text}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
