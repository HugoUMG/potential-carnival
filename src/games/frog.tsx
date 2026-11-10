import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Bug, Flag, Flame, Loader2, Play, RotateCcw, Sparkles, Timer, Trophy, Volume2 } from 'lucide-react';
import { getFrogExample, getFrogWords } from '../services/api';
import type { FrogCategory, FrogExample, FrogLevel, VocabWord } from '../types';
import { playSfx } from '../utils/sfx';
import { playAudio, range, sample, shuffle, speak } from './util';
import { Notice } from './ui';
import { useRoom, useShared } from './roomState';

/* Rana hambrienta (ADR-44): vocabulario contrarreloj, aparte de los sets de preguntas (/rana). La
 * rana dice una palabra y el alumno le da la mosca con su traducción. Las palabras salen del banco
 * del sitio (`frog_words`, A1 a C1): la IA genera cada una UNA vez y otra llamada revisa que ninguna
 * mosca mala sea también una traducción válida (`generate_frog_words` en ai.py).
 * En sala, cada turno es una partida entera: el reloj corre en cada navegador a partir de `clock`. */

type Lang = 'es' | 'en'; // idioma de la palabra que dice la rana
type Diff = 1 | 2 | 3;
type Mood = 'idle' | 'happy' | 'sick' | 'worried' | 'sad';

/** Moscas por ronda y segundos que da o quita cada una. Cada palabra del banco trae al menos
 *  `FROG_MIN_WRONG` (ai.py) moscas malas = las de Difícil: si cambia `flies`, cambia allí (regla 50). */
const DIFFS: Record<Diff, { name: string; flies: number; start: number; gain: number; loss: number }> = {
  1: { name: 'Fácil', flies: 3, start: 30, gain: 3, loss: 3 },
  2: { name: 'Medio', flies: 4, start: 30, gain: 2.5, loss: 4 },
  3: { name: 'Difícil', flies: 6, start: 25, gain: 2, loss: 5 },
};
const CEFR: { id: FrogLevel; name: string }[] = [
  { id: 'A1', name: 'Principiante' }, { id: 'A2', name: 'Básico' }, { id: 'B1', name: 'Intermedio' },
  { id: 'B2', name: 'Intermedio alto' }, { id: 'C1', name: 'Avanzado' },
];
/** Los tipos de palabra del banco (`FROG_CATEGORIES` en ai.py); "" = todos mezclados. */
const CATS: { id: FrogCategory | ''; name: string }[] = [
  { id: '', name: 'Mixto' }, { id: 'sustantivo', name: 'Sustantivos' }, { id: 'verbo', name: 'Verbos' },
  { id: 'adjetivo', name: 'Adjetivos' }, { id: 'adverbio', name: 'Adverbios' },
  { id: 'preposicion', name: 'Preposiciones' }, { id: 'conector', name: 'Conectores' },
];
const MIN_WORDS = 6;       // con menos, la cola repetiría la misma palabra enseguida
const MAX_MS = 60_000;     // el reloj no acumula más de un minuto: siempre hay prisa
const WORRY_MS = 8_000;
const SHOW_OK_MS = 600;    // con el reloj parado: se ve a la rana comer
const SHOW_BAD_MS = 1300;  // un poco más: se ve cuál era la buena

/** Cada 10 aciertos la mosca buena da un cuarto de segundo menos (mínimo 1 s): quien sabe mucho
 *  no se queda jugando para siempre. */
const gainMs = (diff: Diff, hits: number) => Math.max(1, DIFFS[diff].gain - Math.floor(hits / 10) * 0.25) * 1000;

/** Lugares de las moscas (% del estanque) alrededor de la rana y del cartel con la palabra. */
const SPOTS: [number, number][] = [[50, 9], [17, 27], [83, 27], [17, 70], [83, 70], [50, 85]];
const LAYOUTS: Record<number, number[][]> = { 3: [[0, 3, 4], [1, 2, 5]], 4: [[1, 2, 3, 4], [0, 1, 4, 5], [0, 2, 3, 5]], 6: [[0, 1, 2, 3, 4, 5]] };
const MOUTH: [number, number] = [50, 42.6];

