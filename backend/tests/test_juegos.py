"""Juegos de práctica (ADR-38): sets por profesor, diccionario por palabra hecho por IA y audio gratis.

Nada toca la red ni la base real: SQLite temporal (como test_teacher_images.py) y la IA con dobles.
"""
import asyncio
import json
import re

import pytest
from fastapi import BackgroundTasks, HTTPException

from backend.app import ai, main
from backend.app.database import get_connection, initialize_database
from backend.app.models import GameQuestion, GameSetPayload, PublicUser, UserRole

PROF_A = PublicUser(id="prof-a", name="A", username="a", role=UserRole.teacher)
PROF_B = PublicUser(id="prof-b", name="B", username="b", role=UserRole.teacher)


@pytest.fixture
def db(tmp_path, monkeypatch):
    # Sin esto el test correría contra la base de PRODUCCIÓN si el .env local apunta a Aiven.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "test.db"))
    initialize_database()
    with get_connection() as conn:
        conn.execute("INSERT INTO users (id, name, username, password_hash, role) VALUES ('prof-a', 'A', 'a', 'x', 'teacher')")
        conn.execute("INSERT INTO users (id, name, username, password_hash, role) VALUES ('prof-b', 'B', 'b', 'x', 'teacher')")
    main._glossary_jobs.clear()
    main._words_attempted.clear()


def _payload(*texts: str, featured: bool = False) -> GameSetPayload:
    return GameSetPayload(title="Set", featured=featured, questions=[GameQuestion(text=t, translation="t") for t in texts])


FOUR = ("Where would you go?", "What would you eat?", "Who would you call?", "How would you feel?")


def _run(background: BackgroundTasks) -> None:
    for task in background.tasks:
        task.func(*task.args, **task.kwargs)


def test_las_palabras_del_set_salen_como_las_parte_el_front():
    words = main._set_words([GameQuestion(text="What’s your favorite food? What's yours?")])
    assert words == ["what's", "your", "favorite", "food", "yours"]  # apóstrofo curvo = recto, sin repetir


def test_un_set_necesita_entre_4_y_60_preguntas_y_las_vacias_no_cuentan(db):
    with pytest.raises(HTTPException) as exc:
        main.create_game_set(_payload("A?", "B?", "C?", "   "), BackgroundTasks(), PROF_A)
    assert exc.value.status_code == 422 and "tiene 3" in exc.value.detail


def test_un_profesor_no_edita_ni_borra_el_juego_de_otro(db, monkeypatch):
    monkeypatch.setattr(main, "define_words", lambda words: [])
    game = main.create_game_set(_payload(*FOUR), BackgroundTasks(), PROF_A)

    assert [g.id for g in main.list_game_sets(PROF_A)] == [game.id]
    assert main.list_game_sets(PROF_B) == []
    for call in (lambda: main.update_game_set(game.id, _payload(*FOUR), BackgroundTasks(), PROF_B),
                 lambda: main.delete_game_set(game.id, PROF_B)):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 403

    main.delete_game_set(game.id, PROF_A)
    assert main.list_game_sets(PROF_A) == []


def test_solo_los_destacados_salen_en_el_catalogo_publico(db):
    main.create_game_set(_payload(*FOUR), BackgroundTasks(), PROF_A)
    featured = main.create_game_set(_payload(*FOUR, featured=True), BackgroundTasks(), PROF_A)
    assert [(s.id, s.question_count) for s in main.public_game_sets()] == [(featured.id, 4)]


