import { useEffect, useMemo, useState } from 'react';
import { Lightbulb, SkipForward } from 'lucide-react';
import type { GameQuestion } from '../types';
import { pick, range, sample, shuffle, tokenize, type GameProps } from './util';
import { Es, Finish, Say, Speak } from './ui';

const ROUNDS = 10;

// ── Ordena la pregunta ────────────────────────────────────────────────────────

/** Fichas de la pregunta: sin el signo final (va fijo) y con la primera palabra en minúscula,
 *  para que la mayúscula no delate cuál va primero ("I" sí conserva la suya). */
function chipsOf(text: string): { parts: string[]; end: string } {
  const trimmed = text.trim();
  const body = trimmed.replace(/[?.!]+$/, '');
  const parts = body.split(/\s+/).map((w, k) => (k === 0 && !/^I\b/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w));
  return { parts, end: trimmed.slice(body.length) };
}

function shuffledIds(n: number): number[] {
  if (n < 2) return range(n);
  let ids = shuffle(range(n));
  while (ids.every((v, k) => v === k)) ids = shuffle(range(n));
  return ids;
}

export function OrderGame({ questions }: GameProps) {
  // Las preguntas de más de 12 palabras son un rompecabezas tedioso en el celular.
  const usable = useMemo(() => {
    const short = range(questions.length).filter((i) => questions[i].text.split(/\s+/).length <= 12);
    return short.length >= 4 ? short : range(questions.length);
  }, [questions]);
  const rounds = Math.min(ROUNDS, usable.length);
  const [order, setOrder] = useState(() => sample(usable, rounds));
  const [pos, setPos] = useState(0);
  const [pool, setPool] = useState<number[]>(() => shuffledIds(chipsOf(questions[order[0]].text).parts.length));
  const [picked, setPicked] = useState<number[]>([]);
  const [status, setStatus] = useState<'' | 'ok' | 'bad'>('');
  const [score, setScore] = useState(0);
  const [hint, setHint] = useState(false);

  const goTo = (p: number, list = order) => {
    setPos(p);
    setPicked([]);
    setStatus('');
    setHint(false);
    if (p < list.length) setPool(shuffledIds(chipsOf(questions[list[p]].text).parts.length));
  };
  const again = () => { const fresh = sample(usable, rounds); setOrder(fresh); setScore(0); goTo(0, fresh); };
  if (pos >= order.length) return <Finish score={score} total={order.length} onAgain={again} />;

  const q = questions[order[pos]];
  const { parts, end } = chipsOf(q.text);
  const check = () => {
    // Se comparan los textos, no los ids: dos fichas iguales ("you … you") valen en cualquier orden.
    const ok = picked.map((id) => parts[id]).join(' ') === parts.join(' ');
    setStatus(ok ? 'ok' : 'bad');
    if (ok) setScore((s) => s + 1);
  };

  return (
    <div className="dg-quiz">
      <p className="dg-progress">Pregunta {pos + 1} de {order.length} · {score} correctas</p>
      <div className={`dg-answer ${status}`}>
        {picked.length === 0 && <span className="dg-muted">Toca las palabras en orden…</span>}
        {picked.map((id) => (
          <button key={id} type="button" className="dg-chip on" disabled={status === 'ok'}
            onClick={() => { setPicked((p) => p.filter((x) => x !== id)); setPool((p) => [...p, id]); setStatus(''); }}>
            {parts[id]}
          </button>
        ))}
        {picked.length > 0 && <span className="dg-end">{end}</span>}
      </div>
      <div className="dg-pool">
        {pool.map((id) => (
          <button key={id} type="button" className="dg-chip" onClick={() => { setPool((p) => p.filter((x) => x !== id)); setPicked((p) => [...p, id]); }}>
            {parts[id]}
          </button>
        ))}
      </div>
      {hint && <Es className="center">{q.translation || 'Sin traducción para esta pregunta.'}</Es>}
      {status === 'ok' ? (
        <div className="dg-feedback">
          <p className="dg-ok">¡Muy bien! 🎉</p>
          <p className="dg-big-q"><Say text={q.text} /></p>
          <Speak text={q.text} />
          <button type="button" className="dg-btn primary" onClick={() => goTo(pos + 1)}>Siguiente</button>
        </div>
      ) : (
        <div className="dg-row center wrap">
          <button type="button" className="dg-btn primary" disabled={pool.length > 0} onClick={check}>Comprobar</button>
          <button type="button" className="dg-btn" onClick={() => setHint(true)}><Lightbulb size={16} /> Pista</button>
          <button type="button" className="dg-btn" onClick={() => goTo(pos + 1)}><SkipForward size={16} /> Saltar</button>
        </div>
      )}
      {status === 'bad' && <p className="dg-error center">Todavía no. Toca una ficha de arriba para devolverla.</p>}
    </div>
  );
}

