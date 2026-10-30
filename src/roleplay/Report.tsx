import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, CheckCircle2, FolderOpen, Lightbulb, Loader2, Mic, RotateCcw, Rocket, Shuffle, SlidersHorizontal, Snail, Square, Target, Volume2, X, XCircle } from 'lucide-react';
import { EmojiIcon } from '../components/AppIcon';
import RexMascot from '../components/RexMascot';
import { matchWords, tokenize, words } from '../games/util';
import { transcribeAudio } from '../services/api';
import type { RoleplayLevel, RoleplayReport, RoleplayStart } from '../types';
import { moodForScore } from '../utils/scoreMood';
import { canRecord, LEVEL_INFO, say, stopVoice, useRecorder, voiceRate } from './media';

const CRITERIA = [
  { key: 'communication', label: 'Comunicación', hint: 'Entendiste, respondiste al punto y mantuviste la conversación', color: '#7048E8' },
  { key: 'grammar', label: 'Gramática', hint: 'Oraciones correctas para tu nivel', color: '#0CA678' },
  { key: 'vocabulary', label: 'Vocabulario', hint: 'Variedad y palabras adecuadas', color: '#F08C00' },
  { key: 'pronunciation', label: 'Pronunciación', hint: 'Qué tan claro te entendió la máquina', color: '#1C7ED6' },
] as const;

const STATUS = {
  ok: { label: 'Bien dicho', icon: CheckCircle2 },
  better: { label: 'Se entiende, pero suena más natural así', icon: Lightbulb },
  wrong: { label: 'Incorrecto. Lo correcto sería', icon: XCircle },
};

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
};

