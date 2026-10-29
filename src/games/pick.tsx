import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ArrowLeftRight, Bomb, Check, ChevronsLeft, ChevronsRight, Coins, Crown, Flag, Gift, Lightbulb, Mail, RotateCcw, Shuffle, Sparkles, Trophy, X } from 'lucide-react';
import { AppIcon, EmojiIcon } from '../components/AppIcon';
import type { GameQuestion } from '../types';
import { playSfx } from '../utils/sfx';
import { CHALLENGES, PIPS, TEAM_COLORS, range, sample, shuffle, toggledList, type GameProps } from './util';
import { Countdown, Es, Finish, Say, Sheet, Speak } from './ui';
import { useRoom, useShared } from './roomState';

/* Tableros numerados, primos del corcho: casillas del 1 al N a la vista, eliges una y su pregunta
 * sale en una ventana. En sala, cada quien abre una en su turno (`endTurn` al cerrar). */

/** Una ronda de hasta `size` preguntas al azar, numeradas en orden. `open` es la casilla abierta. */
function useRound(total: number, size: number) {
  const { endTurn } = useRoom();
  const n = Math.min(size, total);
  const [order, setOrder] = useShared('order', () => sample(range(total), n));
  const [done, setDone] = useShared<number[]>('done', []);
  const [open, setOpen] = useShared<number | null>('open', null);
  const close = () => { setOpen(null); endTurn(); };
  const answer = (k: number) => { setDone((d) => toggledList(d, k)); close(); };
  const reset = () => { setOrder(sample(range(total), n)); setDone([]); setOpen(null); };
  return { order, done, open, setOpen, close, answer, reset };
}

/** La pregunta abierta, como la nota del corcho: número, audio, traducción y pista. */
function Question({ q, n }: { q: GameQuestion; n?: number }) {
  return (
    <>
      {n !== undefined && <div className="dg-sheet-num">{n}</div>}
      <p className="dg-sheet-q"><Say text={q.text} /></p>
      <Speak text={q.text} />
      <Es className="center">{q.translation}</Es>
      {q.hint && <p className="dg-hint inline-flex items-center gap-1.5"><Lightbulb size={15} className="shrink-0" /> <Say text={q.hint} /></p>}
    </>
  );
}

function Answered({ done, onDone, onClose }: { done: boolean; onDone: () => void; onClose: () => void }) {
  return (
    <div className="dg-row">
      <button type="button" className="dg-btn primary grow" onClick={onDone}>{done ? 'Quitar marca' : <span className="inline-flex items-center gap-1"><Check size={16} /> La respondí</span>}</button>
      <button type="button" className="dg-btn grow" onClick={onClose}>Cerrar</button>
    </div>
  );
}

function Tally({ done, total, again, onReset }: { done: number; total: number; again: string; onReset: () => void }) {
  return (
    <div>
      <p className="dg-muted center">{done} de {total} respondidas</p>
      <button type="button" className="dg-link center" onClick={onReset}><Shuffle size={14} /> {again}</button>
    </div>
  );
}

// ── Puertas sorpresa ──────────────────────────────────────────────────────────

const DOORS = ['#E8590C', '#1971C2', '#2B8A3E', '#C2255C', '#7048E8', '#E67700', '#0B7285', '#C92A2A'];

export function DoorsGame({ questions }: GameProps) {
  const { order, done, open, setOpen, close, answer, reset } = useRound(questions.length, 24);
  const q = open === null ? null : questions[order[open]];
  return (
    <div className="dg-pick">
      <div className="dg-doors">
        {order.map((qi, k) => (
          <button key={k} type="button" className={`dg-door ${done.includes(k) || open === k ? 'open' : ''}`} onClick={() => setOpen(k)}
            style={{ '--c': DOORS[k % DOORS.length] } as CSSProperties} aria-label={`Puerta ${k + 1}${done.includes(k) ? ' (respondida)' : ''}`}>
            <span className="dg-door-in"><EmojiIcon emoji={questions[qi].emoji} size={26} />{done.includes(k) && <b><Check size={14} /></b>}</span>
            <span className="dg-door-leaf">{k + 1}<i /></span>
          </button>
        ))}
      </div>
      <Tally done={done.length} total={order.length} again="Otras puertas" onReset={reset} />
      {q && open !== null && (
        <Sheet onClose={close} className="dg-sheet-pick">
          <Question q={q} n={open + 1} />
          <Answered done={done.includes(open)} onDone={() => answer(open)} onClose={close} />
        </Sheet>
      )}
    </div>
  );
}

