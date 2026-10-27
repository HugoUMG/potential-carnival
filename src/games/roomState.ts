import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { RoomState } from '../types';

/* Salas de juego (ADR-40). El servidor (`backend/app/rooms.py`) guarda un blob opaco y vigila quién
 * tiene el control; las reglas de cada juego siguen en su componente. La pieza que lo conecta es
 * `useShared`: un `useState` que, dentro de una sala, lee del blob y solo escribe quien mueve.
 * Los componentes (proveedor, barra, formulario) están en `room.tsx`. */

export type Blob = Record<string, unknown>;

export interface RoomCtx {
  room: RoomState | null;
  me: string | null;
  isHost: boolean;
  /** ¿Este navegador puede mover? Sin sala, siempre. */
  canAct: boolean;
  view: Blob;
  write: (key: string, value: unknown) => void;
  peek: () => Blob;
  /** Termina "un turno" del juego: en turnos pasa al siguiente; con el control cedido por un turno,
   *  vuelve al anfitrión. Llamarlo DESPUÉS de los setters de esa jugada. */
  endTurn: () => void;
  /** Punto para quien mueve. Solo cuenta en modo turnos (lo enseña la barra de la sala). */
  addPoint: (n?: number) => void;
  /** Publica lo que dijo este jugador (su respuesta por voz). Funciona sin tener el control. */
  say: (text: string) => Promise<void>;
}

const noop = () => {};
const SOLO: RoomCtx = { room: null, me: null, isHost: false, canAct: true, view: {}, write: noop, peek: () => ({}), endTurn: noop, addPoint: noop, say: async () => {} };
export const RoomContext = createContext<RoomCtx>(SOLO);
export const useRoom = () => useContext(RoomContext);

/** Quién mueve después de `me` al terminar su turno (null = nadie cambia).
 *  - turnos: el siguiente jugador conectado, en orden de llegada; si no hay otro, nadie cambia.
 *    Con `seats` (juegos de mesa de 2) rota solo entre los `seats` primeros; el resto mira.
 *  - presentador con el control cedido "un turno": vuelve al anfitrión. */
export function nextTurn(room: Pick<RoomState, 'mode' | 'lend' | 'host_id' | 'players'>, me: string, seats?: number): string | null {
  if (room.mode === 'presentador') return room.lend === 'once' && me !== room.host_id ? room.host_id : null;
  const players = seats ? room.players.slice(0, seats) : room.players;
  const i = players.findIndex((p) => p.id === me);
  for (let k = 1; k <= players.length; k++) {
    const p = players[(i + k) % players.length];
    if (p.id !== me && p.online) return p.id;
  }
  return null;
}

/** `useState` que se comparte en una sala. Sin sala es exactamente `useState`. En sala:
 *  - el valor sale del blob; si falta la clave, el anfitrión escribe `init` (así todos ven el
 *    mismo reparto o barajada);
 *  - el setter no hace nada si este navegador no tiene el control, por eso los efectos y
 *    temporizadores del juego pueden correr en todos sin peligro;
 *  - los valores tienen que ser JSON (nada de `Set`). */
export function useShared<T>(key: string, init: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const { room, view, isHost, canAct, write, peek } = useRoom();
  const [local, setLocal] = useState(init);
  const inRoom = room !== null;
  const missing = inRoom && !(key in view);
  useEffect(() => {
    if (missing && isHost && canAct) write(key, local);
  }, [missing, isHost, canAct, write, key, local]);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    if (!inRoom) { setLocal(next); return; }
    const cur = peek();
    const prev = (key in cur ? cur[key] : local) as T;
    write(key, typeof next === 'function' ? (next as (p: T) => T)(prev) : next);
  }, [inRoom, peek, write, key, local]);
  return [(inRoom && !missing ? view[key] : local) as T, set];
}

// ── Asiento (token) guardado: un F5 no te saca de la sala ─────────────────────

export interface Seat { token: string; me: string }
const seatKey = (code: string) => `dg-room-${code}`;

export function loadSeat(code: string): Seat | null {
  try { return JSON.parse(sessionStorage.getItem(seatKey(code)) ?? 'null') as Seat | null; } catch { return null; }
}
export function saveSeat(code: string, seat: Seat): void {
  try { sessionStorage.setItem(seatKey(code), JSON.stringify(seat)); } catch { /* sin almacenamiento: F5 pide el nombre otra vez */ }
}
export function dropSeat(code: string): void {
  try { sessionStorage.removeItem(seatKey(code)); } catch { /* nada que borrar */ }
}

// ── Aviso de turno (clase virtual) ────────────────────────────────────────────

/** Cuando `active` pasa a true —te toca—: un pitido corto, vibración y, si la pestaña está detrás
 *  de Meet/Zoom, el título parpadea con `label` hasta que vuelvas. Sin assets: WebAudio. */
export function useTurnAlert(active: boolean, label: string): void {
  const was = useRef(active);
  useEffect(() => {
    const fire = active && !was.current;
    was.current = active;
    if (!fire) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        [0, 0.18].forEach((at, k) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = k ? 1046 : 784;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
          gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + at);
          osc.stop(ctx.currentTime + at + 0.18);
        });
        window.setTimeout(() => { void ctx.close(); }, 600);
      }
    } catch { /* sin audio: queda el título */ }
    navigator.vibrate?.(200);
    if (!document.hidden) return;
    const original = document.title;
    let on = false;
    const id = window.setInterval(() => { on = !on; document.title = on ? `Turno: ${label}` : original; }, 900);
    const back = () => { if (document.hidden) return; window.clearInterval(id); document.title = original; document.removeEventListener('visibilitychange', back); };
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(id); document.title = original; document.removeEventListener('visibilitychange', back); };
  }, [active, label]);
}
