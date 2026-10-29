import type { ComponentType } from 'react';
import type { IconName } from '../components/AppIcon';
import type { RoomMode } from '../types';
import type { GameProps } from './util';
import { BoardGame, CardsGame, ChatGame, DiceGame, PronounceGame, TeamsGame, WheelGame } from './speaking';
import { BingoGame, DictationGame, ListenGame } from './listening';
import { BalloonsGame, GapGame, OrderGame } from './structure';
import { MatchGame, MemoryGame, SpeedGame } from './meaning';
import { ConnectFourGame, LaddersGame, TicTacToeGame } from './board';
import { AnswerRaceGame, HotPotatoGame, InterviewGame } from './oral';
import { BombGame, DinoRaceGame, DoorsGame, LettersGame, MapGame, ScratchGame } from './pick';

export type Skill = 'hablar' | 'tablero' | 'escuchar' | 'estructura' | 'significado' | 'mesa' | 'turnos';

export const SKILLS: { id: Skill; name: string; icon: IconName }[] = [
  { id: 'hablar', name: 'Hablar', icon: 'messages' },
  { id: 'tablero', name: 'Tableros: elige un número y responde', icon: 'grid' },
  { id: 'escuchar', name: 'Escuchar', icon: 'ear' },
  { id: 'estructura', name: 'Estructura y gramática', icon: 'puzzle' },
  { id: 'significado', name: 'Significado', icon: 'brain' },
  { id: 'mesa', name: 'Juegos de mesa (2 jugadores)', icon: 'dices' },
  { id: 'turnos', name: 'Responder por turnos (en voz alta)', icon: 'mic' },
];

export interface GameMeta {
  /** Ancla de la URL: /j/:setId#ruleta abre ese juego. */
  id: string;
  name: string;
  icon: IconName;
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
  /** Juegos de mesa: en modo turnos el turno rota solo entre los N primeros de la sala. */
  roomSeats?: number;
  /** Título y explicación de cada modo en el formulario de la sala, si este juego los nombra distinto. */
  roomModeText?: Partial<Record<RoomMode, [string, string]>>;
}

const BOTH: RoomMode[] = ['turnos', 'presentador'];
const SHOW: RoomMode[] = ['presentador'];
// Juegos de responder: quien califica es quien tiene el control (oral.tsx).
const GRADING: Partial<Record<RoomMode, [string, string]>> = {
  presentador: ['Califica el anfitrión', 'Tú sacas la pregunta para cada jugador por turno y das los puntos.'],
  turnos: ['Califica el compañero', 'Quien tiene el turno califica al siguiente; se van rotando (con 3: A→B, B→C, C→A).'],
};

