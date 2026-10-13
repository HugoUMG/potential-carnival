import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Mic, RotateCcw, SendHorizontal, Shuffle } from 'lucide-react';
import { copyText, matchWords, pick, range, reduceMotion, sample, shuffle, toggledList, useGame, words, type GameProps } from './util';
import { Countdown, Es, Notice, Say, Sheet, Speak } from './ui';
import { useRoom, useShared } from './roomState';

const GRADS = ['#FFD6E0,#FFEFD6', '#D6F0FF,#E6DEFF', '#DFFAD6,#FFF6CC', '#FFE1D6,#FFD6EE', '#D9E2FF,#D3FAF1',
  '#FFF1C9,#FFD9D9', '#E5DBFF,#FFD9F2', '#D3F8E2,#D6ECFF', '#FFE4CC,#FFF6D6', '#E0D9FF,#D6F5FF'];
const grad = (i: number) => `linear-gradient(135deg, ${GRADS[i % GRADS.length]})`;

// ── Tarjetas ──────────────────────────────────────────────────────────────────

export function CardsGame({ questions }: GameProps) {
  const { es } = useGame();
  const { endTurn } = useRoom();
  const [order, setOrder] = useShared('order', () => shuffle(range(questions.length)));
  const [pos, setPos] = useShared('pos', 0);
  const [flipped, setFlipped] = useShared('flipped', false);
  const [dir, setDir] = useShared('dir', 0);
  const [done, setDone] = useShared<number[]>('done', []);
  const startX = useRef<number | null>(null);
  const swiped = useRef(false);
  const i = order[pos];
  const q = questions[i];
  const go = (d: number) => {
    setPos((p) => (p + d + order.length) % order.length);
    setFlipped(false);
    setDir(d);
    endTurn();
  };

  return (
    <div className="dg-cards">
      <div
        key={`${pos}-${dir}`}
        className={`dg-deck ${dir > 0 ? 'in-r' : dir < 0 ? 'in-l' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Tarjeta: toca para voltear, desliza para cambiar"
        onPointerDown={(e) => { startX.current = e.clientX; swiped.current = false; }}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 50) { swiped.current = true; go(dx < 0 ? 1 : -1); }
        }}
        onClick={() => { if (!swiped.current) setFlipped((f) => !f); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
          if (e.key === 'ArrowRight') go(1);
          if (e.key === 'ArrowLeft') go(-1);
        }}
      >
        <div className={`dg-card3d ${flipped ? 'flipped' : ''}`}>
          <div className="dg-face" style={{ background: grad(i) }}>
            <div className="dg-face-top">
              <span className="dg-ico">{q.emoji || '💬'}</span>
              <span className="dg-tag">{q.tag}</span>
              {done.includes(i) && <span className="dg-stamp">✓ Done</span>}
              <Speak text={q.text} />
            </div>
            <p className="dg-face-q"><Say text={q.text} /></p>
            <div className="dg-face-foot">↻ Toca para voltear</div>
            <span className="dg-face-num">{String(pos + 1).padStart(2, '0')}</span>
          </div>
          <div className="dg-face back" style={{ background: grad(i) }}>
            {es && q.translation && (<><span className="dg-tag">En español</span><p className="dg-face-t">{q.translation}</p></>)}
            {q.hint && (<><span className="dg-tag">Empieza así</span><p className="dg-face-hint">“<Say text={q.hint} />”</p></>)}
            {!q.hint && !(es && q.translation) && <p className="dg-face-t">Responde con tus propias palabras.</p>}
            <div className="dg-face-foot">↻ Toca para volver</div>
          </div>
        </div>
      </div>

      <div className="dg-row">
        <button type="button" className="dg-round" aria-label="Tarjeta anterior" onClick={() => go(-1)}><ChevronLeft /></button>
        <button type="button" className={`dg-btn primary grow ${done.includes(i) ? 'is-done' : ''}`} onClick={() => setDone((d) => toggledList(d, i))}>
          {done.includes(i) ? '✓ Respondida' : 'Marcar como respondida'}
        </button>
        <button type="button" className="dg-round" aria-label="Tarjeta siguiente" onClick={() => go(1)}><ChevronRight /></button>
      </div>
      <div className="dg-row center dg-muted">
        <span>{pos + 1} / {order.length} · {done.length} respondidas</span>
        <button type="button" className="dg-link" onClick={() => { setOrder(shuffle(order)); setPos(0); setFlipped(false); setDir(1); }}>
          <Shuffle size={14} /> Barajar
        </button>
      </div>
    </div>
  );
}

// ── Chat ──────────────────────────────────────────────────────────────────────

const REACTIONS = ['Nice! 😊', 'Oh, interesting!', 'Cool, thanks for sharing!', 'I see! 👀', 'Great answer! 👏', 'Sounds fun!', 'Wow, really?'];

export function ChatGame({ questions }: GameProps) {
  const { endTurn } = useRoom();
  const [order, setOrder] = useShared('order', () => sample(range(questions.length), Math.min(10, questions.length)));
  const [answers, setAnswers] = useShared<string[]>('answers', []);
  const [typing, setTyping] = useState(false); // solo el "escribiendo…" del bot en este navegador
  const [draft, setDraft] = useShared('draft', '');
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('');
  const end = useRef<HTMLDivElement>(null);
  const finished = answers.length === order.length && !typing;

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' }); }, [answers.length, typing]);
  useEffect(() => {
    if (!typing) return;
    const t = window.setTimeout(() => setTyping(false), reduceMotion ? 200 : 1000);
    return () => window.clearTimeout(t);
  }, [typing]);

  const send = (text: string) => {
    if (typing || answers.length >= order.length) return;
    setAnswers((a) => [...a, text.trim()]);
    setDraft('');
    setTyping(true);
    endTurn();
  };
  const transcript = order.map((qi, k) => `Q${k + 1}. ${questions[qi].text}\nA: ${answers[k] || '(saltada)'}`).join('\n\n');

  // La pregunta k aparece cuando ya se respondió la anterior y el bot terminó de "escribir".
  const visible = order.filter((_, k) => k < answers.length || (k === answers.length && !typing));

  return (
    <div className="dg-chat">
      <div className="dg-chat-bar">
        <span className="dg-av">EB</span>
        <div><b>English Buddy</b><small>{typing ? 'typing…' : 'online'}</small></div>
      </div>
      <div className="dg-msgs" aria-live="polite">
        <div className="dg-msg in">
          <p className="dg-msg-q">Hi! 👋 Let&apos;s talk. Answer in English with 2–3 sentences.</p>
          <Es>¡Hola! Responde en inglés con 2 o 3 oraciones.</Es>
        </div>
        {visible.map((qi, k) => (
          <div key={k} className="dg-msg-pair">
            <div className="dg-msg in">
              <p className="dg-msg-q"><i>Q{k + 1}</i><Say text={questions[qi].text} /></p>
              <Es>{questions[qi].translation}</Es>
              <Speak text={questions[qi].text} />
            </div>
            {k < answers.length && (
              <>
                <div className="dg-msg out">{answers[k] || <em>(pregunta saltada)</em>}<span className="dg-ticks">✓✓</span></div>
                {answers[k] && (k < answers.length - 1 || !typing) && <div className="dg-msg in"><p className="dg-msg-q">{REACTIONS[k % REACTIONS.length]}</p></div>}
              </>
            )}
          </div>
        ))}
        {typing && <div className="dg-msg in dg-typing"><span /><span /><span /></div>}
        {finished && (
          <div className="dg-msg in">
            <p className="dg-msg-q">That&apos;s all! 🎉 You answered {answers.filter(Boolean).length} of {order.length}. Now read your answers out loud.</p>
            <div className="dg-row wrap">
              <button type="button" className="dg-btn small primary" onClick={async () => setCopied((await copyText(transcript)) ? 'ok' : 'fail')}>
                {copied === 'ok' ? '¡Copiado!' : 'Copiar mis respuestas'}
              </button>
              <button type="button" className="dg-btn small" onClick={() => { setOrder(sample(range(questions.length), order.length)); setAnswers([]); setCopied(''); }}>
                <RotateCcw size={14} /> Otra conversación
              </button>
            </div>
            {copied === 'fail' && <textarea className="dg-copy" readOnly value={transcript} onFocus={(e) => e.currentTarget.select()} />}
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="dg-composer" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send(draft); }}>
        <button type="button" className="dg-link" disabled={finished || typing} onClick={() => send('')}>Saltar</button>
        <textarea
          rows={1}
          value={draft}
          disabled={finished}
          placeholder="Escribe tu respuesta en inglés…"
          aria-label="Tu respuesta"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (draft.trim()) send(draft); } }}
        />
        <button type="submit" className="dg-send" aria-label="Enviar" disabled={finished || !draft.trim()}><SendHorizontal size={18} /></button>
      </form>
    </div>
  );
}

// ── Ruleta ────────────────────────────────────────────────────────────────────

const SEG = ['#FF595E', '#FF924C', '#FFCA3A', '#8AC926', '#2BB673', '#1982C4', '#4267AC', '#6A4C93', '#B5179E', '#F15BB5'];
const pt = (deg: number, r: number) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(2));

export function WheelGame({ questions }: GameProps) {
  const size = Math.min(10, questions.length);
  const { endTurn } = useRoom();
  const [round, setRound] = useShared('round', () => sample(range(questions.length), size));
  const [done, setDone] = useShared<number[]>('done', []);
  const [rot, setRot] = useShared('rot', 0);
  const [spinning, setSpinning] = useShared('spinning', false);
  const [open, setOpen] = useShared<number | null>('open', null);
  const step = 360 / size;
  const left = range(size).filter((s) => !done.includes(s));
  const close = () => { setOpen(null); endTurn(); };

  const spin = () => {
    if (spinning || !left.length) return;
    const s = pick(left);
    // El segmento s está centrado en -90 + s·step: se gira hasta dejarlo bajo la flecha.
    const target = -s * step + (Math.random() - 0.5) * step * 0.6;
    setRot((r) => r + 1800 + ((((target - r) % 360) + 360) % 360));
    setSpinning(true);
    window.setTimeout(() => { setSpinning(false); setOpen(s); }, reduceMotion ? 300 : 4300);
  };

  const wheel = useMemo(() => range(size).map((s) => {
    const a0 = -90 - step / 2 + s * step;
    const [x0, y0] = pt(a0, 100);
    const [x1, y1] = pt(a0 + step, 100);
    const [nx, ny] = pt(a0 + step / 2, 70);
    const isDone = done.includes(s);
    return (
      <g key={s}>
        <path d={`M0,0 L${x0},${y0} A100,100 0 0,1 ${x1},${y1} Z`} fill={isDone ? '#CFC8BA' : SEG[s % SEG.length]} stroke="#fff" strokeWidth="2" />
        <circle cx={nx} cy={ny} r="14" fill="#fff" />
        <text x={nx} y={ny} dy="5" textAnchor="middle" className="dg-wheel-n" fill={isDone ? '#8A8478' : '#1B1F3B'}>{isDone ? '✓' : s + 1}</text>
      </g>
    );
  }), [size, step, done]);

  const q = open === null ? null : questions[round[open]];
  return (
    <div className="dg-wheel-wrap">
      <div className="dg-wheel-box">
        <div className="dg-pointer" />
        <svg className="dg-wheel" viewBox="-120 -120 240 240" role="img" aria-label={`Ruleta con ${size} preguntas`}
          style={{ transform: `rotate(${rot}deg)`, transitionDuration: reduceMotion ? '0.3s' : '4.2s' }}>
          <circle r="114" fill="#1B1F3B" stroke="#FFCA3A" strokeWidth="2" />
          {range(24).map((k) => { const [x, y] = pt(k * 15, 107); return <circle key={k} className={`dg-light ${k % 2 ? 'b' : ''}`} cx={x} cy={y} r="3.2" />; })}
          {wheel}
        </svg>
        <button type="button" className="dg-hub" onClick={spin} aria-label="Girar la ruleta">SPIN</button>
      </div>
      <div className="dg-wheel-side">
        <button type="button" className="dg-spin" onClick={spin} disabled={spinning || !left.length}>{left.length ? 'Girar la ruleta' : '¡Ruleta completa! 🎉'}</button>
        <p className="dg-muted center">{left.length} de {size} sin responder</p>
        <button type="button" className="dg-link center" onClick={() => { setRound(sample(range(questions.length), size)); setDone([]); }}>
          <Shuffle size={14} /> Nueva ruleta con otras preguntas
        </button>
      </div>
      {q && open !== null && (
        <Sheet onClose={close} className="dg-sheet-wheel" style={{ '--seg': SEG[open % SEG.length] } as CSSProperties}>
          <div className="dg-sheet-num">{open + 1}</div>
          <p className="dg-sheet-q"><Say text={q.text} /></p>
          <Speak text={q.text} />
          <Es className="center">{q.translation}</Es>
          {q.hint && <p className="dg-hint">💡 <Say text={q.hint} /></p>}
          <div className="dg-row">
            <button type="button" className="dg-btn primary grow" onClick={() => { setDone((d) => toggledList(d, open)); close(); }}>
              {done.includes(open) ? 'Quitar marca' : '✓ La respondí'}
            </button>
            <button type="button" className="dg-btn grow" onClick={close}>Cerrar</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Corcho ────────────────────────────────────────────────────────────────────

const NOTE = ['#FFF475', '#FFB3C7', '#B6F2A6', '#A8DBFF', '#FFCC80', '#E1C8FF'];
const ROT = [-2, 1.5, -1, 2, -2.5, 1, -1.5, 2.5, -1, 1.5];

export function BoardGame({ questions }: GameProps) {
  const { es } = useGame();
  const { endTurn } = useRoom();
  const [done, setDone] = useShared<number[]>('done', []);
  const [open, setOpen] = useShared<number | null>('open', null);
  const q = open === null ? null : questions[open];
  const random = () => {
    const left = range(questions.length).filter((i) => !done.includes(i));
    setOpen(pick(left.length ? left : range(questions.length)));
  };
  const close = () => { setOpen(null); endTurn(); };
  return (
    <div className="dg-board">
      <div className="dg-notes">
        {questions.map((note, i) => (
          <button key={i} type="button" className={`dg-note ${done.includes(i) ? 'done' : ''}`} onClick={() => setOpen(i)}
            style={{ '--r': `${ROT[i % ROT.length]}deg`, '--c': NOTE[i % NOTE.length] } as CSSProperties}>
            <span className={i % 3 === 1 ? 'dg-tape' : 'dg-pin'} />
            <span className="dg-note-n">#{i + 1}</span>
            <span className="dg-note-q">{note.text}</span>
            {es && note.translation && <span className="dg-note-t">{note.translation}</span>}
            {done.includes(i) && <span className="dg-note-stamp">done ✓</span>}
          </button>
        ))}
      </div>
      <button type="button" className="dg-rand" onClick={random}>Nota al azar</button>
      {q && open !== null && (
        <Sheet onClose={close} className="dg-sheet-note" style={{ '--c': NOTE[open % NOTE.length] } as CSSProperties}>
          <span className="dg-note-n big">#{open + 1}</span>
          <p className="dg-sheet-note-q"><Say text={q.text} /></p>
          <Speak text={q.text} />
          <Es>{q.translation}</Es>
          {q.hint && <p className="dg-hint">💡 <Say text={q.hint} /></p>}
          <div className="dg-row">
            <button type="button" className="dg-btn dark grow" onClick={() => { setDone((d) => toggledList(d, open)); close(); }}>
              {done.includes(open) ? 'Quitar marca' : '✓ La respondí'}
            </button>
            <button type="button" className="dg-btn grow" onClick={close}>Cerrar</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Dados ─────────────────────────────────────────────────────────────────────

const CHALLENGES = [
  'Responde con una oración completa.',
  'Responde con dos oraciones.',
  'Responde con tres oraciones y da un ejemplo.',
  'Responde y luego hazle la misma pregunta a un compañero.',
  'Habla 30 segundos sin parar. ¡Usa el cronómetro!',
  '¡Comodín! Tú eliges quién responde.',
];
const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

export function DiceGame({ questions }: GameProps) {
  const { endTurn } = useRoom();
  const [face, setFace] = useShared('face', 0);
  const [qi, setQi] = useShared<number | null>('qi', null);
  const [rolling, setRolling] = useShared('rolling', false);
  const [rolls, setRolls] = useShared('rolls', 0);
  const [deck, setDeck] = useShared('deck', () => shuffle(range(questions.length)));

  // En sala, el turno pasa al terminar de rodar: el reto ya está a la vista y lo responde quien tiró.
  useEffect(() => {
    if (!rolling) return;
    const id = window.setInterval(() => setFace(Math.floor(Math.random() * 6)), 90);
    const stop = window.setTimeout(() => { window.clearInterval(id); setRolling(false); endTurn(); }, reduceMotion ? 100 : 900);
    return () => { window.clearInterval(id); window.clearTimeout(stop); };
  }, [rolling, setFace, setRolling, endTurn]);

  const roll = () => {
    if (rolling) return;
    const rest = deck.length ? deck : shuffle(range(questions.length));
    setQi(rest[0]);
    setDeck(rest.slice(1));
    setRolls((r) => r + 1);
    setRolling(true);
  };
  const q = qi === null ? null : questions[qi];

  return (
    <div className="dg-dice">
      <button type="button" className={`dg-die ${rolling ? 'rolling' : ''}`} onClick={roll} aria-label="Lanzar el dado">
        {range(9).map((p) => <span key={p} className={PIPS[face].includes(p) ? 'on' : ''} />)}
      </button>
      <button type="button" className="dg-btn primary" onClick={roll} disabled={rolling}>🎲 {rolls ? 'Lanzar otra vez' : 'Lanzar el dado'}</button>
      {q && !rolling && (
        <div className="dg-dice-card">
          <p className="dg-challenge"><b>{face + 1}</b> {CHALLENGES[face]}</p>
          <p className="dg-big-q"><span className="dg-emoji">{q.emoji}</span> <Say text={q.text} /></p>
          <div className="dg-row center"><Speak text={q.text} />{face === 4 && <Countdown />}</div>
          <Es className="center">{q.translation}</Es>
          {q.hint && <p className="dg-hint center">💡 <Say text={q.hint} /></p>}
        </div>
      )}
      {!q && <p className="dg-muted center">El número del dado decide cuánto tienes que hablar.</p>}
    </div>
  );
}

// ── Equipos ───────────────────────────────────────────────────────────────────

const TEAM_COLORS = ['#FF595E', '#1982C4', '#2BB673', '#FF924C'];

export function TeamsGame({ questions }: GameProps) {
  const { endTurn } = useRoom();
  const [scores, setScores] = useShared<number[]>('scores', []);
  const [turn, setTurn] = useShared('turn', 0);
  const [deck, setDeck] = useShared<number[]>('deck', []);
  const [shown, setShown] = useShared<number | null>('shown', null);

  if (!scores.length) {
    return (
      <div className="dg-teams-setup">
        <p className="dg-big-q">¿Cuántos equipos juegan?</p>
        <div className="dg-row center">
          {[2, 3, 4].map((n) => (
            <button key={n} type="button" className="dg-btn primary big" onClick={() => { setScores(new Array(n).fill(0)); setTurn(0); setDeck(shuffle(range(questions.length))); setShown(null); }}>
              {n} equipos
            </button>
          ))}
        </div>
        <p className="dg-muted center">Cada turno, el equipo responde una pregunta en 30 segundos y tú das los puntos.</p>
      </div>
    );
  }

  const draw = () => {
    const rest = deck.length ? deck : shuffle(range(questions.length));
    setShown(rest[0]);
    setDeck(rest.slice(1));
  };
  const award = (points: number) => {
    setScores((s) => s.map((v, k) => (k === turn ? v + points : v)));
    setTurn((t) => (t + 1) % scores.length);
    setShown(null);
    endTurn();
  };
  const best = Math.max(...scores);
  const q = shown === null ? null : questions[shown];

  return (
    <div className="dg-teams">
      <div className="dg-scoreboard">
        {scores.map((s, k) => (
          <div key={k} className={`dg-team ${k === turn ? 'turn' : ''}`} style={{ '--team': TEAM_COLORS[k] } as CSSProperties}>
            <span>Equipo {k + 1}{s === best && s > 0 ? ' 👑' : ''}</span>
            <b>{s}</b>
          </div>
        ))}
      </div>
      {!q ? (
        <button type="button" className="dg-btn big primary" style={{ background: TEAM_COLORS[turn] }} onClick={draw}>Pregunta para el Equipo {turn + 1}</button>
      ) : (
        <div className="dg-dice-card">
          <p className="dg-challenge">Turno del <b style={{ color: TEAM_COLORS[turn] }}>Equipo {turn + 1}</b></p>
          <p className="dg-big-q"><span className="dg-emoji">{q.emoji}</span> <Say text={q.text} /></p>
          <div className="dg-row center"><Speak text={q.text} /><Countdown /></div>
          <Es className="center">{q.translation}</Es>
          <div className="dg-row wrap center">
            <button type="button" className="dg-btn ok" onClick={() => award(2)}>+2 Excelente</button>
            <button type="button" className="dg-btn primary" onClick={() => award(1)}>+1 Bien</button>
            <button type="button" className="dg-btn" onClick={() => award(0)}>0 · Pasar</button>
          </div>
        </div>
      )}
      <button type="button" className="dg-link center" onClick={() => setScores([])}><RotateCcw size={14} /> Nueva partida</button>
    </div>
  );
}

// ── Pronuncia ─────────────────────────────────────────────────────────────────

// Web Speech API: Chrome, Edge y Safari la traen (con prefijo webkit); Firefox no. Tipado mínimo
// porque TypeScript no la incluye en lib.dom.
interface Recognizer {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerClass = new () => Recognizer;
const speechWindow = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

export function PronounceGame({ questions }: GameProps) {
  const { endTurn, addPoint } = useRoom();
  const [order] = useShared('order', () => shuffle(range(questions.length)));
  const [pos, setPos] = useShared('pos', 0);
  const [listening, setListening] = useState(false);
  const [said, setSaid] = useShared('said', '');
  const [err, setErr] = useState('');
  // Huecos = frases sin intento. En sala viajan como JSON y llegan como `null`.
  const [best, setBest] = useShared<(number | null)[]>('best', []);
  const q = questions[order[pos % order.length]];
  const target = words(q.text);
  const hits = said ? matchWords(target, words(said)) : null;
  const pct = hits ? Math.round((100 * hits.filter(Boolean).length) / Math.max(1, target.length)) : 0;

  const listen = () => {
    if (!Recognition || listening) return;
    const r = new Recognition();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setSaid(text);
      const score = Math.round((100 * matchWords(target, words(text)).filter(Boolean).length) / Math.max(1, target.length));
      setBest((b) => { const next = [...b]; next[pos] = Math.max(next[pos] ?? 0, score); return next; });
      if (score >= 80) addPoint();
    };
    r.onerror = (e) => setErr(e.error === 'not-allowed' ? 'Permite el uso del micrófono para jugar.' : 'No te escuché bien. Intenta otra vez.');
    r.onend = () => setListening(false);
    setErr('');
    setSaid('');
    setListening(true);
    r.start();
  };
  const next = () => { setPos((p) => p + 1); setSaid(''); setErr(''); endTurn(); };
  const tokens = q.text.split(/\s+/);
  const average = best.length ? Math.round(best.reduce<number>((a, b) => a + (b ?? 0), 0) / best.filter((b) => b != null).length) : null;

  return (
    <div className="dg-pron">
      {!Recognition && (
        <Notice>Tu navegador no reconoce la voz. Ábrelo en Chrome o Edge para que te califique; mientras, escucha el modelo y repítelo.</Notice>
      )}
      <div className="dg-dice-card">
        <p className="dg-challenge">Lee la pregunta en voz alta</p>
        <p className="dg-big-q">
          {hits
            ? tokens.map((t, k) => {
              const index = words(tokens.slice(0, k + 1).join(' ')).length - 1;
              const ok = words(t).length === 0 || hits[index];
              return <span key={k} className={ok ? 'dg-hit' : 'dg-miss'}>{t} </span>;
            })
            : <Say text={q.text} />}
        </p>
        <div className="dg-row center"><Speak text={q.text} label="Escuchar el modelo" /></div>
        <Es className="center">{q.translation}</Es>
        {Recognition && (
          <button type="button" className={`dg-mic ${listening ? 'on' : ''}`} onClick={listen} aria-label="Hablar">
            <Mic size={30} />
          </button>
        )}
        <p className="dg-muted center">{listening ? 'Te escucho…' : Recognition ? 'Toca el micrófono y lee la pregunta.' : ''}</p>
        {err && <p className="dg-error center">{err}</p>}
        {said && (
          <div className={`dg-result ${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'bad'}`}>
            <b>{pct}%</b>
            <span>Escuché: “{said}”</span>
          </div>
        )}
        <div className="dg-row center">
          <button type="button" className="dg-btn primary" onClick={next}>Siguiente pregunta</button>
        </div>
      </div>
      {average !== null && <p className="dg-muted center">Promedio de tus mejores intentos: <b>{average}%</b></p>}
    </div>
  );
}