def test_el_diccionario_se_llena_en_segundo_plano_y_cada_palabra_se_pide_una_vez(db, monkeypatch):
    asked: list[list[str]] = []

    def fake_define(words):
        asked.append(list(words))
        # "feel" no se define: la IA a veces falla una palabra
        return [{"word": w, "lemma": "", "senses": [{"pos": "verbo", "meanings": [f"{w}-es"]}]} for w in words if w != "feel"]

    monkeypatch.setattr(main, "define_words", fake_define)
    background = BackgroundTasks()
    game = main.create_game_set(_payload(*FOUR), background, PROF_A)
    assert main.public_game_set(game.id, BackgroundTasks()).glossary == {}  # aún no corrió la tarea

    _run(background)
    public = main.public_game_set(game.id, again := BackgroundTasks())
    assert public.glossary["would"].senses[0].meanings == ["would-es"]
    assert "feel" not in public.glossary
    assert again.tasks == []  # "feel" ya se intentó en este proceso: no cuesta otra llamada por visita

    # Otro set con palabras ya conocidas solo pide las nuevas.
    second = BackgroundTasks()
    main.create_game_set(_payload("Where would you swim?", *FOUR[1:]), second, PROF_A)
    _run(second)
    assert asked[-1] == ["swim", "feel"]  # al guardar sí se reintenta lo que faltó