interface Cfg { lang: Lang; level: FrogLevel; cat: FrogCategory | ''; diff: Diff }
interface Round { k: number; turn: number; word: string; pos: string; en: string; es: string; flies: string[]; spots: number[]; answer: number }
/** `left` = ms que quedaban al escribirlo; cada navegador cuenta desde que le llega un `n` nuevo. */
interface Clock { left: number; n: number; run: boolean }
/** Una palabra para el repaso final: [en, es, tipo de palabra]. */
type Seen = [string, string, string];
/** `missed` / `hits` = cada palabra fallada / acertada, sin repetir (`hits` es opcional: una sala abierta antes no lo trae). */
interface Stats { ok: number; bad: number; streak: number; best: number; ms: number; missed: Seen[]; hits?: Seen[] }
interface Pick { fly: number; ok: boolean; delta: number }

const EMPTY: Stats = { ok: 0, bad: 0, streak: 0, best: 0, ms: 0, missed: [], hits: [] };

function makeRound(words: VocabWord[], k: number, { lang, diff }: Cfg, turn: number): Round {
  // `% length`: en sala, quien recibe el control a media partida pudo bajar el banco ya crecido.
  const w = words[k % words.length];
  const right = lang === 'es' ? w.en : w.es;
  const flies = shuffle([right, ...sample(lang === 'es' ? w.wrong_en : w.wrong_es, DIFFS[diff].flies - 1)]);
  const layouts = LAYOUTS[flies.length] ?? LAYOUTS[6];
  return { k, turn, word: lang === 'es' ? w.es : w.en, pos: w.pos, en: w.en, es: w.es, flies, spots: layouts[Math.floor(Math.random() * layouts.length)], answer: flies.indexOf(right) };
}

/** Siguiente palabra: la cola barajada, sin repetir la última; la que se falló vuelve tras dos. */
function nextWord(queue: number[], n: number, last: number, ok: boolean): [number, number[]] {
  let q = queue.filter((k) => k !== last && k < n);
  if (!q.length) q = shuffle(range(n).filter((k) => k !== last));
  if (!ok) q = [...q.slice(0, 2), last, ...q.slice(2)];
  return [q[0], q.slice(1)];
}

const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
};
const secs = (ms: number) => String(+(Math.abs(ms) / 1000).toFixed(2));
const catName = (cat: Cfg['cat']) => CATS.find((c) => c.id === cat)?.name ?? 'Mixto';

const bestKey = ({ lang, level, cat, diff }: Cfg) => `dg-rana-${lang}-${level}-${cat || 'mixto'}-${diff}`;
function readBest(key: string): number {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

interface Pool { key: string; words: VocabWord[]; generating: boolean }

/** Palabras del banco para el nivel y tipo elegidos. Si aún hay pocas y la IA está sumando una
 *  tanda, vuelve a preguntar cada 4 s. Durante una partida no se toca: la cola guarda índices. */
function useWords(level: FrogLevel, cat: Cfg['cat'], playing: boolean) {
  const key = `${level}|${cat}`;
  const [pool, setPool] = useState<Pool | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (playing) return;
    let alive = true;
    let timer = 0;
    let tries = 0;
    const load = () => getFrogWords(level, cat).then((p) => {
      if (!alive) return;
      setPool({ key, ...p });
      setError('');
      if (p.generating && p.words.length < MIN_WORDS && tries++ < 45) timer = window.setTimeout(load, 4000);
    }, (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'No se pudo cargar el vocabulario'); });
    load();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [key, level, cat, playing]);
  return { pool: pool?.key === key ? pool : null, error };
}

