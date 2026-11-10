import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { ArrowRight, Check, Play, X } from 'lucide-react';
import { playSfx } from '../utils/sfx';
import { range, sample, shuffle } from './util';
import { Finish, Speak } from './ui';
import { useRoom, useShared } from './roomState';
import { Fly } from './frog';
import { FORMS, VERBS } from './verbData';
import './verbs.css';

/* Camaleón y Oruga: las 5 formas del verbo (base, he/she/it, pasado, participio, -ing), aparte de
 * los sets como Rana hambrienta (/camaleon y /oruga). Camaleón entrena CUÁNDO va cada forma (una
 * oración con hueco y las formas del verbo volando); Oruga, ESCRIBIRLAS. Cada forma tiene siempre
 * el mismo color en los dos juegos (`FORMS`). El banco es fijo (`verbData.ts`): sin IA ni backend.
 * En sala por turnos, cada jugada (una mosca / un verbo) es un turno. */

type Kind = '' | 'irr' | 'reg';
const KINDS: { id: Kind; name: string }[] = [{ id: '', name: 'Mixto' }, { id: 'irr', name: 'Irregulares' }, { id: 'reg', name: 'Regulares' }];
const pool = (kind: Kind) => range(VERBS.length).filter((i) => !kind || VERBS[i].irregular === (kind === 'irr'));
const tint = (f: number) => ({ '--form': FORMS[f].color }) as CSSProperties;

function Legend() {
  return (
    <div className="vb-legend" aria-label="Las cinco formas y su color">
      {FORMS.map((form, f) => <span key={form.id} style={tint(f)}>{form.name}</span>)}
    </div>
  );
}

function Start({ art, title, children, kind, onKind, go, onStart }: { art: ReactNode; title: string; children: ReactNode; kind: Kind; onKind: (k: Kind) => void; go: string; onStart: () => void }) {
  return (
    <div className="fr-start">
      <div className="fr-hero vb-hero">
        <div className="vb-hero-art">{art}</div>
        <div className="fr-hero-text"><h2>{title}</h2><p>{children}</p></div>
      </div>
      <div className="fr-pick">
        <p className="fr-pick-t">Cada forma tiene su color</p>
        <Legend />
      </div>
      <div className="fr-pick">
        <p className="fr-pick-t">Verbos</p>
        <div className="fr-chips">
          {KINDS.map((k) => <button key={k.id || 'mixto'} type="button" className="fr-chip" aria-pressed={kind === k.id} onClick={() => onKind(k.id)}>{k.name} ({pool(k.id).length})</button>)}
        </div>
      </div>
      <button type="button" className="dg-btn primary big fr-go" onClick={onStart}><Play size={18} /> {go}</button>
    </div>
  );
}

/** Las 5 formas de un verbo, cada una con su color. */
function Forms({ v }: { v: number }) {
  return <span className="vb-forms" lang="en">{VERBS[v].forms.map((form, f) => <b key={f} style={tint(f)}>{form}</b>)}</span>;
}

// ── Camaleón ──────────────────────────────────────────────────────────────────

const SHOTS = 12;
/** Una jugada: verbo, forma que pide la oración y las moscas (las formas del verbo, sin repetir). */
interface Shot { v: number; f: number; flies: string[] }

/** Verbos distintos y las 5 formas repartidas parejo: nadie acierta diciendo siempre "pasado". */
function makeShots(kind: Kind): Shot[] {
  const cycle = shuffle(range(FORMS.length));
  return sample(pool(kind), SHOTS).map((v, i) => ({ v, f: cycle[i % cycle.length], flies: shuffle([...new Set(VERBS[v].forms)]) }));
}

