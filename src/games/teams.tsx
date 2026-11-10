import type { CSSProperties, ReactNode } from 'react';
import { Castle, Check, CircleDot, Crown, Flame, Gem, Hand, RotateCcw, Ship, Trophy, Waves, X } from 'lucide-react';
import { EmojiIcon } from '../components/AppIcon';
import { playSfx } from '../utils/sfx';
import { TEAM_COLORS, range, shuffle, teamName, type GameProps } from './util';
import { Sheet, TeamCount } from './ui';
import { Question } from './pick';
import { useRoom, useShared } from './roomState';

/* Competencias por equipos, primas de Cajas bomba: el equipo en turno responde en voz alta (pregunta,
 * traducción y cómo empezar la respuesta), quien tiene el control marca si estuvo bien y el juego
 * decide el premio. El nombre del equipo en turno está siempre a la vista. */

// ── Lo común: equipos, marcador, mazo de preguntas y turno ─────────────────────

interface Out { tone: 'ok' | 'boom' | 'miss'; note: string }

/** Equipos, puntos, turno y un mazo barajado que da la vuelta (sirve con sets de 4 preguntas). */
function useMatch(total: number) {
  const { endTurn } = useRoom();
  const [names, setNames] = useShared<string[]>('names', []);
  const [scores, setScores] = useShared<number[]>('scores', []);
  const [turn, setTurn] = useShared('turn', 0);
  const [deck, setDeck] = useShared<number[]>('deck', []);
  const [qn, setQn] = useShared('qn', 0);
  const [played, setPlayed] = useShared('played', 0);
  const teams = scores.length;
  return {
    names, scores, turn, teams, played,
    team: teamName(names, turn),
    nextTeam: teamName(names, (turn + 1) % (teams || 1)),
    /** Índice de la pregunta que toca. */
    qi: deck[qn % deck.length] ?? 0,
    begin: (n: number, nm: string[], from = 0) => {
      setNames(nm); setScores(new Array(n).fill(from)); setTurn(0);
      setDeck(shuffle(range(total))); setQn(0); setPlayed(0);
    },
    /** Puntos para el equipo en turno (nunca baja de 0). */
    add: (n: number) => setScores((s) => s.map((v, k) => (k === turn ? Math.max(0, v + n) : v))),
    nextQ: () => setQn((n) => n + 1),
    /** Termina el turno del equipo: otra pregunta y juega el siguiente. */
    pass: () => { setQn((n) => n + 1); setPlayed((p) => p + 1); setTurn((t) => (t + 1) % teams); endTurn(); },
    quit: () => setScores([]),
  };
}
type Match = ReturnType<typeof useMatch>;

const tint = (k: number) => ({ '--team': TEAM_COLORS[k], '--accent': TEAM_COLORS[k] }) as CSSProperties;

/** Marcador con nombres + de quién es el turno (o quién ganó). `values` si los puntos se calculan. */
function Header({ m, over, values = m.scores, children }: { m: Match; over: boolean; values?: number[]; children?: ReactNode }) {
  const best = Math.max(...values);
  const winners = values.flatMap((s, k) => (s === best ? [teamName(m.names, k)] : []));
  return (
    <>
      <div className="dg-scoreboard">
        {values.map((s, k) => (
          <div key={k} className={`dg-team ${k === m.turn && !over ? 'turn' : ''}`} style={tint(k)}>
            <span className="inline-flex items-center justify-center gap-1">{teamName(m.names, k)}{s === best && s > 0 && <Crown size={14} className="text-amber-500" />}</span>
            <b>{s}</b>
          </div>
        ))}
      </div>
      {over
        ? <p className="dg-big-q inline-flex items-center justify-center gap-2"><Trophy size={22} /> {winners.length > 1 ? `Empate: ${winners.join(' y ')}` : `¡Gana ${winners[0]}!`}</p>
        : <p className="dg-challenge center">Turno de <span style={{ color: TEAM_COLORS[m.turn] }}>{m.team}</span>{children}</p>}
    </>
  );
}

function Grade({ team, yes, onGrade }: { team: string; yes: string; onGrade: (ok: boolean) => void }) {
  return (
    <>
      <p className="dg-muted center">¿Respondió bien {team}?</p>
      <div className="dg-row">
        <button type="button" className="dg-btn ok grow" onClick={() => onGrade(true)}><Check size={16} /> Bien: {yes}</button>
        <button type="button" className="dg-btn grow" onClick={() => onGrade(false)}><X size={16} /> No</button>
      </div>
    </>
  );
}

