import type { ComponentType } from 'react';
import type { RoomMode } from '../types';
import type { GameProps } from './util';
import { BoardGame, CardsGame, ChatGame, DiceGame, PronounceGame, TeamsGame, WheelGame } from './speaking';
import { BingoGame, DictationGame, ListenGame } from './listening';
import { BalloonsGame, GapGame, OrderGame } from './structure';
import { MatchGame, MemoryGame, SpeedGame } from './meaning';

export type Skill = 'hablar' | 'escuchar' | 'estructura' | 'significado';

export const SKILLS: { id: Skill; name: string; emoji: string }[] = [
  { id: 'hablar', name: 'Hablar', emoji: '🗣️' },
  { id: 'escuchar', name: 'Escuchar', emoji: '👂' },
  { id: 'estructura', name: 'Estructura y gramática', emoji: '🧩' },
  { id: 'significado', name: 'Significado', emoji: '🧠' },
];

export interface GameMeta {
  /** Ancla de la URL: /j/:setId#ruleta abre ese juego. */
  id: string;
  name: string;
  emoji: string;
  skill: Skill;
  color: string;
  /** Qué se aprende jugando. */
  purpose: string;
  /** Cómo usarlo en clase (lo lee el profesor en /juegos y en su panel). */
  howTo: string;
  Component: ComponentType<GameProps>;
  /** Modos de sala que admite (ADR-40). Sin el campo, no se juega en grupo. Si cambia la lista
   *  de juegos con sala, cambia también `ROOM_GAMES` en `backend/app/rooms.py`. */
  room?: RoomMode[];
  /** En sala, quien no tiene el control también puede tocar el juego (Bingo: cada uno marca su
   *  cartón). Sin esto, el área queda `inert` para los que miran. */
  roomFree?: boolean;
}

const BOTH: RoomMode[] = ['turnos', 'presentador'];
const SHOW: RoomMode[] = ['presentador'];

