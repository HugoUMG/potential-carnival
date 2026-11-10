import { useEffect } from 'react';
import { GamePlayer } from '../games/GamePlayer';
import { CATERPILLAR_GAME, CHAMELEON_GAME, type GameMeta } from '../games/registry';
import type { PublicGameSet } from '../types';

/** Como `FrogPage`: el "set" no trae preguntas, solo da el id con el que se crean las salas. */
function VerbPage({ game }: { game: GameMeta }) {
  useEffect(() => { document.title = `${game.name} · Juegos · MyDinoEnglish`; }, [game]);
  const set: PublicGameSet = { id: game.id, title: 'Las 5 formas del verbo', topic: '', level: '', questions: [], glossary: {} };
  return <GamePlayer set={set} solo={game} />;
}

/** /camaleon — elegir la forma del verbo que pide la oración. Sin cuenta. */
export const ChameleonPage = () => <VerbPage game={CHAMELEON_GAME} />;
/** /oruga — escribir las formas del verbo. Sin cuenta. */
export const CaterpillarPage = () => <VerbPage game={CATERPILLAR_GAME} />;
