import { useState } from 'react';
import { Check, Copy, MonitorSmartphone, Play, QrCode, Smartphone, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { GAMES, type Game } from '../../data/games';

const TIPS = [
  { icon: Users, title: 'Proyéctalo en clase', text: 'Abre el juego en la PC del salón y gira la ruleta o voltea las tarjetas frente a todos.' },
  { icon: Smartphone, title: 'Cada quien en su celular', text: 'Comparte el enlace o el QR: el alumno avanza a su ritmo y su progreso queda guardado en su teléfono.' },
  { icon: MonitorSmartphone, title: 'Sin cuenta ni instalación', text: 'Funciona en cualquier navegador, en PC o en celular, con o sin sesión en MyDinoEnglish.' },
];

function GameCard({ game }: { game: Game }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const url = new URL(game.href, window.location.origin).href;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowQr(true); // sin portapapeles: el panel del QR enseña el enlace para copiarlo a mano
    }
  };

  return (
    <article className="site-glass p-6 sm:p-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10">
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-site-acc/15 px-3 py-1 text-site-acc ring-1 ring-site-acc/30">Nivel {game.level}</span>
          <span className="rounded-full bg-site-acc2/15 px-3 py-1 text-site-acc2 ring-1 ring-site-acc2/30">{game.skill}</span>
          <span className="rounded-full bg-site-fg/8 px-3 py-1 text-site-fg/60 ring-1 ring-site-fg/15">{game.questions} preguntas</span>
        </div>
        <h2 className="mt-4 text-3xl font-black tracking-tight">{game.title}</h2>
        <p className="mt-2 leading-relaxed text-site-fg/65">{game.description}</p>

        {/* <a> y no <Link>: el juego es un HTML de public/, fuera de la SPA. */}
        <div className="mt-6 flex flex-wrap gap-2">
          <a href={game.href} className="site-btn site-btn-primary">
            <Play size={16} /> Jugar
          </a>
          <button type="button" onClick={copy} className="site-btn site-btn-ghost">
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
          <button type="button" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr} className="site-btn site-btn-ghost">
            <QrCode size={16} /> {showQr ? 'Ocultar QR' : 'QR para la clase'}
          </button>
        </div>

        {showQr && (
          <div className="mt-5 flex flex-wrap items-center gap-5 rounded-2xl border border-site-fg/10 bg-site-fg/[0.04] p-4">
            {/* Fondo blanco fijo: un QR claro sobre oscuro no lo leen todas las cámaras. */}
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={url} size={156} level="M" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">Escanéalo con la cámara del celular</p>
              <p className="mt-1 text-sm text-site-fg/60">Proyéctalo en clase y cada alumno abre el juego en su teléfono.</p>
              <p className="mt-3 select-all break-all font-mono text-xs text-site-fg/50">{url}</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:mt-0 lg:self-center">
        {game.modes.map((m) => (
          <a
            key={m.hash}
            href={`${game.href}#${m.hash}`}
            className="rounded-2xl border border-site-fg/10 bg-site-fg/[0.04] p-4 transition hover:-translate-y-0.5 hover:border-site-acc/40 hover:bg-site-fg/[0.07]"
          >
            <span aria-hidden className="text-3xl">{m.emoji}</span>
            <span className="mt-2 block font-bold leading-tight">{m.label}</span>
            <span className="mt-0.5 block text-sm text-site-fg/55">{m.topic}</span>
          </a>
        ))}
      </div>
    </article>
  );
}

export function GamesPage() {
  return (
    <>
      <header className="max-w-3xl">
        <p className="site-eyebrow site-neon-spike">Juegos</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight md:text-6xl">
          <span className="site-chrome">Practica hablando,</span>
          <span className="block site-neon">en el celular o en la PC.</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-site-fg/70">
          Juegos de conversación para usar en clase o en casa. Se abren con un enlace, sin cuenta y sin
          instalar nada.
        </p>
      </header>

      <div className="mt-12 grid gap-6">
        {GAMES.map((g) => <GameCard key={g.id} game={g} />)}
      </div>

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