export function ChameleonGame() {
  const { canAct, endTurn, addPoint } = useRoom();
  const [phase, setPhase] = useShared<'ready' | 'play' | 'over'>('phase', 'ready');
  const [kind, setKind] = useShared<Kind>('kind', '');
  const [shots, setShots] = useShared<Shot[]>('shots', []);
  const [pos, setPos] = useShared('pos', 0);
  const [pick, setPick] = useShared<string | null>('pick', null);
  const [score, setScore] = useShared('score', 0);
  const [missed, setMissed] = useShared<number[]>('missed', []);

  const start = () => { setShots(makeShots(kind)); setPos(0); setPick(null); setScore(0); setMissed([]); setPhase('play'); };

  const shot = shots[pos];
  if (phase === 'ready' || !shot) {
    return (
      <Start art={<Chameleon mood="idle" />} title="¡Dale al camaleón la forma correcta!" kind={kind} onKind={setKind} go="¡A cazar!" onStart={start}>
        A la oración le falta el verbo y las moscas traen sus formas. Atrapa la <b>única</b> que encaja: si aciertas, el camaleón se pinta del color de esa forma.
      </Start>
    );
  }

  if (phase === 'over') {
    return (
      <Finish score={score} total={shots.length} onAgain={start}>
        {missed.length > 0 && (
          <div className="fr-review vb-review">
            <p>Repasa estas oraciones ({missed.length})</p>
            <ul>
              {missed.map((p) => {
                const { v, f } = shots[p];
                const [before, after] = VERBS[v].gaps[f].split('___');
                return (
                  <li key={p}>
                    <span lang="en">{before}<b style={tint(f)}>{VERBS[v].forms[f]}</b>{after}</span>
                    <em style={tint(f)}>{FORMS[f].name}</em>
                    <Speak text={VERBS[v].gaps[f].replace('___', VERBS[v].forms[f])} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <button type="button" className="dg-btn" onClick={() => setPhase('ready')}>Cambiar verbos</button>
      </Finish>
    );
  }

  const verb = VERBS[shot.v];
  const right = verb.forms[shot.f];
  const ok = pick === right;
  const [before, after] = verb.gaps[shot.f].split('___');

  const answer = (text: string) => {
    if (!canAct || pick !== null) return;
    setPick(text);
    if (text === right) { setScore(score + 1); addPoint(); } else setMissed([...missed, pos]);
    playSfx(text === right ? 'ok' : 'miss');
  };
  const next = () => {
    if (pos + 1 >= shots.length) { setPhase('over'); playSfx('win'); } else setPos(pos + 1);
    setPick(null);
    endTurn();
  };

  return (
    <div className="vb-game">
      <p className="dg-progress">Mosca {pos + 1} de {shots.length} · {score} atrapadas</p>
      <div className={`vb-scene ${pick === null ? '' : ok ? 'is-ok' : 'is-bad'}`} style={ok ? tint(shot.f) : undefined}>
        <div className="vb-flies">
          {shot.flies.map((text, i) => (
            <button key={`${pos}-${text}`} type="button" disabled={pick !== null} onClick={() => answer(text)} style={{ '--d': `${-i * 0.37}s` } as CSSProperties}
              className={`vb-fly ${pick === null ? '' : text === pick ? (ok ? 'eaten' : 'bad') : text === right ? 'reveal' : 'away'}`}>
              <span className="fr-fly-bob"><Fly /></span>
              <span className="fr-fly-word" lang="en">{text}</span>
            </button>
          ))}
        </div>
        <div className="vb-cham"><Chameleon mood={pick === null ? 'idle' : ok ? 'happy' : 'sad'} /></div>
      </div>

      <p className="vb-sentence" lang="en">
        {before}<span className={`vb-gap ${pick === null ? '' : 'done'}`} style={pick === null ? undefined : tint(shot.f)}>{pick === null ? '' : right}</span>{after}
      </p>
      <p className="vb-verb"><b lang="en">to {verb.forms[0]}</b> · {verb.es}</p>

      {pick !== null && (
        <div className={`vb-tip ${ok ? 'ok' : 'bad'}`} aria-live="polite">
          <p>{ok ? <Check size={17} /> : <X size={17} />} <b style={tint(shot.f)}>{FORMS[shot.f].name}</b> {FORMS[shot.f].tip}</p>
          <Forms v={shot.v} />
          <div className="dg-row center">
            <Speak text={verb.gaps[shot.f].replace('___', right)} label="Escuchar la oración" />
            <button type="button" className="dg-btn primary" onClick={next}>{pos + 1 >= shots.length ? 'Ver resultado' : 'Siguiente'} <ArrowRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** El camaleón en su rama. Contento, toma el color de la forma (`--form` del contenedor) y saca la lengua. */
function Chameleon({ mood }: { mood: 'idle' | 'happy' | 'sad' }) {
  return (
    <svg className={`vb-cham-svg ${mood}`} viewBox="0 0 240 130" aria-hidden="true">
      <path className="vb-branch" d="M4 108 Q120 96 236 110" />
      <path className="vb-leaf" d="M212 104 q14 -22 26 -8 q-10 14 -26 8 z M30 104 q-18 -16 -4 -26 q12 10 4 26 z" />
      <path className="vb-tail" d="M64 86 q-36 -8 -38 14 q-1 18 17 16 q13 -2 11 -12 q-2 -8 -9 -6" />
      <path className="vb-leg" d="M92 96 l-5 10 M132 96 l5 9" />
      <ellipse className="vb-body" cx="112" cy="76" rx="54" ry="27" />
      <path className="vb-stripe" d="M88 56 q-6 20 2 40 M112 51 q-6 25 2 50 M136 55 q-6 21 2 41" />
      <path className="vb-body" d="M150 52 L174 24 L190 56 Z" />
      <ellipse className="vb-body" cx="168" cy="68" rx="31" ry="23" />
      <circle className="vb-eye" cx="174" cy="63" r="12" />
      <circle className="vb-pupil" cx={mood === 'happy' ? 177 : 175} cy={mood === 'sad' ? 67 : mood === 'happy' ? 59 : 63} r="4.6" />
      {mood === 'sad' && <path className="vb-lid" d="M162 63 a12 12 0 0 1 24 0 z" />}
      <path className="vb-mouth" d={mood === 'sad' ? 'M180 82 Q190 78 197 82' : 'M180 80 Q190 84 197 77'} />
      {mood === 'happy' && <path className="vb-tongue" d="M197 77 Q214 60 220 14" pathLength={1} />}
    </svg>
  );
}

// ── Oruga ─────────────────────────────────────────────────────────────────────

const CRAWL = 8;
const BLANK = ['', '', '', ''];
const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function CaterpillarGame() {
  const { canAct, endTurn, addPoint } = useRoom();
  const [phase, setPhase] = useShared<'ready' | 'play' | 'over'>('phase', 'ready');
  const [kind, setKind] = useShared<Kind>('kind', '');
  const [order, setOrder] = useShared<number[]>('order', []);
  const [pos, setPos] = useShared('pos', 0);
  const [typed, setTyped] = useShared<string[]>('typed', BLANK);
  const [marks, setMarks] = useShared<boolean[] | null>('marks', null);
  const [score, setScore] = useShared('score', 0);
  const [missed, setMissed] = useShared<number[]>('missed', []);

  const start = () => { setOrder(sample(pool(kind), CRAWL)); setPos(0); setTyped(BLANK); setMarks(null); setScore(0); setMissed([]); setPhase('play'); };

  if (phase === 'ready' || order[pos] === undefined) {
    return (
      <Start art={<Butterfly />} title="¡Convierte la oruga en mariposa!" kind={kind} onKind={setKind} go="¡A escribir!" onStart={start}>
        La cabeza de la oruga trae el verbo. Escribe sus otras <b>cuatro formas</b>, una en cada parte del cuerpo. Si las cuatro están bien, la oruga se vuelve mariposa.
      </Start>
    );
  }

  if (phase === 'over') {
    return (
      <Finish score={score} total={order.length * 4} onAgain={start}>
        <p className="dg-muted center">Formas bien escritas, de {order.length} verbos.</p>
        {missed.length > 0 && (
          <div className="fr-review vb-review">
            <p>Repasa estos verbos ({missed.length})</p>
            <ul>
              {missed.map((v) => (
                <li key={v}><Forms v={v} /><em>{VERBS[v].es}</em><Speak text={VERBS[v].forms.join(', ')} /></li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="dg-btn" onClick={() => setPhase('ready')}>Cambiar verbos</button>
      </Finish>
    );
  }

  const v = order[pos];
  const verb = VERBS[v];
  const all = marks?.every(Boolean) ?? false;

  const check = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canAct || marks) return;
    // Enter con un hueco vacío salta a ese hueco en vez de calificar a medias.
    const empty = [...e.currentTarget.querySelectorAll('input')].find((input) => !input.value.trim());
    if (empty) { empty.focus(); return; }
    const m = typed.map((text, i) => norm(text) === verb.forms[i + 1]);
    const hits = m.filter(Boolean).length;
    setMarks(m);
    setScore(score + hits);
    if (hits) addPoint(hits);
    if (hits < m.length) setMissed([...missed, v]);
    playSfx(hits === m.length ? 'win' : hits ? 'ok' : 'miss');
  };
  const next = () => {
    if (pos + 1 >= order.length) setPhase('over'); else setPos(pos + 1);
    setTyped(BLANK);
    setMarks(null);
    endTurn();
  };

  return (
    <form className="vb-game" onSubmit={check}>
      <p className="dg-progress">Verbo {pos + 1} de {order.length} · {score} formas bien</p>
      {all && <div className="vb-fly-away"><Butterfly /></div>}
      <div className={`vb-worm ${all ? 'is-ok' : ''}`}>
        <div className="vb-head" style={tint(0)}>
          <svg viewBox="0 0 60 26" aria-hidden="true"><path d="M20 24 Q14 8 8 4 M40 24 Q46 8 52 4" /><circle cx="8" cy="4" r="3.5" /><circle cx="52" cy="4" r="3.5" /></svg>
          <b lang="en">{verb.forms[0]}</b>
          <span>{verb.es}</span>
        </div>
        {typed.map((text, i) => (
          <label key={`${pos}-${i}`} className={`vb-seg ${marks ? (marks[i] ? 'ok' : 'bad') : ''}`} style={tint(i + 1)}>
            <span>{FORMS[i + 1].name}</span>
            <input value={text} disabled={marks !== null} lang="en" autoFocus={i === 0} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
              enterKeyHint={i === 3 ? 'done' : 'next'} onChange={(e) => setTyped(typed.map((t, k) => (k === i ? e.target.value : t)))} />
            {marks && !marks[i] && <b lang="en">{verb.forms[i + 1]}</b>}
          </label>
        ))}
      </div>

      {!marks ? (
        <button type="submit" className="dg-btn primary fr-go">Revisar</button>
      ) : (
        <div className={`vb-tip ${all ? 'ok' : 'bad'}`} aria-live="polite">
          <p>{all ? <><Check size={17} /> ¡Mariposa! Las cuatro formas están bien.</> : <><X size={17} /> {marks.filter(Boolean).length} de 4. En rojo, la forma correcta.</>}</p>
          <Forms v={v} />
          <div className="dg-row center">
            <Speak text={verb.forms.join(', ')} label="Escuchar las cinco formas" />
            <button type="button" className="dg-btn primary" onClick={next}>{pos + 1 >= order.length ? 'Ver resultado' : 'Siguiente'} <ArrowRight size={16} /></button>
          </div>
        </div>
      )}
    </form>
  );
}

/** La mariposa: un ala por cada forma escrita, con su color. */
function Butterfly() {
  return (
    <svg className="vb-butterfly" viewBox="0 0 120 100" aria-hidden="true">
      <g className="vb-wings">
        <ellipse cx="34" cy="36" rx="30" ry="24" fill={FORMS[1].color} />
        <ellipse cx="86" cy="36" rx="30" ry="24" fill={FORMS[2].color} />
        <ellipse cx="40" cy="70" rx="22" ry="18" fill={FORMS[3].color} />
        <ellipse cx="80" cy="70" rx="22" ry="18" fill={FORMS[4].color} />
      </g>
      <path d="M57 26 Q50 10 42 8 M63 26 Q70 10 78 8" />
      <ellipse cx="60" cy="52" rx="6.5" ry="30" fill={FORMS[0].color} />
    </svg>
  );
}
