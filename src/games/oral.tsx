import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Mic, Plus, RotateCcw, X } from 'lucide-react';
import type { GameQuestion } from '../types';
import { canRecognize, range, recognizeOnce, shuffle, speak, useGame, type GameProps } from './util';
import { Es, Notice, Say, Speak } from './ui';
import { nextTurn, useRoom, useShared, useTurnAlert } from './roomState';

/* Juegos de responder en voz alta por turnos: la plataforma solo enseña la pregunta; el alumno
 * responde hablando y alguien califica (✓ +2, ½ +1, ✗ 0). Quien califica es quien tiene el
 * control de la sala, así encaja en los dos modos:
 *  - presentador → califica el anfitrión; quien responde rota entre los demás (`ans`).
 *  - turnos      → califica el compañero: quien tiene el turno califica al siguiente conectado, y al
 *                  calificar le pasa el control (A→B, B→C, C→A).
 *  - sin sala    → se escriben los nombres y califica quien tiene el celular.
 * Los puntos van en `__scores` (por id de jugador), los mismos que pinta la barra de la sala.
 *
 * En línea (cada quien en su casa) quien responde puede hacerlo con la voz: 🎤 → el navegador lo
 * transcribe → `say()` lo publica en la sala (sin tener el control) y todos leen "Luis dijo: …".
 * Por eso estos juegos son `roomFree`: quien responde tiene que poder tocar el micrófono. */

const GRADES = [
  { pts: 2, label: '✓ Bien', cls: 'ok' },
  { pts: 1, label: '½ Casi', cls: 'mid' },
  { pts: 0, label: '✗ No', cls: 'bad' },
];
const COLORS = ['#E8590C', '#1971C2', '#2B8A3E', '#C2255C', '#7048E8', '#0B7285', '#E67700', '#5C940D'];

interface Player { key: string; name: string; color: string }
interface Last { name: string; pts: number; burned?: boolean }

function useOral(questions: GameQuestion[]) {
  const { room, me, canAct, endTurn, say } = useRoom();
  const [names, setNames] = useShared<string[]>('names', []);
  const [deck, setDeck] = useShared<number[]>('deck', () => shuffle(range(questions.length)));
  const [q, setQ] = useShared<number | null>('q', null);
  const [ans, setAns] = useShared('ans', 0);
  const [scores, setScores] = useShared<Record<string, number>>('__scores', {});
  const [last, setLast] = useShared<Last | null>('last', null);
  // `said.n` al sacar la pregunta: solo cuenta lo que se diga después (no la respuesta anterior).
  const [saidBase, setSaidBase] = useShared('saidBase', 0);

  const list = room
    ? (room.mode === 'presentador' ? room.players.filter((p) => p.id !== room.host_id) : room.players).map((p) => ({ key: p.id, name: p.name }))
    : names.map((name, i) => ({ key: `p${i}`, name }));
  const players: Player[] = list.map((p, i) => ({ ...p, color: COLORS[i % COLORS.length] }));
  const answererId = room?.mode === 'turnos' ? nextTurn(room, room.turn) : players.length ? players[ans % players.length].key : null;
  const answerer = players.find((p) => p.key === answererId);
  const grader = room ? room.players.find((p) => p.id === room.turn)?.name ?? '' : '';

  const draw = () => {
    const rest = deck.length ? deck : shuffle(range(questions.length));
    setQ(rest[0]);
    setDeck(rest.slice(1));
    setSaidBase(room?.said?.n ?? 0);
    speak(questions[rest[0]].text);
  };
  const grade = (pts: number, burned = false) => {
    if (!answerer || q === null) return;
    setScores((s) => ({ ...s, [answerer.key]: (s[answerer.key] ?? 0) + pts }));
    setLast({ name: answerer.name, pts, burned });
    setQ(null);
    setAns((a) => a + 1);
    endTurn(); // en turnos, el control pasa a quien acaba de responder: ahora califica él
  };
  const reset = () => { setScores({}); setLast(null); setQ(null); setAns(0); };
  const said = room?.said && answerer && room.said.pid === answerer.key && room.said.n > saidBase && q !== null ? room.said : null;
  const answering = Boolean(room && answerer && answerer.key === me && q !== null);
  useTurnAlert(answering, '¡Te toca responder!');
  return { room, canAct, players, answerer, grader, q, draw, grade, scores, last, names, setNames, reset, said, answering, say };
}

type Oral = ReturnType<typeof useOral>;