/** Milisegundos que le quedan a la rana, contados en este navegador desde el último `clock`. */
function useLeft(clock: Clock): number {
  const [mark, setMark] = useState({ n: -1, at: 0 });
  const [now, setNow] = useState(0);
  const at = mark.n === clock.n ? mark.at : Date.now();
  if (mark.n !== clock.n) setMark({ n: clock.n, at });
  useEffect(() => {
    if (!clock.run) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [clock.run, clock.n]);
  return clock.run ? Math.max(0, clock.left - Math.max(0, now - at)) : clock.left;
}

export function FrogGame() {
  const { room, canAct, endTurn, addPoint } = useRoom();
  const [phase, setPhase] = useShared<'ready' | 'play' | 'over'>('phase', 'ready');
  const [cfg, setCfg] = useShared<Cfg>('cfg', { lang: 'es', level: 'A1', cat: '', diff: 1 });
  const [round, setRound] = useShared<Round | null>('round', null);
  const [queue, setQueue] = useShared<number[]>('queue', []);
  const [clock, setClock] = useShared<Clock>('clock', { left: 0, n: 0, run: false });
  const [stats, setStats] = useShared<Stats>('stats', EMPTY);
  const [pick, setPick] = useShared<Pick | null>('pick', null);
  const [record, setRecord] = useState(false); // solo de este navegador: el récord es personal
  const [look, setLook] = useState<number | null>(null);
  const left = useLeft(clock);
  const { pool, error } = useWords(cfg.level, cfg.cat, phase === 'play');
  const words = pool?.words;

  const start = () => {
    if (!canAct || !words || words.length < MIN_WORDS) return;
    const [k, ...rest] = shuffle(range(words.length));
    setQueue(rest);
    setRound(makeRound(words, k, cfg, 1));
    setStats(EMPTY);
    setPick(null);
    setRecord(false);
    setClock({ left: DIFFS[cfg.diff].start * 1000, n: clock.n + 1, run: true });
    setPhase('play');
  };

  /** Fin de la partida. `spent` = lo que se jugó de la ronda en curso. */
  const finish = (spent: number) => {
    if (!canAct) return;
    const ms = stats.ms + spent;
    setStats({ ...stats, ms });
    setPick(null);
    setClock({ left: 0, n: clock.n + 1, run: false });
    setPhase('over');
    const key = bestKey(cfg);
    const beat = !room && Math.floor(ms / 1000) > Math.floor(readBest(key) / 1000); // en segundos: "0 s" no es récord
    if (beat) {
      try { localStorage.setItem(key, String(ms)); } catch { /* sin almacenamiento: el récord dura la visita */ }
    }
    setRecord(beat);
    playSfx(beat ? 'win' : 'slide');
    addPoint(Math.floor(ms / 1000)); // los mismos segundos que enseña `clockText`
    endTurn();
  };

  const answer = (i: number) => {
    if (!canAct || !round || pick || phase !== 'play') return;
    const ok = i === round.answer;
    const delta = ok ? gainMs(cfg.diff, stats.ok) : -DIFFS[cfg.diff].loss * 1000;
    const seen: Seen = [round.en, round.es, round.pos];
    const add = (list: Seen[], yes: boolean) => (yes && !list.some(([en]) => en === round.en) ? [...list, seen] : list);
    setStats({
      ok: stats.ok + (ok ? 1 : 0), bad: stats.bad + (ok ? 0 : 1), streak: ok ? stats.streak + 1 : 0,
      best: Math.max(stats.best, ok ? stats.streak + 1 : 0), ms: stats.ms + (clock.left - left),
      missed: add(stats.missed, !ok), hits: add(stats.hits ?? [], ok),
    });
    setClock({ left: Math.min(MAX_MS, Math.max(0, left + delta)), n: clock.n + 1, run: false });
    setPick({ fly: i, ok, delta });
    playSfx(ok ? 'ok' : 'miss');
  };

  const advance = () => {
    if (!canAct || !round || !words?.length) return;
    if (clock.left <= 0) { finish(0); return; } // el castigo dejó el reloj en 0
    const [k, rest] = nextWord(queue, words.length, round.k, Boolean(pick?.ok));
    setQueue(rest);
    setRound(makeRound(words, k, cfg, round.turn + 1));
    setPick(null);
    setLook(null);
    setClock({ left: clock.left, n: clock.n + 1, run: true });
  };

  // Los temporizadores leen siempre la última versión (estado de sala incluido).
  const latest = useRef({ advance, finish });
  useLayoutEffect(() => { latest.current = { advance, finish }; });

  const pickKey = pick ? clock.n : 0;
  const pickOk = Boolean(pick?.ok);
  useEffect(() => {
    if (!pickKey) return;
    const t = window.setTimeout(() => latest.current.advance(), pickOk ? SHOW_OK_MS : SHOW_BAD_MS);
    return () => window.clearTimeout(t);
  }, [pickKey, pickOk]);

  const timeUp = phase === 'play' && clock.run && left <= 0;
  const full = clock.left;
  useEffect(() => { if (timeUp) latest.current.finish(full); }, [timeUp, full]);

  // Al empezar, el estanque entero a la vista (en el celular queda debajo de la explicación).
  const gameRef = useRef<HTMLDivElement>(null);
  const playing = phase === 'play';
  useEffect(() => { if (playing) gameRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [playing]);

  const second = Math.ceil(left / 1000);
  const ticking = phase === 'play' && clock.run && second <= 5 && second > 0;
  useEffect(() => { if (ticking) playSfx('tick'); }, [ticking, second]);

  if (error) return <Notice>{error}</Notice>;

  if (phase === 'ready' || !round) {
    return <FrogStart pool={pool} cfg={cfg} onCfg={setCfg} onStart={start} />;
  }

  if (phase === 'over') {
    const best = readBest(bestKey(cfg));
    return (
      <div className="fr-over">
        <div className="fr-over-frog"><Frog mood={record ? 'happy' : 'sad'} /></div>
        <p className="fr-over-k">La rana aguantó</p>
        <p className="fr-over-time">{clockText(stats.ms)}</p>
        {record ? (
          <p className="fr-record"><Trophy size={18} /> ¡Nuevo récord!</p>
        ) : !room && best >= 1000 && <p className="dg-muted">Tu récord en {cfg.level} · {catName(cfg.cat)} · {DIFFS[cfg.diff].name}: <b>{clockText(best)}</b></p>}
        <div className="fr-over-stats">
          <span><b>{stats.ok}</b> moscas buenas</span>
          <span><b>{stats.bad}</b> moscas malas</span>
          <span><b>{stats.best}</b> mejor racha</span>
        </div>
        <FrogReview missed={stats.missed} hits={stats.hits ?? []} />
        <div className="dg-row center wrap">
          <button type="button" className="dg-btn primary big" onClick={start} disabled={!words}><RotateCcw size={18} /> Jugar otra vez</button>
          <button type="button" className="dg-btn" onClick={() => setPhase('ready')}>Cambiar modo</button>
        </div>
      </div>
    );
  }

  const mood: Mood = pick ? (pick.ok ? 'happy' : 'sick') : left < WORRY_MS ? 'worried' : 'idle';
  const lookAt = pick ? pick.fly : look;
  const eye: [number, number] = lookAt === null ? [0, 0.3]
    : [(SPOTS[round.spots[lookAt]][0] - 50) / 34, (SPOTS[round.spots[lookAt]][1] - MOUTH[1]) / 40];
  const survived = stats.ms + (clock.run ? clock.left - left : 0);
  const tone = left >= 15_000 ? 'ok' : left >= WORRY_MS ? 'warn' : 'low';
  const right = round.flies[round.answer];
  const target = pick ? SPOTS[round.spots[pick.fly]] : null;

  return (
    <div className="fr-game" ref={gameRef}>
      <div className="fr-hud">
        <div className={`fr-time ${tone}`}>
          <Timer size={18} />
          <b>{(left / 1000).toFixed(1)}</b><small>s</small>
          {pick && <span key={clock.n} className={`fr-delta ${pick.ok ? 'up' : 'down'}`}>{pick.ok ? '+' : '−'}{secs(pick.delta)} s</span>}
        </div>
        <div className="fr-stats">
          <span title="Tiempo que lleva la rana">Aguantas <b>{clockText(survived)}</b></span>
          <span title="Moscas buenas"><Bug size={15} /> <b>{stats.ok}</b></span>
          {stats.streak >= 3 && <span className="fr-streak"><Flame size={14} /> {stats.streak}</span>}
        </div>
        <button type="button" className="fr-end" onClick={() => finish(clock.run ? clock.left - left : 0)}><Flag size={14} /> Terminar</button>
      </div>
      <div className="fr-bar" aria-hidden="true"><span className={tone} style={{ width: `${(left / MAX_MS) * 100}%` }} /></div>

      <div className={`fr-pond ${pick ? (pick.ok ? 'is-ok' : 'is-bad') : ''}`}>
        <PondDecor />
        <div className="fr-frog"><Frog mood={mood} look={eye} /></div>
        <div key={round.turn} className="fr-card">
          <span className="fr-card-lang">{cfg.lang === 'es' ? 'ES' : 'EN'}</span>
          <b lang={cfg.lang}>{round.word}</b>
          {round.pos && <small>{round.pos}</small>}
          {cfg.lang === 'en' && (
            <button type="button" className="fr-say" onClick={() => speak(round.word)} aria-label={`Escuchar ${round.word}`}><Volume2 size={16} /></button>
          )}
        </div>
        {target && (
          <svg key={`t${clock.n}`} className="fr-tongue" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1={MOUTH[0]} y1={MOUTH[1]} x2={target[0]} y2={target[1]} pathLength={1} className="fr-tongue-edge" />
            <line x1={MOUTH[0]} y1={MOUTH[1]} x2={target[0]} y2={target[1]} pathLength={1} />
          </svg>
        )}
        {round.flies.map((text, i) => {
          const [x, y] = SPOTS[round.spots[i]];
          const eaten = pick?.fly === i;
          const state = eaten ? `eaten ${pick.ok ? 'good' : 'bad'}` : pick && !pick.ok && i === round.answer ? 'reveal' : pick ? 'away' : '';
          return (
            <button key={`${round.turn}-${i}`} type="button" className={`fr-fly ${state}`} disabled={Boolean(pick)}
              style={{ left: `${eaten ? MOUTH[0] : x}%`, top: `${eaten ? MOUTH[1] : y}%`, '--d': `${-i * 0.37}s`, '--i': i } as CSSProperties}
              onClick={() => answer(i)} onPointerEnter={() => setLook(i)} onPointerLeave={() => setLook(null)} onFocus={() => setLook(i)}>
              <span className="fr-fly-bob"><Fly /></span>
              <span className="fr-fly-word" lang={cfg.lang === 'es' ? 'en' : 'es'}>{text}</span>
            </button>
          );
        })}
      </div>

      <p className={`fr-caption ${pick && !pick.ok ? 'bad' : ''}`} aria-live="polite">
        {pick ? (pick.ok ? '¡Ñam! Buena mosca.' : <>¡Puaj! <b>{round.word}</b> = <b>{right}</b></>)
          : cfg.lang === 'es' ? '¿Cómo se dice en inglés? Toca la mosca correcta.' : '¿Qué significa en español? Toca la mosca correcta.'}
      </p>
    </div>
  );
}

function FrogStart({ pool, cfg, onCfg, onStart }: { pool: Pool | null; cfg: Cfg; onCfg: (c: Cfg) => void; onStart: () => void }) {
  const count = pool?.words.length ?? 0;
  const ready = count >= MIN_WORDS;
  return (
    <div className="fr-start">
      <div className="fr-hero">
        <div className="fr-hero-frog">
          <Frog mood="idle" />
          <span className="fr-orbit" aria-hidden="true"><Fly /></span>
          <span className="fr-orbit two" aria-hidden="true"><Fly /></span>
        </div>
        <div className="fr-hero-text">
          <h2>¡Dale de comer a la rana!</h2>
          <p>La rana dice una palabra y a su alrededor vuelan moscas con traducciones. Atrapa la <b>única</b> correcta: una mosca buena le da tiempo y una mala se lo quita. Aguanta lo más que puedas.</p>
        </div>
      </div>

      <div className="fr-pick">
        <p className="fr-pick-t">¿Cómo quieres jugar?</p>
        <div className="fr-modes">
          {(['es', 'en'] as Lang[]).map((lang) => (
            <button key={lang} type="button" className="fr-mode" aria-pressed={cfg.lang === lang} onClick={() => onCfg({ ...cfg, lang })}>
              <b>{lang === 'es' ? 'Español → Inglés' : 'Inglés → Español'}</b>
              <span>{lang === 'es' ? 'La rana dice la palabra en español; las moscas, en inglés.' : 'La rana dice la palabra en inglés; las moscas, en español.'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fr-pick">
        <p className="fr-pick-t">Nivel</p>
        <div className="fr-chips">
          {CEFR.map((l) => (
            <button key={l.id} type="button" className="fr-chip big" aria-pressed={cfg.level === l.id} onClick={() => onCfg({ ...cfg, level: l.id })}>
              <b>{l.id}</b><span>{l.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fr-pick">
        <p className="fr-pick-t">Tipo de palabra</p>
        <div className="fr-chips">
          {CATS.map((c) => (
            <button key={c.id || 'mixto'} type="button" className="fr-chip" aria-pressed={cfg.cat === c.id} onClick={() => onCfg({ ...cfg, cat: c.id })}>{c.name}</button>
          ))}
        </div>
      </div>

      <div className="fr-pick">
        <p className="fr-pick-t">Dificultad</p>
        <div className="fr-levels">
          {([1, 2, 3] as Diff[]).map((diff) => {
            const d = DIFFS[diff];
            const best = readBest(bestKey({ ...cfg, diff }));
            return (
              <button key={diff} type="button" className="fr-level" aria-pressed={cfg.diff === diff} onClick={() => onCfg({ ...cfg, diff })}>
                <b>{d.name}</b>
                <span>{d.flies} moscas · +{d.gain} s / −{d.loss} s</span>
                {best >= 1000 && <em><Trophy size={12} /> {clockText(best)}</em>}
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" className="dg-btn primary big fr-go" disabled={!ready} onClick={onStart}><Play size={18} /> ¡A comer!</button>
      <p className="dg-muted center" aria-live="polite">
        {!pool ? <><Loader2 size={13} className="fr-spin inline align-[-2px]" /> Cargando palabras…</>
          : ready ? <>{count} palabras de {cfg.level} · {catName(cfg.cat).toLowerCase()} en el banco.{pool.generating && ' La IA está sumando más.'}</>
            : pool.generating ? <><Loader2 size={13} className="fr-spin inline align-[-2px]" /> La IA está preparando las palabras de {cfg.level} · {catName(cfg.cat).toLowerCase()} y revisando que cada una tenga una sola respuesta. Solo pasa la primera vez (menos de un minuto).</>
              : <>Aún hay pocas palabras de {cfg.level} · {catName(cfg.cat).toLowerCase()}. Prueba otro tipo de palabra o vuelve en unos minutos: el banco crece solo.</>}
      </p>
    </div>
  );
}

type Example = FrogExample | 'loading' | 'error';

/** El repaso final: las falladas y las acertadas (una que fallaste y luego acertaste va solo arriba).
 *  Cada palabra se escucha, dice su tipo y, solo si el alumno lo pide, la IA escribe una oración de
 *  ejemplo (una por palabra para todo el sitio: la segunda vez sale del banco, sin IA). Suena solo
 *  en este navegador (`playAudio`, no `speak`): en sala cada uno repasa a su ritmo. */
function FrogReview({ missed, hits }: { missed: Seen[]; hits: Seen[] }) {
  const [ex, setEx] = useState<Record<string, Example>>({});
  const ask = (en: string) => {
    setEx((m) => ({ ...m, [en]: 'loading' }));
    getFrogExample(en).then((e) => setEx((m) => ({ ...m, [en]: e })), () => setEx((m) => ({ ...m, [en]: 'error' })));
  };
  const lists: [string, string, Seen[]][] = [
    ['miss', 'Repasa estas palabras', missed],
    ['hit', 'Las que acertaste', hits.filter(([en]) => !missed.some(([m]) => m === en))],
  ];
  return lists.filter(([, , words]) => words.length > 0).map(([kind, title, words]) => (
    <div key={kind} className={`fr-review fr-hits ${kind}`}>
      <p>{title} ({words.length})</p>
      <ul>
        {words.map(([en, es, pos]) => {
          const e = ex[en];
          return (
            <li key={en}>
              <div className="fr-hit">
                <button type="button" className="fr-hit-say" onClick={() => playAudio(en)} aria-label={`Escuchar ${en}`}><Volume2 size={15} /></button>
                <b lang="en">{en}</b>
                {pos && <em className="fr-hit-pos">{pos}</em>}
                <span>{es}</span>
                {e === 'loading' ? <Loader2 size={15} className="fr-spin" aria-label="Escribiendo la oración" />
                  : typeof e !== 'object' && (
                    <button type="button" className="fr-hit-ai" onClick={() => ask(en)}>
                      <Sparkles size={13} /> {e === 'error' ? 'Reintentar' : 'Oración'}
                    </button>
                  )}
              </div>
              {typeof e === 'object' && (
                <div className="fr-hit-ex">
                  <button type="button" className="fr-hit-say" onClick={() => playAudio(e.en)} aria-label="Escuchar la oración"><Volume2 size={13} /></button>
                  <p lang="en">{e.en}</p>
                  <p lang="es">{e.es}</p>
                </div>
              )}
              {e === 'error' && <small className="fr-hit-err">La IA no pudo escribirla ahora.</small>}
            </li>
          );
        })}
      </ul>
    </div>
  ));
}

/** La rana, en SVG. `look` mueve las pupilas hacia la mosca (−1…1 en cada eje). */
function Frog({ mood, look = [0, 0.3] }: { mood: Mood; look?: [number, number] }) {
  const pupils = { transform: `translate(${look[0] * 5}px, ${look[1] * 4}px)` };
  const openEyes = mood === 'idle' || mood === 'worried' || mood === 'sad';
  return (
    <svg className={`fr-svg fr-${mood}`} viewBox="0 0 200 200" aria-hidden="true">
      <ellipse className="fr-shade" cx="100" cy="193" rx="74" ry="7" />
      <ellipse className="fr-dark" cx="46" cy="162" rx="32" ry="21" />
      <ellipse className="fr-dark" cx="154" cy="162" rx="32" ry="21" />
      <ellipse className="fr-skin" cx="100" cy="144" rx="60" ry="47" />
      <ellipse className="fr-belly" cx="100" cy="154" rx="38" ry="30" />
      <g className="fr-dark">
        <ellipse cx="72" cy="186" rx="15" ry="7" />
        <ellipse cx="128" cy="186" rx="15" ry="7" />
      </g>
      <ellipse className="fr-skin" cx="100" cy="102" rx="72" ry="46" />
      <circle className="fr-skin" cx="62" cy="62" r="28" />
      <circle className="fr-skin" cx="138" cy="62" r="28" />

      {openEyes && (
        <>
          <circle className="fr-eye" cx="62" cy="61" r="19" />
          <circle className="fr-eye" cx="138" cy="61" r="19" />
          <g className="fr-pupils" style={pupils}>
            <circle cx="62" cy="62" r={mood === 'worried' ? 7.5 : 10} />
            <circle cx="138" cy="62" r={mood === 'worried' ? 7.5 : 10} />
            <circle className="fr-shine" cx="65.5" cy="58" r="3.4" />
            <circle className="fr-shine" cx="141.5" cy="58" r="3.4" />
          </g>
          <circle className={`fr-lid ${mood === 'sad' ? 'half' : ''}`} cx="62" cy="61" r="20" />
          <circle className={`fr-lid ${mood === 'sad' ? 'half' : ''}`} cx="138" cy="61" r="20" />
        </>
      )}
      {mood === 'happy' && (
        <g className="fr-line">
          <path d="M45 66 Q62 44 79 66" />
          <path d="M121 66 Q138 44 155 66" />
        </g>
      )}
      {mood === 'sick' && (
        <g className="fr-sick-eyes">
          <circle className="fr-eye" cx="62" cy="61" r="19" />
          <circle className="fr-eye" cx="138" cy="61" r="19" />
          <path className="fr-swirl" d="M62 61 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0 a10 10 0 0 1 20 0" />
          <path className="fr-swirl" d="M138 61 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0 a10 10 0 0 1 20 0" />
        </g>
      )}
      {mood === 'worried' && (
        <g className="fr-line thin">
          <path d="M49 44 L74 38" />
          <path d="M151 44 L126 38" />
        </g>
      )}

      <circle className="fr-nose" cx="91" cy="90" r="2.6" />
      <circle className="fr-nose" cx="109" cy="90" r="2.6" />
      <ellipse className="fr-cheek" cx="42" cy="110" rx="12" ry="7" />
      <ellipse className="fr-cheek" cx="158" cy="110" rx="12" ry="7" />

      {mood === 'idle' && <path className="fr-line" d="M72 112 Q100 130 128 112" />}
      {mood === 'worried' && <ellipse className="fr-mouth" cx="100" cy="118" rx="9" ry="7" />}
      {mood === 'sad' && <path className="fr-line" d="M76 124 Q100 108 124 124" />}
      {mood === 'happy' && (
        <>
          <path className="fr-mouth" d="M66 108 Q100 152 134 108 Z" />
          <path className="fr-tongue-in" d="M84 127 Q100 147 116 127 Q100 133 84 127 Z" />
        </>
      )}
      {mood === 'sick' && (
        <>
          <path className="fr-line" d="M68 120 q8 -9 16 0 t16 0 t16 0 t16 0" />
          <path className="fr-drool" d="M112 121 q5 12 1 17 q-6 -1 -5 -9 z" />
        </>
      )}

      {mood === 'worried' && <path className="fr-sweat" d="M165 40 q8 12 0 18 q-8 -6 0 -18 z" />}
      {mood === 'sick' && (
        <g className="fr-stink">
          <path d="M70 26 q-6 -8 0 -16 t0 -16" />
          <path d="M100 20 q-6 -8 0 -16 t0 -16" />
          <path d="M130 26 q-6 -8 0 -16 t0 -16" />
        </g>
      )}
      {mood === 'happy' && (
        <g className="fr-spark">
          <path d="M22 40 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" />
          <path d="M178 30 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" />
        </g>
      )}
    </svg>
  );
}

export function Fly() {
  return (
    <svg className="fr-fly-svg" viewBox="0 0 48 42" aria-hidden="true">
      <g transform="rotate(-28 15 14)"><ellipse className="fr-wing" cx="15" cy="14" rx="12" ry="7" /></g>
      <g transform="rotate(28 33 14)"><ellipse className="fr-wing two" cx="33" cy="14" rx="12" ry="7" /></g>
      <path className="fr-legs" d="M17 31 l-6 7 M24 33 v7 M31 31 l6 7" />
      <ellipse className="fr-fly-body" cx="24" cy="26" rx="10.5" ry="9.5" />
      <path className="fr-fly-stripe" d="M15 28 h18 M16.5 32 h15" />
      <circle className="fr-fly-eye" cx="18.5" cy="20" r="5" />
      <circle className="fr-fly-eye" cx="29.5" cy="20" r="5" />
      <circle className="fr-shine" cx="17.2" cy="18.4" r="1.6" />
      <circle className="fr-shine" cx="28.2" cy="18.4" r="1.6" />
    </svg>
  );
}

/** Nenúfares, juncos y ondas del estanque: solo decoración. */
function PondDecor() {
  return (
    <svg className="fr-decor" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <ellipse className="fr-ripple" cx="50" cy="60" rx="30" ry="9" />
      <ellipse className="fr-ripple two" cx="50" cy="60" rx="30" ry="9" />
      <path className="fr-pad" d="M50 50 m-25 9 a25 8 0 1 0 50 0 a25 8 0 1 0 -50 0 M50 59 l14 -6 l-6 9 z" fillRule="evenodd" />
      <path className="fr-pad small" d="M8 92 a7 3 0 1 0 14 0 a7 3 0 1 0 -14 0 z" />
      <path className="fr-pad small" d="M84 50 a6 2.4 0 1 0 12 0 a6 2.4 0 1 0 -12 0 z" />
      <path className="fr-reed" d="M94 100 q-1 -18 2 -30 M97 100 q0 -14 -3 -24 M4 60 q2 -12 -1 -22" />
    </svg>
  );
}
