import { useState } from 'react';
import { PartyPopper, Play, RotateCcw, Snail, Volume2 } from 'lucide-react';
import { EmojiIcon } from '../components/AppIcon';
import { matchWords, pick, playAudio, range, sample, shuffle, speak, toggled, words, type GameProps } from './util';
import { Es, Finish, Say, Speak } from './ui';
import { useRoom, useShared } from './roomState';

const ROUNDS = 10;

/** Botones grandes para (re)escuchar el audio de la ronda sin ver el texto. */
function Listen({ text }: { text: string }) {
  return (
    <div className="dg-listen">
      <button type="button" className="dg-listen-main" onClick={() => speak(text)} aria-label="Escuchar"><Volume2 size={34} /></button>
      <button type="button" className="dg-listen-slow" onClick={() => speak(text, true)} aria-label="Escuchar lento"><Snail size={22} /></button>
    </div>
  );
}

// ── Escucha y elige ───────────────────────────────────────────────────────────

function optionsFor(target: number, total: number): number[] {
  return shuffle([target, ...sample(range(total).filter((i) => i !== target), Math.min(3, total - 1))]);
}

export function ListenGame({ questions }: GameProps) {
  const rounds = Math.min(ROUNDS, questions.length);
  const { endTurn, addPoint } = useRoom();
  const [order, setOrder] = useShared('order', () => sample(range(questions.length), rounds));
  const [pos, setPos] = useShared('pos', -1); // -1 = antes de empezar (el audio necesita un toque del alumno)
  const [opts, setOpts] = useShared<number[]>('opts', []);
  const [chosen, setChosen] = useShared<number | null>('chosen', null);
  const [score, setScore] = useShared('score', 0);

  const goTo = (p: number, list = order) => {
    setPos(p);
    setChosen(null);
    if (p < list.length) {
      setOpts(optionsFor(list[p], questions.length));
      speak(questions[list[p]].text);
    }
  };
  const again = () => { const fresh = sample(range(questions.length), rounds); setOrder(fresh); setScore(0); goTo(0, fresh); };

  if (pos === -1) {
    return (
      <div className="dg-center-card">
        <p className="dg-big-q">Escucha la pregunta y elige cuál es.</p>
        <button type="button" className="dg-btn primary big" onClick={() => goTo(0)}><Play size={18} /> Empezar ({rounds} rondas)</button>
      </div>
    );
  }
  if (pos >= order.length) return <Finish score={score} total={order.length} onAgain={again} />;

  const target = order[pos];
  return (
    <div className="dg-quiz">
      <p className="dg-progress">Ronda {pos + 1} de {order.length} · {score} aciertos</p>
      <Listen text={questions[target].text} />
      <div className="dg-options">
        {opts.map((o) => {
          const state = chosen === null ? '' : o === target ? 'ok' : o === chosen ? 'bad' : 'dim';
          return (
            <button key={o} type="button" className={`dg-option ${state}`} disabled={chosen !== null}
              onClick={() => { setChosen(o); if (o === target) { setScore((s) => s + 1); addPoint(); } }}>
              {questions[o].text}
            </button>
          );
        })}
      </div>
      {chosen !== null && (
        <div className="dg-feedback">
          <p className={`${chosen === target ? 'dg-ok' : 'dg-bad'} inline-flex items-center gap-1.5`}>{chosen === target ? <><PartyPopper size={16} /> ¡Correcto!</> : 'Casi. Era esta:'}</p>
          <p className="dg-big-q"><Say text={questions[target].text} /></p>
          <Es className="center">{questions[target].translation}</Es>
          <button type="button" className="dg-btn primary" onClick={() => { goTo(pos + 1); endTurn(); }}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

// ── Dictado ───────────────────────────────────────────────────────────────────

export function DictationGame({ questions }: GameProps) {
  const rounds = Math.min(ROUNDS, questions.length);
  const { endTurn, addPoint } = useRoom();
  const [order, setOrder] = useShared('order', () => sample(range(questions.length), rounds));
  const [pos, setPos] = useShared('pos', -1);
  const [typed, setTyped] = useShared('typed', '');
  const [hits, setHits] = useShared<boolean[] | null>('hits', null);
  const [accuracy, setAccuracy] = useShared<number[]>('accuracy', []);

  const goTo = (p: number, list = order) => {
    setPos(p);
    setTyped('');
    setHits(null);
    if (p < list.length) speak(questions[list[p]].text, true);
  };
  const again = () => { const fresh = sample(range(questions.length), rounds); setOrder(fresh); setAccuracy([]); goTo(0, fresh); };

  if (pos === -1) {
    return (
      <div className="dg-center-card">
        <p className="dg-big-q">Escucha y escribe la pregunta exactamente como la oyes.</p>
        <button type="button" className="dg-btn primary big" onClick={() => goTo(0)}><Play size={18} /> Empezar ({rounds} dictados)</button>
      </div>
    );
  }
  if (pos >= order.length) {
    const perfect = accuracy.filter((a) => a === 1).length;
    const avg = Math.round((100 * accuracy.reduce((a, b) => a + b, 0)) / Math.max(1, accuracy.length));
    return <Finish score={perfect} total={order.length} onAgain={again}><p className="dg-muted center">Precisión promedio: <b>{avg}%</b> (cuenta palabra por palabra)</p></Finish>;
  }

  const q = questions[order[pos]];
  const target = words(q.text);
  const check = () => {
    const h = matchWords(target, words(typed));
    const acc = h.filter(Boolean).length / Math.max(1, target.length);
    setHits(h);
    setAccuracy((a) => [...a, acc]);
    if (acc >= 0.8) addPoint();
  };
  // Las palabras de la respuesta en su forma original, para pintarlas en verde o rojo.
  const shown = q.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];

  return (
    <div className="dg-quiz">
      <p className="dg-progress">Dictado {pos + 1} de {order.length}</p>
      <Listen text={q.text} />
      <textarea className="dg-input" rows={2} value={typed} disabled={hits !== null} placeholder="Escribe lo que escuchas…"
        aria-label="Lo que escuchas" onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (typed.trim() && !hits) check(); } }} />
      {!hits ? (
        <button type="button" className="dg-btn primary" disabled={!typed.trim()} onClick={check}>Revisar</button>
      ) : (
        <div className="dg-feedback">
          <p className="dg-big-q">{shown.map((w, k) => <span key={k} className={hits[k] ? 'dg-hit' : 'dg-miss'}>{w} </span>)}</p>
          <p className="dg-muted center">{hits.every(Boolean) ? <span className="inline-flex items-center gap-1.5"><PartyPopper size={16} /> ¡Perfecto!</span> : `${hits.filter(Boolean).length} de ${hits.length} palabras. En rojo, las que faltaron o cambiaste.`}</p>
          <Speak text={q.text} />
          <Es className="center">{q.translation}</Es>
          <button type="button" className="dg-btn primary" onClick={() => { goTo(pos + 1); endTurn(); }}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

// ── Bingo ─────────────────────────────────────────────────────────────────────

function bingoLines(size: number): number[][] {
  const rows = range(size).map((r) => range(size).map((c) => r * size + c));
  const cols = range(size).map((c) => range(size).map((r) => r * size + c));
  return [...rows, ...cols, range(size).map((k) => k * size + k), range(size).map((k) => k * size + (size - 1 - k))];
}

export function BingoGame({ questions }: GameProps) {
  const size = questions.length >= 9 ? 3 : 2;
  // En sala solo se comparten las cantadas: cada uno marca su propio cartón (por eso Bingo es
  // `roomFree` en GAMES y su área no queda bloqueada) y canta quien tiene el control.
  const { room, canAct, endTurn } = useRoom();
  const [card, setCard] = useState(() => sample(range(questions.length), size * size));
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [called, setCalled] = useShared<number[]>('called', []);
  const [teacherCallsLocal, setTeacherCalls] = useState(false);
  const teacherCalls = room ? false : teacherCallsLocal;
  const [shake, setShake] = useState<number | null>(null);
  const bingo = bingoLines(size).some((line) => line.every((cell) => marked.has(cell)));
  const pool = range(questions.length).filter((i) => !called.includes(i));

  const callNext = () => {
    if (!pool.length) return;
    const i = pick(pool);
    setCalled((c) => [...c, i]);
    speak(questions[i].text);
    endTurn();
  };
  const tap = (cell: number) => {
    if (bingo) return;
    if (!teacherCalls && !marked.has(cell) && !called.includes(card[cell])) {
      setShake(cell);
      window.setTimeout(() => setShake(null), 450);
      return;
    }
    setMarked((m) => toggled(m, cell));
  };
  const reset = () => { setCard(sample(range(questions.length), size * size)); setMarked(new Set()); setCalled([]); };
  const last = called.length ? questions[called[called.length - 1]] : null;

  return (
    <div className="dg-bingo">
      {!teacherCalls && (
        <div className="dg-caller">
          {canAct && (
            <button type="button" className="dg-btn primary" onClick={callNext} disabled={!pool.length || bingo}>
              <Volume2 size={16} /> {called.length ? 'Cantar la siguiente' : 'Cantar la primera'}
            </button>
          )}
          {/* playAudio: repetir suena solo en este celular, también al que no canta. */}
          {last && <button type="button" className="dg-btn" onClick={() => playAudio(last.text, true)}><Snail size={16} /> Repetir lento</button>}
          <span className="dg-muted">Cantadas: {called.length}</span>
        </div>
      )}
      <div className={`dg-bingo-card size-${size} ${bingo ? 'won' : ''}`}>
        {card.map((qi, cell) => (
          <button key={cell} type="button" className={`dg-cell ${marked.has(cell) ? 'marked' : ''} ${shake === cell ? 'shake' : ''}`} onClick={() => tap(cell)}>
            <EmojiIcon emoji={questions[qi].emoji} size={18} className="dg-emoji shrink-0" />
            <span>{questions[qi].text}</span>
          </button>
        ))}
      </div>
      {bingo && <p className="dg-bingo-banner inline-flex items-center gap-2">¡BINGO! <PartyPopper size={22} /></p>}
      {shake !== null && <p className="dg-error center">Esa todavía no la han cantado.</p>}
      {!room && (
        <label className="dg-check">
          <input type="checkbox" checked={teacherCalls} onChange={(e) => setTeacherCalls(e.target.checked)} />
          Las canta el profesor (marcar libremente)
        </label>
      )}
      <button type="button" className="dg-link center" onClick={reset}><RotateCcw size={14} /> Nuevo cartón</button>
    </div>
  );
}
