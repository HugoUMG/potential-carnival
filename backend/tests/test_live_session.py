"""Sesión en vivo: lo que rompería la actividad delante de 50 personas.

Importa SOLO `backend.app.live` y el parser: los dos son lógica pura y no abren conexión, así
que este test no puede escribir en Aiven por accidente (regla 2 de CLAUDE.md).
"""

import time

import pytest

from backend.app.live import LIVE_TYPES, LiveError, create_session, extract_questions, get_session, summarize
from backend.app.parser import parse_worksheet_script


SCRIPT = '''worksheet {
title: "Seminario"
description: "Demo en vivo"

info {
  fields:
  - Carné
  - Nombre
}

multiplechoice {
  question: "Capital de Guatemala?"
  options:
  - Antigua
  - Ciudad de Guatemala
  - Quetzaltenango
  answer: "Ciudad de Guatemala"
}

multiselect {
  question: "Cuáles son verbos?"
  options:
  - run
  - table
  - eat
  - blue
  answer:
  - run
  - eat
}

textbox {
  prompt: "Escribe una reflexión."
}
}'''

# Hoja con los cuatro tipos jugables + tres que no lo son, para el resumen de descartes.
SCRIPT_MIXTO = '''worksheet {
title: "Mixta"

multiplechoice {
  question: "Pick one."
  options:
  - a
  - b
  answer: "a"
}

truefalse {
  statements:
  - The Earth is round. | true
  - The Sun orbits the Earth. | false
  - Water boils at 100°C. | true
}

imagechoice {
  question: "Which one is the apple?"
  options:
  - apple
  - banana
  option_images:
  - https://example.test/apple.png
  - https://example.test/banana.png
  answer: "apple"
}

fillblank {
  text: "I _____ tired."
  answer: "am"
}

matching {
  left:
  - dog
  - cat
  right:
  - perro
  - gato
}

textbox {
  prompt: "Escribe algo."
}
}'''


def _session(**kwargs):
    data = parse_worksheet_script(SCRIPT)
    return create_session(
        worksheet_id="ws-1",
        worksheet_title=data.title,
        owner_id="prof-1",
        info_fields=data.info_fields,
        questions=extract_questions(data.activities),
        **kwargs,
    )


def test_solo_entran_los_tipos_jugables_en_vivo():
    """El `textbox` necesita teclado y no se autocalifica: no puede entrar a una pregunta
    cronometrada. Si algún día se cuela, el profesor lanza una pregunta que nadie puede responder."""
    data = parse_worksheet_script(SCRIPT)
    questions = extract_questions(data.activities)

    assert [q.type for q in questions] == ["multiplechoice", "multiselect"]
    assert set(LIVE_TYPES) == {"multiplechoice", "multiselect", "truefalse", "imagechoice"}


def test_los_campos_de_entrada_salen_del_info_de_la_hoja():
    """La hoja decide qué se pide al entrar (`info { fields: … }`), no el módulo en vivo.

    Con la sintaxis equivocada `_parse_info_fields` devuelve [] SIN error y la sesión caería al
    valor por defecto — se vería igual y no se estaría probando nada."""
    assert parse_worksheet_script(SCRIPT).info_fields == ["Carné", "Nombre"]
    assert _session().info_fields == ["Carné", "Nombre"]


def test_un_truefalse_se_parte_en_una_pregunta_por_enunciado():
    """Una actividad no es siempre una pregunta: un `truefalse` de tres enunciados son TRES
    preguntas en vivo. Se numeran como en `_build_answer_details` (`id:índice`), que es lo que
    hace que la entrega guardada al terminar encaje con lo que Revisión sabe leer."""
    questions = extract_questions(parse_worksheet_script(SCRIPT_MIXTO).activities)
    tf = [q for q in questions if q.type == "truefalse"]

    assert len(tf) == 3
    assert [q.question for q in tf][:2] == ["The Earth is round.", "The Sun orbits the Earth."]
    assert [q.answer for q in tf] == ["True", "False", "True"]
    assert all(q.options == ["True", "False"] for q in tf)
    assert [q.id.rsplit(":", 1)[1] for q in tf] == ["0", "1", "2"]
    # Las cadenas son las mismas que guarda el renderer de la hoja, así que la comparación de
    # texto de siempre basta: no hay una rama de calificación nueva que mantener.
    assert tf[0].is_correct("true") and not tf[0].is_correct("false")


