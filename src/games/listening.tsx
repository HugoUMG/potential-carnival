import { useState } from 'react';
import { Play, RotateCcw, Snail, Volume2 } from 'lucide-react';
import { matchWords, pick, range, sample, shuffle, speak, toggled, words, type GameProps } from './util';
import { Es, Finish, Say, Speak } from './ui';

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
  const [order, setOrder] = useState(() => sample(range(questions.length), rounds));
  const [pos, setPos] = useState(-1); // -1 = antes de empezar (el audio necesita un toque del alumno)
  const [opts, setOpts] = useState<number[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);

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
              onClick={() => { setChosen(o); if (o === target) setScore((s) => s + 1); }}>
              {questions[o].text}
            </button>
          );
        })}
      </div>
      {chosen !== null && (
        <div className="dg-feedback">
          <p className={chosen === target ? 'dg-ok' : 'dg-bad'}>{chosen === target ? '¡Correcto! 🎉' : 'Casi. Era esta:'}</p>
          <p className="dg-big-q"><Say text={questions[target].text} /></p>
          <Es className="center">{questions[target].translation}</Es>
          <button type="button" className="dg-btn primary" onClick={() => goTo(pos + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

// ── Dictado ───────────────────────────────────────────────────────────────────

export function DictationGame({ questions }: GameProps) {
  const rounds = Math.min(ROUNDS, questions.length);
  const [order, setOrder] = useState(() => sample(range(questions.length), rounds));
  const [pos, setPos] = useState(-1);
  const [typed, setTyped] = useState('');
  const [hits, setHits] = useState<boolean[] | null>(null);
  const [accuracy, setAccuracy] = useState<number[]>([]);

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
    setHits(h);
    setAccuracy((a) => [...a, h.filter(Boolean).length / Math.max(1, target.length)]);
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
          <p className="dg-muted center">{hits.every(Boolean) ? '¡Perfecto! 🎉' : `${hits.filter(Boolean).length} de ${hits.length} palabras. En rojo, las que faltaron o cambiaste.`}</p>
          <Speak text={q.text} />
          <Es className="center">{q.translation}</Es>
          <button type="button" className="dg-btn primary" onClick={() => goTo(pos + 1)}>Siguiente</button>
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
  const [card, setCard] = useState(() => sample(range(questions.length), size * size));
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [called, setCalled] = useState<number[]>([]);
  const [teacherCalls, setTeacherCalls] = useState(false);
  const [shake, setShake] = useState<number | null>(null);
  const bingo = bingoLines(size).some((line) => line.every((cell) => marked.has(cell)));
  const pool = range(questions.length).filter((i) => !called.includes(i));

  const callNext = () => {
    if (!pool.length) return;
    const i = pick(pool);
    setCalled((c) => [...c, i]);
    speak(questions[i].text);
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
          <button type="button" className="dg-btn primary" onClick={callNext} disabled={!pool.length || bingo}>
            <Volume2 size={16} /> {called.length ? 'Cantar la siguiente' : 'Cantar la primera'}
          </button>
          {last && <button type="button" className="dg-btn" onClick={() => speak(last.text, true)}><Snail size={16} /> Repetir lento</button>}
          <span className="dg-muted">Cantadas: {called.length}</span>
        </div>
      )}
      <div className={`dg-bingo-card size-${size} ${bingo ? 'won' : ''}`}>
        {card.map((qi, cell) => (
          <button key={cell} type="button" className={`dg-cell ${marked.has(cell) ? 'marked' : ''} ${shake === cell ? 'shake' : ''}`} onClick={() => tap(cell)}>
            <span className="dg-emoji">{questions[qi].emoji}</span>
            <span>{questions[qi].text}</span>
          </button>
        ))}
      </div>
      {bingo && <p className="dg-bingo-banner">¡BINGO! 🎉</p>}
      {shake !== null && <p className="dg-error center">Esa todavía no la han cantado.</p>}
      <label className="dg-check">
        <input type="checkbox" checked={teacherCalls} onChange={(e) => setTeacherCalls(e.target.checked)} />
        Las canta el profesor (marcar libremente)
      </label>
      <button type="button" className="dg-link center" onClick={reset}><RotateCcw size={14} /> Nuevo cartón</button>
    </div>
  );
}
