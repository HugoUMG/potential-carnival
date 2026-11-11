import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, Loader2, Play, X } from 'lucide-react';
import { getVerbs } from '../services/api';
import type { Verb } from '../types';
import { playSfx } from '../utils/sfx';
import { pick as pickOne, preloadAudio, range, sample, shuffle } from './util';
import { Finish, Notice, Speak } from './ui';
import { useRoom, useShared } from './roomState';
import { Fly } from './frog';
import './verbs.css';

/* Camaleón y Oruga (ADR-46): las 5 formas del verbo, aparte de los sets como Rana hambrienta
 * (/camaleon y /oruga). Camaleón entrena CUÁNDO va cada forma (una oración con hueco y las formas
 * del verbo volando); Oruga, ESCRIBIRLAS. Cada forma tiene siempre el mismo color en los dos juegos
 * (`FORMS`). Los verbos salen del banco del sitio (`verb_bank` → `/public/verbs`, 200 verbos con
 * varias oraciones por forma), escrito a mano y sin IA.
 * En sala por turnos, cada jugada (una mosca / un verbo) es un turno. Lo que se comparte lleva el
 * verbo entero, no su índice: quien mira no depende de haber bajado el mismo banco. */

/** Las 5 formas, en el orden de `Verb.forms` y `Verb.gaps` (el del backend: models.py `Verb`). */
const FORMS = [
  { id: 'base', name: 'Base', color: '#2F9E44', tip: 'Después de to, can, should, don’t, let’s… va la forma base.' },
  { id: 's', name: 'He / she / it', color: '#1C7ED6', tip: 'Presente con he, she o it: el verbo lleva -s.' },
  { id: 'past', name: 'Pasado', color: '#E8590C', tip: 'Acción terminada (yesterday, last…, ago): pasado simple.' },
  { id: 'pp', name: 'Participio', color: '#7048E8', tip: 'Después de have / has / had, o en voz pasiva (was made): participio.' },
  { id: 'ing', name: '-ing', color: '#D6336C', tip: 'Después de am / is / are, o de palabras como enjoy, keep, at, without: -ing.' },
] as const;

type Kind = '' | 'irr' | 'reg';
const KINDS: { id: Kind; name: string }[] = [{ id: '', name: 'Mixto' }, { id: 'irr', name: 'Irregulares' }, { id: 'reg', name: 'Regulares' }];
const pool = (verbs: Verb[], kind: Kind) => verbs.filter((v) => !kind || v.irregular === (kind === 'irr'));
const tint = (f: number) => ({ '--form': FORMS[f].color }) as CSSProperties;
/** Lo que viaja de un verbo en el estado de una partida. */
type Word = Pick<Verb, 'forms' | 'es'>;

/** El banco se baja una vez por visita y lo comparten los dos juegos. Si falla, la próxima vez reintenta. */
let bank: Promise<Verb[]> | null = null;
function useVerbs() {
  const [verbs, setVerbs] = useState<Verb[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    bank ??= getVerbs();
    bank.then((v) => { if (alive) setVerbs(v); }, (e: unknown) => {
      bank = null;
      if (alive) setError(e instanceof Error ? e.message : 'No se pudieron cargar los verbos');
    });
    return () => { alive = false; };
  }, []);
  return { verbs, error };
}

function Legend() {
  return (
    <div className="vb-legend" aria-label="Las cinco formas y su color">
      {FORMS.map((form, f) => <span key={form.id} style={tint(f)}>{form.name}</span>)}
    </div>
  );
}

