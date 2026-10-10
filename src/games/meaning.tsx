import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, X } from 'lucide-react';
import { pick, range, sample, shuffle, speak, useGame, type GameProps } from './util';
import { Finish, Notice, Say, Speak } from './ui';

/** Índices de las preguntas que tienen traducción: los tres juegos de significado viven de ella. */
function useTranslated(questions: GameProps['questions']): number[] {
  return useMemo(() => range(questions.length).filter((i) => questions[i].translation.trim()), [questions]);
}

const NEEDS_TRANSLATION = 'Este juego necesita al menos 4 preguntas con traducción. Pídele a tu profesor que las agregue en el generador.';

// ── Memorama ──────────────────────────────────────────────────────────────────

interface MemoryCard {
  pair: number; // índice de la pregunta
  side: 'en' | 'es';
}

export function MemoryGame({ questions }: GameProps) {
  const usable = useTranslated(questions);
  const pairs = Math.min(6, usable.length);
  const deal = () => shuffle(sample(usable, pairs).flatMap((i): MemoryCard[] => [{ pair: i, side: 'en' }, { pair: i, side: 'es' }]));
  const [cards, setCards] = useState(deal);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    if (open.length !== 2) return;
    const [a, b] = open.map((k) => cards[k]);
    if (a.pair === b.pair) {
      setMatched((m) => new Set(m).add(a.pair));
      speak(questions[a.pair].text);
      setOpen([]);
      return;
    }
    const t = window.setTimeout(() => setOpen([]), 1000);
    return () => window.clearTimeout(t);
  }, [open, cards, questions]);

  if (pairs < 4) return <Notice>{NEEDS_TRANSLATION}</Notice>;
  if (matched.size === pairs) {
    return (
      <Finish score={pairs} total={pairs} onAgain={() => { setCards(deal()); setMatched(new Set()); setMoves(0); }}>
        <p className="dg-muted center">Lo lograste en <b>{moves}</b> intentos (lo mínimo posible es {pairs}).</p>
      </Finish>
    );
  }

  const flip = (k: number) => {
    if (open.length === 2 || open.includes(k) || matched.has(cards[k].pair)) return;
    setOpen((o) => [...o, k]);
    if (open.length === 1) setMoves((m) => m + 1);
  };
  return (
    <div className="dg-memory-wrap">
      <p className="dg-progress">{matched.size} de {pairs} pares · {moves} intentos</p>
      <div className="dg-memory">
        {cards.map((c, k) => {
          const up = open.includes(k) || matched.has(c.pair);
          return (
            <button key={k} type="button" className={`dg-mem ${up ? 'up' : ''} ${matched.has(c.pair) ? 'matched' : ''} ${c.side}`} onClick={() => flip(k)}
              aria-label={up ? (c.side === 'en' ? questions[c.pair].text : questions[c.pair].translation) : 'Carta boca abajo'}>
              <span className="dg-mem-in">
                <span className="dg-mem-back">{c.side === 'en' ? 'EN' : 'ES'}</span>
                <span className="dg-mem-front">{c.side === 'en' ? questions[c.pair].text : questions[c.pair].translation}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="dg-muted center">Une cada pregunta en inglés (EN) con su traducción (ES).</p>
    </div>
  );
}

// ── Contrarreloj ──────────────────────────────────────────────────────────────

const SECONDS = 60;

function speedRound(usable: number[], avoid: number | null) {
  const target = pick(usable.length > 1 ? usable.filter((i) => i !== avoid) : usable);
  return { target, options: shuffle([target, ...sample(usable.filter((i) => i !== target), Math.min(3, usable.length - 1))]) };
}

export function SpeedGame({ questions }: GameProps) {
  const { setId } = useGame();
  const usable = useTranslated(questions);
  const bestKey = `dg-best-${setId}`;
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const [left, setLeft] = useState(SECONDS);
  const [round, setRound] = useState(() => speedRound(usable, null));
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [flash, setFlash] = useState<'' | 'ok' | 'bad'>('');
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(bestKey)) || 0; } catch { return 0; } });
  const endsAt = useRef(0);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = window.setInterval(() => {
      const rest = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000));
      setLeft(rest);
      if (!rest) setPhase('over');
    }, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'over' || score <= best) return;
    setBest(score);
    try { localStorage.setItem(bestKey, String(score)); } catch { /* sin almacenamiento: el récord dura la sesión */ }
  }, [phase, score, best, bestKey]);

  if (usable.length < 4) return <Notice>{NEEDS_TRANSLATION}</Notice>;

  const start = () => { endsAt.current = Date.now() + SECONDS * 1000; setLeft(SECONDS); setScore(0); setCombo(0); setRound(speedRound(usable, null)); setPhase('play'); };
  const answer = (i: number) => {
    if (i === round.target) {
      const mult = Math.min(combo + 1, 5);
      setScore((s) => s + 10 * mult);
      setCombo((c) => c + 1);
      setFlash('ok');
    } else {
      setCombo(0);
      setFlash('bad');
    }
    window.setTimeout(() => setFlash(''), 250);
    setRound(speedRound(usable, round.target));
  };

  if (phase === 'ready' || phase === 'over') {
    return (
      <div className="dg-center-card">
        {phase === 'over' && <p className="dg-finish-score">{score} puntos</p>}
        <p className="dg-big-q">{phase === 'over' ? (score >= best && score > 0 ? '¡Nuevo récord! 🏆' : `Tu récord: ${best}`) : `Tienes ${SECONDS} segundos: lee la traducción y elige la pregunta en inglés.`}</p>
        <p className="dg-muted center">Cada acierto seguido sube el combo (hasta ×5). Un error lo reinicia.</p>
        <button type="button" className="dg-btn primary big" onClick={start}><Play size={18} /> {phase === 'over' ? 'Jugar otra vez' : '¡Empezar!'}</button>
      </div>
    );
  }

  return (
    <div className={`dg-quiz dg-speed ${flash}`}>
      <div className="dg-speed-bar">
        <span className="dg-speed-time" style={{ width: `${(left / SECONDS) * 100}%` }} />
      </div>
      <p className="dg-progress">⏱ {left}s · {score} puntos {combo > 1 && <b className="dg-combo">combo ×{Math.min(combo, 5)}</b>}</p>
      <p className="dg-big-q es">{questions[round.target].translation}</p>
      <div className="dg-options">
        {round.options.map((o) => (
          <button key={o} type="button" className="dg-option" onClick={() => answer(o)}>{questions[o].text}</button>
        ))}
      </div>
    </div>
  );
}

