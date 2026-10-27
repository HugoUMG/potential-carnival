"""Conversación con IA por role-play (ADR-39): partidas reproducibles por seed, prompts, nota y claridad.

Nada toca la red ni la base: la IA se sustituye por dobles que devuelven el JSON que pide el prompt.
"""
import pytest

from backend.app import roleplay as rp
from backend.app.ai import speech_clarity


def _fake(reply: dict):
    calls = []

    def ask(system, user, **kwargs):
        calls.append({"system": system, "user": user, **kwargs})
        return reply
    ask.calls = calls
    return ask


def _history(*learner_lines, clarity=None):
    out = []
    for line in learner_lines:
        out += [{"who": "ai", "text": "What would you like?"}, {"who": "user", "text": line, "clarity": clarity}]
    return out


def test_todos_los_escenarios_se_arman_igual_con_el_mismo_seed_y_sin_filtrar_el_secreto():
    for sid, scenario in rp.SCENARIOS.items():
        for role in scenario.roles:
            for level in rp.LEVELS:
                first = rp.start(sid, role.id, level, 777)
                assert first == rp.start(sid, role.id, level, 777)
                assert first["cards"] and 2 <= len(first["missions"]) <= 3
                _, built = rp.session(sid, role.id, level, 777)
                public = str(first)
                assert built.secret and not any(secret in public for secret in built.secret)
    assert rp.start("restaurante", "customer", "beginner", 1) != rp.start("restaurante", "customer", "beginner", 2)


def test_escenario_rol_o_nivel_inexistentes_son_error():
    for args in (("playa", "customer", "beginner"), ("restaurante", "pirata", "beginner"), ("restaurante", "customer", "expert")):
        with pytest.raises(rp.RoleplayError):
            rp.start(*args, 1)


def test_el_prompt_lleva_los_datos_el_nivel_y_cierra_al_llegar_al_tope():
    scenario, built = rp.session("restaurante", "customer", "beginner", 5)
    system, user, closing = rp.turn_prompt(scenario, built, "customer", "beginner", [])
    assert built.cards[0]["title"] in system and "BEGINNER" in system and "reply_es" in system
    assert "You speak first" in user and not closing

    full = _history(*["I want a soup"] * rp.LEVELS["beginner"].turns)
    _, user, closing = rp.turn_prompt(scenario, built, "customer", "beginner", full)
    assert closing and "Close the conversation" in user
    _, _, closing = rp.turn_prompt(scenario, built, "customer", "advanced", full)
    assert not closing  # en avanzado se habla más


def test_la_traduccion_solo_viaja_en_principiante_y_el_chat_no_hace_fila():
    ask = _fake({"reply": "Hi! Coffee or tea?", "reply_es": "¡Hola! ¿Café o té?"})
    assert rp.reply("restaurante", "customer", "beginner", 9, [], ask)["reply_es"] == "¡Hola! ¿Café o té?"
    assert rp.reply("restaurante", "customer", "advanced", 9, [], ask)["reply_es"] == ""
    assert ask.calls[0]["serialize"] is False and ask.calls[0]["prefer_fast"] is True and ask.calls[0]["chat"] is True


def test_no_se_puede_seguir_hablando_pasado_el_tope():
    ask = _fake({"reply": "Bye!"})
    too_long = _history(*["ok"] * (rp.LEVELS["beginner"].turns + 1))
    with pytest.raises(rp.RoleplayError):
        rp.reply("restaurante", "customer", "beginner", 9, too_long, ask)


def test_la_nota_pondera_y_sin_audio_no_cuenta_la_pronunciacion():
    assert rp.final_grade({"communication": 10, "grammar": 10, "vocabulary": 10, "pronunciation": 10}) == 10
    assert rp.final_grade({"communication": 0, "grammar": 0, "vocabulary": 0, "pronunciation": 0}) == 1  # mínimo 1
    typed = rp.final_grade({"communication": 8, "grammar": 6, "vocabulary": 7, "pronunciation": None})
    assert typed == round((0.30 * 8 + 0.25 * 6 + 0.20 * 7) / 0.75, 1)


