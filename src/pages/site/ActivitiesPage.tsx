import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Headphones, Mic, Music4, PenLine, Shapes } from 'lucide-react';

type Grading = 'auto' | 'ia' | 'libre';

interface Activity {
  key: string;
  name: string;
  text: string;
  grading: Grading;
}

const GROUPS: { icon: typeof Shapes; emoji: string; title: string; subtitle: string; items: Activity[] }[] = [
  {
    icon: Shapes,
    emoji: '🧱',
    title: 'Gramática y vocabulario',
    subtitle: 'Preguntas cerradas: hay una respuesta esperada y el sistema la conoce.',
    items: [
      { key: 'fillblank', name: 'Completar espacios', text: 'La oración lleva huecos y el alumno escribe la palabra que falta.', grading: 'auto' },
      { key: 'dragdrop', name: 'Arrastrar palabras', text: 'Un banco de palabras (con distractores) que se arrastran a los huecos.', grading: 'auto' },
      { key: 'multiplechoice', name: 'Opción múltiple', text: 'Varias opciones, una sola correcta. Se barajan al mostrarlas.', grading: 'auto' },
      { key: 'multiselect', name: 'Selección múltiple', text: 'Igual que la anterior, pero hay más de una respuesta correcta.', grading: 'auto' },
      { key: 'matching', name: 'Unir con líneas', text: 'Dos columnas que se conectan trazando líneas de color, punto a punto.', grading: 'auto' },
      { key: 'truefalse', name: 'Verdadero / Falso', text: 'Enunciados que el alumno marca como ciertos o falsos.', grading: 'auto' },
    ],
  },
  {
    icon: BookOpen,
    emoji: '📖',
    title: 'Lectura',
    subtitle: 'Primero se explica o se lee; después se pregunta sobre el texto.',
    items: [
      { key: 'content', name: 'Repaso / teoría', text: 'Una mini-página con el tema explicado (títulos, colores, tablas). Solo lectura.', grading: 'libre' },
      { key: 'reading', name: 'Lectura + preguntas', text: 'Un texto con botón de audio y preguntas abiertas sobre lo leído.', grading: 'ia' },
      { key: 'readingtruefalse', name: 'Lectura + V/F', text: 'El mismo texto, pero evaluado con enunciados de verdadero o falso.', grading: 'auto' },
    ],
  },
  {
    icon: Headphones,
    emoji: '🎧',
    title: 'Comprensión auditiva',
    subtitle: 'El audio se genera con voz sintética; el alumno nunca ve el texto.',
    items: [
      { key: 'listening', name: 'Escuchar y responder', text: 'Reproduce una oración oculta y pregunta sobre ella.', grading: 'auto' },
      { key: 'listeningmultiplechoice', name: 'Escuchar + opción múltiple', text: 'Audio y opciones para elegir la correcta.', grading: 'auto' },
      { key: 'listeningtruefalse', name: 'Escuchar + V/F', text: 'Un audio y varios enunciados para marcar verdadero o falso.', grading: 'auto' },
    ],
  },
  {
    icon: Music4,
    emoji: '🎼',
    title: 'Escucha fina',
    subtitle: 'Dictado y orden: aquí se entrena el oído palabra por palabra.',
    items: [
      { key: 'listeningfillblank', name: 'Dictado con huecos', text: 'Se escucha la oración y se escriben las palabras que faltan.', grading: 'auto' },
      { key: 'listeningorder', name: 'Ordenar la oración', text: 'Fichas desordenadas que se tocan para armar la frase que escuchas.', grading: 'auto' },
      { key: 'listeningmatching', name: 'Varios audios + categoría', text: 'Cada audio se clasifica con un desplegable (habilidad, consejo, permiso…).', grading: 'auto' },
    ],
  },
  {
    icon: Mic,
    emoji: '🗣️',
    title: 'Producción oral',
    subtitle: 'Micrófono en el navegador; si no hay, queda el respaldo escrito.',
    items: [
      { key: 'speaking', name: 'Hablar', text: 'Leer una oración en voz alta, o responder una pregunta hablando libremente.', grading: 'ia' },
      { key: 'conversation', name: 'Diálogo a dos voces', text: 'Una conversación con voz masculina y femenina en un solo audio, y una pregunta.', grading: 'auto' },
    ],
  },
  {
    icon: PenLine,
    emoji: '✍️',
    title: 'Escritura abierta',
    subtitle: 'Sin respuesta única: las evalúa la IA o el profesor.',
    items: [
      { key: 'textbox', name: 'Respuesta larga', text: 'Un cuadro de texto para redactar con sus propias palabras.', grading: 'ia' },
      { key: 'imagequestion', name: 'Pregunta con imagen', text: 'Una imagen y una pregunta abierta sobre lo que se ve en ella.', grading: 'ia' },
    ],
  },
];

