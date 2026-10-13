import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoom, getRoom, joinRoom, passRoomTurn, pushRoomState, RoomError, type RoomJoined } from '../services/api';
import type { RoomLend, RoomMode, RoomState } from '../types';
import { nextTurn, RoomContext, saveSeat, type Blob, type RoomCtx, type Seat } from './roomState';
import { copyText, playAudio, setSpeakGate } from './util';

/* Componentes de la sala de juego (ADR-40). Hooks y lógica pura en `roomState.ts`. */

interface Say { text: string; slow: boolean; n: number }

// ── Proveedor: polling, escrituras y audio ────────────────────────────────────

/** `free`: quien no tiene el control también toca el juego (Bingo); si no, el juego queda `inert`. */
export function RoomProvider({ seat, initial, free = false, onLeave, children }: { seat: Seat; initial: RoomState; free?: boolean; onLeave: () => void; children: ReactNode }) {
  const { token, me } = seat;
  const code = initial.code;
  const [room, setRoom] = useState<RoomState>(initial);
  const [view, setView] = useState<Blob>(initial.state ?? {});
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);

  const server = useRef<Blob>(initial.state ?? {});
  const viewRef = useRef<Blob>(initial.state ?? {});
  const version = useRef(initial.version);
  const pending = useRef<Blob>({});
  const turnNext = useRef<string | null>(null);
  const busy = useRef(false);
  const scheduled = useRef(false);
  const roomRef = useRef(room);
  const canActRef = useRef(initial.turn === me);
  const canAct = room.turn === me;
  // Layout: corre antes que los efectos de los hijos, que es donde `useShared` escribe.
  useLayoutEffect(() => { roomRef.current = room; canActRef.current = room.turn === me; }, [room, me]);

  const adopt = useCallback((next: RoomState) => {
    if (next.version < version.current) return; // respuesta vieja que llegó tarde
    version.current = next.version;
    if (next.state) {
      server.current = next.state;
      viewRef.current = { ...next.state, ...pending.current };
      setView(viewRef.current);
    }
    setRoom(next);
  }, []);

  const refresh = useCallback(async (full: boolean) => {
    try {
      adopt(await getRoom(code, token, full ? null : version.current));
    } catch (e) {
      if (e instanceof RoomError && e.status === 404) setGone(true);
    }
  }, [adopt, code, token]);

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(() => { void flushRef.current(); });
  }, []);

  // Una sola petición en vuelo: lo que cambie mientras tanto (varios setters, letra por letra,
  // la animación del dado) se junta y sale en la siguiente.
  useEffect(() => {
    flushRef.current = async () => {
      scheduled.current = false;
      if (busy.current) return;
      if (!Object.keys(pending.current).length && turnNext.current === null) return;
      busy.current = true;
      const sent = { ...pending.current };
      const turnSent = turnNext.current;
      const body = { ...server.current, ...sent, __ready: true };
      try {
        const next = await pushRoomState(code, token, version.current, body, turnSent ?? roomRef.current.turn);
        server.current = body;
        for (const k of Object.keys(sent)) if (pending.current[k] === sent[k]) delete pending.current[k];
        if (turnNext.current === turnSent) turnNext.current = null;
        adopt(next);
        setError('');
      } catch (e) {
        // 409/403: el anfitrión cambió algo o recuperó el control antes. Manda el servidor.
        pending.current = {};
        turnNext.current = null;
        if (!(e instanceof RoomError && (e.status === 409 || e.status === 403))) setError(e instanceof Error ? e.message : 'No se pudo guardar la jugada');
        busy.current = false;
        await refresh(true);
      } finally {
        busy.current = false;
      }
      if (Object.keys(pending.current).length || turnNext.current !== null) schedule();
    };
  }, [adopt, code, refresh, schedule, token]);

  const write = useCallback((key: string, value: unknown) => {
    if (!canActRef.current) return;
    pending.current[key] = value;
    viewRef.current = { ...viewRef.current, [key]: value };
    setView(viewRef.current);
    schedule();
  }, [schedule]);

  const peek = useCallback(() => viewRef.current, []);

  const endTurn = useCallback(() => {
    if (!canActRef.current) return;
    const next = nextTurn(roomRef.current, me);
    if (next === null || next === me) return;
    turnNext.current = next;
    canActRef.current = false; // bloquea ya: no esperar a la respuesta para soltar el control
    setRoom((r) => ({ ...r, turn: next, lend: next === r.host_id ? null : r.lend }));
    schedule();
  }, [me, schedule]);

  const addPoint = useCallback((n = 1) => {
    if (roomRef.current.mode !== 'turnos') return;
    const scores = (viewRef.current.__scores ?? {}) as Record<string, number>;
    write('__scores', { ...scores, [me]: (scores[me] ?? 0) + n });
  }, [me, write]);

  // Polling de 1 s (como live.py). Se pausa con la pestaña oculta o con jugadas sin confirmar.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden || busy.current || Object.keys(pending.current).length) return;
      void refresh(false);
    }, 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Audio: quien mueve suena y lo anuncia en `__say`; los demás callan su `speak` y suenan aquí.
  useEffect(() => {
    setSpeakGate((text, slow) => {
      if (!canActRef.current) return false;
      const prev = viewRef.current.__say as Say | undefined;
      write('__say', { text, slow, n: (prev?.n ?? 0) + 1 });
      return true;
    });
    return () => setSpeakGate(null);
  }, [write]);
  const lastSay = useRef((initial.state?.__say as Say | undefined)?.n ?? 0);
  const say = view.__say as Say | undefined;
  useEffect(() => {
    if (!say || say.n === lastSay.current) return;
    lastSay.current = say.n;
    if (!canActRef.current) playAudio(say.text, say.slow);
  }, [say]);

  const passTurn = useCallback(async (to: string, lend?: RoomLend) => {
    try {
      adopt(await passRoomTurn(code, token, to, lend));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pasar el control');
    }
  }, [adopt, code, token]);

  const isHost = room.host_id === me;
  const ctx = useMemo<RoomCtx>(() => ({ room, me, isHost, canAct, view, write, peek, endTurn, addPoint }),
    [room, me, isHost, canAct, view, write, peek, endTurn, addPoint]);

  return (
    <RoomContext.Provider value={ctx}>
      <RoomBar room={room} me={me} scores={(view.__scores ?? {}) as Record<string, number>} error={gone ? 'La sala ya terminó.' : error} onPass={passTurn} onLeave={onLeave} />
      {gone ? null : !isHost && !view.__ready ? (
        <p className="dg-notice">Esperando al anfitrión…</p>
      ) : (
        <div inert={!canAct && !free} className={canAct || free ? undefined : 'dg-room-locked'}>{children}</div>
      )}
    </RoomContext.Provider>
  );
}