def test_la_misma_claridad_vale_menos_en_avanzado():
    assert rp.pronunciation_score([70], "beginner") > rp.pronunciation_score([70], "intermediate") > rp.pronunciation_score([70], "advanced")
    assert rp.pronunciation_score([], "beginner") is None


def test_el_informe_sanea_lo_que_devuelve_la_ia():
    history = _history("I want the soup", "Can I pay with card?", clarity=80) + [{"who": "user", "text": "yes", "clarity": None}]
    ask = _fake({
        "turns": [{"n": 1, "status": "better", "better": "I'd like the soup, please.", "why_es": "Más cortés."},
                  {"n": 2, "status": "excelente", "better": "x"}],  # status inválido → ok
        "grammar": 14, "vocabulary": "7", "communication": None,
        "missions": [True],
        "summary_es": "Bien.", "tips_es": ["Usa I'd like", ""],
    })
    out = rp.report("restaurante", "customer", "intermediate", 3, history, ask)
    assert [t["status"] for t in out["turns"]] == ["better", "ok", "ok"]  # el 3.º no vino: ok
    assert out["turns"][0]["better"] == "I'd like the soup, please." and out["turns"][1]["better"] == ""
    assert out["turns"][0]["clear"] is True and out["turns"][2]["clear"] is None
    assert out["scores"]["grammar"] == 10 and out["scores"]["vocabulary"] == 7 and out["scores"]["communication"] == 0
    assert [m["done"] for m in out["missions"]] == [True] + [False] * (len(out["missions"]) - 1)
    assert out["tips_es"] == ["Usa I'd like"]
    assert 1 <= out["grade"] <= 10
    assert ask.calls[0]["serialize"] is False


def test_sin_respuestas_del_alumno_no_hay_informe():
    with pytest.raises(rp.RoleplayError):
        rp.report("restaurante", "customer", "beginner", 3, [{"who": "ai", "text": "Hi"}], _fake({}))


def test_claridad_de_whisper():
    clear = [{"start": 0, "end": 2, "avg_logprob": -0.15, "no_speech_prob": 0.01}]
    mumbled = [{"start": 0, "end": 2, "avg_logprob": -0.9, "no_speech_prob": 0.2}]
    assert speech_clarity(clear) > 70 > speech_clarity(mumbled)
    assert speech_clarity([]) is None
    assert 0 <= speech_clarity([{"start": 0, "end": 1, "avg_logprob": 0.5, "no_speech_prob": 0}]) <= 100


