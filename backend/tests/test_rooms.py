"""Salas de juego (ADR-40): el servidor solo vigila quién tiene el control y la versión.

Lógica pura en memoria: no importa `main` ni toca la BD (regla 2).
"""
import json

import pytest

from backend.app import rooms
from backend.app.live import LiveError


@pytest.fixture(autouse=True)
def _clean():
    rooms._rooms.clear()


def _status(fn, *args) -> int:
    with pytest.raises(LiveError) as exc:
        fn(*args)
    return exc.value.status


def _room(mode: str = "turnos"):
    room, host = rooms.create_room("memorama", "set-1", mode, "Ana")
    b = room.join("Luis")
    c = room.join("Eva")
    return room, host, b, c


def test_el_estado_publico_no_lleva_tokens():
    room, host, b, _ = _room()
    dumped = json.dumps(room.public_state())
    assert host.token not in dumped and b.token not in dumped
    assert [p["name"] for p in room.public_state()["players"]] == ["Ana", "Luis", "Eva"]
    assert room.turn == host.id


def test_los_juegos_de_mesa_de_responder_y_tableros_abren_sala():
    for game in ("gato", "conecta4", "escaleras", "entrevista", "carrera", "papa",
                 "puertas", "mapa", "sobres", "rasca", "bomba"):
        assert rooms.create_room(game, "s", "turnos", "Ana")[0].game == game


def test_contrarreloj_y_modos_raros_no_abren_sala():
    assert _status(rooms.create_room, "contrarreloj", "s", "turnos", "Ana") == 422
    assert _status(rooms.create_room, "memorama", "s", "libre", "Ana") == 422


def test_nombre_vacio_o_largo_y_sala_llena():
    room, *_ = _room()
    assert _status(room.join, "   ") == 422
    assert _status(room.join, "x" * 25) == 422
    for i in range(rooms.MAX_PLAYERS - 3):
        room.join(f"P{i}")
    assert _status(room.join, "Uno más") == 409


def test_solo_escribe_quien_tiene_el_turno_y_sobre_la_ultima_version():
    room, host, b, c = _room()
    assert _status(room.push, b.token, 0, {"x": 1}, b.id) == 403
    room.push(host.token, 0, {"x": 1}, b.id)          # pasa el turno a Luis
    assert room.version == 1 and room.turn == b.id
    assert _status(room.push, b.token, 0, {"x": 2}, c.id) == 409   # versión vieja
    assert _status(room.push, b.token, 1, {"x": 2}, "nadie") == 422
    room.push(b.token, 1, {"x": 2}, c.id)
    assert room.turn == c.id and room.state == {"x": 2}


def test_turn_solo_lo_reparte_el_anfitrion():
    room, host, b, c = _room()
    assert _status(room.pass_turn, b.token, c.id, None) == 403
    room.pass_turn(host.token, c.id, None)
    assert room.turn == c.id


def test_presentador_sin_ceder_solo_mueve_el_anfitrion():
    room, host, b, _ = _room("presentador")
    assert _status(room.push, b.token, 0, {}, host.id) == 403
    room.push(host.token, 0, {"a": 1}, host.id)


def test_ceder_un_turno_y_devolverlo():
    room, host, b, c = _room("presentador")
    assert _status(room.pass_turn, host.token, b.id, None) == 422   # hay que elegir cómo
    room.pass_turn(host.token, b.id, "once")
    assert room.lend == "once"
    room.push(b.token, room.version, {"a": 1}, b.id)                # sigue moviendo
    assert _status(room.push, b.token, room.version, {}, c.id) == 422   # no se lo pasa a otro
    room.push(b.token, room.version, {"a": 2}, host.id)             # lo devuelve
    assert room.lend is None and room.turn == host.id
    assert _status(room.push, b.token, room.version, {}, b.id) == 403


def test_ceder_sin_limite_y_recuperar():
    room, host, b, _ = _room("presentador")
    room.pass_turn(host.token, b.id, "always")
    for i in range(3):
        room.push(b.token, room.version, {"i": i}, b.id)
    room.push(host.token, room.version, {"i": "corrige"}, b.id)     # el anfitrión siempre escribe
    room.pass_turn(host.token, host.id, None)
    assert room.turn == host.id and room.lend is None
    assert _status(room.push, b.token, room.version, {}, b.id) == 403


def test_blob_demasiado_grande():
    room, host, *_ = _room()
    assert _status(room.push, host.token, 0, {"x": "a" * rooms.MAX_STATE_BYTES}, host.id) == 413


def test_sin_cambios_el_poll_no_trae_el_blob():
    room, host, *_ = _room()
    room.push(host.token, 0, {"x": 1}, host.id)
    assert "state" not in room.public_state(since=1)
    assert room.public_state(since=0)["state"] == {"x": 1}


def test_codigo_desconocido():
    assert _status(rooms.get_room, "ZZZZ") == 404
    room, *_ = _room()
    assert rooms.get_room(room.code.lower()) is room


def test_cualquier_jugador_dice_su_respuesta_aunque_no_tenga_el_control():
    room, host, b, _ = _room()
    assert room.turn == host.id
    room.say(b.token, "  I live   in Guatemala ")
    said = room.public_state()["said"]
    assert said == {"pid": b.id, "name": "Luis", "text": "I live in Guatemala", "n": 1}
    room.say(host.token, "x" * 1000)
    assert room.public_state()["said"]["n"] == 2 and len(room.public_state()["said"]["text"]) == rooms.MAX_SAID
    assert _status(room.say, b.token, "   ") == 422
    assert _status(room.say, "token-falso", "hola") == 403