function Outcome({ out, m, onNext }: { out: Out; m: Match; onNext: () => void }) {
  return (
    <>
      <p className={`dg-prize ${out.tone === 'ok' ? '' : out.tone}`}>{out.note}</p>
      <button type="button" className="dg-btn primary" onClick={onNext}>Siguiente: {m.nextTeam}</button>
    </>
  );
}

const Again = ({ m }: { m: Match }) => (
  <button type="button" className="dg-link center" onClick={m.quit}><RotateCcw size={14} /> Nueva partida</button>
);

// ── Batalla naval ─────────────────────────────────────────────────────────────

const SIDE = 5;
const FLEET = [3, 2, 2];
const coord = (c: number) => `${'ABCDE'[c % SIDE]}${Math.floor(c / SIDE) + 1}`;

/** Barcos en línea recta que no se pisan. 7 casillas de 25: siempre caben. */
function dealFleet(): number[][] {
  const ships: number[][] = [];
  for (const len of FLEET) {
    for (;;) {
      const across = Math.random() < 0.5;
      const line = Math.floor(Math.random() * SIDE);
      const from = Math.floor(Math.random() * (SIDE - len + 1));
      const cells = range(len).map((i) => (across ? line * SIDE + from + i : (from + i) * SIDE + line));
      if (!cells.some((c) => ships.flat().includes(c))) { ships.push(cells); break; }
    }
  }
  return ships;
}

export function NavalGame({ questions }: GameProps) {
  const m = useMatch(questions.length);
  const [ships, setShips] = useShared<number[][]>('ships', []);
  const [shots, setShots] = useShared<number[]>('shots', []);
  const [open, setOpen] = useShared<number | null>('open', null);
  const [out, setOut] = useShared<Out | null>('out', null);

  if (!m.teams) {
    return (
      <TeamCount onPick={(n, nm) => { m.begin(n, nm); setShips(dealFleet()); setShots([]); setOpen(null); setOut(null); }}>
        Hay 3 barcos escondidos. Cada equipo elige una casilla y responde: si responde bien, dispara. Tocado +1, hundido +3. Gana quien tenga más puntos cuando se hunda el último barco.
      </TeamCount>
    );
  }

  const sunk = (s: number[], hits = shots) => s.every((c) => hits.includes(c));
  const over = ships.length > 0 && ships.every((s) => sunk(s));
  const grade = (ok: boolean) => {
    if (open === null) return;
    if (!ok) { playSfx('miss'); setOut({ tone: 'miss', note: `Sin disparo: ${coord(open)} sigue tapada para otro equipo.` }); return; }
    const hits = [...shots, open];
    const ship = ships.find((s) => s.includes(open));
    setShots(hits);
    if (!ship) { playSfx('slide'); setOut({ tone: 'miss', note: `¡Agua! No había nada en ${coord(open)}.` }); return; }
    const down = sunk(ship, hits);
    playSfx(down ? 'win' : 'ok');
    m.add(down ? 3 : 1);
    setOut({ tone: 'ok', note: down ? `¡Hundido! +3 para ${m.team}.` : `¡Tocado! +1 para ${m.team}.` });
  };
  const next = () => { setOpen(null); setOut(null); m.pass(); };

  return (
    <div className="dg-pick">
      <Header m={m} over={over}>: elige una casilla ({ships.filter((s) => !sunk(s)).length} barcos a flote)</Header>
      <div className="dg-grid5">
        {range(SIDE * SIDE).map((c) => {
          if (!shots.includes(c)) {
            return <button key={c} type="button" className="dg-sea" disabled={over} onClick={() => { setOpen(c); setOut(null); }} aria-label={`Casilla ${coord(c)}`}>{coord(c)}</button>;
          }
          const ship = ships.find((s) => s.includes(c));
          const state = !ship ? 'water' : sunk(ship) ? 'sunk' : 'hit';
          return (
            <div key={c} className={`dg-sea ${state}`} role="img" aria-label={`${coord(c)}: ${state === 'water' ? 'agua' : state === 'sunk' ? 'hundido' : 'tocado'}`}>
              {state === 'water' ? <Waves size={20} /> : state === 'sunk' ? <Ship size={20} /> : <Flame size={20} />}
            </div>
          );
        })}
      </div>
      <Again m={m} />
      {open !== null && (
        <Sheet onClose={out ? next : () => setOpen(null)} className="dg-sheet-pick" style={tint(m.turn)}>
          <Question q={questions[m.qi]} n={coord(open)} />
          {out ? <Outcome out={out} m={m} onNext={next} /> : <Grade team={m.team} yes="disparar" onGrade={grade} />}
        </Sheet>
      )}
    </div>
  );
}

