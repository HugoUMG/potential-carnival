import { useMemo, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Circle, Dices, Flag, PartyPopper, RotateCcw, Smile, Trophy, X } from 'lucide-react';
import type { GameQuestion } from '../types';
import { pick, range, shuffle, speak, type GameProps } from './util';
import { Notice, Say, Sheet, Speak } from './ui';
import { useRoom, useShared } from './roomState';

/* Juegos de mesa para 2 (gato, conecta 4, serpientes y escaleras). Para mover, quien tiene el turno
 * acierta qué significa una pregunta del set (opción múltiple con las traducciones). Sin sala se
 * juega pasando el celular; en sala por turnos juegan los 2 primeros (`roomSeats: 2`) y el resto mira. */

const NEEDS = 'Este juego necesita al menos 4 preguntas con traducción. Pídele a tu profesor que las agregue en el generador.';
const SIDES = [{ name: 'X', color: '#E8590C' }, { name: 'O', color: '#1971C2' }];

function SideMark({ side, size = 18 }: { side: number; size?: number }) {
  return side === 0 ? <X size={size} strokeWidth={3} /> : <Circle size={size} strokeWidth={3} />;
}

interface Challenge {
  at: number;        // casilla, columna o tirada del dado: lo que se gana si acierta
  q: number;         // pregunta
  options: number[]; // preguntas cuyas traducciones son las opciones
  chosen: number | null;
}

function useTranslated(questions: GameQuestion[]): number[] {
  return useMemo(() => range(questions.length).filter((i) => questions[i].translation.trim()), [questions]);
}

function newChallenge(questions: GameQuestion[], usable: number[], at: number, avoid?: number): Challenge {
  const q = pick(usable.length > 1 ? usable.filter((i) => i !== avoid) : usable);
  const seen = new Set([questions[q].translation.trim().toLowerCase()]);
  const others = shuffle(usable.filter((i) => i !== q)).filter((i) => {
    const t = questions[i].translation.trim().toLowerCase();
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return { at, q, options: shuffle([q, ...others.slice(0, 2)]), chosen: null };
}

/** Ganador de un tablero w×h (celdas -1 = vacía) con `k` en línea, o null. Pura. */
function lineWinner(board: number[], w: number, h: number, k: number): number | null {
  const at = (x: number, y: number) => (x >= 0 && x < w && y >= 0 && y < h ? board[y * w + x] : -2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x, y);
      if (v < 0) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        if (range(k).every((s) => at(x + dx * s, y + dy * s) === v)) return v;
      }
    }
  }
  return null;
}

function useSideNames(): string[] {
  const { room } = useRoom();
  return room ? [room.players[0]?.name ?? 'Jugador 1', room.players[1]?.name ?? 'Jugador 2'] : ['Jugador 1', 'Jugador 2'];
}

