import { Link } from 'react-router-dom';
import { ArrowRight, Check, Code2, MousePointerClick, Wand2 } from 'lucide-react';
import { useTheme } from '../../utils/theme';

/**
 * Captura real del editor, enmarcada como ventana de navegador.
 *
 * Hay dos juegos de imágenes: `nombre.webp` (claro) y `nombre-dark.webp` (oscuro). Se
 * muestra la del modo activo, así la captura coincide con lo que el visitante ve en la
 * app. Las dos se regeneran juntas con `node scripts/shots.mjs` (ver /__shots en dev).
 */
function Shot({ title, src, alt }: { title: string; src: string; alt: string }) {
  const theme = useTheme();
  const file = theme === 'dark' ? src.replace(/\.webp$/, '-dark.webp') : src;
  return (
    <figure className="site-shot">
      <div className="site-shot-bar">
        <span className="site-shot-dot bg-[#FF5F57]" />
        <span className="site-shot-dot bg-[#FEBC2E]" />
        <span className="site-shot-dot bg-[#28C840]" />
        <figcaption className="ml-2 truncate text-[11px] font-semibold text-site-fg/45">{title}</figcaption>
        <span className="ml-auto shrink-0 text-[11px] text-site-fg/30">clic para ampliar</span>
      </div>
      {/* Enlace normal al archivo: ampliar no necesita visor ni JS. */}
      <a href={file} target="_blank" rel="noreferrer">
        {/* key: fuerza recarga al cambiar de tema (si no, el navegador deja la anterior). */}
        <img key={file} src={file} alt={alt} loading="lazy" className="block w-full" />
      </a>
    </figure>
  );
}

const METHODS = [
  {
    id: 'grafico',
    n: '01',
    icon: MousePointerClick,
    title: 'Gráfico',
    tagline: 'Constructor visual',
    text: 'Eliges el tipo de actividad de una lista, rellenas los campos en formularios y arrastras las tarjetas para reordenarlas. No hay sintaxis que aprender: lo que ves es lo que el alumno verá.',
    bullets: [
      'Los 19 tipos disponibles en el selector',
      'Arrastrar para reordenar actividades',
      'Tema de color y campos de identificación de la hoja',
      'Vista previa del lado del alumno antes de publicar',
    ],
    best: 'Para empezar, y para hojas cortas o muy visuales.',
    shot: <Shot title="MyDinoEnglish — Constructor visual" src="/shots/editor-visual.webp" alt="Constructor visual: la actividad de opción múltiple abierta, con su pregunta, sus opciones y la respuesta correcta marcada." />,
  },
  {
    id: 'dsl',
    n: '02',
    icon: Code2,
    title: 'DSL',
    tagline: 'Escribir el script',
    text: 'Un lenguaje de texto pensado para hojas de trabajo. Cada actividad es un bloque con sus campos. Se escribe rápido, se copia y pega entre hojas, y se valida antes de guardar.',
    bullets: [
      'Bloques con título e instrucciones por sección',
      'Un archivo de texto: se versiona, se comparte, se reutiliza',
      'Validación del script antes de guardar',
      'Ida y vuelta con el constructor visual',
    ],
    best: 'Para exámenes largos o series de hojas parecidas.',
    shot: <Shot title="MyDinoEnglish — Editor de script (DSL)" src="/shots/editor-dsl.webp" alt="Editor de script con un WorksheetScript real: dos bloques, dos fillblank y una actividad de escuchar y ordenar." />,
  },
  {
    id: 'ia',
    n: '03',
    icon: Wand2,
    title: 'IA',
    tagline: 'Describir y generar',
    text: 'Describes la hoja en lenguaje natural —o la armas con chips de nivel, tema, edad y duración— y la IA devuelve el script completo. A partir de ahí lo editas como cualquier otra hoja.',
    bullets: [
      'Presets de un clic: calentamiento, quiz semanal, examen mensual',
      'Chips de nivel, tema, objetivo, edad, duración y dificultad',
      'El prompt se compone en vivo y se puede editar a mano',
      'El resultado es un script normal: editable y revisable',
    ],
    best: 'Para tener un borrador decente en segundos.',
    shot: <Shot title="MyDinoEnglish — Generar con IA" src="/shots/editor-ia.webp" alt="Panel de generación con IA: chips de nivel A2, tema, objetivo, edad y duración marcados, y el prompt compuesto en vivo abajo." />,
  },
];