// ── Conquista ─────────────────────────────────────────────────────────────────

/** Vecinas de arriba, abajo y a los lados (sin saltar de fila). */
const around = (c: number) => [c - SIDE, c + SIDE, c % SIDE ? c - 1 : -1, c % SIDE < SIDE - 1 ? c + 1 : -1].filter((n) => n >= 0 && n < SIDE * SIDE);

export function ConquestGame({ questions }: GameProps) {
  const m = useMatch(questions.length);
  const [own, setOwn] = useShared<number[]>('own', []);
  const [fort, setFort] = useShared<number[]>('fort', []);
  const [open, setOpen] = useShared<number | null>('open', null);
  const [out, setOut] = useShared<Out | null>('out', null);

  if (!m.teams) {
    return (
      <TeamCount onPick={(n, nm) => { m.begin(n, nm); setOwn(new Array(SIDE * SIDE).fill(-1)); setFort([]); setOpen(null); setOut(null); }}>
        Responde bien y pinta una casilla libre de tu color. También puedes quitarle una al rival si toca una tuya: queda con castillo y ya nadie la roba. Gana quien tenga más casillas cuando no quede ninguna libre.
      </TeamCount>
    );
  }

  const counts = range(m.teams).map((k) => own.filter((o) => o === k).length);
  const over = own.length > 0 && !own.includes(-1);
  /** Libre, o del rival sin castillo y pegada a una del equipo en turno. */
  const canTake = (c: number) => own[c] === -1 || (own[c] !== m.turn && !fort.includes(c) && around(c).some((n) => own[n] === m.turn));
  const grade = (ok: boolean) => {
    if (open === null) return;
    if (!ok) { playSfx('miss'); setOut({ tone: 'miss', note: `Sin conquista: la casilla ${open + 1} queda como estaba.` }); return; }
    const victim = own[open];
    playSfx(victim < 0 ? 'ok' : 'swap');
    if (victim >= 0) setFort((f) => [...f, open]);
    setOwn((o) => o.map((v, c) => (c === open ? m.turn : v)));
    setOut({ tone: 'ok', note: victim < 0 ? `Casilla ${open + 1} para ${m.team}.` : `¡Conquista! ${m.team} le quita la ${open + 1} a ${teamName(m.names, victim)} y levanta un castillo.` });
  };
  const next = () => { setOpen(null); setOut(null); m.pass(); };

  return (
    <div className="dg-pick">
      <Header m={m} over={over} values={counts}>: elige una casilla libre o roba una vecina</Header>
      <div className="dg-grid5">
        {own.map((o, c) => (
          <button key={c} type="button" className={`dg-land ${o >= 0 ? 'own' : ''} ${o >= 0 && o !== m.turn && canTake(c) && !over ? 'raid' : ''}`} style={o >= 0 ? tint(o) : undefined}
            disabled={over || !canTake(c)} onClick={() => { setOpen(c); setOut(null); }}
            aria-label={`Casilla ${c + 1}${o >= 0 ? ` de ${teamName(m.names, o)}` : ' libre'}${fort.includes(c) ? ' con castillo' : ''}`}>
            {fort.includes(c) ? <Castle size={20} /> : c + 1}
          </button>
        ))}
      </div>
      <Again m={m} />
      {open !== null && (
        <Sheet onClose={out ? next : () => setOpen(null)} className="dg-sheet-pick" style={tint(m.turn)}>
          <Question q={questions[m.qi]} n={open + 1} />
          {out ? <Outcome out={out} m={m} onNext={next} /> : <Grade team={m.team} yes={own[open] === -1 ? 'pintar la casilla' : 'conquistarla'} onGrade={grade} />}
        </Sheet>
      )}
    </div>
  );
}

