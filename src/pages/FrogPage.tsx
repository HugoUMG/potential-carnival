import { useEffect } from 'react';
import { GamePlayer } from '../games/GamePlayer';
import { FROG_GAME } from '../games/registry';
import type { PublicGameSet } from '../types';

/** El "set" de Rana hambrienta: no trae preguntas, solo da el id con el que se crean sus salas. */
const VOCAB: PublicGameSet = { id: 'rana', title: 'Vocabulario A1–C1', topic: '', level: '', questions: [], glossary: {} };

/** /rana — Rana hambrienta, el juego de vocabulario aparte de los sets (ADR-44). Sin cuenta. */
export function FrogPage() {
  useEffect(() => { document.title = 'Rana hambrienta · Juegos · MyDinoEnglish'; }, []);
  return <GamePlayer set={VOCAB} solo={FROG_GAME} />;
}