/** Marcador de los dos lados. `disc`: la ficha es un círculo de color (conecta 4) en vez de ✕/◯. */
function Sides({ side, names, winner, extra, disc = false }: { side: number; names: string[]; winner: number | null; extra?: (s: number) => string; disc?: boolean }) {
  return (
    <div className="dg-players">
      {SIDES.map((s, k) => {
        const turn = winner === null && side === k;
        return (
          <div key={k} className={`dg-player ${turn ? 'turn' : ''} ${winner === k ? 'won' : ''}`} style={{ '--side': s.color } as CSSProperties}>
            <b className={disc ? 'disc' : ''}>{disc ? '' : <SideMark side={k} />}</b>
            <span>
              <span className="dg-player-name">{names[k]}</span>
              <small className="inline-flex items-center gap-1">{winner === k ? <><Trophy size={12} /> ¡Ganó!</> : turn ? 'Le toca' : extra?.(k) ?? 'Espera'}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** La pregunta del turno. Al responder enseña si acertó; "Continuar" aplica la jugada y pasa el turno. */
function ChallengeCard({ questions, ch, onChoose, onDone }: { questions: GameQuestion[]; ch: Challenge; onChoose: (i: number) => void; onDone: () => void }) {
  const q = questions[ch.q];
  const ok = ch.chosen === ch.q;
  // En hoja inferior: el tablero sigue a la vista detrás. No se cierra tocando fuera (sería
  // saltarse la pregunta): solo "Continuar" la cierra.
  return (
    <Sheet onClose={() => {}} className="dg-challenge-card">
      <p className="dg-challenge">¿Qué significa?</p>
      <p className="dg-big-q"><Say text={q.text} /></p>
      <div className="dg-row center"><Speak text={q.text} /></div>
      <div className="dg-options">
        {ch.options.map((o) => {
          const state = ch.chosen === null ? '' : o === ch.q ? 'ok' : o === ch.chosen ? 'bad' : 'dim';
          return <button key={o} type="button" className={`dg-option ${state}`} disabled={ch.chosen !== null} onClick={() => onChoose(o)}>{questions[o].translation}</button>;
        })}
      </div>
      {ch.chosen !== null && (
        <div className="dg-feedback">
          <p className={`${ok ? 'dg-ok' : 'dg-bad'} inline-flex items-center gap-1.5`}>{ok ? <><PartyPopper size={16} /> ¡Correcto! Haces tu jugada.</> : 'Fallaste: pierdes la jugada.'}</p>
          <button type="button" className="dg-btn primary" onClick={onDone}>Continuar</button>
        </div>
      )}
    </Sheet>
  );
}

/** Estado común: lado que mueve, reto abierto y ganador (-1 = empate). `finish` cierra el reto,
 *  aplica la jugada si acertó y pasa el turno. */
function useBoardTurn(questions: GameQuestion[]) {
  const { endTurn, addPoint } = useRoom();
  const usable = useTranslated(questions);
  const [side, setSide] = useShared('side', 0);
  const [ch, setCh] = useShared<Challenge | null>('ch', null);
  const [winner, setWinner] = useShared<number | null>('winner', null);
  const ask = (at: number) => {
    const next = newChallenge(questions, usable, at, ch?.q);
    setCh(next);
    speak(questions[next.q].text);
  };
  const choose = (o: number) => { if (ch && ch.chosen === null) setCh({ ...ch, chosen: o }); };
  /** `apply` recibe la jugada y devuelve el ganador que deja (o null). */
  const finish = (apply: (at: number) => number | null) => {
    if (!ch) return;
    const won = ch.chosen === ch.q ? apply(ch.at) : null;
    setCh(null);
    if (won !== null) {
      setWinner(won);
      if (won >= 0) addPoint();
    } else {
      setSide(1 - side);
    }
    endTurn();
  };
  const reset = () => { setSide(0); setCh(null); setWinner(null); };
  return { usable, side, ch, winner, ask, choose, finish, reset };
}

function Result({ winner, names, onAgain }: { winner: number; names: string[]; onAgain: () => void }) {
  return (
    <div className="dg-feedback">
      <p className="dg-ok inline-flex items-center gap-1.5">{winner < 0 ? <><Smile size={16} /> ¡Empate!</> : <><Trophy size={16} /> ¡Gana {names[winner]}!</>}</p>
      <button type="button" className="dg-btn primary" onClick={onAgain}><RotateCcw size={16} /> Otra partida</button>
    </div>
  );
}

// ── Gato (tres en raya) ───────────────────────────────────────────────────────

export function TicTacToeGame({ questions }: GameProps) {
  const names = useSideNames();
  const t = useBoardTurn(questions);
  const [board, setBoard] = useShared<number[]>('board', () => new Array(9).fill(-1));
  if (t.usable.length < 4) return <Notice>{NEEDS}</Notice>;

  const apply = (cell: number) => {
    const next = board.map((v, k) => (k === cell ? t.side : v));
    setBoard(next);
    return lineWinner(next, 3, 3, 3) ?? (next.every((v) => v >= 0) ? -1 : null);
  };
  return (
    <div className="dg-boardgame">
      <Sides side={t.side} names={names} winner={t.winner} />
      <div className="dg-ttt">
        {board.map((v, k) => (
          <button key={k} type="button" className={`dg-ttt-cell ${v >= 0 ? `mark-${v}` : ''} ${t.ch?.at === k ? 'asking' : ''}`} disabled={v >= 0 || !!t.ch || t.winner !== null} onClick={() => t.ask(k)}
            style={v >= 0 ? { color: SIDES[v].color } as CSSProperties : undefined} aria-label={v >= 0 ? SIDES[v].name : `Casilla ${k + 1}`}>
            {v >= 0 ? <SideMark side={v} size={34} /> : t.ch?.at === k ? <span className="text-2xl">?</span> : ''}
          </button>
        ))}
      </div>
      {t.ch && <ChallengeCard questions={questions} ch={t.ch} onChoose={t.choose} onDone={() => t.finish(apply)} />}
      {!t.ch && t.winner === null && <p className="dg-muted center">Elige una casilla y acierta la pregunta para marcarla. Tres en línea ganan.</p>}
      {t.winner !== null && <Result winner={t.winner} names={names} onAgain={() => { setBoard(new Array(9).fill(-1)); t.reset(); }} />}
    </div>
  );
}

// ── Conecta 4 ─────────────────────────────────────────────────────────────────

const C4W = 7;
const C4H = 6;

export function ConnectFourGame({ questions }: GameProps) {
  const names = useSideNames();
  const t = useBoardTurn(questions);
  const [board, setBoard] = useShared<number[]>('board', () => new Array(C4W * C4H).fill(-1));
  if (t.usable.length < 4) return <Notice>{NEEDS}</Notice>;

  const freeRow = (col: number) => range(C4H).reverse().find((y) => board[y * C4W + col] < 0);
  const apply = (col: number) => {
    const y = freeRow(col);
    if (y === undefined) return null;
    const next = board.map((v, k) => (k === y * C4W + col ? t.side : v));
    setBoard(next);
    return lineWinner(next, C4W, C4H, 4) ?? (next.every((v) => v >= 0) ? -1 : null);
  };
  const locked = !!t.ch || t.winner !== null;
  return (
    <div className="dg-boardgame">
      <Sides side={t.side} names={names} winner={t.winner} disc />
      <div className="dg-c4">
        {range(C4W).map((col) => (
          <button key={`d${col}`} type="button" className="dg-c4-drop" disabled={locked || freeRow(col) === undefined}
            onClick={() => t.ask(col)} aria-label={`Columna ${col + 1}`} style={{ '--side': SIDES[t.side].color } as CSSProperties}>
            {t.ch?.at === col ? <span className="text-2xl">?</span> : <ChevronDown size={20} />}
          </button>
        ))}
        {board.map((v, k) => (
          <span key={`${k}-${v}`} className="dg-c4-cell" style={v >= 0 ? { '--piece': SIDES[v].color } as CSSProperties : undefined} data-on={v >= 0 || undefined} />
        ))}
      </div>
      {t.ch && <ChallengeCard questions={questions} ch={t.ch} onChoose={t.choose} onDone={() => t.finish(apply)} />}
      {!t.ch && t.winner === null && <p className="dg-muted center">Elige una columna y acierta la pregunta para soltar tu ficha. Cuatro en línea ganan.</p>}
      {t.winner !== null && <Result winner={t.winner} names={names} onAgain={() => { setBoard(new Array(C4W * C4H).fill(-1)); t.reset(); }} />}
    </div>
  );
}

// ── Serpientes y escaleras ────────────────────────────────────────────────────

const END = 30;
// Inicio → fin. Escaleras suben, serpientes bajan.
const JUMPS: Record<number, number> = { 3: 11, 8: 16, 13: 22, 19: 27, 14: 5, 21: 10, 25: 17, 29: 20 };

export function LaddersGame({ questions }: GameProps) {
  const names = useSideNames();
  const t = useBoardTurn(questions);
  const [pos, setPos] = useShared<number[]>('pos', [0, 0]);
  if (t.usable.length < 4) return <Notice>{NEEDS}</Notice>;

  const roll = () => t.ask(1 + Math.floor(Math.random() * 6));
  const apply = (steps: number) => {
    const raw = Math.min(END, pos[t.side] + steps);
    const to = JUMPS[raw] ?? raw;
    setPos(pos.map((p, k) => (k === t.side ? to : p)));
    return to >= END ? t.side : null;
  };
  // Tablero en zigzag: la fila de abajo va de izquierda a derecha, la siguiente al revés.
  const rows = range(END / 5).reverse().map((r) => {
    const cells = range(5).map((c) => r * 5 + c + 1);
    return r % 2 ? cells.reverse() : cells;
  });
  return (
    <div className="dg-boardgame">
      <Sides side={t.side} names={names} winner={t.winner} extra={(k) => `casilla ${pos[k]}`} />
      <div className="dg-snakes">
        {rows.flat().map((n) => {
          const jump = JUMPS[n];
          return (
            <div key={n} className={`dg-sq ${jump ? (jump > n ? 'up' : 'down') : ''} ${n === END ? 'goal' : ''} ${(Math.ceil(n / 5) + n) % 2 ? 'odd' : ''}`}>
              <small className="inline-flex items-center gap-1">{n === END ? <><Flag size={11} /> 30</> : n}</small>
              {jump && <span className="dg-sq-jump">{jump > n ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{jump}</span>}
              <span className="dg-sq-tokens">
                {pos.map((p, k) => (p === n ? <i key={k} style={{ background: SIDES[k].color }}><SideMark side={k} size={11} /></i> : null))}
              </span>
            </div>
          );
        })}
      </div>
      {pos.some((p) => p === 0) && <p className="dg-muted center">En la salida: {pos.map((p, k) => (p === 0 ? names[k] : null)).filter(Boolean).join(' y ')}</p>}
      {t.ch && <p className="dg-challenge center inline-flex items-center gap-1.5">Sacaste <Dices size={18} /><b className="dg-die-face">{t.ch.at}</b>: acierta para avanzar.</p>}
      {t.ch && <ChallengeCard questions={questions} ch={t.ch} onChoose={t.choose} onDone={() => t.finish(apply)} />}
      {!t.ch && t.winner === null && (
        <button type="button" className="dg-btn primary big center-self" onClick={roll}><Dices size={18} /> Tirar el dado ({names[t.side]})</button>
      )}
      {t.winner !== null && <Result winner={t.winner} names={names} onAgain={() => { setPos([0, 0]); t.reset(); }} />}
    </div>
  );
}