// ── Volcán: arriesga o guarda ─────────────────────────────────────────────────

const VOLCANO_GOAL = 15;
/** Probabilidad (%) de erupción en la siguiente respuesta buena: la primera gema nunca explota. */
const risk = (streak: number) => Math.min(60, streak * 15);

export function VolcanoGame({ questions }: GameProps) {
  const m = useMatch(questions.length);
  const [pot, setPot] = useShared('pot', 0);
  const [streak, setStreak] = useShared('streak', 0);
  const [gem, setGem] = useShared('gem', 0);
  const [out, setOut] = useShared<Out | null>('out', null);
  const clear = () => { setPot(0); setStreak(0); setGem(0); setOut(null); };

  if (!m.teams) {
    return (
      <TeamCount onPick={(n, nm) => { m.begin(n, nm); clear(); }}>
        Cada respuesta buena saca gemas del volcán. Después eliges: guardarlas o arriesgar con otra pregunta. Si fallas o el volcán hace erupción, pierdes las que no guardaste. Gana el primero con {VOLCANO_GOAL} puntos.
      </TeamCount>
    );
  }

  const over = m.scores.some((s) => s >= VOLCANO_GOAL);
  const grade = (ok: boolean) => {
    if (!ok) { playSfx('miss'); setOut({ tone: 'miss', note: pot ? `${m.team} falla y pierde las ${pot} gemas sin guardar.` : `${m.team} falla: sin gemas esta vez.` }); return; }
    if (Math.random() * 100 < risk(streak)) { playSfx('slide'); setOut({ tone: 'boom', note: `¡Erupción! La lava se lleva las ${pot} gemas de ${m.team}.` }); return; }
    const g = 1 + Math.floor(Math.random() * 3);
    playSfx('ok');
    setGem(g); setPot(pot + g); setStreak(streak + 1);
  };
  const next = () => { clear(); m.pass(); };
  const bank = () => { playSfx('climb'); m.add(pot); next(); };

  return (
    <div className="dg-pick">
      <Header m={m} over={over} />
      {!over && (
        <div className="dg-tq" style={tint(m.turn)}>
          <p className="dg-pot"><Gem size={30} /> {pot}</p>
          <p className="dg-muted">Gemas sin guardar · riesgo de erupción en la próxima: <b>{risk(streak)}%</b></p>
          <div className="dg-risk" aria-hidden="true"><i style={{ width: `${risk(streak)}%` }} /></div>
          {out ? <Outcome out={out} m={m} onNext={next} /> : gem ? (
            <>
              <p className="dg-prize">+{gem} {gem === 1 ? 'gema' : 'gemas'} para {m.team}. ¿Guardan o arriesgan?</p>
              <div className="dg-row">
                <button type="button" className="dg-btn ok grow" onClick={bank}>Guardar {pot}</button>
                <button type="button" className="dg-btn primary grow" onClick={() => { setGem(0); m.nextQ(); }}><Flame size={16} /> Arriesgar</button>
              </div>
            </>
          ) : (
            <>
              <Question q={questions[m.qi]} />
              <Grade team={m.team} yes="sacar gemas" onGrade={grade} />
            </>
          )}
        </div>
      )}
      <Again m={m} />
    </div>
  );
}

// ── Apuesta ───────────────────────────────────────────────────────────────────

const BET_START = 5;
const BET_ROUNDS = 5;