def test_imagechoice_se_califica_por_texto_y_arrastra_sus_imagenes():
    """ADR-20: la clave es el TEXTO de la opción; las imágenes solo cambian lo que se pinta."""
    q = next(q for q in extract_questions(parse_worksheet_script(SCRIPT_MIXTO).activities) if q.type == "imagechoice")

    assert q.is_correct("apple") and not q.is_correct("banana")
    assert q.option_images == ["https://example.test/apple.png", "https://example.test/banana.png"]
    assert len(q.option_images) == len(q.options)  # paralelas o el alumno ve la imagen equivocada


def test_lo_que_no_se_puede_jugar_se_reporta_en_vez_de_desaparecer():
    """El fallo silencioso que este proyecto ya se comió varias veces: si `summarize` no contara
    los descartes, el profesor abriría una sesión más corta que su hoja sin saber por qué."""
    resumen = summarize(parse_worksheet_script(SCRIPT_MIXTO).activities)

    assert resumen["playable"] == 5  # 1 MC + 3 enunciados T/F + 1 imagechoice
    assert resumen["skipped"] == [
        {"type": "fillblank", "count": 1},
        {"type": "matching", "count": 1},
        {"type": "textbox", "count": 1},
    ]


def test_el_catalogo_en_vivo_es_el_mismo_en_el_backend_y_en_el_panel():
    """`LIVE_TYPES` está duplicada en `LiveHostPanel.tsx` para pintar el resumen sin una petición
    por hoja. Si se desincronizan, el panel promete preguntas que la sesión no tendrá."""
    from pathlib import Path

    panel = Path(__file__).resolve().parents[2] / "src" / "components" / "LiveHostPanel.tsx"
    declarada = panel.read_text(encoding="utf-8").split("const LIVE_TYPES = new Set([", 1)[1].split("])", 1)[0]
    en_el_front = {t.strip().strip("',\"") for t in declarada.split(",") if t.strip()}

    assert en_el_front == set(LIVE_TYPES)


def test_una_hoja_sin_preguntas_jugables_no_abre_sesion():
    with pytest.raises(LiveError) as error:
        create_session(worksheet_id="ws-2", worksheet_title="Solo lectura", owner_id="prof-1", info_fields=["Nombre"], questions=[])
    assert error.value.status == 422


def test_la_respuesta_correcta_no_viaja_mientras_la_pregunta_esta_abierta():
    """El agujero que arruinaría la demo: si la clave va en el JSON del poll, cualquiera con las
    herramientas del navegador abiertas gana todas las preguntas."""
    session = _session()
    session.open_next()

    abierta = session.public_state()
    assert abierta["phase"] == "question"
    assert "answer" not in abierta
    assert "Ciudad de Guatemala" not in str(abierta["question"]).replace(str(abierta["question"]["options"]), "")

    session.reveal()
    revelada = session.public_state()
    assert revelada["phase"] == "reveal"
    assert revelada["answer"] == "Ciudad de Guatemala"


def test_sin_pregunta_abierta_nadie_puede_responder():
    """El alumno se queda esperando hasta que el profesor lanza: es el control que se pidió."""
    session = _session()
    ana = session.join({"Carné": "2021-001", "Nombre": "Ana"})

    assert session.public_state()["phase"] == "lobby"
    with pytest.raises(LiveError):
        session.submit(ana.pid, "Ciudad de Guatemala")

    session.open_next()
    session.submit(ana.pid, "Ciudad de Guatemala")
    with pytest.raises(LiveError):
        session.submit(ana.pid, "Antigua")  # una respuesta por pregunta, no se corrige después