/** Pantalla de inicio. `need` = verbos que gasta una partida: con menos de un tipo, no se puede elegir. */
function Start({ art, title, children, verbs, need, kind, onKind, go, onStart }: {
  art: ReactNode; title: string; children: ReactNode; verbs: Verb[] | null; need: number; kind: Kind; onKind: (k: Kind) => void; go: string; onStart: () => void;
}) {
  const ready = verbs !== null && pool(verbs, kind).length >= need;
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
          {KINDS.map((k) => (
            <button key={k.id || 'mixto'} type="button" className="fr-chip" aria-pressed={kind === k.id} onClick={() => onKind(k.id)}>
              {k.name}{verbs && ` (${pool(verbs, k.id).length})`}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="dg-btn primary big fr-go" disabled={!ready} onClick={onStart}><Play size={18} /> {go}</button>
      {!ready && (
        <p className="dg-muted center" aria-live="polite">
          {verbs ? 'Aún no hay suficientes verbos de este tipo.' : <><Loader2 size={13} className="fr-spin inline align-[-2px]" /> Cargando los verbos…</>}
        </p>
      )}
    </div>
  );
}

/** Las 5 formas de un verbo, cada una con su color. */
function Forms({ forms }: { forms: string[] }) {
  return <span className="vb-forms" lang="en">{forms.map((form, f) => <b key={f} style={tint(f)}>{form}</b>)}</span>;
}

// ── Camaleón ──────────────────────────────────────────────────────────────────

const SHOTS = 12;
/** Una jugada: el verbo, la forma que pide la oración y las moscas (sus formas, sin repetir). */
interface Shot extends Word { f: number; gap: string; flies: string[] }

/** Verbos distintos y las 5 formas repartidas parejo: nadie acierta diciendo siempre "pasado". */
function makeShots(verbs: Verb[], kind: Kind): Shot[] {
  const cycle = shuffle(range(FORMS.length));
  return sample(pool(verbs, kind), SHOTS).map(({ forms, es, gaps }, i) => {
    const f = cycle[i % cycle.length];
    return { forms, es, f, gap: pickOne(gaps[f]), flies: shuffle([...new Set(forms)]) };
  });
}

export function ChameleonGame() {
  const { canAct, endTurn, addPoint } = useRoom();
  const { verbs, error } = useVerbs();
  const [phase, setPhase] = useShared<'ready' | 'play' | 'over'>('phase', 'ready');
  const [kind, setKind] = useShared<Kind>('kind', '');
  const [shots, setShots] = useShared<Shot[]>('shots', []);
  const [pos, setPos] = useShared('pos', 0);
  const [pick, setPick] = useShared<string | null>('pick', null);
  const [score, setScore] = useShared('score', 0);
  const [missed, setMissed] = useShared<number[]>('missed', []);

  const start = () => {
    if (!verbs) return;
    setShots(makeShots(verbs, kind)); setPos(0); setPick(null); setScore(0); setMissed([]); setPhase('play');
  };

  useEffect(() => preloadAudio(shots.map((s) => s.gap.replace('___', s.forms[s.f]))), [shots]);
  const shot = shots[pos];
  if (phase === 'ready' || !shot) {
    if (error) return <Notice>{error}</Notice>;
    return (
      <Start art={<Chameleon mood="idle" />} title="¡Dale al camaleón la forma correcta!" verbs={verbs} need={SHOTS} kind={kind} onKind={setKind} go="¡A cazar!" onStart={start}>
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
                const { forms, f, gap } = shots[p];
                const [before, after] = gap.split('___');
                return (
                  <li key={p}>
                    <span lang="en">{before}<b style={tint(f)}>{forms[f]}</b>{after}</span>
                    <em style={tint(f)}>{FORMS[f].name}</em>
                    <Speak text={gap.replace('___', forms[f])} />
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

  const right = shot.forms[shot.f];
  const ok = pick === right;
  const [before, after] = shot.gap.split('___');

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
      <p className="vb-verb"><b lang="en">to {shot.forms[0]}</b> · {shot.es}</p>

      {pick !== null && (
        <div className={`vb-tip ${ok ? 'ok' : 'bad'}`} aria-live="polite">
          <p>{ok ? <Check size={17} /> : <X size={17} />} <b style={tint(shot.f)}>{FORMS[shot.f].name}</b> {FORMS[shot.f].tip}</p>
          <Forms forms={shot.forms} />
          <div className="dg-row center">
            <Speak text={shot.gap.replace('___', right)} label="Escuchar la oración" />
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
  const { verbs, error } = useVerbs();
  const [phase, setPhase] = useShared<'ready' | 'play' | 'over'>('phase', 'ready');
  const [kind, setKind] = useShared<Kind>('kind', '');
  const [order, setOrder] = useShared<Word[]>('order', []);
  const [pos, setPos] = useShared('pos', 0);
  const [typed, setTyped] = useShared<string[]>('typed', BLANK);
  const [marks, setMarks] = useShared<boolean[] | null>('marks', null);
  const [score, setScore] = useShared('score', 0);
  const [missed, setMissed] = useShared<Word[]>('missed', []);

  const start = () => {
    if (!verbs) return;
    setOrder(sample(pool(verbs, kind), CRAWL).map(({ forms, es }) => ({ forms, es })));
    setPos(0); setTyped(BLANK); setMarks(null); setScore(0); setMissed([]); setPhase('play');
  };

  useEffect(() => preloadAudio(order.map((w) => w.forms.join(', '))), [order]);
  const verb = order[pos];
  if (phase === 'ready' || !verb) {
    if (error) return <Notice>{error}</Notice>;
    return (
      <Start art={<Butterfly />} title="¡Convierte la oruga en mariposa!" verbs={verbs} need={CRAWL} kind={kind} onKind={setKind} go="¡A escribir!" onStart={start}>
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
              {missed.map(({ forms, es }) => (
                <li key={forms[0]}><Forms forms={forms} /><em>{es}</em><Speak text={forms.join(', ')} /></li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="dg-btn" onClick={() => setPhase('ready')}>Cambiar verbos</button>
      </Finish>
    );
  }

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
    if (hits < m.length) setMissed([...missed, verb]);
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
          <Forms forms={verb.forms} />
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