// ── Mapa del tesoro ───────────────────────────────────────────────────────────

const COLS = 4;

export function MapGame({ questions }: GameProps) {
  const { endTurn } = useRoom();
  const n = Math.min(12, questions.length);
  const [route, setRoute] = useShared('route', () => sample(range(questions.length), n));
  const [at, setAt] = useShared('at', 0);
  const [open, setOpen] = useShared('open', false);
  const close = () => { setOpen(false); endTurn(); };
  const again = () => { setRoute(sample(range(questions.length), n)); setAt(0); setOpen(false); };
  const q = at < route.length ? questions[route[at]] : null;
  return (
    <div className="dg-pick">
      <div className="dg-map">
        {/* Camino en zigzag: la fila par va a la derecha, la impar vuelve. La última casilla es el tesoro. */}
        {range(route.length + 1).map((k) => {
          const row = Math.floor(k / COLS);
          const col = row % 2 ? COLS - 1 - (k % COLS) : k % COLS;
          const gold = k === route.length;
          const link = gold ? '' : k % COLS === COLS - 1 ? 'down' : row % 2 ? 'left' : 'right';
          return (
            <div key={k} className={`dg-stop-cell ${link} ${k < at ? 'walked' : ''}`} style={{ gridRow: row + 1, gridColumn: col + 1 }}>
              <button type="button" className={`dg-stop ${k < at ? 'past' : k === at ? 'here' : ''} ${gold ? 'gold' : ''}`}
                disabled={k !== at || gold} onClick={() => setOpen(true)} aria-label={gold ? 'Tesoro' : `Parada ${k + 1}`}>
                {gold ? <Coins size={20} /> : k < at ? <Check size={18} /> : k + 1}
              </button>
              {k === at && <span className="dg-rex" aria-hidden="true"><AppIcon name="footprints" size={22} /></span>}
            </div>
          );
        })}
      </div>
      {q ? (
        <>
          <p className="dg-muted center">Parada {at + 1} de {route.length}: toca la casilla del dino y responde para avanzar.</p>
          <button type="button" className="dg-link center" onClick={again}><Shuffle size={14} /> Nuevo mapa</button>
        </>
      ) : (
        <Finish score={route.length} total={route.length} onAgain={again}><p className="inline-flex items-center gap-1.5">¡Encontraste el tesoro! <Coins size={18} /></p></Finish>
      )}
      {q && open && (
        <Sheet onClose={close} className="dg-sheet-pick">
          <Question q={q} n={at + 1} />
          <div className="dg-row">
            <button type="button" className="dg-btn primary grow" onClick={() => { setAt((a) => a + 1); close(); }}><Check size={16} /> La respondí: ¡avanza!</button>
            <button type="button" className="dg-btn grow" onClick={close}>Cerrar</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Sobres ────────────────────────────────────────────────────────────────────

const ENVELOPES = ['#FFE3E3', '#D0EBFF', '#FFF3BF', '#D3F9D8', '#E5DBFF', '#FFDEEB'];

export function LettersGame({ questions }: GameProps) {
  const { order, done, open, setOpen, close, answer, reset } = useRound(questions.length, 12);
  const qi = open === null ? null : order[open];
  // El reto sale de la pregunta: así todos en la sala ven el mismo sin guardar nada más.
  const task = qi === null ? 0 : qi % CHALLENGES.length;
  return (
    <div className="dg-pick">
      <div className="dg-mail">
        {order.map((_, k) => (
          <button key={k} type="button" className={`dg-env ${done.includes(k) ? 'done' : ''}`} onClick={() => setOpen(k)}
            style={{ '--c': ENVELOPES[k % ENVELOPES.length] } as CSSProperties} aria-label={`Sobre ${k + 1}${done.includes(k) ? ' (respondido)' : ''}`}>
            {done.includes(k) && <span className="dg-env-letter"><Check size={16} /></span>}
            <span className="dg-env-flap" />
            {!done.includes(k) && <span className="dg-seal">{k + 1}</span>}
          </button>
        ))}
      </div>
      <Tally done={done.length} total={order.length} again="Otros sobres" onReset={reset} />
      {qi !== null && open !== null && (
        <Sheet onClose={close} className="dg-sheet-letter">
          <span className="dg-seal big">{open + 1}</span>
          <Question q={questions[qi]} />
          <p className="dg-task inline-flex items-center gap-1.5"><b className="inline-flex items-center gap-1"><Mail size={15} /> Reto</b>{CHALLENGES[task]}</p>
          {task === 4 && <Countdown />}
          <Answered done={done.includes(open)} onDone={() => answer(open)} onClose={close} />
        </Sheet>
      )}
    </div>
  );
}

// ── Rasca y gana ──────────────────────────────────────────────────────────────

/** Fracción ya rascada del lienzo: mira 1 de cada 50 píxeles, de sobra para decidir. */
function cleared(c: HTMLCanvasElement): number {
  const data = c.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, c.width, c.height).data;
  if (!data) return 1;
  let clear = 0;
  let seen = 0;
  for (let i = 3; i < data.length; i += 200) { seen++; if (data[i] === 0) clear++; }
  return clear / seen;
}

/** Capa plateada que se rasca con el dedo o el ratón. Al quitar más de la mitad, `onReveal`. */
function ScratchPad({ onReveal, children }: { onReveal: () => void; children: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d', { willReadFrequently: true });
    if (!c || !ctx) return;
    // offsetWidth y no getBoundingClientRect: la ventana entra con una animación de escala.
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.scale(dpr, dpr);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#AEB5C0');
    g.addColorStop(0.5, '#EDF0F4');
    g.addColorStop(1, '#949BA8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(60, 66, 78, .6)';
    ctx.font = '800 18px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RASCA AQUÍ', w / 2, h / 2 + 6);
    // De aquí en adelante, pintar = borrar la capa.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.lineWidth = 36;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.offsetWidth, y: ((e.clientY - r.top) / r.height) * c.offsetHeight };
  };
  const scratch = (e: PointerEvent<HTMLCanvasElement>, from: { x: number; y: number } | null) => {
    const c = e.currentTarget;
    const ctx = c.getContext('2d');
    if (!ctx || !from) return;
    const to = point(e);
    ctx.beginPath();
    if (to.x === from.x && to.y === from.y) { ctx.arc(to.x, to.y, 18, 0, 2 * Math.PI); ctx.fill(); }
    else { ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); }
    last.current = to;
    if (++strokes.current % 8 === 0 && cleared(c) > 0.55) onReveal();
  };

  return (
    <div className="dg-scratch">
      {children}
      <canvas
        ref={ref}
        aria-hidden="true"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scratch(e, point(e)); }}
        onPointerMove={(e) => scratch(e, last.current)}
        onPointerUp={(e) => { last.current = null; if (cleared(e.currentTarget) > 0.55) onReveal(); }}
        onPointerCancel={() => { last.current = null; }}
      />
    </div>
  );
}