def test_multiselect_exige_el_conjunto_exacto():
    """Misma regla que el calificador de `main.py`: sobrar o faltar una opción es incorrecto."""
    session = _session()
    session.open_next()
    session.reveal()
    session.open_next()  # la multiselect

    a = session.join({"Carné": "1", "Nombre": "A"})
    b = session.join({"Carné": "2", "Nombre": "B"})
    c = session.join({"Carné": "3", "Nombre": "C"})
    session.submit(a.pid, ["run", "eat"])
    session.submit(b.pid, ["run"])
    session.submit(c.pid, ["run", "eat", "blue"])

    assert (a.correct, b.correct, c.correct) == (1, 0, 0)


def test_el_tiempo_agotado_revela_solo_y_cierra_las_respuestas():
    session = _session(duration=20)
    ana = session.join({"Carné": "2021-001", "Nombre": "Ana"})
    session.open_next()

    session.opened_at = time.monotonic() - 21  # el cronómetro llegó a cero
    assert session.remaining_ms() == 0
    assert session.phase() == "reveal"
    with pytest.raises(LiveError):
        session.submit(ana.pid, "Ciudad de Guatemala")


def test_responder_rapido_puntea_mas_y_ordena_el_marcador():
    session = _session(duration=20)
    veloz = session.join({"Carné": "1", "Nombre": "Veloz"})
    lento = session.join({"Carné": "2", "Nombre": "Lento"})
    session.open_next()

    session.submit(veloz.pid, "Ciudad de Guatemala")
    session.opened_at = time.monotonic() - 18  # el segundo contesta casi al final
    session.submit(lento.pid, "Ciudad de Guatemala")

    assert veloz.score > lento.score
    session.reveal()  # el marcador solo se publica al revelar, no durante la pregunta
    assert [p["label"] for p in session.public_state()["leaderboard"]] == ["Veloz", "Lento"]


def test_recargar_la_pagina_no_borra_los_puntos():
    """Con 50 celulares alguien recarga sí o sí. Si eso creara un participante nuevo, perdería su
    puntaje y saldría duplicado en la pantalla proyectada."""
    session = _session()
    ana = session.join({"Carné": "2021-001", "Nombre": "Ana"})
    session.open_next()
    session.submit(ana.pid, "Ciudad de Guatemala")

    de_vuelta = session.join({"Carné": "2021-001", "Nombre": "Ana"})

    assert de_vuelta.pid == ana.pid
    assert de_vuelta.score > 0
    assert len(session.participants) == 1


def test_los_campos_de_identificacion_son_obligatorios():
    session = _session()
    with pytest.raises(LiveError) as error:
        session.join({"Carné": "2021-001", "Nombre": "   "})
    assert error.value.status == 422
    assert "Nombre" in error.value.message


def test_el_visto_bueno_se_guarda_hasta_el_reveal():
    """Comportamiento Kahoot por defecto: si el ✓/✗ saliera al tocar, el primero en responder le
    canta la respuesta al de al lado."""
    session = _session()
    ana = session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()
    session.submit(ana.pid, "Ciudad de Guatemala")

    assert "correct" not in session.public_state(pid=ana.pid)["me"]
    session.reveal()
    assert session.public_state(pid=ana.pid)["me"]["correct"] is True


def test_solo_el_dueno_controla_su_sesion():
    session = _session()
    assert get_session(session.code.lower()) is session  # el código se teclea como salga

    from backend.app.live import owned_session

    with pytest.raises(LiveError) as error:
        owned_session(session.code, "otro-profe")
    assert error.value.status == 403
    assert owned_session(session.code, "otro-profe", is_admin=True) is session


def test_el_resultado_por_alumno_queda_listo_para_guardarse():
    session = _session()
    ana = session.join({"Carné": "2021-001", "Nombre": "Ana"})
    session.join({"Carné": "2021-002", "Nombre": "Beto"})  # entra pero nunca responde
    session.open_next()
    session.submit(ana.pid, "Antigua")

    filas = {row["label"]: row for row in session.snapshot()}

    assert filas["Ana"]["details"][0]["status"] == "incorrect"
    assert filas["Ana"]["info"] == {"Carné": "2021-001", "Nombre": "Ana"}
    assert filas["Beto"]["answered"] == 0  # `main` lo salta: no se inventa una entrega