def test_el_audio_de_los_juegos_y_la_conversacion_va_en_streaming(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app import main
    from backend.app.repository import repository

    store: dict[str, bytes] = {}
    monkeypatch.setattr(repository, "get_tts_audio", store.get)
    monkeypatch.setattr(repository, "put_tts_audio", store.__setitem__)
    calls = 0

    async def stream(text, voice, rate):
        nonlocal calls
        calls += 1
        for part in (b"ID3", b"-uno", b"-dos"):
            yield part

    async def broken(text, voice, rate):
        raise RuntimeError("edge caído")
        yield b""  # pragma: no cover

    monkeypatch.setattr(main, "_edge_stream", stream)
    client = TestClient(main.app)  # sin `with`: no corre el arranque
    params = {"text": "Hi", "engine": "edge", "voice": "en-GB-SoniaNeural", "rate": "-25%"}
    ok = client.get("/tts", params=params)
    assert ok.status_code == 200 and ok.content == b"ID3-uno-dos"
    assert ok.headers["cache-control"].startswith("public")
    # La segunda vez sale de `tts_cache`: no se vuelve a abrir el websocket de edge.
    assert client.get("/tts", params=params).content == b"ID3-uno-dos"
    assert calls == 1 and list(store.values()) == [b"ID3-uno-dos"]
    assert client.get("/tts", params={"text": "Hi", "engine": "edge", "voice": "en-GB-OliverNeural"}).status_code == 400

    monkeypatch.setattr(main, "_edge_stream", broken)
    assert client.get("/tts", params={"text": "Hi", "engine": "edge"}).status_code == 503  # falla antes de responder


def test_staff_notes_only_reach_the_learner_and_the_report():
    """La nota ⚠ (plato agotado) la ve el alumno-mesero y el informe; el personaje cliente no."""
    scenario, built = rp.session("restaurante", "waiter", "beginner", 7)
    note = next(n for c in built.cards for n in c["notes"] if n.startswith("⚠"))
    system, _, _ = rp.turn_prompt(scenario, built, "waiter", "beginner", [])
    assert note not in system
    _, report_user = rp.report_prompt(scenario, built, "waiter", "beginner", [{"who": "user", "text": "hi"}])
    assert note in report_user


def test_el_turno_trae_la_voz_y_sin_ella_la_conversacion_sigue(monkeypatch):
    """Una línea JSON y detrás el mp3, en la misma respuesta; si edge-tts falla, sale solo el texto."""
    import json
    from fastapi.testclient import TestClient
    from backend.app import main

    seen = {}

    async def stream(text, voice, rate):
        seen.update(text=text, voice=voice, rate=rate)
        yield b"ID3-voz"

    async def broken(text, voice, rate):
        raise RuntimeError("edge caído")
        yield b""  # pragma: no cover

    async def no_connection():
        raise OSError("sin red en los tests")

    monkeypatch.setattr(main, "ai_json", _fake({"reply": "Hi! What would you like?", "reply_es": "¡Hola!"}))
    monkeypatch.setattr(main, "_edge_connect", no_connection)  # la adelantada falla → cae a `_edge_stream`
    monkeypatch.setattr(main, "_edge_stream", stream)
    client = TestClient(main.app)  # sin `with`: no corre el arranque, no toca ninguna base
    body = {"scenario": "restaurante", "role": "customer", "level": "beginner", "seed": 3, "history": [], "rate": "-40%"}
    head, _, audio = client.post("/public/roleplay/turn", json=body).content.partition(b"\n")
    r = json.loads(head)
    assert r["reply"] == "Hi! What would you like?" and audio == b"ID3-voz"
    _, built = rp.session("restaurante", "customer", "beginner", 3)
    assert seen == {"text": "Hi! What would you like?", "voice": built.ai_voice, "rate": "-40%"}
    assert "voice" not in r  # solo viaja lo que declara RoleplayReply

    monkeypatch.setattr(main, "_edge_stream", broken)
    r = client.post("/public/roleplay/turn", json=body)
    head, _, audio = r.content.partition(b"\n")
    assert r.status_code == 200 and json.loads(head)["reply"] and audio == b""
    assert client.post("/public/roleplay/turn", json={**body, "rate": "fast'><x"}).status_code == 422


def test_la_voz_usa_la_conexion_abierta_mientras_la_ia_piensa(monkeypatch):
    """`_edge_connect` se abre antes de que la IA conteste y `_edge_speak` reenvía el mp3 de los mensajes binarios."""
    from types import SimpleNamespace

    import aiohttp
    from fastapi.testclient import TestClient
    from backend.app import main

    def binary(payload: bytes) -> SimpleNamespace:
        head = b"X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n"
        return SimpleNamespace(type=aiohttp.WSMsgType.BINARY, data=len(head).to_bytes(2, "big") + head + payload)

    class FakeWS:
        def __init__(self):
            self.sent, self.closed = [], False

        async def send_str(self, text):
            self.sent.append(text)

        async def close(self):
            self.closed = True

        async def receive(self, timeout=None):
            return self.queue.pop(0)

    FakeWS.queue = [
        SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data="X-RequestId:1\r\nPath:turn.start\r\n\r\n{}"),
        binary(b"ID3"),
        SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data="Path:audio.metadata\r\n\r\n{}"),
        binary(b"-voz"),
        SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data="Path:turn.end\r\n\r\n{}"),
        binary(b"-nunca"),
    ]

    class FakeSession:
        closed = False

        async def close(self):
            FakeSession.closed = True

    ws = FakeWS()

    async def connect():
        return FakeSession(), ws

    async def must_not_be_used(*args):
        raise AssertionError("no debía abrir otra conexión")
        yield b""  # pragma: no cover

    monkeypatch.setattr(main, "ai_json", _fake({"reply": "Fish & chips?", "reply_es": "¿Pescado?"}))
    monkeypatch.setattr(main, "_edge_connect", connect)
    monkeypatch.setattr(main, "_edge_stream", must_not_be_used)
    body = {"scenario": "restaurante", "role": "customer", "level": "beginner", "seed": 3, "history": [], "rate": "-25%"}
    _, _, audio = TestClient(main.app).post("/public/roleplay/turn", json=body).content.partition(b"\n")
    assert audio == b"ID3-voz"
    assert "Fish &amp; chips?" in ws.sent[0] and "rate='-25%'" in ws.sent[0]  # SSML escapado, con la velocidad
    assert ws.closed and FakeSession.closed