// ── Barra de la sala ──────────────────────────────────────────────────────────

function RoomBar({ room, me, scores, error, onPass, onLeave }: {
  room: RoomState; me: string; scores: Record<string, number>; error: string;
  onPass: (to: string, lend?: RoomLend) => void; onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = room.host_id === me;
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? '…';
  const host = room.players.find((p) => p.id === room.host_id);
  const status = room.mode === 'turnos'
    ? (room.turn === me ? '▶ Tu turno' : `▶ Turno de ${nameOf(room.turn)}`)
    : room.lend
      ? `🎮 ${room.turn === me ? 'Ahora mueves tú' : `Ahora mueve ${nameOf(room.turn)}`} (${room.lend === 'once' ? '1 turno' : 'sin límite'})`
      : isHost ? '👀 Todos ven lo que haces' : `👀 Viendo a ${host?.name ?? 'el anfitrión'}`;
  const link = `${window.location.origin}${window.location.pathname}?sala=${room.code}${window.location.hash}`;
  const copy = () => { void copyText(link).then((ok) => { setCopied(ok); window.setTimeout(() => setCopied(false), 1500); }); };

  return (
    <section className="dg-room" aria-label="Sala">
      <div className="dg-room-top">
        <b className="dg-room-code" title="Código de la sala">{room.code}</b>
        <span className="dg-room-mode">{room.mode === 'turnos' ? 'Por turnos' : 'Presentador'}</span>
        <button type="button" className="dg-btn small" onClick={copy}>{copied ? '¡Copiado!' : 'Copiar enlace'}</button>
        <button type="button" className="dg-link" onClick={onLeave}>Salir</button>
      </div>
      <p className="dg-room-status" aria-live="polite">{status}</p>
      <ul className="dg-room-players">
        {room.players.map((p) => (
          <li key={p.id} className={`${p.id === room.turn ? 'is-turn' : ''} ${p.online ? '' : 'is-off'}`}>
            <span>{p.id === room.host_id && '👑 '}{p.name}{p.id === me && ' (tú)'}</span>
            {room.mode === 'turnos' && <b>{scores[p.id] ?? 0}</b>}
            {isHost && p.id !== me && room.mode === 'turnos' && p.id !== room.turn && (
              <button type="button" className="dg-room-act" onClick={() => onPass(p.id)}>Dar turno</button>
            )}
            {isHost && p.id !== me && room.mode === 'presentador' && (
              <>
                <button type="button" className="dg-room-act" onClick={() => onPass(p.id, 'once')}>1 turno</button>
                <button type="button" className="dg-room-act" onClick={() => onPass(p.id, 'always')}>Sin límite</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {isHost && room.turn !== me && (
        <button type="button" className="dg-btn small primary" onClick={() => onPass(me)}>
          {room.mode === 'presentador' ? 'Recuperar control' : 'Tomar el turno'}
        </button>
      )}
      {error && <p className="dg-room-error" role="alert">{error}</p>}
    </section>
  );
}

// ── Crear o unirse ────────────────────────────────────────────────────────────

const NAME_KEY = 'dg-name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };

export function RoomGate({ game, setId, modes, joinCode, onEnter, onCancel }: {
  game: string; setId: string; modes: RoomMode[]; joinCode?: string;
  onEnter: (seat: Seat, room: RoomState) => void; onCancel: () => void;
}) {
  const [tab, setTab] = useState<'crear' | 'unirme'>(joinCode ? 'unirme' : 'crear');
  const [name, setName] = useState(readName);
  const [code, setCode] = useState(joinCode ?? '');
  const [mode, setMode] = useState<RoomMode>(modes[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const clean = code.trim().toUpperCase();
      const joined: RoomJoined = tab === 'crear' ? await createRoom(game, setId, mode, name) : await joinRoom(clean, name);
      try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* solo recuerda el nombre */ }
      const seat = { token: joined.token, me: joined.me };
      saveSeat(joined.code, seat);
      // La sala es de otro set o de otro juego: se abre ahí, ya con el asiento guardado.
      if (joined.set_id !== setId || joined.game !== game) {
        window.location.assign(`/j/${encodeURIComponent(joined.set_id)}?sala=${joined.code}#${joined.game}`);
        return;
      }
      onEnter(seat, joined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar');
      setBusy(false);
    }
  };

  return (
    <form className="dg-room-gate" onSubmit={(e) => { void submit(e); }}>
      <h2>👥 Jugar en grupo</h2>
      {!joinCode && (
        <div className="dg-room-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'crear'} onClick={() => setTab('crear')}>Crear sala</button>
          <button type="button" role="tab" aria-selected={tab === 'unirme'} onClick={() => setTab('unirme')}>Unirme con código</button>
        </div>
      )}
      {joinCode && <p className="dg-muted center">Vas a entrar a la sala <b>{joinCode}</b>.</p>}
      <label>Tu nombre
        <input className="dg-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required autoFocus />
      </label>
      {tab === 'unirme' && !joinCode && (
        <label>Código de la sala
          <input className="dg-input dg-room-codein" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} required autoCapitalize="characters" />
        </label>
      )}
      {tab === 'crear' && modes.length > 1 && (
        <fieldset className="dg-room-modes">
          <legend>Modo</legend>
          <label><input type="radio" name="mode" checked={mode === 'turnos'} onChange={() => setMode('turnos')} />
            <span><b>Por turnos</b> Cada uno juega en su turno; gana quien sume más.</span></label>
          <label><input type="radio" name="mode" checked={mode === 'presentador'} onChange={() => setMode('presentador')} />
            <span><b>Presentador</b> Solo tú mueves y los demás ven lo mismo. Puedes ceder el control.</span></label>
        </fieldset>
      )}
      {error && <p className="dg-room-error" role="alert">{error}</p>}
      <div className="dg-row">
        <button type="button" className="dg-btn" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="dg-btn primary grow" disabled={busy}>{tab === 'crear' ? 'Crear sala' : 'Entrar'}</button>
      </div>
    </form>
  );
}
