import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Copy, MessagesSquare, MonitorSmartphone, Play, QrCode, Smartphone, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AppIcon } from '../../components/AppIcon';
import { Spinner } from '../../components/LoadingScreen';
import { GAMES, SKILLS } from '../../games/registry';
import { listFeaturedGameSets } from '../../services/api';
import type { GameSetSummary } from '../../types';

const TIPS = [
  { icon: Users, title: 'Proyéctalo en clase', text: 'Abre el juego en la PC del salón y gira la ruleta, canta el bingo o reparte puntos por equipos.' },
  { icon: Smartphone, title: 'Cada quien en su celular', text: 'Comparte el enlace o el QR: el alumno juega a su ritmo y toca cualquier palabra para ver qué significa.' },
  { icon: MonitorSmartphone, title: 'Sin cuenta ni instalación', text: 'Funciona en cualquier navegador, en PC o en celular, con o sin sesión en MyDinoEnglish.' },
];

function SetCard({ set }: { set: GameSetSummary }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const url = `${window.location.origin}/j/${set.id}`;
  const copy = () => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => setShowQr(true));

  return (
    <article className="site-glass flex flex-col p-6">
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        {set.level && <span className="rounded-full bg-site-acc/15 px-3 py-1 text-site-acc ring-1 ring-site-acc/30">Nivel {set.level}</span>}
        <span className="rounded-full bg-site-fg/8 px-3 py-1 text-site-fg/60 ring-1 ring-site-fg/15">{set.question_count} preguntas · {GAMES.length} juegos</span>
      </div>
      <h2 className="mt-4 text-2xl font-black tracking-tight">{set.title}</h2>
      {set.topic && <p className="mt-1 leading-relaxed text-site-fg/65">{set.topic}</p>}
      <div className="mt-auto flex flex-wrap gap-2 pt-6">
        <Link to={`/j/${set.id}`} className="site-btn site-btn-primary"><Play size={16} /> Jugar</Link>
        <button type="button" onClick={() => void copy()} className="site-btn site-btn-ghost">
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar enlace'}
        </button>
        <button type="button" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr} className="site-btn site-btn-ghost">
          <QrCode size={16} /> QR
        </button>
      </div>
      {showQr && (
        <div className="mt-5 flex flex-wrap items-center gap-5 rounded-2xl border border-site-fg/10 bg-site-fg/[0.04] p-4">
          {/* Fondo blanco fijo: un QR claro sobre oscuro no lo leen todas las cámaras. */}
          <div className="rounded-xl bg-white p-3"><QRCodeSVG value={url} size={140} level="M" /></div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Escanéalo con la cámara del celular</p>
            <p className="mt-3 select-all break-all font-mono text-xs text-site-fg/50">{url}</p>
          </div>
        </div>
      )}
    </article>
  );
}

export function GamesPage() {
  const [sets, setSets] = useState<GameSetSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { listFeaturedGameSets().then(setSets, (e: Error) => setError(e.message)); }, []);

  return (
    <>
      <header className="max-w-3xl">
        <p className="site-eyebrow site-neon-spike">Juegos</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight md:text-6xl">
          <span className="site-chrome">Practica hablando,</span>
          <span className="block site-neon">en el celular o en la PC.</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-site-fg/70">
          Cada set trae {GAMES.length} juegos para hablar, escuchar, ordenar y entender preguntas en inglés, y juegos de mesa para retarse en parejas. Se abren con un
          enlace, sin cuenta, y cada palabra se puede tocar para ver qué significa y cómo suena.
        </p>
      </header>

      <Link to="/conversacion" className="site-glass site-glass-hover mt-10 flex flex-wrap items-center gap-5 p-6 sm:p-8">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-site-acc2/15 text-site-acc2 ring-1 ring-site-acc2/30"><MessagesSquare size={28} /></span>
        <div className="min-w-[14rem] flex-1">
          <p className="site-eyebrow site-neon-spike">Nuevo · Conversación con IA</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Habla en inglés sin miedo a equivocarte</h2>
          <p className="mt-1 text-site-fg/65">Role-plays por voz con personajes de IA (restaurante, aeropuerto, entrevista de trabajo…), en tres niveles y con tu nota al final.</p>
        </div>
        <span className="site-btn site-btn-spike">Probar <ArrowRight size={16} /></span>
      </Link>

      <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {!sets && !error && <div className="grid place-items-center py-10 md:col-span-2 xl:col-span-3"><Spinner /></div>}
        {error && <p className="site-glass p-6 text-site-fg/70 md:col-span-2 xl:col-span-3">No se pudieron cargar los juegos: {error}</p>}
        {sets?.length === 0 && (
          <div className="site-glass p-8 md:col-span-2 xl:col-span-3">
            <p className="text-lg font-bold">Pronto habrá juegos aquí.</p>
            <p className="mt-1 text-site-fg/60">Si eres profesor, créalos desde tu panel en <b>Juegos</b> y márcalos para mostrarlos en esta página.</p>
            <Link to="/login" className="site-btn site-btn-primary mt-5">Entrar al panel</Link>
          </div>
        )}
        {sets?.map((s) => <SetCard key={s.id} set={s} />)}
      </div>

      <section className="mt-16">
        <h2 className="text-2xl font-black tracking-tight">Los {GAMES.length} juegos de cada set</h2>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {SKILLS.map((s) => (
            <div key={s.id} className="site-glass p-6">
              <h3 className="flex items-center gap-2 text-lg font-black"><AppIcon name={s.icon} size={20} /> {s.name}</h3>
              <ul className="mt-4 grid gap-3">
                {GAMES.filter((g) => g.skill === s.id).map((g) => (
                  <li key={g.id} className="flex gap-3">
                    <span aria-hidden className="leading-none"><AppIcon name={g.icon} size={24} /></span>
                    <div>
                      <p className="font-bold">{g.name}</p>
                      <p className="text-sm leading-relaxed text-site-fg/65">{g.purpose}</p>
                      <p className="mt-0.5 text-sm text-site-fg/45">En clase: {g.howTo}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {TIPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-site-fg/10 bg-site-fg/[0.04] p-5">
            <Icon size={20} className="text-site-acc" />
            <h3 className="mt-3 font-bold">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-site-fg/60">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