export function BetGame({ questions }: GameProps) {
  const m = useMatch(questions.length);
  const [bet, setBet] = useShared<number | null>('bet', null);
  const [out, setOut] = useShared<Out | null>('out', null);

  if (!m.teams) {
    return (
      <TeamCount onPick={(n, nm) => { m.begin(n, nm, BET_START); setBet(null); setOut(null); }}>
        Todos empiezan con {BET_START} puntos. Antes de ver la pregunta, el equipo apuesta: si responde bien gana lo apostado; si falla, lo pierde. Son {BET_ROUNDS} rondas y gana quien termine con más.
      </TeamCount>
    );
  }

  const over = m.played >= m.teams * BET_ROUNDS;
  const q = questions[m.qi];
  const max = Math.min(5, Math.max(1, m.scores[m.turn] ?? 0));
  const grade = (ok: boolean) => {
    if (bet === null) return;
    playSfx(ok ? 'ok' : 'miss');
    m.add(ok ? bet : -bet);
    setOut(ok ? { tone: 'ok', note: `¡Apuesta ganada! +${bet} para ${m.team}.` } : { tone: 'boom', note: `Apuesta perdida: −${bet} para ${m.team}.` });
  };
  const next = () => { setBet(null); setOut(null); m.pass(); };

  return (
    <div className="dg-pick">
      <Header m={m} over={over}> · ronda {Math.floor(m.played / m.teams) + 1} de {BET_ROUNDS}</Header>
      {!over && (
        <div className="dg-tq" style={tint(m.turn)}>
          {bet === null ? (
            <>
              <EmojiIcon emoji={q.emoji} size={40} />
              <p className="dg-big-q">{q.tag ? `Tema: ${q.tag}` : 'Pregunta sorpresa'}</p>
              <p className="dg-muted">¿Cuánto apuesta {m.team}?</p>
              <div className="dg-row wrap center">
                {range(max).map((k) => (
                  <button key={k} type="button" className="dg-btn primary big" onClick={() => { playSfx('select'); setBet(k + 1); }}>{k + 1}</button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="dg-challenge">Apuesta: <b>{bet}</b></p>
              <Question q={q} />
              {out ? <Outcome out={out} m={m} onNext={next} /> : <Grade team={m.team} yes={`gana ${bet}`} onGrade={grade} />}
            </>
          )}
        </div>
      )}
      <Again m={m} />
    </div>
  );
}

// ── Tanda de penales ──────────────────────────────────────────────────────────

const SHOTS = 5;
const SIDES = ['Izquierda', 'Centro', 'Derecha'];

export function PenaltyGame({ questions }: GameProps) {
  const m = useMatch(questions.length);
  const [aim, setAim] = useShared('aim', false);
  const [shot, setShot] = useShared<{ dir: number; keeper: number } | null>('shot', null);
  const [out, setOut] = useShared<Out | null>('out', null);
  const clear = () => { setAim(false); setShot(null); setOut(null); };

  if (!m.teams) {
    return (
      <TeamCount onPick={(n, nm) => { m.begin(n, nm); clear(); }}>
        Si el equipo responde bien, patea un penal: elige izquierda, centro o derecha. Si el portero se lanza a otro lado, es gol. Cada equipo tiene {SHOTS} turnos y gana quien meta más goles.
      </TeamCount>
    );
  }

  const over = m.played >= m.teams * SHOTS;
  const grade = (ok: boolean) => {
    if (ok) { playSfx('ok'); setAim(true); return; }
    playSfx('miss');
    setOut({ tone: 'miss', note: `${m.team} no patea esta vez.` });
  };
  const kick = (dir: number) => {
    const keeper = Math.floor(Math.random() * 3);
    const goal = keeper !== dir;
    playSfx(goal ? 'win' : 'slide');
    if (goal) m.add(1);
    setShot({ dir, keeper });
    setOut(goal ? { tone: 'ok', note: `¡GOOOL de ${m.team}!` } : { tone: 'boom', note: `¡Atajada! El portero adivinó el tiro de ${m.team}.` });
  };
  const next = () => { clear(); m.pass(); };

  return (
    <div className="dg-pick">
      <Header m={m} over={over}> · tiro {Math.floor(m.played / m.teams) + 1} de {SHOTS}</Header>
      {!over && (
        <div className="dg-tq" style={tint(m.turn)}>
          <div className="dg-goal">
            {SIDES.map((side, k) => (shot || !aim ? (
              <div key={k}>
                {(shot ? shot.keeper === k : k === 1) && <Hand size={30} aria-label="Portero" />}
                {shot?.dir === k && <CircleDot size={24} className="dg-ball" aria-label="Balón" />}
              </div>
            ) : (
              <button key={k} type="button" onClick={() => kick(k)}><CircleDot size={22} /> {side}</button>
            )))}
          </div>
          {out ? <Outcome out={out} m={m} onNext={next} /> : aim ? (
            <p className="dg-prize">¡Bien! {m.team} patea: elige a dónde va el balón.</p>
          ) : (
            <>
              <Question q={questions[m.qi]} />
              <Grade team={m.team} yes="patear" onGrade={grade} />
            </>
          )}
        </div>
      )}
      <Again m={m} />
    </div>
  );
}
