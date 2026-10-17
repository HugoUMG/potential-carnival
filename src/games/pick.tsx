import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { RotateCcw, Shuffle } from 'lucide-react';
import type { GameQuestion } from '../types';
import { CHALLENGES, TEAM_COLORS, range, sample, shuffle, toggledList, type GameProps } from './util';
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
      {q.hint && <p className="dg-hint">💡 <Say text={q.hint} /></p>}
    </>
  );
}

function Answered({ done, onDone, onClose }: { done: boolean; onDone: () => void; onClose: () => void }) {
  return (
    <div className="dg-row">
      <button type="button" className="dg-btn primary grow" onClick={onDone}>{done ? 'Quitar marca' : '✓ La respondí'}</button>
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
            <span className="dg-door-in">{questions[qi].emoji || '❓'}{done.includes(k) && <b>✓</b>}</span>
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
                {gold ? '💰' : k < at ? '✓' : k + 1}
              </button>
              {k === at && <span className="dg-rex" aria-hidden="true">🦖</span>}
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
        <Finish score={route.length} total={route.length} onAgain={again}><p>¡Encontraste el tesoro! 💰</p></Finish>
      )}
      {q && open && (
        <Sheet onClose={close} className="dg-sheet-pick">
          <Question q={q} n={at + 1} />
          <div className="dg-row">
            <button type="button" className="dg-btn primary grow" onClick={() => { setAt((a) => a + 1); close(); }}>✓ La respondí: ¡avanza!</button>
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
            {done.includes(k) && <span className="dg-env-letter">✓</span>}
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
          <p className="dg-task"><b>📮 Reto</b>{CHALLENGES[task]}</p>
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
            {done.includes(k) && <span className="dg-note-stamp">done ✓</span>}
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

// ── Cajas bomba ───────────────────────────────────────────────────────────────

/** Lo que hay en cada caja: puntos (1–3), ⭐ que duplica o 💣 que deja al equipo en 0. */
type Prize = number | 'star' | 'boom';
const BOXES = ['#FF6B6B', '#4DABF7', '#51CF66', '#FF922B', '#9775FA', '#F06595'];
const prizeLabel = (p: Prize) => (p === 'boom' ? '💣' : p === 'star' ? '⭐' : `+${p}`);

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
      <div className="dg-teams-setup">
        <p className="dg-big-q">¿Cuántos equipos juegan?</p>
        <div className="dg-row center">
          {[2, 3, 4].map((t) => <button key={t} type="button" className="dg-btn primary big" onClick={() => start(t)}>{t} equipos</button>)}
        </div>
        <p className="dg-muted center">Cada equipo elige una caja y responde su pregunta. Si responde bien, se lleva lo que hay dentro: puntos, ⭐ (duplica) o 💣 (se queda en 0).</p>
      </div>
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
            <span>Equipo {k + 1}{s === best && s > 0 ? ' 👑' : ''}</span>
            <b>{s}</b>
          </div>
        ))}
      </div>
      {over
        ? <p className="dg-big-q">🏆 {winners.length > 1 ? `Empate: equipos ${winners.join(' y ')}` : `¡Gana el Equipo ${winners[0]}!`}</p>
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
                <button type="button" className="dg-btn ok grow" onClick={() => grade(true)}>✓ Bien: abrir la caja</button>
                <button type="button" className="dg-btn grow" onClick={() => grade(false)}>✗ No</button>
              </div>
            </>
          ) : (
            <>
              <p className={`dg-prize ${result === 'no' ? 'miss' : prize === 'boom' ? 'boom' : ''}`}>
                {result === 'no' ? 'Sin puntos: la caja sigue cerrada para otro equipo.'
                  : prize === 'boom' ? `💣 ¡BOOM! El ${team} se queda en 0.`
                    : prize === 'star' ? `⭐ ¡Estrella! Los puntos del ${team} se duplican.`
                      : `🎁 +${prize} para el ${team}`}
              </p>
              <button type="button" className="dg-btn primary" onClick={next}>Siguiente: Equipo {((turn + 1) % scores.length) + 1}</button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