/** Rebanada de dona entre dos ángulos y dos radios. */
function slice(a0: number, a1: number, rIn: number, rOut: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${polar(rOut, a0)} A${rOut},${rOut} 0 ${large} 1 ${polar(rOut, a1)} L${polar(rIn, a1)} A${rIn},${rIn} 0 ${large} 0 ${polar(rIn, a0)} Z`;
}

/** Pastel "de pétalos": cada criterio es una rebanada del tamaño de su peso en la nota, y crece
 *  hacia afuera según su puntaje. En el centro, la nota final. */
function GradePie({ report }: { report: RoleplayReport }) {
  const R_IN = 36;
  const R_MAX = 100;
  const used = CRITERIA.filter((c) => report.scores[c.key] !== null);
  const total = used.reduce((sum, c) => sum + (report.weights[c.key] ?? 0), 0) || 1;
  let angle = 0;
  return (
    <svg className="rp-pie" viewBox="-110 -110 220 220" role="img" aria-label={`Nota ${report.grade} de 10`}>
      {used.map((c) => {
        const span = ((report.weights[c.key] ?? 0) / total) * 360;
        const a0 = angle + 1.5;
        const a1 = angle + span - 1.5;
        angle += span;
        const score = report.scores[c.key] ?? 0;
        const r = R_IN + 4 + ((R_MAX - R_IN - 4) * score) / 10;
        return (
          <g key={c.key}>
            <path d={slice(a0, a1, R_IN, R_MAX)} fill={c.color} opacity="0.14" />
            <path className="rp-petal" d={slice(a0, a1, R_IN, r)} fill={c.color} />
          </g>
        );
      })}
      <circle r={R_IN - 3} className="rp-pie-hole" />
      <text className="rp-pie-grade" dy="6">{report.grade.toFixed(1)}</text>
      <text className="rp-pie-of" dy="24">de 10</text>
    </svg>
  );
}

/** Repetir una frase del informe: suena el modelo, el alumno la graba y se pintan en rojo las
 *  palabras que Whisper no oyó (la misma comparación que el juego Pronuncia). No cambia la nota. */
function Practice({ text, play }: { text: string; play: (text: string, slow?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rec = useRecorder(20);
  // Si el alumno cierra la práctica mientras se transcribe, el resultado viejo no se pinta.
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);

  if (!canRecord) return null;
  if (!open) {
    return <button type="button" className="rp-practice-btn" onClick={() => { setOpen(true); play(text); }}><Mic size={14} /> Practícala</button>;
  }

  const target = words(text);
  const hits = heard ? matchWords(target, words(heard)) : null;
  const pct = hits ? Math.round((100 * hits.filter(Boolean).length) / Math.max(1, target.length)) : 0;
  let k = 0;
  const marks = tokenize(text).map((t) => ({ raw: t.raw, hit: t.word && hits ? hits[k++] : undefined }));

  const record = async () => {
    if (rec.recording) { rec.stop(); return; }
    const id = ++attempt.current;
    stopVoice();
    setErr('');
    setHeard('');
    try {
      const blob = await rec.start();
      if (id !== attempt.current) return;
      if (!blob) { setErr('No se grabó audio. Intenta otra vez.'); return; }
      setBusy(true);
      const said = (await transcribeAudio(blob)).trim();
      if (id !== attempt.current) return;
      if (said) setHeard(said);
      else setErr('No te escuché bien. Acércate al micrófono e intenta otra vez.');
    } catch {
      if (id === attempt.current) setErr('No se pudo usar el micrófono o entender el audio. Intenta otra vez.');
    } finally {
      if (id === attempt.current) setBusy(false);
    }
  };

  return (
    <div className="rp-practice">
      <p className="rp-practice-target">
        {marks.map((m, i) => (m.hit === undefined ? m.raw : <span key={i} className={m.hit ? 'hit' : 'miss'}>{m.raw}</span>))}
      </p>
      <div className="rp-practice-row">
        <button type="button" onClick={() => play(text)} aria-label="Escuchar el modelo"><Volume2 size={14} /></button>
        <button type="button" onClick={() => play(text, true)} aria-label="Escuchar lento"><Snail size={14} /></button>
        <button type="button" className={`rp-practice-mic ${rec.recording ? 'on' : ''}`} onClick={() => void record()} disabled={busy || rec.starting}
          aria-label={rec.recording ? 'Detener y comparar' : 'Grabarme'}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : rec.recording ? <Square size={14} /> : <Mic size={14} />}
          {busy ? 'Comparando…' : rec.recording ? `${rec.seconds}s · toca para comparar` : heard ? 'Otra vez' : 'Grabarme'}
        </button>
      </div>
      {heard && <p className={`rp-practice-result ${pct >= 80 ? 'ok' : 'low'}`}><b>{pct}%</b> Escuché: “{heard}”</p>}
      {err && <p className="rp-practice-result low">{err}</p>}
    </div>
  );
}

export function Report({ report, session, onAgain, onSetup, onOther, onLevelUp }: {
  report: RoleplayReport;
  session: RoleplayStart;
  onAgain: () => void;
  onSetup: () => void;
  onOther: () => void;
  onLevelUp: (level: RoleplayLevel) => void;
}) {
  const play = (text: string, slow = false) => void say(text, session.ai_voice, voiceRate(session.rate, slow));
  const counts = { ok: 0, better: 0, wrong: 0 };
  report.turns.forEach((t) => { counts[t.status] += 1; });

  return (
    <div className="rp-report">
      <section className="rp-report-hero">
        <div className="rp-pie-wrap">
          <GradePie report={report} />
          <RexMascot mood={moodForScore(report.grade * 10)} className="rp-report-rex" />
        </div>
        <div className="rp-report-head">
          <p className="rp-eyebrow">{session.title} · {session.level === 'beginner' ? 'Principiante' : session.level === 'intermediate' ? 'Intermedio' : 'Avanzado'}</p>
          <h2>{report.grade >= 9 ? '¡Increíble!' : report.grade >= 7.5 ? '¡Muy bien!' : report.grade >= 6 ? '¡Buen trabajo!' : '¡Sigue practicando!'}</h2>
          <p>{report.summary_es}</p>
          <div className="rp-tally">
            <span className="ok inline-flex items-center gap-1"><Check size={14} /> {counts.ok} bien</span>
            <span className="better inline-flex items-center gap-1"><Lightbulb size={14} /> {counts.better} mejorables</span>
            <span className="wrong inline-flex items-center gap-1"><X size={14} /> {counts.wrong} incorrectas</span>
          </div>
        </div>
        <ul className="rp-legend">
          {CRITERIA.map((c) => (
            <li key={c.key} style={{ '--c': c.color } as CSSProperties}>
              <span className="dot" />
              <div>
                <b>{c.label}</b>
                <small>{report.scores[c.key] === null ? 'No se midió: respuestas escritas o muy cortas' : c.hint}</small>
              </div>
              <strong>{report.scores[c.key] === null ? '—' : report.scores[c.key]?.toFixed(1)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="rp-report-grid">
        {report.missions.length > 0 && (
          <div className="rp-box">
            <h3 className="flex items-center gap-2"><Target size={18} /> Tu misión</h3>
            <ul className="rp-checks">
              {report.missions.map((m, i) => <li key={i} className={m.done ? 'done' : ''}>{m.done ? <CheckCircle2 size={15} /> : <Square size={15} />} {m.text}</li>)}
            </ul>
          </div>
        )}
        {report.tips_es.length > 0 && (
          <div className="rp-box">
            <h3 className="flex items-center gap-2"><Lightbulb size={18} /> Para la próxima</h3>
            <ul className="rp-tips">{report.tips_es.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="rp-box">
        <h3 className="flex items-center gap-2"><FolderOpen size={18} /> Tu conversación, respuesta por respuesta</h3>
        <ol className="rp-review">
          {report.turns.map((t) => {
            const Icon = STATUS[t.status].icon;
            return (
              <li key={t.n} className={`rp-turn ${t.status}`}>
                {t.asked && (
                  <p className="rp-turn-asked">
                    <span className="inline-flex items-center gap-1"><EmojiIcon emoji={session.ai_emoji} size={14} /> {session.ai_name}:</span> {t.asked}
                    <button type="button" onClick={() => play(t.asked)} aria-label="Escuchar"><Volume2 size={14} /></button>
                  </p>
                )}
                <p className="rp-turn-said">
                  <span>Tú:</span> “{t.said}”
                  {t.clarity !== null && (
                    <em className={t.clear === null ? '' : t.clear ? 'ok' : 'low'}><Mic size={12} className="inline align-[-2px]" /> {Math.round(t.clarity)}%{t.clear === false ? ' · poco clara para tu nivel' : ''}</em>
                  )}
                </p>
                <div className="rp-verdict">
                  <Icon size={18} />
                  <div>
                    <b>{STATUS[t.status].label}</b>
                    {t.better && (
                      <p className="rp-better">
                        “{t.better}”
                        <button type="button" onClick={() => play(t.better)} aria-label="Escuchar la versión correcta"><Volume2 size={14} /></button>
                        <button type="button" onClick={() => play(t.better, true)} aria-label="Escuchar lento"><Snail size={14} /></button>
                      </p>
                    )}
                    {t.why_es && <p className="rp-why">{t.why_es}</p>}
                    {/* La versión natural si la hay; si no, lo que quiso decir y no se entendió. */}
                    {(t.better || t.clear === false) && <Practice text={t.better || t.said} play={play} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {report.next_level && (
        <section className="rp-level-up">
          <span aria-hidden><Rocket size={26} className="text-violet-500" /></span>
          <p><b>Tu inglés va por encima de este nivel.</b> ¿Probamos en {LEVEL_INFO[report.next_level].label.toLowerCase()}?</p>
          <button type="button" className="rp-btn primary" onClick={() => onLevelUp(report.next_level!)}>
            Probar en {LEVEL_INFO[report.next_level].label}
          </button>
        </section>
      )}

      <div className="rp-report-actions">
        <button type="button" className="rp-btn primary" onClick={onAgain}><RotateCcw size={16} /> Repetir (será distinta)</button>
        <button type="button" className="rp-btn" onClick={onSetup}><SlidersHorizontal size={16} /> Cambiar rol o nivel</button>
        <button type="button" className="rp-btn" onClick={onOther}><Shuffle size={16} /> Otro role-play</button>
      </div>
    </div>
  );
}
