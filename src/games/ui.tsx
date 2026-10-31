import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Snail, Timer, Volume2 } from 'lucide-react';
import RexMascot from '../components/RexMascot';
import { moodForScore } from '../utils/scoreMood';
import { TEAM_COLORS, speak, teamName, tokenize, useGame } from './util';

/** Texto en inglés con cada palabra tocable, al estilo Duolingo: abre sus significados y la pronuncia. */
export function Say({ text, className = '' }: { text: string; className?: string }) {
  const { openWord } = useGame();
  return (
    <span className={className}>
      {tokenize(text).map((t, i) => {
        const word = t.word;
        if (!word) return <span key={i}>{t.raw}</span>;
        return (
          <button key={i} type="button" className="dg-w" onClick={(e) => { e.stopPropagation(); openWord(word, e.currentTarget); }}>
            {t.raw}
          </button>
        );
      })}
    </span>
  );
}

/** Altavoz (velocidad normal) + tortuga (lento), como en Duolingo. */
export function Speak({ text, label = 'Escuchar' }: { text: string; label?: string }) {
  return (
    <span className="dg-speak">
      <button type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); speak(text); }}>
        <Volume2 size={18} />
      </button>
      <button type="button" aria-label={`${label} lento`} title="Lento" onClick={(e) => { e.stopPropagation(); speak(text, true); }}>
        <Snail size={18} />
      </button>
    </span>
  );
}

/** Traducción al español: desaparece con el botón ES. */
export function Es({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { es } = useGame();
  return es && children ? <p className={`dg-es ${className}`}>{children}</p> : null;
}

export function WordPopover({ word, anchor, onClose }: { word: string; anchor: HTMLElement; onClose: () => void }) {
  const { glossary } = useGame();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -9999, left: 0 });
  const entry = glossary[word];

  // Debajo de la palabra si cabe; si no, encima. Nunca fuera de la pantalla.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - el.offsetWidth / 2), window.innerWidth - el.offsetWidth - 8);
    const below = r.bottom + 8 + el.offsetHeight < window.innerHeight;
    setPos({ top: below ? r.bottom + 8 : Math.max(8, r.top - el.offsetHeight - 8), left });
  }, [anchor, word]);

  useEffect(() => { speak(word); }, [word]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className="dg-pop" role="dialog" aria-label={`Significados de ${word}`} style={{ top: pos.top, left: pos.left }}>
      <div className="dg-pop-head">
        <b>{word}</b>
        <Speak text={word} label={`Pronunciar ${word}`} />
      </div>
      {entry?.lemma && entry.lemma !== word && <p className="dg-pop-lemma">forma base: <b>{entry.lemma}</b></p>}
      {entry ? (
        entry.senses.map((s, i) => (
          <div key={i} className="dg-pop-sense">
            <span>{s.pos}</span>
            <p>{s.meanings.join(' · ')}</p>
          </div>
        ))
      ) : (
        <p className="dg-pop-empty">Todavía no hay significados para esta palabra. Puedes escucharla.</p>
      )}
    </div>
  );
}

/** Ventana sobre el juego (resultado de la ruleta, nota del corcho). */
export function Sheet({ children, onClose, className = '', style }: { children: ReactNode; onClose: () => void; className?: string; style?: CSSProperties }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="dg-scrim" onClick={onClose}>
      <div className={`dg-sheet ${className}`} style={style} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Cronómetro de 30 s para responder (encabezado, dados, equipos). */
export function Countdown({ seconds = 30, compact = false }: { seconds?: number; compact?: boolean }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (left === null || left <= 0) return;
    const t = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  const over = left === 0;
  const pct = left === null ? 0 : ((seconds - left) / seconds) * 360;
  return (
    <button
      type="button"
      className={`dg-timer ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
      style={{ '--p': `${pct}deg` } as CSSProperties}
      onClick={() => setLeft(left === null || over ? seconds : null)}
      aria-label={`Cronómetro de ${seconds} segundos`}
    >
      {left === null ? <Timer size={16} /> : <span className="dg-timer-ring" />}
      <span>{over ? '¡Tiempo!' : left === null ? `${seconds}s` : `${left}s`}</span>
    </button>
  );
}

/** Pantalla final de una ronda, con Rex según el resultado. */
export function Finish({ score, total, onAgain, children }: { score: number; total: number; onAgain: () => void; children?: ReactNode }) {
  const pct = total ? Math.round((score / total) * 100) : 0;
  return (
    <div className="dg-finish">
      <RexMascot mood={moodForScore(pct)} className="dg-finish-rex" />
      <p className="dg-finish-score">{score} / {total}</p>
      <p className="dg-finish-msg">{pct >= 75 ? '¡Excelente trabajo!' : pct >= 50 ? '¡Bien hecho! Ya casi.' : '¡Sigue practicando!'}</p>
      {children}
      <button type="button" className="dg-btn primary" onClick={onAgain}>Jugar otra vez</button>
    </div>
  );
}

/** Aviso cuando a un juego le faltan datos (p. ej. traducciones). */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="dg-notice">
      <RexMascot mood="thinking" className="dg-notice-rex" />
      <p>{children}</p>
    </div>
  );
}

/** Primera pantalla de los juegos por equipos: nombres (opcionales) y 2, 3 o 4 equipos. */
export function TeamCount({ onPick, children }: { onPick: (teams: number, names: string[]) => void; children: ReactNode }) {
  const [names, setNames] = useState(['', '', '', '']);
  return (
    <div className="dg-teams-setup">
      <p className="dg-big-q">¿Cuántos equipos juegan?</p>
      <div className="dg-team-names">
        {names.map((v, k) => (
          <input key={k} className="dg-input" style={{ borderColor: TEAM_COLORS[k] }} value={v} maxLength={20}
            placeholder={`Equipo ${k + 1} (nombre opcional)`} aria-label={`Nombre del equipo ${k + 1}`}
            onChange={(e) => setNames((n) => n.map((x, i) => (i === k ? e.target.value : x)))} />
        ))}
      </div>
      <div className="dg-row center">
        {[2, 3, 4].map((t) => (
          <button key={t} type="button" className="dg-btn primary big" onClick={() => onPick(t, names.slice(0, t).map((_, k) => teamName(names, k)))}>{t} equipos</button>
        ))}
      </div>
      <p className="dg-muted center">{children}</p>
    </div>
  );
}
