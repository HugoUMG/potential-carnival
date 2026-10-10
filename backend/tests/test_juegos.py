"""Juegos de práctica (ADR-38): sets por profesor, diccionario por palabra hecho por IA y audio gratis.

Nada toca la red ni la base real: SQLite temporal (como test_teacher_images.py) y la IA con dobles.
"""
import asyncio
import json

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
    monkeypatch.setattr(ai, "_ai_call", lambda system, user, prefer_fast=False: ("```json\n" + json.dumps(reply) + "\n```", "fake"))
    assert ai.define_words(["went", "you"]) == [
        {"word": "went", "lemma": "go", "senses": [{"pos": "verbo", "meanings": ["fue", "se fue"]}]},
    ]


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
