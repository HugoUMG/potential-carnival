"""Salas de juego: varios alumnos ven y juegan EL MISMO juego de `/j/:setId` (ADR-40).

El servidor NO entiende ningún juego: guarda el estado como un blob opaco (`state`) y solo vigila
dos cosas — quién tiene el control (`turn`) y que nadie escriba sobre una versión vieja
(`version`). Las reglas del juego viven en el navegador de quien mueve (autoridad en el cliente:
en una clase, la trampa desde DevTools no importa, y así el mismo backend sirve para todos).

Mismo patrón que `live.py`: LÓGICA PURA en memoria, sin `main` ni BD (regla 2: se prueba sin
cargar el `.env` de producción). ponytail: dict de módulo y polling de 1 s; un worker en Render.
Techos: un redeploy borra las salas, varios workers necesitarían Redis, y si la latencia molesta
el salto es a WebSockets.
"""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from .live import CODE_ALPHABET, LiveError

# Juegos que admiten sala. Duplicado del campo `room` de `GAMES` en `src/games/registry.ts`.
# Contrarreloj queda fuera: es una carrera de 60 s y con polling de 1 s se vería a saltos.
ROOM_GAMES = frozenset({
    "memorama", "tarjetas", "chat", "ruleta", "corcho", "dados", "equipos", "pronuncia",
    "escucha", "dictado", "bingo", "ordena", "completa", "globos", "coincide",
    "gato", "conecta4", "escaleras", "entrevista", "carrera", "papa",
})
MODES = ("turnos", "presentador")
LENDS = ("once", "always")

CODE_LENGTH = 4
MAX_PLAYERS = 8
MAX_NAME = 24
MAX_STATE_BYTES = 50_000   # Chat guarda respuestas escritas; lo demás son índices
MAX_ROOMS = 500
ROOM_TTL_SECONDS = 3 * 3600
# Sin poll en este tiempo, el jugador sale como desconectado y el turno se lo salta. Holgado a
# propósito: en clase virtual el alumno tiene Meet/Zoom delante y nuestra pestaña en segundo
# plano, donde Chrome espacia los timers (hasta 1 por minuto tras 5 min oculta).
ONLINE_WINDOW = 90.0
MAX_SAID = 400             # caracteres de lo que un jugador dijo (transcripción de su respuesta)


@dataclass
class Player:
    id: str
    token: str   # secreto: NUNCA sale en `public_state`
    name: str
    last_seen: float = field(default_factory=time.monotonic)