/** Sin sala: los nombres de quienes juegan (2 a 8). */
function Setup({ onStart }: { onStart: (names: string[]) => void }) {
  const { openGroup } = useGame();
  const [names, setNames] = useState(['', '']);
  const clean = names.map((n, i) => n.trim() || `Jugador ${i + 1}`);
  return (
    <div className="dg-center-card dg-oral-setup">
      {openGroup && (
        <>
          <p className="dg-big-q">🌐 ¿Cada quien en su casa?</p>
          <p className="dg-muted">Crea una sala, comparte el enlace y cada uno responde desde su celular. Puedes calificar tú o que se califiquen entre ellos.</p>
          <button type="button" className="dg-btn primary big" onClick={openGroup}>Jugar en línea</button>
          <p className="dg-oral-or">o en un solo dispositivo</p>
        </>
      )}
      <p className={openGroup ? 'dg-oral-sub' : 'dg-big-q'}>¿Quiénes juegan?</p>
      <p className="dg-muted">Cada uno responde en voz alta en su turno y quien tiene el celular da los puntos.</p>
      {names.map((n, i) => (
        <div key={i} className="dg-oral-name" style={{ '--who': COLORS[i % COLORS.length] } as CSSProperties}>
          <span>{i + 1}</span>
          <input className="dg-input" value={n} placeholder={`Jugador ${i + 1}`} maxLength={24}
            onChange={(e) => setNames(names.map((m, k) => (k === i ? e.target.value : m)))} />
          {names.length > 2 && <button type="button" className="dg-link" aria-label="Quitar" onClick={() => setNames(names.filter((_, k) => k !== i))}><X size={16} /></button>}
        </div>
      ))}
      {names.length < 8 && <button type="button" className="dg-link" onClick={() => setNames([...names, ''])}><Plus size={14} /> Agregar jugador</button>}
      <button type="button" className={`dg-btn ${openGroup ? '' : 'primary '}big`} onClick={() => onStart(clean)}>Empezar aquí</button>
    </div>
  );
}

function Scoreboard({ o }: { o: Oral }) {
  const ranked = [...o.players].sort((a, b) => (o.scores[b.key] ?? 0) - (o.scores[a.key] ?? 0));
  return (
    <div className="dg-oral-board">
      {ranked.map((p) => (
        <div key={p.key} className={`dg-oral-score ${p.key === o.answerer?.key ? 'now' : ''}`} style={{ '--who': p.color } as CSSProperties}>
          <span className="dg-player-name">{p.name}</span>
          <b>{o.scores[p.key] ?? 0}</b>
        </div>
      ))}
    </div>
  );
}

/** El turno: quién responde, la pregunta y los botones para calificar (solo para quien califica). */
function Turn({ o, questions, extra }: { o: Oral; questions: GameQuestion[]; extra?: ReactNode }) {
  if (!o.answerer) return <Notice>Hace falta al menos otro jugador conectado para responder.</Notice>;
  const q = o.q === null ? null : questions[o.q];
  const graderName = o.room ? o.grader : 'quien tiene el celular';
  return (
    <div className="dg-oral-turn" style={{ '--who': o.answerer.color } as CSSProperties}>
      <p className="dg-oral-who">Responde <b>{o.answerer.name}</b>{o.room && <> · califica <b>{o.grader}</b></>}</p>
      {!q ? (
        o.canAct
          ? <button type="button" className="dg-btn primary big" onClick={o.draw}>🎴 Sacar pregunta para {o.answerer.name}</button>
          : <p className="dg-muted center">Esperando a que {graderName} saque la pregunta…</p>
      ) : (
        <>
          <p className="dg-big-q"><Say text={q.text} /></p>
          <div className="dg-row center"><Speak text={q.text} /></div>
          <Es className="center">{q.translation}</Es>
          {q.hint && <p className="dg-hint center">💡 Empieza así: <Say text={q.hint} /></p>}
          {extra}
          {o.answering && <AnswerMic o={o} />}
          {o.said && <p className="dg-said"><b>🗣️ {o.said.name} dijo:</b> “{o.said.text}”</p>}
          {o.canAct ? (
            <div className="dg-grades">
              {GRADES.map((g) => (
                <button key={g.pts} type="button" className={`dg-grade ${g.cls}`} onClick={() => o.grade(g.pts)}>
                  {g.label}<small>+{g.pts}</small>
                </button>
              ))}
            </div>
          ) : <p className="dg-muted center">{graderName} decide si la respuesta fue buena.</p>}
        </>
      )}
      {o.last && (
        <p className="dg-oral-last">
          {o.last.burned ? `💥 A ${o.last.name} se le quemó la papa` : `${o.last.name}: ${o.last.pts ? `+${o.last.pts} ${o.last.pts === 1 ? 'punto' : 'puntos'}` : 'sin puntos'}`}
        </p>
      )}
    </div>
  );
}