/** Los 28 juegos. Todos salen de las mismas preguntas del set (texto + traducción). */
export const GAMES: GameMeta[] = [
  { id: 'tarjetas', name: 'Tarjetas', icon: 'layers', skill: 'hablar', color: '#7048E8', Component: CardsGame, room: BOTH,
    purpose: 'Conversación guiada: al voltear ves la traducción y cómo empezar tu respuesta.',
    howTo: 'En parejas: uno lee la tarjeta y el otro responde con 3 oraciones. Proyectada, es un buen calentamiento.' },
  { id: 'chat', name: 'Chat', icon: 'messages', skill: 'hablar', color: '#4F46E5', Component: ChatGame, room: BOTH,
    purpose: 'Responder por escrito con frases completas, como en un chat de verdad.',
    howTo: 'Tarea o trabajo individual: al final copian sus respuestas y te las mandan por WhatsApp o correo.' },
  { id: 'ruleta', name: 'Ruleta', icon: 'circleDot', skill: 'hablar', color: '#D9481F', Component: WheelGame, room: BOTH,
    purpose: 'Hablar sin preparar: no sabes qué pregunta te va a tocar.',
    howTo: 'Proyéctala y que gire quien pase al frente. Ideal para cerrar la clase.' },
  { id: 'corcho', name: 'Corcho', icon: 'mapPin', skill: 'tablero', color: '#A8631A', Component: BoardGame, room: BOTH,
    purpose: 'Todas las preguntas a la vista para elegir y responder a tu ritmo.',
    howTo: 'Cada alumno elige una nota; o usa “nota al azar” para quien levante la mano.' },
  { id: 'puertas', name: 'Puertas sorpresa', icon: 'doorOpen', skill: 'tablero', color: '#9C36B5', Component: DoorsGame, room: BOTH,
    purpose: 'Cada puerta esconde una pregunta: eliges un número sin saber qué te va a tocar.',
    howTo: 'Proyectado: el alumno dice un número y abres la puerta. En sala, cada quien abre una en su turno.' },
  { id: 'mapa', name: 'Mapa del tesoro', icon: 'map', skill: 'tablero', color: '#B5651D', Component: MapGame, room: BOTH,
    purpose: 'Un camino de paradas en orden: cada respuesta lleva al dino un paso más cerca del tesoro.',
    howTo: 'Toda la clase avanza junta, por turnos. Si alguien no puede responder, cierra y la parada pasa al siguiente.' },
  { id: 'sobres', name: 'Sobres con reto', icon: 'mail', skill: 'tablero', color: '#D6336C', Component: LettersGame, room: BOTH,
    purpose: 'Cada sobre trae una pregunta y un reto: cuántas oraciones decir, hablar 30 segundos o pasarla a otro.',
    howTo: 'Por turnos: abre un sobre, lee el reto en voz alta y cúmplelo.' },
  { id: 'rasca', name: 'Rasca y gana', icon: 'coins', skill: 'tablero', color: '#5C7CFA', Component: ScratchGame, room: BOTH,
    purpose: 'Rasca el boleto con el dedo o el ratón para descubrir la pregunta.',
    howTo: 'Ideal en celular o tableta. En sala rasca quien tiene el turno y todos ven qué salió.' },
  { id: 'bomba', name: 'Cajas bomba', icon: 'alertTriangle', skill: 'tablero', color: '#E03131', Component: BombGame, room: BOTH,
    purpose: 'Por equipos: si responden bien abren la caja y se llevan lo que hay (puntos, doble… o una bomba que deja en 0).',
    howTo: 'Divide el salón en 2–4 equipos. Tú decides si la respuesta es buena; la suerte de la caja hace el resto.' },
  { id: 'dinos', name: 'Carrera de dinos', icon: 'footprints', skill: 'hablar', color: '#5C940D', Component: DinoRaceGame, room: BOTH,
    purpose: 'Por equipos: responder bien da derecho a tirar el dado; la suerte y las casillas sorpresa (turbo, trampa, cambio) deciden la carrera.',
    howTo: 'Divide el salón en 2–4 equipos y comparte la pantalla. Tú marcas si la respuesta es buena; gana el primer dino en llegar a la meta.' },
  { id: 'dados', name: 'Dados', icon: 'dices', skill: 'hablar', color: '#E8590C', Component: DiceGame, room: BOTH,
    purpose: 'Fluidez: el dado decide cuánto tienes que hablar (de 1 oración a 30 segundos).',
    howTo: 'Grupos de 3–4 con un celular: lanzan por turnos y cumplen el reto del número.' },
  { id: 'equipos', name: 'Equipos', icon: 'trophy', skill: 'hablar', color: '#C2255C', Component: TeamsGame, room: SHOW,
    purpose: 'Competencia por equipos con cronómetro: motiva a hablar a todo el salón.',
    howTo: 'Divide el salón en 2–4 equipos. Tú das +2, +1 o 0 según la respuesta.' },
  { id: 'pronuncia', name: 'Pronuncia', icon: 'mic', skill: 'hablar', color: '#0CA678', Component: PronounceGame, room: BOTH,
    purpose: 'Pronunciación: grabas la pregunta y se marca cada palabra en verde o rojo.',
    howTo: 'Individual, con audífonos: escuchan el modelo, lo repiten y buscan llegar al 100%. Necesita permiso de micrófono.' },
  { id: 'escucha', name: 'Escucha y elige', icon: 'ear', skill: 'escuchar', color: '#1971C2', Component: ListenGame, room: BOTH,
    purpose: 'Comprensión auditiva: escuchas la pregunta y eliges cuál es entre cuatro.',
    howTo: 'Proyectado: la clase vota la opción antes de revelar. También sirve de tarea.' },
  { id: 'dictado', name: 'Dictado', icon: 'penLine', skill: 'escuchar', color: '#0B7285', Component: DictationGame, room: BOTH,
    purpose: 'Oído y ortografía: escribes lo que oyes y se corrige palabra por palabra.',
    howTo: 'Individual. Que usen la tortuga para escuchar lento las veces que necesiten.' },
  { id: 'bingo', name: 'Bingo', icon: 'hash', skill: 'escuchar', color: '#5F3DC4', Component: BingoGame, room: SHOW, roomFree: true,
    purpose: 'Reconocer preguntas al escucharlas. Cada celular recibe un cartón distinto.',
    howTo: 'Todos abren el bingo en su celular y marcan “las canta el profesor”; tú las lees en voz alta.' },
  { id: 'ordena', name: 'Ordena', icon: 'listOrdered', skill: 'estructura', color: '#2B8A3E', Component: OrderGame, room: BOTH,
    purpose: 'Orden de la pregunta: palabra interrogativa, auxiliar, sujeto y verbo en su lugar.',
    howTo: 'Antes de hablar, para fijar la estructura (would, be able to, present perfect…).' },
  { id: 'completa', name: 'Completa', icon: 'squareDashed', skill: 'estructura', color: '#5C940D', Component: GapGame, room: BOTH,
    purpose: 'Gramática y vocabulario: eliges la palabra que falta (auxiliares, wh-words y más).',
    howTo: 'Repaso rápido al inicio de la clase o como tarea corta.' },
  { id: 'globos', name: 'Globos', icon: 'sparkles', skill: 'estructura', color: '#E64980', Component: BalloonsGame, room: BOTH,
    purpose: 'Ortografía: adivina la palabra oculta letra por letra antes de que se revienten los globos.',
    howTo: 'Proyectado y por equipos: cada equipo dice una letra por turno.' },
  { id: 'memorama', name: 'Memorama', icon: 'brain', skill: 'significado', color: '#1098AD', Component: MemoryGame, room: BOTH,
    purpose: 'Relacionar cada pregunta con su significado mientras ejercitas la memoria.',
    howTo: 'En parejas, por turnos: gana quien encuentre más pares.' },
  { id: 'contrarreloj', name: 'Contrarreloj', icon: 'timer', skill: 'significado', color: '#F08C00', Component: SpeedGame,
    purpose: 'Reconocer el significado rápido: 60 segundos, combos y récord.',
    howTo: 'Reto individual: anota en la pizarra el récord del salón.' },
  { id: 'coincide', name: '¿Coincide?', icon: 'checkCheck', skill: 'significado', color: '#2F9E44', Component: MatchGame, room: BOTH,
    purpose: 'Comprensión de lectura veloz: ¿la traducción corresponde a la pregunta?',
    howTo: 'Calentamiento de 2 minutos; se juega deslizando como en una app.' },
  { id: 'gato', name: 'Gato', icon: 'grid', skill: 'mesa', color: '#E8590C', Component: TicTacToeGame, room: BOTH, roomSeats: 2,
    purpose: 'Tres en raya: para marcar una casilla, acierta qué significa la pregunta.',
    howTo: 'Parejas en un celular (se lo pasan) o en sala, cada uno en el suyo. Proyectado: dos alumnos al frente.' },
  { id: 'conecta4', name: 'Conecta 4', icon: 'circle', skill: 'mesa', color: '#C92A2A', Component: ConnectFourGame, room: BOTH, roomSeats: 2,
    purpose: 'Suelta tu ficha solo si aciertas la pregunta. Cuatro en línea ganan.',
    howTo: 'Partida más larga que el gato: ideal por parejas o dos equipos con el tablero proyectado.' },
  { id: 'escaleras', name: 'Serpientes y escaleras', icon: 'trendingUp', skill: 'mesa', color: '#2B8A3E', Component: LaddersGame, room: BOTH, roomSeats: 2,
    purpose: 'Tira el dado y acierta para avanzar; las escaleras suben y las serpientes bajan.',
    howTo: 'Por parejas: gana quien llegue primero a la casilla 30.' },
  { id: 'entrevista', name: 'Entrevista', icon: 'podcast', skill: 'turnos', color: '#7048E8', Component: InterviewGame, room: SHOW.concat('turnos'), roomModeText: GRADING, roomFree: true,
    purpose: 'Responder en voz alta: sale una pregunta, la contestas hablando y te califican.',
    howTo: 'Tú calificas (presentador) o se califican entre ellos por turnos. Nadie escribe: solo hablan.' },
  { id: 'carrera', name: 'Carrera de respuestas', icon: 'car', skill: 'turnos', color: '#C92A2A', Component: AnswerRaceGame, room: SHOW.concat('turnos'), roomModeText: GRADING, roomFree: true,
    purpose: 'Cada respuesta buena avanza tu coche. Gana quien llegue primero a la meta.',
    howTo: 'Ideal por parejas o tríos que se califican entre ellos; proyectada, la clase ve la carrera.' },
  { id: 'papa', name: 'Papa caliente', icon: 'flame', skill: 'turnos', color: '#E67700', Component: HotPotatoGame, room: SHOW.concat('turnos'), roomModeText: GRADING, roomFree: true,
    purpose: 'Responde antes de que la papa se queme: el tiempo es secreto (de 10 a 20 segundos).',
    howTo: 'Para soltarse a hablar rápido. Quien califica marca en cuanto termina la respuesta.' },
];