// ── ¿Coincide? ────────────────────────────────────────────────────────────────

const MATCH_ROUNDS = 15;

function matchRound(usable: number[], questions: GameProps['questions']) {
  const target = pick(usable);
  const truthy = Math.random() < 0.5;
  const others = usable.filter((i) => i !== target && questions[i].translation !== questions[target].translation);
  const shown = truthy || !others.length ? target : pick(others);
  return { target, shown, truthy: shown === target };
}

export function MatchGame({ questions }: GameProps) {
  const usable = useTranslated(questions);
  const [n, setN] = useState(0);
  const [round, setRound] = useState(() => matchRound(usable, questions));
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [result, setResult] = useState<'' | 'ok' | 'bad'>('');
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);

  if (usable.length < 4) return <Notice>{NEEDS_TRANSLATION}</Notice>;
  if (n >= MATCH_ROUNDS) {
    return <Finish score={score} total={MATCH_ROUNDS} onAgain={() => { setN(0); setScore(0); setStreak(0); setRound(matchRound(usable, questions)); }} />;
  }

  const answer = (yes: boolean) => {
    if (result) return;
    const ok = yes === round.truthy;
    setResult(ok ? 'ok' : 'bad');
    setScore((s) => s + (ok ? 1 : 0));
    setStreak((s) => (ok ? s + 1 : 0));
    setDrag(yes ? 400 : -400);
    window.setTimeout(() => { setResult(''); setDrag(0); setN((k) => k + 1); setRound(matchRound(usable, questions)); }, 650);
  };
  const q = questions[round.target];

  return (
    <div className="dg-quiz">
      <p className="dg-progress">Tarjeta {n + 1} de {MATCH_ROUNDS} · {score} aciertos {streak > 2 && <b className="dg-combo">🔥 {streak}</b>}</p>
      <div
        className={`dg-swipe ${result}`}
        style={{ transform: `translateX(${drag}px) rotate(${drag / 25}deg)` }}
        onPointerDown={(e) => { startX.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (startX.current !== null) setDrag(e.clientX - startX.current); }}
        onPointerUp={() => {
          if (startX.current === null) return;
          startX.current = null;
          if (Math.abs(drag) > 90) answer(drag > 0);
          else setDrag(0);
        }}
      >
        <p className="dg-big-q"><Say text={q.text} /></p>
        <Speak text={q.text} />
        <p className="dg-swipe-t">{questions[round.shown].translation}</p>
        {result && <p className={result === 'ok' ? 'dg-ok' : 'dg-bad'}>{result === 'ok' ? '¡Bien!' : round.truthy ? 'Sí coincidía.' : `No: era “${q.translation}”.`}</p>}
      </div>
      <p className="dg-muted center">¿La traducción corresponde a la pregunta? Desliza o toca.</p>
      <div className="dg-row center">
        <button type="button" className="dg-yesno no" onClick={() => answer(false)} aria-label="No coincide"><X size={30} /></button>
        <button type="button" className="dg-yesno yes" onClick={() => answer(true)} aria-label="Sí coincide"><Check size={30} /></button>
      </div>
    </div>
  );
}