def test_las_misiones_cambian_de_una_partida_a_otra():
    sets = {tuple(rp.session("restaurante", "customer", "beginner", seed)[1].missions) for seed in range(30)}
    assert len(sets) > 5 and all(2 <= len(m) <= 3 for m in sets)


def test_sin_misiones_y_conversacion_libre():
    s = rp.start("restaurante", "waiter", "intermediate", 5, with_info=False, with_missions=False)
    assert s["cards"] == [] and s["missions"] == [] and not s["with_info"]
    scenario, built = rp.session("restaurante", "waiter", "intermediate", 5)
    free, _, _ = rp.turn_prompt(scenario, built, "waiter", "intermediate", [], info=False)
    guided, _, _ = rp.turn_prompt(scenario, built, "waiter", "intermediate", [], info=True)
    assert "Free conversation" in free and "Use ONLY the facts" not in free
    assert built.cards[0]["sections"][0]["rows"][0]["label"] not in free  # en libre el personaje tampoco ve las tarjetas
    assert "Use ONLY the facts" in guided and "Free conversation" not in guided
    _, user = rp.report_prompt(scenario, built, "waiter", "intermediate", _history("hi"), info=False, missions=False)
    assert "Cards: none" in user and "missions: none" in user
    report = rp.report("restaurante", "waiter", "intermediate", 5, _history("hi"),
                       _fake({"turns": [], "missions": [True, True]}), info=False, missions=False)
    assert report["missions"] == []


def test_mayusculas_y_puntuacion_no_son_un_error():
    ask = _fake({"turns": [{"n": 1, "status": "better", "better": "I want a lemonade, please.", "why_es": "Mayúscula"},
                           {"n": 2, "status": "wrong", "better": "I don't like fish.", "why_es": "Falta el auxiliar"}]})
    turns = rp.report("restaurante", "customer", "beginner", 1, _history("i want a lemonade please", "i no like fish"), ask)["turns"]
    assert turns[0]["status"] == "ok" and turns[0]["better"] == ""
    assert turns[1]["status"] == "wrong"
    assert rp._same_words("dont worry im fine", "Don't worry, I'm fine!")
    tips = rp.report("restaurante", "customer", "beginner", 1, _history("hi"),
                     _fake({"tips_es": ["Recuerda la mayúscula en I.", "Usa I'd like para pedir."]}))["tips_es"]
    assert tips == ["Usa I'd like para pedir."]


def test_el_cierre_no_se_adelanta_y_el_personaje_contesta_primero():
    scenario, built = rp.session("rutina", "newcomer", "beginner", 4)
    system, user, closing = rp.turn_prompt(scenario, built, "newcomer", "beginner", _history("a", "b", "c", "d", "e"))
    assert not closing and "Do NOT say goodbye yet" in user
    assert "answer it FIRST" in system and "open questions" in system and "will, going to" in system


def test_una_palabra_no_mide_la_pronunciacion_y_la_nota_alta_propone_subir():
    history = _history("I would like a lemonade, please", clarity=90) + [{"who": "user", "text": "Bye!", "clarity": 30}]
    ask = _fake({"turns": [], "grammar": 10, "vocabulary": 10, "communication": 10})
    out = rp.report("restaurante", "customer", "beginner", 1, history, ask)
    assert out["turns"][0]["clear"] is True and out["turns"][1]["clear"] is None  # "Bye!" no es "poco clara"
    assert out["scores"]["pronunciation"] == rp.pronunciation_score([90], "beginner")
    assert out["next_level"] == "intermediate"
    assert rp.report("restaurante", "customer", "advanced", 1, history, ask)["next_level"] is None
    low = _fake({"turns": [], "grammar": 4, "vocabulary": 4, "communication": 4})
    assert rp.report("restaurante", "customer", "beginner", 1, history, low)["next_level"] is None
