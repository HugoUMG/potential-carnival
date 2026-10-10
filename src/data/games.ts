/**
 * Catálogo de /juegos.
 *
 * Cada juego es UN archivo HTML autocontenido en `public/jugar/` (ADR-37): no usa React ni el
 * backend, así que se abre sin sesión y se comparte con un enlace. Para añadir uno: copiar su HTML
 * a `public/jugar/` y agregar aquí su entrada — `GamesPage` lo pinta solo.
 */
export interface GameMode {
  /** Ancla que el HTML del juego entiende (`/jugar/x.html#ruleta` abre esa pestaña). */
  hash: string;
  label: string;
  topic: string;
  emoji: string;
}

export interface Game {
  id: string;
  title: string;
  level: string;
  skill: string;
  questions: number;
  description: string;
  /** Ruta del archivo en `public/`. Va con `.html`: sin la extensión, Render la mandaría a la SPA. */
  href: string;
  modes: GameMode[];
}

export const GAMES: Game[] = [
  {
    id: 'b1-speaking',
    title: 'B1 Speaking Games',
    level: 'B1',
    skill: 'Speaking',
    questions: 40,
    description:
      'Cuatro juegos de conversación con 10 preguntas cada uno, con traducción y un temporizador de 30 segundos para responder.',
    href: '/jugar/b1-speaking.html',
    modes: [
      { hash: 'cards', label: 'Tarjetas', topic: 'Vida diaria', emoji: '🃏' },
      { hash: 'chat', label: 'Chat', topic: 'Viajes y planes', emoji: '💬' },
      { hash: 'ruleta', label: 'Ruleta', topic: 'Tecnología y futuro', emoji: '🎡' },
      { hash: 'corcho', label: 'Corcho', topic: 'Comida, salud y hábitos', emoji: '📌' },
    ],
  },
];
