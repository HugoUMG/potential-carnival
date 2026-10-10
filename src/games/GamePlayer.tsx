import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import type { PublicGameSet } from '../types';
import { GAMES, SKILLS } from './registry';
import { GameContext, type GameCtx } from './util';
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

export function GamePlayer({ set }: { set: PublicGameSet }) {
  const [es, setEs] = useState(readEs);
  const [active, setActive] = useState(gameFromHash);
  const [word, setWord] = useState<{ word: string; anchor: HTMLElement } | null>(null);

  useEffect(() => {
    const sync = () => { setActive(gameFromHash()); setWord(null); };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);

  const openWord = useCallback((w: string, anchor: HTMLElement) => setWord({ word: w, anchor }), []);
  const closeWord = useCallback(() => setWord(null), []);
  const ctx = useMemo<GameCtx>(() => ({ glossary: set.glossary, es, setId: set.id, openWord }), [set, es, openWord]);
  const game = GAMES.find((g) => g.id === active) ?? null;

  const open = (id: string | null) => {
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
          <div className="dg-ttl">
            <small>{game ? `${SKILLS.find((s) => s.id === game.skill)?.name} · ${set.title}` : [set.level && `Nivel ${set.level}`, `${set.questions.length} preguntas`].filter(Boolean).join(' · ')}</small>
            <h1>{game ? `${game.emoji} ${game.name}` : set.title}</h1>
          </div>
          <Countdown compact />
          <button type="button" className="dg-es-btn" aria-pressed={es} onClick={toggleEs} title={es ? 'Ocultar traducciones' : 'Mostrar traducciones'}>ES</button>
        </header>

        <div className="dg-body">
          {game && (
            <nav className="dg-side" aria-label="Juegos">
              {SKILLS.map((s) => (
                <div key={s.id}>
                  <p>{s.emoji} {s.name}</p>
                  {GAMES.filter((g) => g.skill === s.id).map((g) => (
                    <button key={g.id} type="button" aria-current={g.id === game.id ? 'page' : undefined} onClick={() => open(g.id)}
                      style={{ '--accent': g.color } as CSSProperties}>
                      <span>{g.emoji}</span>{g.name}
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
                <game.Component key={game.id} questions={set.questions} />
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
        <p className="dg-hero-tip">💡 Toca cualquier palabra en inglés para ver sus significados y escuchar cómo se pronuncia. 🔊 lee la pregunta y 🐢 la lee lento.</p>
      </section>
      {SKILLS.map((s) => (
        <section key={s.id} className="dg-skill">
          <h2>{s.emoji} {s.name}</h2>
          <div className="dg-tiles">
            {GAMES.filter((g) => g.skill === s.id).map((g) => (
              <button key={g.id} type="button" className="dg-tile" onClick={() => onOpen(g.id)} style={{ '--accent': g.color } as CSSProperties}>
                <span className="dg-tile-emoji">{g.emoji}</span>
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