export function LearnPage() {
  return (
    <>
      <header className="max-w-3xl">
        <p className="site-eyebrow site-neon-spike">Aprende</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight md:text-6xl">
          <span className="site-chrome">Tres formas de crear</span>
          <span className="block site-neon">la misma hoja.</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-site-fg/70">
          Gráfico, DSL o IA. No compiten entre sí: puedes generar con IA, ajustar en el constructor
          visual y rematar en el script. Todas terminan en la misma hoja publicable.
        </p>
      </header>

      {/* Índice rápido */}
      <nav className="mt-8 flex flex-wrap gap-2">
        {METHODS.map(({ id, icon: Icon, title }) => (
          <a key={id} href={`#${id}`} className="site-btn site-btn-ghost !px-4 !py-2 text-sm">
            <Icon size={15} /> {title}
          </a>
        ))}
      </nav>

      <div className="mt-14 grid gap-16">
        {METHODS.map(({ id, n, icon: Icon, title, tagline, text, bullets, best, shot }, i) => (
          <section key={id} id={id} className="scroll-mt-24">
            <div className={`grid items-center gap-8 lg:grid-cols-2 ${i % 2 ? 'lg:[&>figure]:order-first' : ''}`}>
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-site-acc/15 text-site-acc ring-1 ring-site-acc/30">
                    <Icon size={20} />
                  </span>
                  <div>
                    <p className="site-eyebrow text-site-fg/40">{n} · {tagline}</p>
                    <h2 className="text-3xl font-black tracking-tight">{title}</h2>
                  </div>
                </div>

                <p className="mt-5 leading-relaxed text-site-fg/70">{text}</p>

                <ul className="mt-5 grid gap-2">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm text-site-fg/65">
                      <Check size={15} className="mt-0.5 shrink-0 text-site-acc" /> {b}
                    </li>
                  ))}
                </ul>

                <p className="mt-5 inline-flex rounded-full bg-site-acc2/12 px-4 py-2 text-sm font-semibold text-site-acc2 ring-1 ring-site-acc2/30">
                  Ideal: {best}
                </p>
              </div>

              {shot}
            </div>
          </section>
        ))}
      </div>

      {/* Comparativa */}
      <section className="mt-20 site-glass p-6 sm:p-8">
        <h2 className="text-2xl font-black tracking-tight">¿Cuál te conviene?</h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-site-fg/45">
                <th className="border-b border-site-fg/10 pb-3 pr-4 font-bold">Si quieres…</th>
                <th className="border-b border-site-fg/10 pb-3 pr-4 font-bold">Gráfico</th>
                <th className="border-b border-site-fg/10 pb-3 pr-4 font-bold">DSL</th>
                <th className="border-b border-site-fg/10 pb-3 font-bold">IA</th>
              </tr>
            </thead>
            <tbody className="text-site-fg/70">
              {[
                ['Empezar sin aprender nada', '★★★', '★', '★★★'],
                ['Ir rápido en hojas largas', '★', '★★★', '★★'],
                ['Control fino de cada campo', '★★', '★★★', '★'],
                ['Reutilizar y versionar', '★', '★★★', '★'],
                ['Tener un borrador ya escrito', '—', '—', '★★★'],
              ].map(([q, a, b, c]) => (
                <tr key={q}>
                  <td className="border-b border-site-fg/5 py-3 pr-4 font-semibold text-site-fg/85">{q}</td>
                  <td className="border-b border-site-fg/5 py-3 pr-4 text-site-acc">{a}</td>
                  <td className="border-b border-site-fg/5 py-3 pr-4 text-site-acc">{b}</td>
                  <td className="border-b border-site-fg/5 py-3 text-site-acc">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14 site-glass p-10 text-center">
        <h2 className="text-3xl font-black tracking-tight">Entra y arma la primera.</h2>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/login" className="site-btn site-btn-primary">Entrar como profesor <ArrowRight size={18} /></Link>
          <Link to="/registro" className="site-btn site-btn-spike">Crear cuenta</Link>
        </div>
      </section>
    </>
  );
}