@dataclass
class Room:
    code: str
    game: str
    set_id: str
    mode: str
    host_id: str
    players: list[Player]
    turn: str
    lend: str | None = None
    state: dict[str, Any] = field(default_factory=dict)
    version: int = 0
    created_at: float = field(default_factory=time.monotonic)
    # Lo último que dijo un jugador (su respuesta por voz, transcrita). Va fuera de `state` porque
    # quien responde casi nunca tiene el control: cualquier jugador de la sala puede escribirlo.
    said: dict[str, Any] | None = None

    def player(self, token: str) -> Player:
        for p in self.players:
            if secrets.compare_digest(p.token, token or ""):
                return p
        raise LiveError("No estás en esta sala", status=403)

    def touch(self, token: str | None) -> Player | None:
        if not token:
            return None
        try:
            p = self.player(token)
        except LiveError:
            return None
        p.last_seen = time.monotonic()
        return p

    def join(self, name: str) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise LiveError(f"La sala está llena (máximo {MAX_PLAYERS})", status=409)
        p = _new_player(name, {q.id for q in self.players})
        self.players.append(p)
        return p

    def push(self, token: str, version: int, state: dict[str, Any], turn: str) -> None:
        p = self.player(token)
        is_host = p.id == self.host_id
        if not is_host and self.turn != p.id:
            raise LiveError("No tienes el control", status=403)
        if version != self.version:
            raise LiveError("El juego cambió mientras movías", status=409)
        if len(json.dumps(state, ensure_ascii=False).encode()) > MAX_STATE_BYTES:
            raise LiveError("El estado del juego es demasiado grande", status=413)
        if not any(q.id == turn for q in self.players):
            raise LiveError("Ese jugador no está en la sala", status=422)
        # En presentador, quien recibió el control solo puede seguir o devolverlo al anfitrión.
        if self.mode == "presentador" and not is_host and turn not in (p.id, self.host_id):
            raise LiveError("Solo puedes devolver el control al anfitrión", status=422)
        self.state = state
        self.turn = turn
        if self.mode == "presentador" and turn == self.host_id:
            self.lend = None
        self.version += 1

    def say(self, token: str, text: str) -> None:
        p = self.player(token)
        text = " ".join((text or "").split())[:MAX_SAID]
        if not text:
            raise LiveError("No se escuchó nada", status=422)
        n = (self.said or {}).get("n", 0) + 1
        self.said = {"pid": p.id, "name": p.name, "text": text, "n": n}

    def pass_turn(self, token: str, to: str, lend: str | None) -> None:
        if self.player(token).id != self.host_id:
            raise LiveError("Solo el anfitrión reparte el control", status=403)
        if not any(q.id == to for q in self.players):
            raise LiveError("Ese jugador no está en la sala", status=422)
        if self.mode == "presentador":
            if to == self.host_id:
                lend = None
            elif lend not in LENDS:
                raise LiveError("Elige ceder un turno o sin límite", status=422)
            self.lend = lend
        self.turn = to
        self.version += 1

    def public_state(self, since: int | None = None) -> dict[str, Any]:
        now = time.monotonic()
        out: dict[str, Any] = {
            "code": self.code, "game": self.game, "set_id": self.set_id, "mode": self.mode,
            "host_id": self.host_id, "turn": self.turn, "lend": self.lend, "version": self.version,
            "players": [{"id": p.id, "name": p.name, "online": now - p.last_seen < ONLINE_WINDOW} for p in self.players],
            "said": self.said,
        }
        # Sin cambios desde el último poll, el blob (lo pesado) no viaja.
        if since != self.version:
            out["state"] = self.state
        return out


_rooms: dict[str, Room] = {}


def _clean_name(name: str) -> str:
    name = " ".join((name or "").split())
    if not name or len(name) > MAX_NAME:
        raise LiveError(f"El nombre debe tener entre 1 y {MAX_NAME} caracteres", status=422)
    return name


def _new_player(name: str, taken: set[str]) -> Player:
    pid = secrets.token_hex(3)
    while pid in taken:
        pid = secrets.token_hex(3)
    return Player(id=pid, token=secrets.token_urlsafe(16), name=_clean_name(name))


def _new_code() -> str:
    for _ in range(50):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if code not in _rooms:
            return code
    raise LiveError("No se pudo generar un código libre", status=503)


def _evict() -> None:
    now = time.monotonic()
    for code in [c for c, r in _rooms.items() if now - r.created_at > ROOM_TTL_SECONDS]:
        del _rooms[code]
    while len(_rooms) >= MAX_ROOMS:
        del _rooms[min(_rooms.values(), key=lambda r: r.created_at).code]


def create_room(game: str, set_id: str, mode: str, name: str) -> tuple[Room, Player]:
    if game not in ROOM_GAMES:
        raise LiveError("Este juego no se puede jugar en grupo", status=422)
    if mode not in MODES:
        raise LiveError("Modo de sala desconocido", status=422)
    set_id = (set_id or "").strip()
    if not set_id or len(set_id) > 64:
        raise LiveError("Falta el set de preguntas", status=422)
    host = _new_player(name, set())
    _evict()
    room = Room(code=_new_code(), game=game, set_id=set_id, mode=mode, host_id=host.id,
                players=[host], turn=host.id)
    _rooms[room.code] = room
    return room, host


def get_room(code: str) -> Room:
    room = _rooms.get((code or "").strip().upper())
    if room is None:
        raise LiveError("Esa sala no existe o ya terminó", status=404)
    return room