/** Quien responde, en línea: habla y el navegador lo transcribe para que quien califica lo lea. */
function AnswerMic({ o }: { o: Oral }) {
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState('');
  if (!canRecognize) return <p className="dg-muted center">🎤 Responde en voz alta por la llamada (tu navegador no transcribe la voz; en Chrome sí).</p>;
  const listen = async () => {
    setErr('');
    setListening(true);
    try {
      const text = await recognizeOnce();
      if (text) await o.say(text);
      else setErr('No te escuché. Toca el micrófono y habla.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo usar el micrófono');
    } finally {
      setListening(false);
    }
  };
  return (
    <div className="dg-answer-mic">
      <p className="dg-oral-you">¡Te toca responder!</p>
      <button type="button" className={`dg-mic ${listening ? 'on' : ''}`} onClick={() => void listen()} disabled={listening} aria-label="Responder con la voz"><Mic size={30} /></button>
      <p className="dg-muted center">{listening ? 'Te escucho… habla en inglés' : 'Toca y responde en voz alta: lo que digas aparece para quien califica.'}</p>
      {err && <p className="dg-error center">{err}</p>}
    </div>
  );
}

function NewGame({ o }: { o: Oral }) {
  return o.canAct ? <button type="button" className="dg-link center" onClick={o.reset}><RotateCcw size={14} /> Nueva partida (puntos a cero)</button> : null;
}

// ── Entrevista ────────────────────────────────────────────────────────────────

export function InterviewGame({ questions }: GameProps) {
  const o = useOral(questions);
  if (!o.room && !o.names.length) return <Setup onStart={o.setNames} />;
  return (
    <div className="dg-oral">
      <Scoreboard o={o} />
      <Turn o={o} questions={questions} />
      <NewGame o={o} />
    </div>
  );
}

// ── Carrera de respuestas ─────────────────────────────────────────────────────

const GOAL = 10;

export function AnswerRaceGame({ questions }: GameProps) {
  const o = useOral(questions);
  if (!o.room && !o.names.length) return <Setup onStart={o.setNames} />;
  const winner = o.players.find((p) => (o.scores[p.key] ?? 0) >= GOAL);
  return (
    <div className="dg-oral">
      <div className="dg-race">
        {o.players.map((p) => {
          const pts = Math.min(GOAL, o.scores[p.key] ?? 0);
          return (
            <div key={p.key} className={`dg-lane ${p.key === o.answerer?.key && !winner ? 'now' : ''}`} style={{ '--who': p.color, '--at': pts / GOAL } as CSSProperties}>
              <span className="dg-lane-name">{p.name}</span>
              <span className="dg-lane-track"><span className="dg-car">🏎️</span><span className="dg-flag">🏁</span></span>
              <b>{pts}</b>
            </div>
          );
        })}
      </div>
      {winner ? (
        <div className="dg-feedback">
          <p className="dg-ok">🏆 ¡{winner.name} gana la carrera!</p>
          {o.canAct && <button type="button" className="dg-btn primary" onClick={o.reset}><RotateCcw size={16} /> Otra carrera</button>}
        </div>
      ) : (
        <>
          <p className="dg-muted center">✓ avanza 2 casillas · ½ avanza 1 · meta en {GOAL}</p>
          <Turn o={o} questions={questions} />
        </>
      )}
    </div>
  );
}

// ── Papa caliente ─────────────────────────────────────────────────────────────

/** La papa: se calienta hasta `endsAt` (oculto, de 10 a 20 s). Si se quema antes de calificar, 0 puntos. */
function Potato({ endsAt, onBurn }: { endsAt: number; onBurn: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    const burn = window.setTimeout(onBurn, Math.max(0, endsAt - Date.now()));
    return () => { window.clearInterval(id); window.clearTimeout(burn); };
  }, [endsAt, onBurn]);
  const left = endsAt - now;
  const heat = left <= 0 ? 'burnt' : left < 3000 ? 'hot' : left < 7000 ? 'warm' : '';
  return <div className={`dg-potato ${heat}`} aria-label="Papa caliente">{left <= 0 ? '💥' : '🥔'}</div>;
}

export function HotPotatoGame({ questions }: GameProps) {
  const o = useOral(questions);
  const [endsAt, setEndsAt] = useShared<number | null>('endsAt', null);
  if (!o.room && !o.names.length) return <Setup onStart={o.setNames} />;
  // La papa arranca con la pregunta y se apaga al calificar.
  const draw = () => { setEndsAt(Date.now() + (10 + Math.floor(Math.random() * 11)) * 1000); o.draw(); };
  const grade = (pts: number, burned = false) => { setEndsAt(null); o.grade(pts, burned); };
  const oo = { ...o, draw, grade };
  return (
    <div className="dg-oral">
      <Scoreboard o={o} />
      <p className="dg-muted center">Responde antes de que la papa se queme. ¡Nadie sabe cuánto aguanta!</p>
      <Turn o={oo} questions={questions}
        extra={o.q !== null && endsAt !== null && <Potato endsAt={endsAt} onBurn={() => grade(0, true)} />} />
      <NewGame o={o} />
    </div>
  );
}