def test_los_juegos_suenan_con_edge_aunque_haya_clave_de_elevenlabs(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")

    async def eleven(text, voice, rate):
        raise AssertionError("un juego no debe gastar créditos de ElevenLabs")

    async def edge(text, voice, rate):
        return b"edge"

    monkeypatch.setattr(main, "_eleven_synth", eleven)
    monkeypatch.setattr(main, "_edge_synth", edge)
    assert asyncio.run(main._synth_mp3([("would", "en-US-AndrewNeural")], "-15%", edge_only=True)) == b"edge"


def test_define_words_se_queda_solo_con_lo_pedido_y_bien_formado(monkeypatch):
    reply = {"words": [
        {"word": "Went", "lemma": "go", "senses": [{"pos": "verbo", "meanings": ["fue", "", "se fue"]}]},
        {"word": "went", "lemma": "", "senses": [{"pos": "verbo", "meanings": ["repetida"]}]},
        {"word": "banana", "senses": [{"pos": "sustantivo", "meanings": ["no se pidió"]}]},
        {"word": "you", "senses": [{"pos": "pronombre", "meanings": []}]},
    ]}
    monkeypatch.setattr(ai, "_ai_call", lambda system, user, **_: ("```json\n" + json.dumps(reply) + "\n```", "fake"))
    assert ai.define_words(["went", "you"]) == [
        {"word": "went", "lemma": "go", "senses": [{"pos": "verbo", "meanings": ["fue", "se fue"]}]},
    ]


def test_un_bloque_que_falla_no_tira_el_diccionario_entero(monkeypatch):
    # Antes: 80 palabras por llamada, gpt-oss devolvía "" y el set entero quedaba sin significados.
    words = [f"w{i}" for i in range(ai._WORDS_PER_CALL * 2)]

    def fake(system, user, **_):
        chunk = user.split("\n")[1:]
        if chunk[0] == words[0]:
            raise RuntimeError("Groq devolvió una respuesta vacía")
        return json.dumps({"words": [{"word": w, "senses": [{"pos": "sustantivo", "meanings": ["x"]}]} for w in chunk]}), "fake"

    monkeypatch.setattr(ai, "_ai_call", fake)
    assert [r["word"] for r in ai.define_words(words)] == words[ai._WORDS_PER_CALL:]


def test_las_preguntas_generadas_no_se_repiten_y_respetan_la_cantidad(monkeypatch):
    reply = {"title": "Travel", "questions": [
        {"text": "Where would you go?", "translation": "¿A dónde irías?", "emoji": "✈️"},
        {"text": "where would you go?"},
        {"text": ""},
        {"text": "Why would you stay?"},
        {"text": "Who would you call?"},
    ]}
    monkeypatch.setattr(ai, "_ai_call", lambda system, user, prefer_fast=False: (json.dumps(reply), "fake"))
    data, provider = ai.generate_game_questions("travel", "B1", "Wh- + would", 2)
    assert provider == "fake" and data["title"] == "Travel"
    assert [q["text"] for q in data["questions"]] == ["Where would you go?", "Why would you stay?"]


# ── Rana hambrienta: banco de vocabulario por IA ──────────────────────────────

def _frog_reply(n: int = 9) -> dict:
    """`n` palabras válidas; la 0 trae las trampas de doble sentido que el filtro debe quitar."""
    words = [{"en": "bank", "es": ["el banco", "orilla (de un río)"], "en_all": ["bank", "bench"],
              "wrong_es": ["Orilla", "puente", "caja", "tienda", "puerto", "calle", "mesa", "silla"],
              "wrong_en": ["Bench", "to bridge", "box", "shop", "port", "street", "table"]}]
    words += [{"en": f"w{k}", "es": [f"p{k}"], "en_all": [f"w{k}"], "wrong_es": [f"x{k}{c}" for c in "abcde"],
               "wrong_en": [f"y{k}{c}" for c in "abcde"]} for k in range(1, n)]
    return {"words": words}


def _fake_frog_ai(reply: dict, flags: dict[str, dict] | None = None, skip: str = ""):
    """La IA de mentira: `reply` al generar; al revisar, una entrada por palabra (menos `skip`) con
    una traducción inversa inocente de cada mosca y las marcas de `flags` según su `en`."""
    def fake(system, user, **_):
        if system != ai._FROG_CHECK_SYSTEM:
            return json.dumps(reply), "fake"
        items = json.loads(user)["items"]
        return json.dumps({"items": [{
            "id": w["id"], "back_es": {t: ["zz"] for t in w["wrong_es"]}, "back_en": {t: ["zz"] for t in w["wrong_en"]},
            **(flags or {}).get(w["en"], {}),
        } for w in items if w["en"] != skip]}), "fake"
    return fake


def test_rana_la_traduccion_inversa_saca_la_mosca_que_tambien_vale(monkeypatch):
    # Medido con Gemini: para "en" lista in/inside/at y olvida "on"; al traducir "on" sí dice "en".
    reply = {"words": [{"en": "in", "es": ["en"], "en_all": ["in"], "wrong_es": ["sobre", "bajo", "cerca", "lejos", "entre", "atrás"],
                        "wrong_en": ["on", "under", "near", "far", "between", "behind", "around"]}]}
    back_es = {"sobre": ["on", "about"], "bajo": ["under"], "cerca": ["near"], "lejos": ["far"], "entre": ["between"]}  # sin "atrás"
    back_en = {"on": ["sobre", "en", "encima de"], "under": ["bajo"], "near": ["cerca"], "far": ["lejos"],
               "between": ["entre"], "behind": ["detrás de"], "around": ["alrededor"]}
    monkeypatch.setattr(ai, "_ai_call", _fake_frog_ai(reply, {"in": {"back_es": back_es, "back_en": back_en}}))
    [word] = ai.generate_frog_words("A1", "preposicion", [])
    assert word["wrong_en"] == ["under", "near", "far", "between", "behind", "around"]  # "on" también es "en"
    assert word["wrong_es"] == ["sobre", "bajo", "cerca", "lejos", "entre"]            # "sobre" (on) no es "in": se queda
    assert word["pos"] == "preposición"                                                # "atrás", sin traducir: fuera


def test_rana_ningun_distractor_es_otra_traduccion_de_la_palabra(monkeypatch):
    # La revisora marca "caja", lista "tienda" entre las traducciones (también se quita) y ve que
    # w2 está mal traducida o no es del tipo pedido.
    flags = {"bank": {"flag_es": ["caja"], "translations_es": ["banco", "tienda"]}, "w2": {"bad": True}}
    monkeypatch.setattr(ai, "_ai_call", _fake_frog_ai(_frog_reply(10), flags))
    words = ai.generate_frog_words("B1", "sustantivo", [])

    bank = words[0]
    assert (bank["en"], bank["es"], bank["pos"]) == ("bank", "el banco", "sustantivo")
    assert bank["wrong_es"] == ["puente", "puerto", "calle", "mesa", "silla"]        # sin "orilla" (otro sentido), "caja" ni "tienda"
    assert bank["wrong_en"] == ["to bridge", "box", "shop", "port", "street", "table"]  # sin "bench" (también es "banco")
    assert "w2" not in [w["en"] for w in words]                                     # la revisora la marcó mal traducida


def test_rana_una_palabra_que_la_revisora_no_devuelve_no_entra(monkeypatch):
    # gpt-oss, con mucho que razonar, a veces devuelve solo las primeras palabras de la tanda.
    calls: list[str] = []

    def counting(system, user, **kw):
        calls.append(system)
        return _fake_frog_ai(_frog_reply(10), skip="w9")(system, user, **kw)

    monkeypatch.setattr(ai, "_ai_call", counting)
    words = ai.generate_frog_words("A1", "verbo", [])
    assert "w9" not in [w["en"] for w in words] and len(words) == 9
    assert calls.count(ai._FROG_CHECK_SYSTEM) == 2  # 10 palabras = dos tandas de revisión


def test_rana_sin_revision_no_entra_nada_y_sin_moscas_suficientes_la_palabra_sobra(monkeypatch):
    def review_down(system, user, **_):
        if system == ai._FROG_CHECK_SYSTEM:
            raise RuntimeError("Groq caído")
        return json.dumps(_frog_reply()), "fake"

    monkeypatch.setattr(ai, "_ai_call", review_down)
    with pytest.raises(RuntimeError):
        ai.generate_frog_words("A1", "sustantivo", [])

    # Cada palabra necesita 5 moscas malas (las de Difícil): a "bank" la revisora le deja 4.
    flags = {"bank": {"flag_es": ["caja", "calle", "mesa"]}}
    monkeypatch.setattr(ai, "_ai_call", _fake_frog_ai(_frog_reply(3), flags))
    assert [w["en"] for w in ai.generate_frog_words("A1", "sustantivo", [])] == ["w1", "w2"]


def test_rana_no_repite_palabras_ni_traducciones(monkeypatch):
    reply = _frog_reply()
    reply["words"] += [dict(reply["words"][1]), {**reply["words"][1], "en": "bench"}]  # mismo "p1": el centro sería igual
    monkeypatch.setattr(ai, "_ai_call", _fake_frog_ai(reply))
    words = ai.generate_frog_words("A2", "sustantivo", ["W3"])
    assert [w["en"] for w in words] == ["bank", "w1", "w2", "w4", "w5", "w6", "w7", "w8"]  # w3 ya estaba en el banco


def test_rana_descarta_las_moscas_genericas_copiadas_de_otra_palabra(monkeypatch):
    # Pasó con Groq: "book", "cat" y "water" con la misma lista (coche, árbol, silla, mesa…).
    reply = _frog_reply(4)
    reply["words"][3]["wrong_es"] = reply["words"][2]["wrong_es"][:4] + ["otra"]
    reply["words"].append({**reply["words"][1], "en": "w9", "es": ["p9"], "en_all": ["w9"]})
    monkeypatch.setattr(ai, "_ai_call", _fake_frog_ai(reply))
    assert [w["en"] for w in ai.generate_frog_words("A1", "sustantivo", [])] == ["bank", "w1", "w2", "w3"]


def _word(en: str, es: str) -> dict:
    return {"en": en, "es": es, "pos": "sustantivo", "wrong_es": list("abcde"), "wrong_en": list("fghij")}


def test_el_banco_de_la_rana_se_llena_una_vez_y_es_de_todo_el_sitio(db, monkeypatch):
    main._frog_job.clear()
    main._frog_next.clear()
    monkeypatch.setattr(main, "_FROG_STARTER", 3)  # de 3 palabras en adelante, ya espera entre tandas
    asked: list[tuple[str, str, list[str]]] = []
    batches = iter([[_word("cat", "gato"), _word("dog", "perro")],
                    [_word("cat", "gato"), _word("kitty", "Gato"), _word("bird", "pájaro")],  # repetida y misma traducción
                    [_word("fish", "pez")]])

    def fake_generate(level, category, avoid):
        asked.append((level, category, list(avoid)))
        return next(batches)

    monkeypatch.setattr(main, "generate_frog_words", fake_generate)
    first = main.public_frog_words(background := BackgroundTasks(), level="A1", category="sustantivo")
    assert first.words == [] and first.generating
    # Mientras hay una tanda en curso nadie lanza otra: quien estrena otro nivel queda en cola.
    queued = main.public_frog_words(other := BackgroundTasks(), level="B2", category="verbo")
    assert queued.generating and other.tasks == []
    _run(background)
    main.public_frog_words(second := BackgroundTasks(), level="A1", category="sustantivo")  # 2 < 3: sin espera
    _run(second)

    assert [sorted(a[2]) for a in asked] == [[], ["cat", "dog"]]  # no le vuelve a pedir lo que ya hay
    again = main.public_frog_words(later := BackgroundTasks(), level="A1", category="sustantivo")
    assert [w.en for w in again.words] == ["bird", "cat", "dog"]
    assert not again.generating and later.tasks == []  # ya tiene 3: espera su turno, no gasta IA en cada visita
    # El banco es de todo el sitio: no depende de ningún set ni de su tema.
    assert [w.en for w in main.public_frog_words(BackgroundTasks(), level="A1").words] == ["bird", "cat", "dog"]

    with pytest.raises(HTTPException) as exc:
        main.public_frog_words(BackgroundTasks(), level="Z9")
    assert exc.value.status_code == 422


def test_rana_el_crecimiento_pasivo_llena_primero_lo_mas_vacio_de_todo_el_banco():
    main._frog_next.clear()
    counts = {lv: dict(t) for lv, t in main._FROG_TARGETS.items()}  # todo en su meta
    assert main._frog_passive_pick(counts, 0) is None
    counts["A1"]["sustantivo"] = 40  # 40 de su piso de 48: 0.83
    counts["A1"]["conector"] = 6     # 6 de 10: 0.6
    counts["B2"]["conector"] = 7     # 7 de 40: 0.18, el más atrasado aunque sea de otro nivel
    assert main._frog_passive_pick(counts, 0) == ("B2", "conector")
    main._frog_next[("B2", "conector")] = 100  # falló hace poco: espera su turno
    assert main._frog_passive_pick(counts, 50) == ("A1", "conector")
    # Con todo en su piso, sigue hacia la meta el que más lejos está de ella.
    floors = {lv: {c: min(t, main._FROG_STARTER) for c, t in targets.items()} for lv, targets in main._FROG_TARGETS.items()}
    assert main._frog_passive_pick(floors, 200) == ("C1", "sustantivo")
    main._frog_next.clear()


def test_rana_la_oracion_de_ejemplo_se_pide_una_vez_y_solo_de_palabras_del_banco(db, monkeypatch):
    calls: list[str] = []
    replies = iter([{"en": "My cat sleeps.", "es": "Mi gato duerme.", "used": "dog"},  # no usa la palabra: no se guarda
                    {"en": "My cat sleeps.", "es": "Mi gato duerme.", "used": "cat"}])

    def fake_ai(system, user, **kw):
        calls.append(user)
        return json.dumps(next(replies)), "fake"

    monkeypatch.setattr(ai, "_ai_call", fake_ai)
    main.repository.put_frog_words("A1", "sustantivo", [main.VocabWord(**_word("cat", "gato"))])
    with pytest.raises(HTTPException) as exc:
        main.public_frog_example(en="cat")
    assert exc.value.status_code == 503
    assert main.public_frog_example(en="Cat").model_dump() == {"en": "My cat sleeps.", "es": "Mi gato duerme."}
    assert main.public_frog_example(en="cat").en == "My cat sleeps." and len(calls) == 2  # la tercera sale del banco
    assert "Level: A1" in calls[0] and "gato" in calls[0]
    # La oración no viaja en el banco que baja cada partida.
    assert main.public_frog_words(BackgroundTasks(), level="A1").words[0].model_dump().keys() == {"en", "es", "pos", "wrong_es", "wrong_en"}
    with pytest.raises(HTTPException) as exc:
        main.public_frog_example(en="anything goes")
    assert exc.value.status_code == 404 and len(calls) == 2


def test_rana_si_la_ia_falla_se_reintenta_mas_tarde_y_mixto_crece_lo_mas_atrasado(db, monkeypatch):
    main._frog_job.clear()
    main._frog_next.clear()
    asked: list[str] = []

    def failing(level, category, avoid):
        asked.append(category)
        raise RuntimeError("IA caída")

    monkeypatch.setattr(main, "generate_frog_words", failing)
    main.repository.put_frog_words("B1", "sustantivo", [main.VocabWord(**_word("house", "casa"))])
    main.public_frog_words(background := BackgroundTasks(), level="B1")  # mixto
    _run(background)
    assert asked == ["verbo"]  # entre los tipos sin palabras, el primero; los sustantivos ya tienen una
    assert not main.public_frog_words(again := BackgroundTasks(), level="B1", category="verbo").generating
    assert again.tasks == []  # falló hace nada: no se reintenta en cada visita


# ── Rana hambrienta: semilla del banco (ADR-45) ───────────────────────────────

MIN_WORDS = 6  # `MIN_WORDS` de src/games/frog.tsx: con menos, el juego espera a la IA


def _seed() -> dict[str, dict[str, list[dict]]]:
    return json.loads(main.FROG_SEED.read_text(encoding="utf-8"))


def test_la_semilla_de_la_rana_cumple_las_reglas_del_banco():
    seed = _seed()
    assert set(seed) == set(ai.FROG_LEVELS)
    words: list[tuple[str, str, main.VocabWord]] = []
    for level, by_category in seed.items():
        assert set(by_category) == set(ai.FROG_CATEGORIES), level
        for category, raw_words in by_category.items():
            assert len(raw_words) >= MIN_WORDS, (level, category)  # ningún nivel ni tipo espera a la IA
            words += [(level, category, main.VocabWord(**w, pos="")) for w in raw_words]
        # El profesor pidió al menos 300 por nivel para no depender de la IA (ADR-45, ampliación).
        assert sum(len(ws) for ws in by_category.values()) >= 300, level

    n = ai.frog_norm
    en_keys = [n(w.en) for _, _, w in words]
    assert len(set(en_keys)) == len(en_keys)  # una palabra vive en un solo nivel (en_key)
    for level in seed:
        es_keys = [n(w.es) for lv, _, w in words if lv == level]
        assert len(set(es_keys)) == len(es_keys), level  # la rana no dice lo mismo con dos respuestas
    for level, category, w in words:
        for side, answer in (("es", w.es), ("en", w.en)):
            wrong = getattr(w, f"wrong_{side}")
            keys = [n(t) for t in wrong]
            assert len(set(keys)) == len(keys) >= ai.FROG_MIN_WRONG, (w.en, side)  # alcanza para Difícil
            assert n(answer) not in keys, (w.en, side)
            for term in [answer, *wrong]:
                assert term == term.strip() and term and not re.search(r"[/,;()]", term), term  # como _frog_terms
        # Una mosca mala que es otra palabra de la semilla con la misma traducción también valdría.
        for _, _, other in words:
            assert not (n(other.es) == n(w.es) and n(other.en) in {n(t) for t in w.wrong_en}), (w.en, other.en)
    # Sin listas genéricas copiadas: la misma regla que una tanda de la IA (≥5 moscas iguales).
    for level, category, w in words:
        for lv, cat, other in words:
            if (lv, cat) == (level, category) and other is not w:
                shared = {n(t) for t in w.wrong_es} & {n(t) for t in other.wrong_es}
                assert len(shared) < 5, (w.en, other.en)


def test_la_semilla_entra_una_vez_sin_pisar_el_banco_y_la_ia_sigue_sumando(db, monkeypatch):
    main._frog_job.clear()
    main._frog_next.clear()
    total = sum(len(ws) for by_category in _seed().values() for ws in by_category.values())
    # Ya en el banco: la misma palabra (no se pisa) y otra con la misma traducción ("carro").
    main.repository.put_frog_words("A1", "sustantivo", [main.VocabWord(**_word("dog", "can")), main.VocabWord(**_word("auto", "carro"))])

    assert main.seed_frog_words() == total - 2
    assert main.seed_frog_words() == 0  # en cada arranque: lo que ya está no se vuelve a escribir
    a1 = {w.en: w for w in main.repository.get_frog_words("A1", "sustantivo")}
    assert a1["dog"].es == "can" and "car" not in a1
    assert {w.pos for w in main.repository.get_frog_words("B1", "preposicion")} == {"preposición"}

    monkeypatch.setattr(main, "generate_frog_words", lambda *a: [])
    for level in ai.FROG_LEVELS:
        for category in ai.FROG_CATEGORIES:
            assert len(main.public_frog_words(BackgroundTasks(), level=level, category=category).words) >= MIN_WORDS
    # Con la semilla nadie espera, pero el banco no está en su meta: la IA sigue sumando tandas.
    main._frog_job.clear()
    first = main.public_frog_words(background := BackgroundTasks(), level="A1")
    assert len(first.words) >= 50 and first.generating and background.tasks


# ── Banco de verbos de Camaleón y Oruga (ADR-46) ──────────────────────────────

def test_la_semilla_de_verbos_cumple_las_reglas_del_banco():
    """Lo que se puede comprobar sin entender inglés. Que en cada hueco quepa UNA sola forma se
    revisó a mano; estas reglas atrapan los descuidos que lo rompen."""
    seed = json.loads(main.VERB_SEED.read_text(encoding="utf-8"))
    assert len(seed) >= 200
    assert len({raw["forms"].split()[0] for raw in seed}) == len(seed)  # sin verbos repetidos
    kinds = [raw["irregular"] for raw in seed]
    assert kinds.count(True) >= 12 and kinds.count(False) >= 12  # una partida de Camaleón por tipo
    present = re.compile(r"\b(now|nowadays|these days|when|every time|if|before|so|that)\b", re.I)
    perfect = re.compile(r"\b(have|has|had|haven’t|hasn’t|was|were|is|are|been|be)\b", re.I)
    for raw in seed:
        verb = main.Verb(**(raw | {"forms": raw["forms"].split()}))
        base, s, past, pp, ing = verb.forms
        assert all(re.fullmatch(r"[a-z]+", form) for form in verb.forms), base  # Oruga compara texto exacto
        assert s != base and ing.endswith("ing") and verb.es, base
        assert verb.irregular or (past == pp and past.endswith("ed")), base
        for f, sentences in enumerate(verb.gaps):
            assert len(sentences) >= 2 and len(set(sentences)) == len(sentences), (base, f)
            for sentence in sentences:
                # Un solo hueco y nunca al principio: la mosca va en minúsculas.
                assert sentence.count("___") == 1 and not sentence.startswith("___"), sentence
        # Sin ancla de presente, en el hueco de -s también cabría el pasado.
        assert all(present.search(g) for g in verb.gaps[1]), verb.gaps[1]
        assert all(perfect.search(g) for g in verb.gaps[3]), verb.gaps[3]
        assert not any(re.search(r"\b(have|has|had)\s+___", g, re.I) for g in verb.gaps[2]), verb.gaps[2]


def test_la_semilla_de_verbos_manda_sobre_la_base_y_no_reescribe_lo_que_esta_al_dia(db):
    total = main.seed_verbs()
    assert total >= 200 and main.seed_verbs() == 0  # ya cargada: ninguna escritura
    verbs = main.public_verbs()
    assert len(verbs) == total and [v.forms[0] for v in verbs] == sorted(v.forms[0] for v in verbs)
    go = next(v for v in verbs if v.forms[0] == "go")
    assert go.forms == ["go", "goes", "went", "gone", "going"] and go.irregular and len(go.gaps) == 5
    # Un verbo tocado en la base vuelve a quedar como en el JSON; uno que no es de la semilla se queda.
    main.repository.put_verb("go", go.model_dump() | {"es": "otra cosa"})
    main.repository.put_verb("zzz", go.model_dump() | {"forms": ["zzz", "zzzs", "zzzed", "zzzed", "zzzing"]})
    assert main.seed_verbs() == 1
    after = {v.forms[0]: v for v in main.public_verbs()}
    assert after["go"].es == "ir" and "zzz" in after
