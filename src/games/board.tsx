import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Circle, Flag, PartyPopper, RotateCcw, Smile, Trophy, X } from 'lucide-react';
import type { GameQuestion } from '../types';
import { playSfx } from '../utils/sfx';
import { PIPS, pick, range, shuffle, speak, type GameProps } from './util';
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

/** Marcador de los dos lados. `disc`: la ficha es un círculo de color (conecta 4) en vez de ✕/◯.
 *  `middle` va entre los dos (el dado de serpientes y escaleras). */
function Sides({ side, names, winner, extra, disc = false, middle }: { side: number; names: string[]; winner: number | null; extra?: (s: number) => string; disc?: boolean; middle?: ReactNode }) {
  const [a, b] = SIDES.map((s, k) => {
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
  });
  return <div className={`dg-players ${middle ? 'mid' : ''}`}>{a}{middle}{b}</div>;
}

/** La pregunta del turno. Al responder enseña si acertó; "Continuar" aplica la jugada y pasa el turno. */
function ChallengeCard({ questions, ch, onChoose, onDone, badge }: { questions: GameQuestion[]; ch: Challenge; onChoose: (i: number) => void; onDone: () => void; badge?: ReactNode }) {
  const q = questions[ch.q];
  const ok = ch.chosen === ch.q;
  // En hoja inferior: el tablero sigue a la vista detrás. No se cierra tocando fuera (sería
  // saltarse la pregunta): solo "Continuar" la cierra.
  return (
    <Sheet onClose={() => {}} className="dg-challenge-card">
      <p className="dg-challenge">{badge}¿Qué significa?</p>
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

/* Tablero 6×5 dibujado (SVG): la ficha avanza casilla por casilla y sube o baja por la escalera o
 * la serpiente. El dado y la pregunta son de quien mueve; la animación corre en cada navegador a
 * partir de `move` (el recorrido), así una jugada es una sola escritura en la sala. */

const COLS = 6;
const ROWS = 5;
const END = COLS * ROWS;
// Inicio → fin. Escaleras suben, serpientes bajan. Ningún fin es inicio de otro salto.
type Jumps = Record<number, number>;
const SNAKE_COLORS = ['#74B816', '#E64980', '#7048E8', '#F08C00'];
// La pausa entre pasos no se acorta con "reducir movimiento": ahí la ficha salta sin deslizarse
// (games.css), pero el alumno tiene que poder contar las casillas.
const HOP_MS = 450;
const JUMP_MS = 1000;

const CLASSIC: Jumps = { 3: 16, 8: 19, 11: 23, 20: 28, 15: 6, 22: 9, 27: 13, 29: 18 };

/** ¿Se cruzan los tramos rectos de dos saltos? (para que no se enciman en el dibujo) */
function crosses([a, b]: number[], [c, d]: number[]): boolean {
  const [p, q, r, s] = [a, b, c, d].map(xy);
  const side = (u: number[], v: number[], w: number[]) => Math.sign((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]));
  return side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;
}

/** Tablero nuevo por partida: 4 escaleras y 4 serpientes que suben o bajan 1–2 filas y se corren
 *  2 columnas como mucho, sin cruzarse, sin tocar salida ni meta ni compartir casillas. Si en 50
 *  intentos no sale (no pasa en la práctica), el tablero clásico. */
function dealJumps(): Jumps {
  for (let round = 0; round < 50; round++) {
    const used = new Set([1, END]);
    const jumps: Jumps = {};
    const segs: number[][] = [];
    for (let tries = 0; segs.length < 8 && tries < 400; tries++) {
      const up = segs.length < 4;
      const a = 2 + Math.floor(Math.random() * (END - 2));
      const b = up ? a + 4 + Math.floor(Math.random() * 10) : a - 4 - Math.floor(Math.random() * 10);
      if (b < 2 || b >= END || used.has(a) || used.has(b)) continue;
      const [[xa, ya], [xb, yb]] = [xy(a), xy(b)];
      const rows = Math.abs(ya - yb) / 100;
      if (rows < 1 || rows > 2 || Math.abs(xa - xb) > 200 || segs.some((s) => crosses(s, [a, b]))) continue;
      jumps[a] = b;
      used.add(a).add(b);
      segs.push([a, b]);
    }
    if (segs.length === 8) return jumps;
  }
  return CLASSIC;
}

/** Centro de la casilla `n` en el SVG (100 por casilla). Zigzag: la fila de abajo va a la derecha. */
function xy(n: number): [number, number] {
  const i = n - 1;
  const r = Math.floor(i / COLS);
  const c = r % 2 ? COLS - 1 - (i % COLS) : i % COLS;
  return [c * 100 + 50, (ROWS - 1 - r) * 100 + 50];
}

/** Recorrido de una tirada: cada casilla que pisa y, si cae en un salto, su destino. Pura. */
function walk(from: number, steps: number, jumps: Jumps): number[] {
  const raw = Math.min(END, from + steps);
  const path = range(raw - from).map((k) => from + k + 1);
  return jumps[raw] ? [...path, jumps[raw]] : path;
}

function Ladder({ from, to }: { from: number; to: number }) {
  const [x1, y1] = xy(from);
  const [x2, y2] = xy(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [px, py] = [((y1 - y2) / len) * 14, ((x2 - x1) / len) * 14];
  const rungs = Math.max(2, Math.round(len / 30));
  return (
    <g className="dg-sl-ladder">
      {range(rungs).map((k) => {
        const f = (k + 0.5) / rungs;
        const [x, y] = [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
        return <line key={k} x1={x - px} y1={y - py} x2={x + px} y2={y + py} />;
      })}
      <line x1={x1 - px} y1={y1 - py} x2={x2 - px} y2={y2 - py} />
      <line x1={x1 + px} y1={y1 + py} x2={x2 + px} y2={y2 + py} />
    </g>
  );
}

function Snake({ from, to, color }: { from: number; to: number; color: string }) {
  const [hx, hy] = xy(from);
  const [tx, ty] = xy(to);
  const [dx, dy] = [tx - hx, ty - hy];
  const len = Math.hypot(dx, dy);
  const [ux, uy] = [dx / len, dy / len];
  const [px, py] = [-uy * 45, ux * 45];
  const d = `M${hx} ${hy} C${hx + dx * 0.33 + px} ${hy + dy * 0.33 + py} ${hx + dx * 0.66 - px} ${hy + dy * 0.66 - py} ${tx} ${ty}`;
  return (
    <g className="dg-sl-snake" style={{ '--snake': color } as CSSProperties}>
      <path d={d} />
      <path d={d} className="scales" />
      <line x1={hx} y1={hy} x2={hx - ux * 28} y2={hy - uy * 28} className="tongue" />
      <ellipse cx={hx} cy={hy} rx="18" ry="15" transform={`rotate(${(Math.atan2(uy, ux) * 180) / Math.PI} ${hx} ${hy})`} />
      {[1, -1].map((s) => {
        const [ex, ey] = [hx - ux * 5 + uy * 7 * s, hy - uy * 5 - ux * 7 * s];
        return <g key={s}><circle cx={ex} cy={ey} r="5" fill="#fff" /><circle cx={ex - ux * 1.5} cy={ey - uy * 1.5} r="2.4" fill="#111" /></g>;
      })}
    </g>
  );
}

interface Move { id: number; side: number; path: number[] }

export function LaddersGame({ questions }: GameProps) {
  const names = useSideNames();
  const { canAct } = useRoom();
  const t = useBoardTurn(questions);
  const [pos, setPos] = useShared<number[]>('pos', [1, 1]);
  const [jumps, setJumps] = useShared<Jumps>('jumps', dealJumps);
  const [move, setMove] = useShared<Move | null>('move', null);
  const [rolling, setRolling] = useShared('rolling', false);
  const [face, setFace] = useShared('face', 6);
  const [flick, setFlick] = useState(6);
  // Ficha en movimiento (local): dónde va pintada y si está saltando.
  const [anim, setAnim] = useState<{ side: number; at: number; jump: boolean } | null>(null);
  // Último recorrido ya animado (o presente al entrar a la sala: ese no se repite).
  const seen = useRef(move?.id);
  const [shownId, setShownId] = useState(move?.id);
  // Entre que llega `move` y arranca su animación hay un render: la ficha sigue en la salida.
  const pending = move && move.id !== shownId ? move : null;

  // El dado rueda en todos; la cara la decide quien tiró (los setters de los demás no escriben).
  useEffect(() => {
    if (!rolling) return;
    const id = window.setInterval(() => { setFlick(1 + Math.floor(Math.random() * 6)); playSfx('tick'); }, 90);
    const stop = window.setTimeout(() => {
      const f = 1 + Math.floor(Math.random() * 6);
      setFace(f);
      setRolling(false);
      t.ask(f);
    }, 900);
    return () => { window.clearInterval(id); window.clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` cambia en cada render; solo importa `rolling`
  }, [rolling]);

  // Al responder: sonido y, un segundo después, la jugada se aplica sola ("Continuar" la adelanta).
  const chosen = t.ch?.chosen ?? null;
  useEffect(() => {
    if (chosen === null || !t.ch) return;
    playSfx(chosen === t.ch.q ? 'ok' : 'miss');
    if (!canAct) return;
    const id = window.setTimeout(() => t.finish(apply), 1100);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez por respuesta
  }, [chosen]);

  // Recorrido nuevo: la ficha salta casilla por casilla y, al final, sube o baja.
  useEffect(() => {
    if (!move || move.id === seen.current) return;
    seen.current = move.id;
    setShownId(move.id);
    const { side, path } = move;
    // Caminando se avanza de 1 en 1; un salto (escalera o serpiente) es siempre de 5 o más.
    const jumped = path.length > 1 && Math.abs(path[path.length - 1] - path[path.length - 2]) > 1;
    setAnim({ side, at: path[0] - 1, jump: false });
    const timers = path.map((at, k) => window.setTimeout(() => {
      const jump = jumped && k === path.length - 1;
      setAnim({ side, at, jump });
      playSfx(!jump ? 'hop' : at > path[k - 1] ? 'climb' : 'slide');
    }, (k + 1) * HOP_MS));
    timers.push(window.setTimeout(() => {
      setAnim(null);
      if (path[path.length - 1] === END) playSfx('win');
    }, path.length * HOP_MS + (jumped ? JUMP_MS : HOP_MS)));
    return () => timers.forEach(window.clearTimeout);
    // La sala trae un objeto nuevo en cada sondeo: solo un `id` nuevo es otra jugada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.id]);

  if (t.usable.length < 4) return <Notice>{NEEDS}</Notice>;

  function apply(steps: number) {
    const path = walk(pos[t.side], steps, jumps);
    const to = path[path.length - 1];
    setPos(pos.map((p, k) => (k === t.side ? to : p)));
    setMove({ id: Date.now(), side: t.side, path });
    return to >= END ? t.side : null;
  }
  const moving = !!anim || !!pending;
  const busy = rolling || !!t.ch || moving || t.winner !== null;
  const roll = () => { if (!busy) setRolling(true); };
  const again = () => { setPos([1, 1]); setMove(null); setJumps(dealJumps()); t.reset(); };

  const at = (k: number) => (anim?.side === k ? anim.at : pending?.side === k ? pending.path[0] - 1 : pos[k]);
  const active = anim?.side ?? pending?.side ?? t.side;
  const winner = moving ? null : t.winner;
  // Casillas en orden de lectura (de arriba abajo) para la rejilla CSS.
  const cells = range(ROWS).flatMap((vr) => range(COLS).map((c) => {
    const r = ROWS - 1 - vr;
    return r * COLS + (r % 2 ? COLS - c : c + 1);
  }));

  return (
    <div className="dg-boardgame">
      <Sides side={active} names={names} winner={winner} middle={winner === null && (
        <button type="button" className={`dg-die dg-sl-die ${rolling ? 'rolling' : ''} ${!busy && canAct ? 'ready' : ''}`} onClick={roll}
          disabled={busy || !canAct} style={{ '--side': SIDES[active].color } as CSSProperties} aria-label={`Tirar el dado (${names[active]})`}>
          {range(9).map((p) => <span key={p} className={PIPS[(rolling ? flick : face) - 1].includes(p) ? 'on' : ''} />)}
        </button>
      )} />
      <div className="dg-sl">
        {cells.map((n, i) => (
          <div key={n} className={`dg-sl-cell ${n === END ? 'goal' : n === 1 ? 'start' : ''} ${(i + Math.floor(i / COLS)) % 2 ? 'alt' : ''}`}>
            {n === END ? <Trophy size={22} /> : n === 1 ? <Flag size={16} /> : n}
          </div>
        ))}
        <svg viewBox={`0 0 ${COLS * 100} ${ROWS * 100}`} aria-hidden="true">
          {Object.entries(jumps).filter(([a, b]) => b > +a).map(([a, b]) => <Ladder key={a} from={+a} to={b} />)}
          {Object.entries(jumps).filter(([a, b]) => b < +a).map(([a, b], k) => <Snake key={a} from={+a} to={b} color={SNAKE_COLORS[k % SNAKE_COLORS.length]} />)}
        </svg>
        {SIDES.map((s, k) => {
          const [x, y] = xy(at(k));
          const nudge = at(0) === at(1) ? (k ? 2.5 : -2.5) : 0;
          return (
            <div key={k} className={`dg-sl-token ${anim?.side === k && anim.jump ? 'jump' : ''} ${active === k && winner === null ? 'turn' : ''}`}
              style={{ left: `${x / COLS + nudge}%`, top: `${y / ROWS}%`, '--side': s.color, zIndex: active === k ? 4 : 3 } as CSSProperties}
              role="img" aria-label={`${names[k]}: casilla ${at(k)}`}>
              <span key={at(k)}><SideMark side={k} size={14} /></span>
            </div>
          );
        })}
      </div>
      {winner !== null && <Result winner={winner} names={names} onAgain={again} />}
      {t.ch && (
        <ChallengeCard questions={questions} ch={t.ch} onChoose={t.choose} onDone={() => t.finish(apply)}
          badge={<span className="dg-sl-badge" style={{ '--side': SIDES[t.side].color } as CSSProperties}><SideMark side={t.side} size={13} /> +{t.ch.at}</span>} />
      )}
    </div>
  );
}
