import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Users } from 'lucide-react';
import { AppIcon } from '../components/AppIcon';
import { getRoom } from '../services/api';
import type { PublicGameSet, RoomState } from '../types';
import { GAMES, SKILLS } from './registry';
import { RoomGate, RoomProvider } from './room';
import { dropSeat, loadSeat } from './roomState';
import { GameContext, type GameCtx, stopAudio } from './util';
import { Countdown, WordPopover } from './ui';
import './games.css';

const ES_KEY = 'dg-es';

function readEs(): boolean {
  try { return localStorage.getItem(ES_KEY) !== '0'; } catch { return true; }
}

/** El juego abierto vive en el hash (#ruleta): se comparte por enlace y el "atrás" del celular
 *  vuelve a la lista de juegos. */
const gameFromHash = () => {
  const id = window.location.hash.slice(1);
  return GAMES.some((g) => g.id === id) ? id : null;
};

/** `?sala=K7QF` en la URL: el enlace de una sala de juego (ADR-40). */
const roomFromUrl = () => new URLSearchParams(window.location.search).get('sala')?.trim().toUpperCase() || null;

export function GamePlayer({ set }: { set: PublicGameSet }) {
  const [es, setEs] = useState(readEs);
  const [active, setActive] = useState(gameFromHash);
  const [word, setWord] = useState<{ word: string; anchor: HTMLElement } | null>(null);
  // Sala: código (de la URL o recién creada), asiento guardado y primer estado del servidor.
  const [roomCode, setRoomCode] = useState(roomFromUrl);
  const [seat, setSeat] = useState(() => { const c = roomFromUrl(); return c ? loadSeat(c) : null; });
  const [roomInit, setRoomInit] = useState<RoomState | null>(null);
  const [roomErr, setRoomErr] = useState('');
  const [gate, setGate] = useState(false);

  const leaveRoom = useCallback(() => {
    stopAudio();
    if (roomCode) dropSeat(roomCode);
    setRoomCode(null); setSeat(null); setRoomInit(null); setGate(false);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, [roomCode]);

  useEffect(() => {
    const sync = () => { setActive(gameFromHash()); setWord(null); };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);

  // Al cambiar de juego o salir del reproductor, la voz que estaba sonando se corta.
  useEffect(() => () => stopAudio(), [active]);

  // Con asiento guardado (F5 o enlace tras unirse en otra página), se pide el estado y se entra.
  useEffect(() => {
    if (!roomCode || !seat || roomInit) return;
    let alive = true;
    getRoom(roomCode, seat.token, null).then((r) => {
      if (!alive) return;
      setRoomInit(r);
      if (gameFromHash() !== r.game) { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${r.game}`); setActive(r.game); }
    }, (e: unknown) => {
      if (!alive) return;
      setRoomErr(e instanceof Error ? e.message : 'Esa sala no existe o ya terminó');
      leaveRoom();
    });
    return () => { alive = false; };
  }, [roomCode, seat, roomInit, leaveRoom]);

  const enterRoom = (s: { token: string; me: string }, r: RoomState) => {
    window.history.replaceState(null, '', `${window.location.pathname}?sala=${r.code}${window.location.hash}`);
    setRoomCode(r.code); setSeat(s); setRoomInit(r); setGate(false); setRoomErr('');
  };

  const openWord = useCallback((w: string, anchor: HTMLElement) => setWord({ word: w, anchor }), []);
  const closeWord = useCallback(() => setWord(null), []);
  const canGroup = Boolean(GAMES.find((g) => g.id === active)?.room) && !roomCode && !gate;
  const openGroup = useCallback(() => setGate(true), []);
  const ctx = useMemo<GameCtx>(() => ({ glossary: set.glossary, es, setId: set.id, openWord, openGroup: canGroup ? openGroup : undefined }),
    [set, es, openWord, canGroup, openGroup]);
  const game = GAMES.find((g) => g.id === active) ?? null;
  const inRoom = Boolean(roomCode && game?.room);

  const open = (id: string | null) => {
    if (roomCode && id !== active) {
      if (!window.confirm('¿Salir de la sala de juego?')) return;
      leaveRoom();
    }
    setGate(false);
    window.history.pushState(null, '', id ? `#${id}` : window.location.pathname);
    setActive(id);
    setWord(null);
    window.scrollTo({ top: 0 });
  };
  const toggleEs = () => {
    setEs((v) => {
      try { localStorage.setItem(ES_KEY, v ? '0' : '1'); } catch { /* preferencia solo de esta visita */ }
      return !v;
    });
  };

  return (
    <GameContext.Provider value={ctx}>
      <div className={`dg ${game ? 'in-game' : ''}`} style={{ '--accent': game?.color ?? '#7048E8' } as CSSProperties}>
        <header className="dg-top">
          {game ? (
            <button type="button" className="dg-home" onClick={() => open(null)} aria-label="Volver a los juegos"><ChevronLeft size={20} /><span>Juegos</span></button>
          ) : (
            <Link className="dg-home" to="/juegos" aria-label="Volver a MyDinoEnglish"><ChevronLeft size={20} /><span>MyDinoEnglish</span></Link>
          )}
          {game && <span className="dg-ttl-ico" aria-hidden="true"><AppIcon name={game.icon} size={32} /></span>}
          <div className="dg-ttl">
            <small>
              {game
                ? <>{SKILLS.find((s) => s.id === game.skill)?.name}<span className="dg-ttl-set"> · {set.title}</span></>
                : [set.level && `Nivel ${set.level}`, `${set.questions.length} preguntas`].filter(Boolean).join(' · ')}
            </small>
            <h1>{game ? game.name : set.title}</h1>
          </div>
          <div className="dg-top-actions">
            {game?.room && !roomCode && !gate && (
              <button type="button" className="dg-es-btn dg-group-btn" onClick={() => setGate(true)} title="Jugar en grupo" aria-label="Jugar en grupo"><Users size={16} /><span>En grupo</span></button>
            )}
            <Countdown compact />
            <button type="button" className="dg-es-btn" aria-pressed={es} onClick={toggleEs} title={es ? 'Ocultar traducciones' : 'Mostrar traducciones'}>ES</button>
          </div>
        </header>

        <div className="dg-body">
          {game && (
            <nav className="dg-side" aria-label="Juegos">
              {SKILLS.map((s) => (
                <div key={s.id}>
                  <p><AppIcon name={s.icon} size={14} className="inline align-[-2px]" /> {s.name}</p>
                  {GAMES.filter((g) => g.skill === s.id).map((g) => (
                    <button key={g.id} type="button" aria-current={g.id === game.id ? 'page' : undefined} onClick={() => open(g.id)}
                      style={{ '--accent': g.color } as CSSProperties}>
                      <AppIcon name={g.icon} size={15} /><span>{g.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          )}
          <main className="dg-main">
            {game ? (
              <>
                <p className="dg-purpose">{game.purpose}</p>
                {canGroup && (
                  <div className="dg-online">
                    <span><AppIcon name="globe" size={16} className="inline align-[-2px]" /> <b>¿Cada quien en su casa?</b> Crea una sala y comparte el enlace: todos ven el mismo juego en vivo.</span>
                    <button type="button" className="dg-btn small primary" onClick={openGroup}>Jugar en línea</button>
                  </div>
                )}
                {roomErr && <p className="dg-room-error" role="alert">{roomErr}</p>}
                {game.room && (gate || (inRoom && !seat)) ? (
                  <RoomGate game={game.id} setId={set.id} modes={game.room} modeText={game.roomModeText} joinCode={roomCode ?? undefined}
                    onEnter={enterRoom} onCancel={() => (roomCode ? leaveRoom() : setGate(false))} />
                ) : inRoom && seat ? (
                  roomInit ? (
                    <RoomProvider key={roomInit.code} seat={seat} initial={roomInit} free={game.roomFree} seats={game.roomSeats} onLeave={leaveRoom}>
                      <game.Component key={game.id} questions={set.questions} />
                    </RoomProvider>
                  ) : <p className="dg-notice">Conectando con la sala…</p>
                ) : (
                  <game.Component key={game.id} questions={set.questions} />
                )}
              </>
            ) : (
              <Home set={set} onOpen={open} />
            )}
          </main>
        </div>
        {word && <WordPopover word={word.word} anchor={word.anchor} onClose={closeWord} />}
      </div>
    </GameContext.Provider>
  );
}

function Home({ set, onOpen }: { set: PublicGameSet; onOpen: (id: string) => void }) {
  return (
    <>
      <section className="dg-hero">
        {set.topic && <p className="dg-hero-topic">{set.topic}</p>}
        <p>Elige un juego. Todos usan las mismas {set.questions.length} preguntas.</p>
        <p className="dg-hero-tip"><AppIcon name="lightbulb" size={15} className="inline align-[-2px]" /> Toca cualquier palabra en inglés para ver sus significados y escuchar cómo se pronuncia. <AppIcon name="volume" size={15} className="inline align-[-2px]" /> lee la pregunta y <AppIcon name="snail" size={15} className="inline align-[-2px]" /> la lee lento.</p>
      </section>
      {SKILLS.map((s) => (
        <section key={s.id} className="dg-skill">
          <h2 className="flex items-center gap-2"><AppIcon name={s.icon} size={22} /> {s.name}</h2>
          <div className="dg-tiles">
            {GAMES.filter((g) => g.skill === s.id).map((g) => (
              <button key={g.id} type="button" className="dg-tile" onClick={() => onOpen(g.id)} style={{ '--accent': g.color } as CSSProperties}>
                <span className="dg-tile-emoji"><AppIcon name={g.icon} size={30} /></span>
                <b>{g.name}</b>
                <span>{g.purpose}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