const BADGE: Record<Grading, { label: string; className: string }> = {
  auto: { label: 'Automática', className: 'bg-site-acc/15 text-site-acc ring-site-acc/30' },
  ia: { label: 'IA o profesor', className: 'bg-site-acc2/15 text-site-acc2 ring-site-acc2/30' },
  libre: { label: 'No se califica', className: 'bg-site-fg/8 text-site-fg/60 ring-site-fg/15' },
};

export function ActivitiesPage() {
  const total = GROUPS.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <header className="max-w-3xl">
        <p className="site-eyebrow site-neon-spike">Actividades</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight md:text-6xl">
          <span className="site-chrome">{total} tipos de actividad,</span>
          <span className="block site-neon">seis habilidades.</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-site-fg/70">
          Una hoja se arma mezclando estos bloques en el orden que quieras. Casi todos se corrigen
          solos; los abiertos los evalúa la IA o el profesor.
        </p>
      </header>

      <div className="mt-8 flex flex-wrap gap-2 text-xs font-bold">
        {(Object.keys(BADGE) as Grading[]).map((k) => (
          <span key={k} className={`rounded-full px-3 py-1.5 ring-1 ${BADGE[k].className}`}>{BADGE[k].label}</span>
        ))}
      </div>

      <div className="mt-12 grid gap-6">
        {GROUPS.map(({ icon: Icon, emoji, title, subtitle, items }) => (
          <section key={title} className="site-glass p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-site-acc/15 text-site-acc ring-1 ring-site-acc/30">
                <Icon size={20} />
              </span>
              <div className="min-w-[14rem] flex-1">
                <h2 className="text-xl font-black tracking-tight">
                  <span aria-hidden className="mr-2">{emoji}</span>{title}
                </h2>
                <p className="mt-0.5 text-sm text-site-fg/55">{subtitle}</p>
              </div>
              <span className="rounded-full bg-site-fg/8 px-3 py-1 text-xs font-bold text-site-fg/60 ring-1 ring-site-fg/15">
                {items.length} {items.length === 1 ? 'tipo' : 'tipos'}
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => (
                <article key={a.key} className="rounded-2xl border border-site-fg/10 bg-site-fg/[0.04] p-4 transition hover:border-site-acc/40 hover:bg-site-fg/[0.07]">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold leading-tight">{a.name}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${BADGE[a.grading].className}`}>
                      {BADGE[a.grading].label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-site-fg/60">{a.text}</p>
                  <code className="mt-3 block font-mono text-[11px] text-site-fg/35">{a.key}</code>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-14 site-glass p-10 text-center">
        <h2 className="text-3xl font-black tracking-tight">Ya sabes qué se puede armar.</h2>
        <p className="mx-auto mt-3 max-w-xl text-site-fg/60">Ahora mira las tres formas de armarlo.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/aprende" className="site-btn site-btn-primary">Cómo se crean <ArrowRight size={18} /></Link>
          <Link to="/registro" className="site-btn site-btn-ghost">Crear cuenta</Link>
        </div>
      </section>
    </>
  );
}