// ── Completa el hueco ─────────────────────────────────────────────────────────

// Auxiliares y wh-words: si la pregunta los tiene, se ocultan seguido y sus distractores son de
// la misma familia ("Where ___ you go?" → would / will / do / are). Es la gramática que se practica.
const AUX = ['would', 'will', 'can', 'could', 'do', 'does', 'did', 'are', 'is', 'am', 'was', 'were', 'have', 'has', 'had', 'should', 'might', 'must'];
const WH = ['what', 'where', 'when', 'why', 'who', 'which', 'how', 'whose'];

interface Gap {
  index: number; // token oculto
  answer: string;
  options: string[];
}

function matchCase(word: string, model: string): string {
  return model[0] === model[0].toUpperCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

function makeGap(q: GameQuestion, bank: string[]): Gap {
  const tokens = tokenize(q.text);
  const idx = range(tokens.length).filter((k) => tokens[k].word);
  const of = (family: string[]) => idx.filter((k) => family.includes(tokens[k].word ?? ''));
  const aux = of(AUX);
  const wh = of(WH);
  const content = idx.filter((k) => (tokens[k].word ?? '').length >= 3 && !AUX.includes(tokens[k].word ?? '') && !WH.includes(tokens[k].word ?? ''));
  const roll = Math.random();
  const index = aux.length && roll < 0.5 ? pick(aux) : wh.length && roll < 0.75 ? pick(wh) : content.length ? pick(content) : pick(idx);
  const raw = tokens[index].raw;
  const word = tokens[index].word ?? raw.toLowerCase();
  const family = AUX.includes(word) ? AUX : WH.includes(word) ? WH : bank;
  const distractors = sample(family.filter((w) => w !== word), 3);
  return { index, answer: raw, options: shuffle([raw, ...distractors.map((d) => matchCase(d, raw))]) };
}

export function GapGame({ questions }: GameProps) {
  const bank = useMemo(() => {
    const all = new Set(questions.flatMap((q) => tokenize(q.text).flatMap((t) => (t.word && t.word.length >= 3 ? [t.word] : []))));
    return [...all];
  }, [questions]);
  const rounds = Math.min(ROUNDS, questions.length);
  const [order, setOrder] = useState(() => sample(range(questions.length), rounds));
  const [pos, setPos] = useState(0);
  const [gap, setGap] = useState(() => makeGap(questions[order[0]], bank));
  const [chosen, setChosen] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const goTo = (p: number, list = order) => {
    setPos(p);
    setChosen(null);
    if (p < list.length) setGap(makeGap(questions[list[p]], bank));
  };
  const again = () => { const fresh = sample(range(questions.length), rounds); setOrder(fresh); setScore(0); goTo(0, fresh); };
  if (pos >= order.length) return <Finish score={score} total={order.length} onAgain={again} />;

  const q = questions[order[pos]];
  const tokens = tokenize(q.text);
  return (
    <div className="dg-quiz">
      <p className="dg-progress">Pregunta {pos + 1} de {order.length} · {score} correctas</p>
      <p className="dg-big-q">
        {tokens.map((t, k) => (k === gap.index
          ? <span key={k} className={`dg-gap ${chosen === null ? '' : chosen === gap.answer ? 'ok' : 'bad'}`}>{chosen === null ? ' '.repeat(6) : gap.answer}</span>
          : <span key={k}>{t.raw}</span>))}
      </p>
      <Es className="center">{q.translation}</Es>
      <div className="dg-options grid2">
        {gap.options.map((o) => {
          const state = chosen === null ? '' : o === gap.answer ? 'ok' : o === chosen ? 'bad' : 'dim';
          return (
            <button key={o} type="button" className={`dg-option ${state}`} disabled={chosen !== null}
              onClick={() => { setChosen(o); if (o === gap.answer) setScore((s) => s + 1); }}>{o}</button>
          );
        })}
      </div>
      {chosen !== null && (
        <div className="dg-feedback">
          <p className={chosen === gap.answer ? 'dg-ok' : 'dg-bad'}>{chosen === gap.answer ? '¡Correcto! 🎉' : `Era “${gap.answer}”.`}</p>
          <Speak text={q.text} />
          <button type="button" className="dg-btn primary" onClick={() => goTo(pos + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

// ── Globos (ahorcado amable) ──────────────────────────────────────────────────

const LIVES = 6;
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function secretOf(q: GameQuestion): number {
  const tokens = tokenize(q.text);
  const candidates = range(tokens.length).filter((k) => /^[a-z]{4,}$/.test(tokens[k].word ?? ''));
  if (candidates.length) return pick(candidates);
  return range(tokens.length).filter((k) => tokens[k].word).sort((a, b) => tokens[b].raw.length - tokens[a].raw.length)[0];
}

export function BalloonsGame({ questions }: GameProps) {
  const rounds = Math.min(8, questions.length);
  const [order, setOrder] = useState(() => sample(range(questions.length), rounds));
  const [pos, setPos] = useState(0);
  const [secret, setSecret] = useState(() => secretOf(questions[order[0]]));
  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [wins, setWins] = useState(0);
  const [clue, setClue] = useState(false);

  const q = pos < order.length ? questions[order[pos]] : null;
  const tokens = q ? tokenize(q.text) : [];
  const word = (tokens[secret]?.word ?? '').replace(/[^a-z]/g, '');
  const misses = [...guessed].filter((l) => !word.includes(l)).length;
  const won = !!word && [...word].every((l) => guessed.has(l));
  const lost = misses >= LIVES;

  const guess = (letter: string) => {
    if (won || lost || guessed.has(letter)) return;
    const next = new Set(guessed).add(letter);
    setGuessed(next);
    if ([...word].every((l) => next.has(l))) setWins((w) => w + 1);
  };
  const goTo = (p: number, list = order) => {
    setPos(p);
    setGuessed(new Set());
    setClue(false);
    if (p < list.length) setSecret(secretOf(questions[list[p]]));
  };
  const again = () => { const fresh = sample(range(questions.length), rounds); setOrder(fresh); setWins(0); goTo(0, fresh); };

  // Teclado físico en la PC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (/^[a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey) guess(e.key.toLowerCase()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!q) return <Finish score={wins} total={order.length} onAgain={again} />;

  return (
    <div className="dg-quiz">
      <p className="dg-progress">Palabra {pos + 1} de {order.length} · {wins} salvadas</p>
      <div className="dg-balloons" aria-label={`${LIVES - misses} globos`}>
        {range(LIVES).map((k) => <span key={k} className={k < LIVES - misses ? '' : 'popped'}>🎈</span>)}
        <span className={`dg-rex-float ${lost ? 'down' : ''}`}>🦖</span>
      </div>
      <p className="dg-big-q">
        {tokens.map((t, k) => (k === secret
          ? <span key={k} className="dg-slots">{[...t.raw].map((ch, c) => <span key={c} className={/[a-z]/i.test(ch) && !guessed.has(ch.toLowerCase()) && !lost ? 'slot' : 'slot shown'}>{/[a-z]/i.test(ch) && !guessed.has(ch.toLowerCase()) && !lost ? ' ' : ch}</span>)}</span>
          : <span key={k}>{t.raw}</span>))}
      </p>
      {clue ? <Es className="center">{q.translation || 'Sin traducción.'}</Es> : !won && !lost && (
        <button type="button" className="dg-link center" onClick={() => setClue(true)}><Lightbulb size={14} /> Ver la traducción como pista</button>
      )}
      {won || lost ? (
        <div className="dg-feedback">
          <p className={won ? 'dg-ok' : 'dg-bad'}>{won ? '¡Salvaste a Rex! 🎉' : `Se acabaron los globos. Era “${tokens[secret].raw}”.`}</p>
          <p className="dg-big-q"><Say text={q.text} /></p>
          <Speak text={q.text} />
          <button type="button" className="dg-btn primary" onClick={() => goTo(pos + 1)}>Siguiente</button>
        </div>
      ) : (
        <div className="dg-keyboard">
          {KEYS.map((row) => (
            <div key={row}>
              {[...row].map((l) => (
                <button key={l} type="button" disabled={guessed.has(l)} className={guessed.has(l) ? (word.includes(l) ? 'ok' : 'bad') : ''} onClick={() => guess(l)}>{l}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