/** Los 16 juegos. Todos salen de las mismas preguntas del set (texto + traducción). */
export const GAMES: GameMeta[] = [
  { id: 'tarjetas', name: 'Tarjetas', emoji: '🃏', skill: 'hablar', color: '#7048E8', Component: CardsGame, room: BOTH,
    purpose: 'Conversación guiada: al voltear ves la traducción y cómo empezar tu respuesta.',
    howTo: 'En parejas: uno lee la tarjeta y el otro responde con 3 oraciones. Proyectada, es un buen calentamiento.' },
  { id: 'chat', name: 'Chat', emoji: '💬', skill: 'hablar', color: '#4F46E5', Component: ChatGame, room: BOTH,
    purpose: 'Responder por escrito con frases completas, como en un chat de verdad.',
    howTo: 'Tarea o trabajo individual: al final copian sus respuestas y te las mandan por WhatsApp o correo.' },
  { id: 'ruleta', name: 'Ruleta', emoji: '🎡', skill: 'hablar', color: '#D9481F', Component: WheelGame, room: BOTH,
    purpose: 'Hablar sin preparar: no sabes qué pregunta te va a tocar.',
    howTo: 'Proyéctala y que gire quien pase al frente. Ideal para cerrar la clase.' },
  { id: 'corcho', name: 'Corcho', emoji: '📌', skill: 'hablar', color: '#A8631A', Component: BoardGame, room: BOTH,
    purpose: 'Todas las preguntas a la vista para elegir y responder a tu ritmo.',
    howTo: 'Cada alumno elige una nota; o usa “nota al azar” para quien levante la mano.' },
  { id: 'dados', name: 'Dados', emoji: '🎲', skill: 'hablar', color: '#E8590C', Component: DiceGame, room: BOTH,
    purpose: 'Fluidez: el dado decide cuánto tienes que hablar (de 1 oración a 30 segundos).',
    howTo: 'Grupos de 3–4 con un celular: lanzan por turnos y cumplen el reto del número.' },
  { id: 'equipos', name: 'Equipos', emoji: '🏆', skill: 'hablar', color: '#C2255C', Component: TeamsGame, room: SHOW,
    purpose: 'Competencia por equipos con cronómetro: motiva a hablar a todo el salón.',
    howTo: 'Divide el salón en 2–4 equipos. Tú das +2, +1 o 0 según la respuesta.' },
  { id: 'pronuncia', name: 'Pronuncia', emoji: '🎤', skill: 'hablar', color: '#0CA678', Component: PronounceGame, room: BOTH,
    purpose: 'Pronunciación: el navegador te escucha y marca cada palabra en verde o rojo.',
    howTo: 'Individual, con audífonos: escuchan el modelo, lo repiten y buscan llegar al 100%. Mejor en Chrome.' },
  { id: 'escucha', name: 'Escucha y elige', emoji: '👂', skill: 'escuchar', color: '#1971C2', Component: ListenGame, room: BOTH,
    purpose: 'Comprensión auditiva: escuchas la pregunta y eliges cuál es entre cuatro.',
    howTo: 'Proyectado: la clase vota la opción antes de revelar. También sirve de tarea.' },
  { id: 'dictado', name: 'Dictado', emoji: '✍️', skill: 'escuchar', color: '#0B7285', Component: DictationGame, room: BOTH,
    purpose: 'Oído y ortografía: escribes lo que oyes y se corrige palabra por palabra.',
    howTo: 'Individual. Que usen la tortuga para escuchar lento las veces que necesiten.' },
  { id: 'bingo', name: 'Bingo', emoji: '🔢', skill: 'escuchar', color: '#5F3DC4', Component: BingoGame, room: SHOW, roomFree: true,
    purpose: 'Reconocer preguntas al escucharlas. Cada celular recibe un cartón distinto.',
    howTo: 'Todos abren el bingo en su celular y marcan “las canta el profesor”; tú las lees en voz alta.' },
  { id: 'ordena', name: 'Ordena', emoji: '🧩', skill: 'estructura', color: '#2B8A3E', Component: OrderGame, room: BOTH,
    purpose: 'Orden de la pregunta: palabra interrogativa, auxiliar, sujeto y verbo en su lugar.',
    howTo: 'Antes de hablar, para fijar la estructura (would, be able to, present perfect…).' },
  { id: 'completa', name: 'Completa', emoji: '🕳️', skill: 'estructura', color: '#5C940D', Component: GapGame, room: BOTH,
    purpose: 'Gramática y vocabulario: eliges la palabra que falta (auxiliares, wh-words y más).',
    howTo: 'Repaso rápido al inicio de la clase o como tarea corta.' },
  { id: 'globos', name: 'Globos', emoji: '🎈', skill: 'estructura', color: '#E64980', Component: BalloonsGame, room: BOTH,
    purpose: 'Ortografía: adivina la palabra oculta letra por letra antes de que se revienten los globos.',
    howTo: 'Proyectado y por equipos: cada equipo dice una letra por turno.' },
  { id: 'memorama', name: 'Memorama', emoji: '🧠', skill: 'significado', color: '#1098AD', Component: MemoryGame, room: BOTH,
    purpose: 'Relacionar cada pregunta con su significado mientras ejercitas la memoria.',
    howTo: 'En parejas, por turnos: gana quien encuentre más pares.' },
  { id: 'contrarreloj', name: 'Contrarreloj', emoji: '⏱️', skill: 'significado', color: '#F08C00', Component: SpeedGame,
    purpose: 'Reconocer el significado rápido: 60 segundos, combos y récord.',
    howTo: 'Reto individual: anota en la pizarra el récord del salón.' },
  { id: 'coincide', name: '¿Coincide?', emoji: '✅', skill: 'significado', color: '#2F9E44', Component: MatchGame, room: BOTH,
    purpose: 'Comprensión de lectura veloz: ¿la traducción corresponde a la pregunta?',
    howTo: 'Calentamiento de 2 minutos; se juega deslizando como en una app.' },
];