export function ScratchGame({ questions }: GameProps) {
  const { order, done, open, setOpen, close, answer, reset } = useRound(questions.length, 12);
  const [shown, setShown] = useShared<number[]>('shown', []);
  const q = open === null ? null : questions[order[open]];
  const reveal = (k: number) => setShown((s) => (s.includes(k) ? s : [...s, k]));
  return (
    <div className="dg-pick">
      <div className="dg-tickets">
        {order.map((qi, k) => (
          <button key={k} type="button" className={`dg-ticket ${done.includes(k) ? 'done' : ''}`} onClick={() => setOpen(k)}
            aria-label={`Boleto ${k + 1}${shown.includes(k) ? `: ${questions[qi].text}` : ''}`}>
            <span className="dg-ticket-n">#{k + 1}</span>
            {shown.includes(k) ? <span className="dg-ticket-q">{questions[qi].text}</span> : <span className="dg-ticket-foil">RASCA</span>}
            {done.includes(k) && <span className="dg-note-stamp inline-flex items-center gap-1">done <Check size={12} /></span>}
          </button>
        ))}
      </div>
      <Tally done={done.length} total={order.length} again="Otros boletos" onReset={() => { reset(); setShown([]); }} />
      {q && open !== null && (
        <Sheet onClose={close} className="dg-sheet-pick">
          {shown.includes(open) ? (
            <>
              <Question q={q} n={open + 1} />
              <Answered done={done.includes(open)} onDone={() => answer(open)} onClose={close} />
            </>
          ) : (
            <>
              <div className="dg-sheet-num">{open + 1}</div>
              <ScratchPad key={open} onReveal={() => reveal(open)}><p className="dg-sheet-q">{q.text}</p></ScratchPad>
              <p className="dg-muted center">Rasca con el dedo o con el ratón.</p>
              <button type="button" className="dg-link" onClick={() => reveal(open)}>Destapar sin rascar</button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

/** Primera pantalla de los juegos por equipos: 2, 3 o 4. */
function TeamCount({ onPick, children }: { onPick: (teams: number) => void; children: ReactNode }) {
  return (
    <div className="dg-teams-setup">
      <p className="dg-big-q">¿Cuántos equipos juegan?</p>
      <div className="dg-row center">
        {[2, 3, 4].map((t) => <button key={t} type="button" className="dg-btn primary big" onClick={() => onPick(t)}>{t} equipos</button>)}
      </div>
      <p className="dg-muted center">{children}</p>
    </div>
  );
}

// ── Cajas bomba ───────────────────────────────────────────────────────────────

/** Lo que hay en cada caja: puntos (1–3), una estrella que duplica o una bomba que deja al equipo en 0. */
type Prize = number | 'star' | 'boom';
const BOXES = ['#FF6B6B', '#4DABF7', '#51CF66', '#FF922B', '#9775FA', '#F06595'];
const prizeLabel = (p: Prize) => (p === 'boom' ? <Bomb size={20} /> : p === 'star' ? <Sparkles size={20} /> : `+${p}`);

function deal(n: number): Prize[] {
  const booms = Math.max(1, Math.round(n / 7));
  const stars = Math.max(1, Math.round(n / 10));
  const points = range(Math.max(0, n - booms - stars)).map(() => 1 + Math.floor(Math.random() * 3));
  return shuffle<Prize>([...Array<Prize>(booms).fill('boom'), ...Array<Prize>(stars).fill('star'), ...points]);
}

export function BombGame({ questions }: GameProps) {
  const { endTurn } = useRoom();
  const n = Math.min(20, questions.length);
  const [scores, setScores] = useShared<number[]>('scores', []);
  const [turn, setTurn] = useShared('turn', 0);
  const [order, setOrder] = useShared<number[]>('order', []);
  const [prizes, setPrizes] = useShared<Prize[]>('prizes', []);
  const [opened, setOpened] = useShared<number[]>('opened', []);
  const [open, setOpen] = useShared<number | null>('open', null);
  const [result, setResult] = useShared<'ok' | 'no' | null>('result', null);

  const start = (teams: number) => {
    setScores(new Array(teams).fill(0));
    setTurn(0);
    setOrder(sample(range(questions.length), n));
    setPrizes(deal(n));
    setOpened([]);
    setOpen(null);
    setResult(null);
  };

  if (!scores.length) {
    return (
      <TeamCount onPick={start}>
        Cada equipo elige una caja y responde su pregunta. Si responde bien, se lleva lo que hay dentro: puntos, <Sparkles size={14} className="inline align-[-2px]" /> (duplica) o <Bomb size={14} className="inline align-[-2px]" /> (se queda en 0).
      </TeamCount>
    );
  }

  // Bien: se abre la caja y cuenta lo que trae. Mal: sigue cerrada para otro equipo.
  const grade = (ok: boolean) => {
    if (open === null) return;
    if (ok) {
      const p = prizes[open];
      setScores((s) => s.map((v, k) => (k !== turn ? v : p === 'boom' ? 0 : p === 'star' ? Math.max(2, v * 2) : v + p)));
      setOpened((o) => [...o, open]);
    }
    setResult(ok ? 'ok' : 'no');
  };
  const next = () => { setOpen(null); setResult(null); setTurn((t) => (t + 1) % scores.length); endTurn(); };

  const best = Math.max(...scores);
  const winners = scores.flatMap((s, k) => (s === best ? [k + 1] : []));
  const over = opened.length === order.length;
  const q = open === null ? null : questions[order[open]];
  const prize = open === null ? null : prizes[open];
  const team = `Equipo ${turn + 1}`;

  return (
    <div className="dg-pick">
      <div className="dg-scoreboard">
        {scores.map((s, k) => (
          <div key={k} className={`dg-team ${k === turn && !over ? 'turn' : ''}`} style={{ '--team': TEAM_COLORS[k] } as CSSProperties}>
            <span className="inline-flex items-center gap-1">Equipo {k + 1}{s === best && s > 0 && <Crown size={14} className="text-amber-500" />}</span>
            <b>{s}</b>
          </div>
        ))}
      </div>
      {over
        ? <p className="dg-big-q inline-flex items-center gap-2"><Trophy size={22} /> {winners.length > 1 ? `Empate: equipos ${winners.join(' y ')}` : `¡Gana el Equipo ${winners[0]}!`}</p>
        : <p className="dg-challenge center">Turno del <span style={{ color: TEAM_COLORS[turn] }}>{team}</span>: elige una caja</p>}
      <div className="dg-boxes">
        {order.map((_, k) => (opened.includes(k) ? (
          <div key={k} className={`dg-box open ${prizes[k] === 'boom' ? 'boom' : ''}`}>{prizeLabel(prizes[k])}</div>
        ) : (
          <button key={k} type="button" className="dg-box" onClick={() => { setOpen(k); setResult(null); }}
            style={{ '--c': BOXES[k % BOXES.length] } as CSSProperties} aria-label={`Caja ${k + 1}`}>
            <span>{k + 1}</span>
          </button>
        )))}
      </div>
      <button type="button" className="dg-link center" onClick={() => setScores([])}><RotateCcw size={14} /> Nueva partida</button>
      {q && open !== null && (
        <Sheet onClose={result ? next : () => setOpen(null)} className="dg-sheet-pick" style={{ '--accent': TEAM_COLORS[turn] } as CSSProperties}>
          <Question q={q} n={open + 1} />
          {result === null ? (
            <>
              <p className="dg-muted center">¿Respondió bien el {team}?</p>
              <div className="dg-row">
                <button type="button" className="dg-btn ok grow" onClick={() => grade(true)}><Check size={16} /> Bien: abrir la caja</button>
                <button type="button" className="dg-btn grow" onClick={() => grade(false)}><X size={16} /> No</button>
              </div>
            </>
          ) : (
            <>
              <p className={`dg-prize ${result === 'no' ? 'miss' : prize === 'boom' ? 'boom' : ''}`}>
                {result === 'no' ? 'Sin puntos: la caja sigue cerrada para otro equipo.'
                  : prize === 'boom' ? <span className="inline-flex items-center gap-1.5"><Bomb size={18} /> ¡BOOM! El {team} se queda en 0.</span>
                    : prize === 'star' ? <span className="inline-flex items-center gap-1.5"><Sparkles size={18} /> ¡Estrella! Los puntos del {team} se duplican.</span>
                      : <span className="inline-flex items-center gap-1.5"><Gift size={18} /> +{prize} para el {team}</span>}
              </p>
              <button type="button" className="dg-btn primary" onClick={next}>Siguiente: Equipo {((turn + 1) % scores.length) + 1}</button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

// ── Carrera de dinos ──────────────────────────────────────────────────────────

/* Primo de Cajas bomba: responder bien solo da derecho a tirar el dado; la suerte decide cuánto
 * avanza el dino y qué casilla sorpresa pisa. Un carril por equipo. Como en serpientes y escaleras,
 * quien mueve guarda `pos` (final) y `move` (recorrido) y cada navegador anima a partir de `move.id`. */

type Surprise = 'turbo' | 'trap' | 'swap';
const GOAL = 15;
const SHIFT = { turbo: 2, trap: -3 };
const SURPRISE_ICON = { turbo: ChevronsRight, trap: ChevronsLeft, swap: ArrowLeftRight };
// Igual que en serpientes y escaleras: la pausa entre pasos no se acorta con "reducir movimiento".
const RACE_HOP = 450;
const RACE_JUMP = 1000;

interface RaceMove { id: number; team: number; before: number[]; path: number[]; after: number[]; kind: Surprise | null }

/** 2 turbos, 2 trampas y 1 cambio en casillas al azar entre la 2 y la 13. */
const dealSquares = (): Record<number, Surprise> => {
  const [a, b, c, d, e] = sample(range(12).map((k) => k + 2), 5);
  return { [a]: 'turbo', [b]: 'turbo', [c]: 'trap', [d]: 'trap', [e]: 'swap' };
};

/** Tirada de `team`: casillas que pisa y posiciones finales. La sorpresa no encadena otra; el
 *  cambio solo cuenta si hay alguien por delante (cambia de lugar con el que va primero). Pura. */
function race(pos: number[], team: number, face: number, squares: Record<number, Surprise>): Omit<RaceMove, 'id' | 'team'> {
  const land = Math.min(GOAL, pos[team] + face);
  const path = range(land - pos[team]).map((k) => pos[team] + k + 1);
  const after = pos.map((p, k) => (k === team ? land : p));
  let kind: Surprise | null = land < GOAL ? squares[land] ?? null : null;
  if (kind === 'turbo' || kind === 'trap') after[team] = Math.max(0, Math.min(GOAL, land + SHIFT[kind]));
  if (kind === 'swap') {
    const lead = after.reduce((best, p, k) => (k !== team && p > after[best] ? k : best), team);
    if (lead === team) kind = null;
    else [after[team], after[lead]] = [after[lead], land];
  }
  return { before: pos, path, after, kind };
}

/** Dino de perfil mirando a la derecha; toma el color de `currentColor`. */
function Dino() {
  return (
    <svg viewBox="0 0 64 48" className="dg-dino" aria-hidden="true">
      <path d="M2 27 Q12 25 18 22 L21 33 Q9 33 2 27Z" fill="currentColor" />
      <path d="M17 20 l3-7 3 6 3-7 3 6 3-7 3 6 3-6 2 6" fill="currentColor" />
      <ellipse cx="29" cy="27" rx="15" ry="11" fill="currentColor" />
      <path d="M36 22 Q39 13 44 11 L51 19 Q44 23 42 30Z" fill="currentColor" />
      <ellipse cx="50" cy="13" rx="11" ry="8.5" fill="currentColor" />
      <ellipse cx="29" cy="31" rx="9" ry="5" fill="#fff" opacity=".3" />
      <rect className="leg a" x="20" y="34" width="6" height="11" rx="3" fill="currentColor" />
      <rect className="leg b" x="32" y="34" width="6" height="11" rx="3" fill="currentColor" />
      <circle cx="53" cy="10.5" r="3.4" fill="#fff" /><circle cx="54.2" cy="10.5" r="1.7" fill="#111" />
      <path d="M53 17 q3.5 1.5 6-1" stroke="#111" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function DinoRaceGame({ questions }: GameProps) {
  const { endTurn, canAct } = useRoom();
  const [teams, setTeams] = useShared('teams', 0);
  const [turn, setTurn] = useShared('turn', 0);
  const [pos, setPos] = useShared<number[]>('pos', []);
  const [squares, setSquares] = useShared<Record<number, Surprise>>('squares', {});
  const [deck, setDeck] = useShared<number[]>('deck', []);
  const [qn, setQn] = useShared('qn', 0);
  const [phase, setPhase] = useShared<'ask' | 'roll'>('phase', 'ask');
  const [rolling, setRolling] = useShared('rolling', false);
  const [face, setFace] = useShared('face', 6);
  const [move, setMove] = useShared<RaceMove | null>('move', null);
  const [verdict, setVerdict] = useShared<{ id: number; team: number; ok: boolean } | null>('verdict', null);
  const [flick, setFlick] = useState(6);
  const [anim, setAnim] = useState<{ at: number[]; jump: boolean } | null>(null);
  const [flash, setFlash] = useState<{ team: number; ok: boolean } | null>(null);
  const seen = useRef(move?.id);
  const [shownId, setShownId] = useState(move?.id);
  const heard = useRef(verdict?.id);
  const pending = move && move.id !== shownId ? move : null;

  const start = (n: number) => {
    setTeams(n);
    setTurn(0);
    setPos(new Array(n).fill(0));
    setSquares(dealSquares());
    setDeck(shuffle(range(questions.length)));
    setQn(0);
    setPhase('ask');
    setMove(null);
    setVerdict(null);
  };

  // Veredicto (en todos los navegadores): sonido y el carril brilla en verde o tiembla en rojo.
  useEffect(() => {
    if (!verdict || verdict.id === heard.current) return;
    heard.current = verdict.id;
    playSfx(verdict.ok ? 'ok' : 'miss');
    setFlash(verdict);
    const id = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(id);
  }, [verdict]);

  // El dado rueda en todos; la cara y el recorrido los decide quien tiró.
  useEffect(() => {
    if (!rolling) return;
    const id = window.setInterval(() => { setFlick(1 + Math.floor(Math.random() * 6)); playSfx('tick'); }, 90);
    const stop = window.setTimeout(() => {
      const f = 1 + Math.floor(Math.random() * 6);
      const m = race(pos, turn, f, squares);
      setFace(f);
      setRolling(false);
      setPos(m.after);
      setMove({ id: Date.now(), team: turn, ...m });
      setPhase('ask');
      setTurn((turn + 1) % teams);
      endTurn();
    }, 900);
    return () => { window.clearInterval(id); window.clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo importa `rolling`
  }, [rolling]);

  // Recorrido nuevo: el dino salta casilla por casilla y luego la sorpresa (turbo, trampa o cambio).
  useEffect(() => {
    if (!move || move.id === seen.current) return;
    seen.current = move.id;
    setShownId(move.id);
    const { team, before, path, after, kind } = move;
    let at = before;
    setAnim({ at, jump: false });
    const timers = path.map((p, k) => window.setTimeout(() => {
      at = at.map((v, i) => (i === team ? p : v));
      setAnim({ at, jump: false });
      playSfx('hop');
    }, (k + 1) * RACE_HOP));
    let end = (path.length + 1) * RACE_HOP;
    if (kind) {
      timers.push(window.setTimeout(() => { setAnim({ at: after, jump: true }); playSfx(kind === 'turbo' ? 'climb' : kind === 'trap' ? 'slide' : 'swap'); }, end));
      end += RACE_JUMP;
    }
    timers.push(window.setTimeout(() => { setAnim(null); if (after[team] >= GOAL) playSfx('win'); }, end));
    return () => timers.forEach(window.clearTimeout);
    // La sala trae un objeto nuevo en cada sondeo: solo un `id` nuevo es otra jugada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.id]);

  if (!teams) {
    return (
      <TeamCount onPick={start}>
        Si el equipo responde bien, tira el dado y su dino avanza. Las casillas sorpresa dan turbo <ChevronsRight size={14} className="inline align-[-2px]" />,
        trampa <ChevronsLeft size={14} className="inline align-[-2px]" /> o cambio con el que va primero <ArrowLeftRight size={14} className="inline align-[-2px]" />.
      </TeamCount>
    );
  }

  const moving = !!anim || !!pending;
  const shown = anim?.at ?? pending?.before ?? pos;
  const active = moving && move ? move.team : turn;
  const winner = moving ? -1 : pos.findIndex((p) => p >= GOAL);
  const q = questions[deck[qn % deck.length] ?? 0];
  const grade = (ok: boolean) => {
    setVerdict({ id: Date.now(), team: turn, ok });
    setQn(qn + 1);
    if (ok) { setPhase('roll'); return; }
    setTurn((turn + 1) % teams);
    endTurn();
  };
  const roll = () => { if (phase === 'roll' && !rolling && !moving) setRolling(true); };

  return (
    <div className="dg-pick">
      <div className="dg-dr">
        {range(teams).map((k) => {
          const p = shown[k] ?? 0;
          return (
            <div key={k} className={`dg-dr-lane ${k === active && winner < 0 ? 'now' : ''} ${flash?.team === k ? (flash.ok ? 'ok' : 'miss') : ''}`}
              style={{ '--team': TEAM_COLORS[k] } as CSSProperties}>
              <b className="dg-dr-n">{k + 1}</b>
              <div className="dg-dr-track">
                {range(GOAL + 1).map((c) => {
                  const kind = squares[c];
                  const Icon = kind && SURPRISE_ICON[kind];
                  return <span key={c} className={`dg-dr-cell ${kind ?? ''} ${c === GOAL ? 'goal' : ''}`}>{Icon && <Icon size={16} />}{c === GOAL && <Flag size={16} />}</span>;
                })}
                <span className={`dg-dr-dino ${anim?.jump && anim.at[k] !== move?.before[k] ? 'jump' : ''} ${winner === k ? 'won' : ''}`}
                  style={{ left: `${((p + 0.5) / (GOAL + 1)) * 100}%`, zIndex: k === active ? 3 : 2 }} role="img" aria-label={`Equipo ${k + 1}: casilla ${p}`}>
                  <span key={p}><Dino /></span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {winner >= 0 ? (
        <div className="dg-feedback" style={{ '--team': TEAM_COLORS[winner] } as CSSProperties}>
          <span className="dg-dr-me"><Dino /></span>
          <p className="dg-ok inline-flex items-center gap-1.5"><Trophy size={18} /> ¡Gana el Equipo {winner + 1}!</p>
          <button type="button" className="dg-btn primary" onClick={() => setTeams(0)}><RotateCcw size={16} /> Otra carrera</button>
        </div>
      ) : (
        <div className="dg-dr-turn" style={{ '--team': TEAM_COLORS[active] } as CSSProperties}>
          <span className="dg-dr-me" aria-label={`Turno del Equipo ${active + 1}`}><Dino /><b>{active + 1}</b></span>
          {phase === 'ask' && !moving ? (
            <div className="dg-dr-q">
              <p className="dg-big-q"><Say text={q.text} /></p>
              <div className="dg-row center"><Speak text={q.text} /></div>
              <Es className="center">{q.translation}</Es>
              {q.hint && <p className="dg-hint inline-flex items-center gap-1.5"><Lightbulb size={15} className="shrink-0" /> <Say text={q.hint} /></p>}
              <div className="dg-row">
                <button type="button" className="dg-btn ok grow" onClick={() => grade(true)} aria-label="Respondió bien"><Check size={20} /></button>
                <button type="button" className="dg-btn grow" onClick={() => grade(false)} aria-label="Respondió mal"><X size={20} /></button>
              </div>
            </div>
          ) : (
            <button type="button" className={`dg-die dg-dr-die ${rolling ? 'rolling' : ''} ${phase === 'roll' && !rolling && !moving && canAct ? 'ready' : ''}`}
              onClick={roll} disabled={phase !== 'roll' || rolling || moving || !canAct} aria-label="Tirar el dado">
              {range(9).map((d) => <span key={d} className={PIPS[(rolling ? flick : face) - 1].includes(d) ? 'on' : ''} />)}
            </button>
          )}
        </div>
      )}
      {winner < 0 && <button type="button" className="dg-link center" onClick={() => setTeams(0)}><RotateCcw size={14} /> Nueva carrera</button>}
    </div>
  );
}
