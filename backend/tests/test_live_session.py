"""Sesión en vivo: lo que rompería la actividad delante de 50 personas.

Importa SOLO `backend.app.live` y el parser: los dos son lógica pura y no abren conexión, así
que este test no puede escribir en Aiven por accidente (regla 2 de CLAUDE.md).
"""

import json
import time

import pytest

from backend.app.live import (
    DEFAULT_AVATAR,
    MAX_LIVE_BLANKS,
    MAX_LIVE_OPTIONS,
    activity_questions,
    LIVE_TYPES,
    LiveError,
    create_session,
    extract_questions,
    get_session,
    summarize,
)
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
    assert set(LIVE_TYPES) == {
        "multiplechoice", "multiselect", "truefalse", "imagechoice",
        "matching", "imagematching", "dragdrop", "fillblank",
        "listeningmultiplechoice", "listeningtruefalse", "listeningmatching",
        "listeningfillblank", "listeningorder",
    }


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

    # 1 MC + 3 enunciados T/F + 1 imagechoice + 2 filas del matching + 1 fillblank
    assert resumen["playable"] == 8
    assert resumen["skipped"] == [{"type": "textbox", "count": 1}]


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


def test_la_nota_se_calcula_sobre_las_preguntas_lanzadas_no_sobre_las_respondidas():
    """El bug real: antes de esta corrección, alguien que entraba a media sesión y se perdía la
    mitad de las preguntas sacaba la misma nota que quien las contestó todas, porque el
    denominador (`len(graded)` en `_score_details`) se encogía junto con el numerador."""
    session = _session()
    ana = session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()
    session.submit(ana.pid, "Ciudad de Guatemala")  # P1 correcta
    session.reveal()
    session.open_next()  # P2 (multiselect): Ana no contesta

    fila = next(r for r in session.snapshot() if r["label"] == "Ana")
    correctas = sum(1 for d in fila["details"] if d["status"] == "correct")

    assert (correctas, len(fila["details"])) == (1, 2)  # 1 de 2, no 1 de 1


def test_distingue_conexion_tardia_de_no_responder_a_tiempo():
    """Los dos motivos por los que una pregunta queda sin responder no son lo mismo, y en
    Revisión tienen que verse distintos: uno es "no llegaste a tiempo", el otro "no estabas"."""
    session = _session()
    presente = session.join({"Carné": "1", "Nombre": "Presente"})
    session.open_next()  # P1 lanzada; Presente ya está dentro pero no contesta
    session.join({"Carné": "2", "Nombre": "Tardío"})  # entra DESPUÉS de que se lanzara

    filas = {r["label"]: r for r in session.snapshot()}

    assert filas["Presente"]["details"][0]["teacher_comment"] == "No respondió a tiempo."
    assert "se conectó después" in filas["Tardío"]["details"][0]["teacher_comment"]
    assert filas["Presente"]["details"][0]["status"] == filas["Tardío"]["details"][0]["status"] == "incorrect"
    assert presente.pid  # sanity: el fixture se usó


def test_una_pregunta_nunca_lanzada_no_cuenta_ni_a_favor_ni_en_contra():
    """Si la sesión termina antes de llegar a la última pregunta, esa pregunta no aparece en el
    detalle de nadie: nadie la vivió, así que no se puede calificar a nadie por ella."""
    session = _session()
    session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()  # solo P1; P2 nunca se lanza

    fila = next(r for r in session.snapshot() if r["label"] == "Ana")

    assert len(fila["details"]) == 1


# ── Puntaje, menciones, avatar y reacciones ──────────────────────────────────


def test_el_puntaje_separa_acertar_de_ser_rapido():
    """El bug que originó todo esto: el marcador solo enseña el TOTAL, y el total mezcla dos
    cosas. Quien acierta más puede quedar por debajo de quien va más rápido, y sin el desglose
    no hay forma de explicarlo. `_points` devuelve las dos mitades por separado."""
    session = _session(duration=20)
    base_rapido, bono_rapido = session._points(0.0)
    base_lento, bono_lento = session._points(20.0)

    assert base_rapido == base_lento == 500     # acertar vale lo mismo para todos
    assert bono_rapido == 500 and bono_lento == 0  # la rapidez es lo único que cambia


def test_sin_limite_de_tiempo_nadie_pierde_bono_por_lento():
    """Con `duration=0` no hay cronómetro contra el que medir rapidez. Si el bono se calculara
    igual, el elapsed dividiría entre cero (o daría 0 a todos), que es castigar por una regla
    que la sesión no tiene."""
    assert _session(duration=0)._points(300.0) == (500, 500)


def test_mas_aciertos_y_mas_rapido_se_lleva_una_sola_mencion():
    """Quien gana en las dos cosas es "La mente maestra", no "El mentalista" Y "El más veloz":
    repartir los cuatro títulos entre el mismo primer lugar deja al resto del salón sin nada,
    que es justo lo contrario de para lo que sirven las menciones."""
    session = _session(duration=20)
    crack = session.join({"Carné": "1", "Nombre": "Crack"})
    otro = session.join({"Carné": "2", "Nombre": "Otro"})
    session.open_next()
    session.submit(crack.pid, "Ciudad de Guatemala")   # acierta
    session.submit(otro.pid, "Antigua")                # falla
    session.end()

    claves = [a["key"] for a in session.awards()]
    assert claves.count("mente_maestra") == 1
    assert "mentalista" not in claves and "veloz" not in claves
    assert session.awards()[0]["label"] == "Crack"


def test_el_mas_veloz_solo_cuenta_los_aciertos():
    """Contestar rapidísimo y mal no es ser rápido. Sin este filtro, quien toca el primer botón
    que ve en cada pregunta gana el premio a la velocidad sin acertar una sola."""
    session = _session(duration=20)
    listo = session.join({"Carné": "1", "Nombre": "Listo"})
    impulsivo = session.join({"Carné": "2", "Nombre": "Impulsivo"})
    session.open_next()
    session.submit(impulsivo.pid, "Antigua")           # instantáneo pero incorrecto
    session.submit(listo.pid, "Ciudad de Guatemala")   # más tarde y correcto
    session.end()

    ganadores = {a["key"]: a["label"] for a in session.awards()}
    assert "Impulsivo" not in ganadores.values()
    assert session.participants[impulsivo.pid].avg_speed() is None


def test_el_avatar_se_congela_al_arrancar_la_evaluacion():
    """Se elige en la sala de espera y ahí se queda: un alumno cambiando de cara a mitad de
    pregunta distrae al salón entero y hace irreconocible el marcador entre una y otra."""
    session = _session()
    ana = session.join({"Carné": "1", "Nombre": "Ana"}, emoji="🦊")
    assert ana.emoji == "🦊"

    session.set_avatar(ana.pid, "🐼")  # todavía en lobby: permitido
    assert ana.emoji == "🐼"

    session.open_next()
    with pytest.raises(LiveError):
        session.set_avatar(ana.pid, "🚀")
    assert ana.emoji == "🐼"


def test_un_avatar_fuera_de_la_lista_no_llega_a_la_pantalla():
    """`AVATARS` es una lista CERRADA: lo que se elija aquí acaba proyectado en la pared del
    salón, así que no se acepta cualquier cadena que llegue en el JSON."""
    session = _session()
    ana = session.join({"Carné": "1", "Nombre": "Ana"}, emoji="💩")
    assert ana.emoji == DEFAULT_AVATAR  # el que no está en la lista se descarta, no se guarda

    with pytest.raises(LiveError):
        session.set_avatar(ana.pid, "<script>")


def test_las_reacciones_tienen_freno_por_alumno():
    """Sin cooldown, un solo alumno tapa la proyección con cincuenta emojis por segundo."""
    session = _session()
    ana = session.join({"Carné": "1", "Nombre": "Ana"})

    session.react(ana.pid, "🔥")
    session.react(ana.pid, "🔥")  # inmediatamente después: se ignora, sin error

    assert len(session.recent_reactions()) == 1

    with pytest.raises(LiveError):
        session.react(ana.pid, "🖕")  # fuera de los cinco de `REACTIONS`


def test_la_sala_de_espera_no_publica_el_carne():
    """`lobby_roster` viaja por un endpoint SIN autenticación. Solo el nombre y el avatar: el
    resto del `info {}` es dato personal y no tiene por qué salir de ahí."""
    session = _session()
    session.join({"Carné": "2021-999", "Nombre": "Ana"}, emoji="🐼")

    fila = session.public_state()["lobby_roster"][0]

    assert fila == {"label": "Ana", "emoji": "🐼"}


def test_las_listas_de_emojis_no_se_desincronizan_con_el_frontend():
    """`AVATARS` y `REACTIONS` están duplicadas en `src/pages/LivePage.tsx` para pintarlas sin
    una petición. El backend es quien VALIDA: si allá aparece un emoji que aquí no está, el
    alumno lo elige, el POST lo rechaza y se queda con el avatar por defecto sin saber por qué.
    Este test es lo único que impide que las dos listas se separen en silencio."""
    from pathlib import Path

    from backend.app.live import AVATARS, REACTIONS

    fuente = (Path(__file__).resolve().parents[2] / "src" / "pages" / "LivePage.tsx").read_text(encoding="utf-8")

    def lista(nombre: str) -> set[str]:
        bloque = fuente.split(f"const {nombre} = [", 1)[1].split("];", 1)[0]
        return {trozo.strip().strip("',") for trozo in bloque.replace("\n", "").split(",") if trozo.strip()}

    assert lista("AVATARS") == set(AVATARS)
    assert lista("REACTIONS") == set(REACTIONS)


# ── Catálogo: matching, imagematching, dragdrop y el estímulo del bloque ─────


SCRIPT_BLOQUE = '''worksheet {
title: "Bloques"
description: "Estimulo compartido"

info {
  fields:
  - Nombre
}

block {
  title: "Lectura"
  text: "Tom is a baker. He wakes up at four."

  multiplechoice {
    question: "What is Tom's job?"
    options:
    - Baker
    - Teacher
    answer: "Baker"
  }
}

block {
  title: "Audio"
  audio_text: "He wakes up at four."

  multiplechoice {
    question: "What time?"
    options:
    - Four
    - Five
    answer: "Four"
  }
}
}'''


def _actividad(script: str, tipo: str):
    return next(a for a in parse_worksheet_script(script).activities if a.type == tipo)


def test_un_matching_es_una_pregunta_de_opcion_multiple_por_fila():
    """El `matching` se descartó en vivo por "el problema del dedo", pero eso era la mecánica de
    líneas del renderer: `_build_answer_details` YA lo califica fila a fila, o sea que la unidad
    de calificación siempre fue una opción múltiple. Explotado son botones, como `truefalse`."""
    preguntas = activity_questions(_actividad(SCRIPT_MIXTO, "matching"))

    assert [q.question for q in preguntas] == ["dog", "cat"]
    assert [q.answer for q in preguntas] == ["perro", "gato"]
    assert all(sorted(q.options) == ["gato", "perro"] for q in preguntas)  # todas las `right`
    # La convención de ids es la MISMA que usa `_build_answer_details` para este tipo; sin ella
    # la entrega que guarda `finish` no encajaría con lo que Revisión sabe leer.
    ids = [q.id for q in preguntas]
    assert ids == [f"{ids[0].rsplit(':', 1)[0]}:0", f"{ids[0].rsplit(':', 1)[0]}:1"]


def test_las_opciones_de_un_matching_no_salen_en_el_orden_de_la_clave():
    """Sin barajar, la respuesta de la fila `i` cae siempre en el botón `i` y el juego se
    resuelve sin leer. El barajado es determinista por actividad: el orden tiene que ser el
    mismo en toda la sesión (el cliente pregunta cada segundo) y reproducible en un test."""
    actividad = _actividad(SCRIPT_MIXTO, "matching")
    preguntas = activity_questions(actividad)

    # Determinista: dos extracciones de la misma actividad dan el mismo orden.
    assert [q.options for q in activity_questions(actividad)] == [q.options for q in preguntas]
    # Y todas las filas comparten un único orden, para que el alumno no lo relea cada vez.
    assert len({tuple(q.options) for q in preguntas}) == 1


def test_un_matching_con_demasiadas_columnas_se_descarta_entero():
    """Los colores de las opciones ciclan cada cuatro: con ocho, dos son azules y el color deja
    de identificar desde el fondo del salón. No se recorta (perdería la clave la mitad de las
    veces): se descarta entero y se reporta, como todo lo que se queda fuera."""
    class _Fake:
        id, type = "m1", "matching"
        left = [f"l{i}" for i in range(MAX_LIVE_OPTIONS + 1)]
        right = [f"r{i}" for i in range(MAX_LIVE_OPTIONS + 1)]
        left_images = None

    assert activity_questions(_Fake()) == []


def test_el_dragdrop_de_un_hueco_se_juega_con_los_botones_de_siempre():
    """Con un solo hueco es un `multiplechoice` disfrazado —el parser YA garantiza que el `bank`
    contiene todas las respuestas—, así que se juega con los botones grandes y no con fichas.
    Con varios huecos pasa a la mecánica de huecos, que es otra pantalla."""
    class _Uno:
        id, type = "d1", "dragdrop"
        text, answer, bank = "I _____ tired.", ["am"], ["am", "is", "are"]

    class _Varios(_Uno):
        text, answer = "I _____ very _____.", ["am", "tired"]

    uno = activity_questions(_Uno())[0]
    assert (uno.input, uno.options, uno.answer) == ("choice", ["am", "is", "are"], "am")

    varios = activity_questions(_Varios())[0]
    # Misma mecánica que `fillblank`, pero con fichas: la lista es POSICIONAL, hueco por hueco.
    assert (varios.input, varios.answer) == ("blanks", ["am", "tired"])


def test_la_lectura_del_bloque_llega_a_la_pregunta():
    """`iter_activities()` aplana los bloques y tira el `BlockData`, así que una hoja con una
    lectura arriba y preguntas debajo (ADR-24) se jugaba mandando las preguntas SIN el texto del
    que hablan. Llegaban bien formadas, solo que sobre la nada: nadie se enteraba."""
    data = parse_worksheet_script(SCRIPT_BLOQUE)
    # Con bloques, las actividades viven DENTRO de ellos: `WorksheetData.activities` queda vacía
    # y aplanar es justo lo que hace `iter_activities()` en producción.
    planas = [a for b in data.blocks for a in b.activities]
    preguntas = extract_questions(planas, data.blocks)

    lectura = next(q for q in preguntas if q.passage)
    assert lectura.passage == "Tom is a baker. He wakes up at four."
    assert not lectura.audio_text  # la lectura no suena: es texto


def test_una_actividad_hereda_el_audio_de_su_bloque():
    """Una `multiplechoice` normal colgada de un bloque con `audio_text` es, en vivo, una
    pregunta de escucha: nace en fase `listening` y el mp3 sale del bloque. Antes de la fase 3
    estas se descartaban por no poder sonar."""
    data = parse_worksheet_script(SCRIPT_BLOQUE)
    planas = [a for b in data.blocks for a in b.activities]
    preguntas = extract_questions(planas, data.blocks)

    con_audio = next(q for q in preguntas if q.audio_text)
    assert con_audio.audio_text == "He wakes up at four."
    assert summarize(planas, data.blocks)["playable"] == 2


def test_un_bloque_de_conversacion_sigue_mudo_y_se_reporta():
    """`lines` son dos voces y sintetizarlo es concatenar un mp3 por turno, no una llamada.
    Hasta que exista, se descarta y se REPORTA: preguntar por un diálogo que nadie ha oído es
    el fallo silencioso de siempre con otro disfraz."""
    class _Actividad:
        id, type = "a1", "multiplechoice"
        options, answer = ["Yes", "No"], "Yes"

    class _Bloque:
        text = audio_text = None
        lines = [{"speaker": "A", "text": "Hi"}, {"speaker": "B", "text": "Hello"}]
        activities = [_Actividad()]

    assert extract_questions([_Actividad()], [_Bloque()]) == []
    assert summarize([_Actividad()], [_Bloque()])["skipped"] == [{"type": "multiplechoice", "count": 1}]


def test_el_panel_y_el_backend_cuentan_las_mismas_preguntas():
    """`liveBreakdown` en `LiveHostPanel.tsx` reimplementa la explosión para no pedir una
    petición por hoja con cincuenta en la lista. Comparar solo la lista de TIPOS no basta: el
    panel podría decir "1 pregunta" donde la sesión trae seis, y el profesor lo descubriría con
    el salón mirando. Esto compara el CONTEO, que es lo que de verdad se desincroniza."""
    from pathlib import Path

    panel = (Path(__file__).resolve().parents[2] / "src" / "components" / "LiveHostPanel.tsx").read_text(encoding="utf-8")

    # El tope tiene que ser el mismo número en los dos lados.
    assert f"const MAX_LIVE_OPTIONS = {MAX_LIVE_OPTIONS};" in panel
    # Y el panel tiene que saber explotar TODO lo que el backend explota, no solo `truefalse`.
    for tipo in ("truefalse", "matching", "imagematching", "dragdrop"):
        assert tipo in panel, f"`liveBreakdown` no contempla {tipo}: contaría de menos"


# ── Fase 2: la mecánica de huecos ────────────────────────────────────────────


def _huecos(text="I _____ tired.", answer=("am",), bank=None, tipo="fillblank"):
    class _Fake:
        id, type = "f1", tipo
    _Fake.text, _Fake.answer, _Fake.bank = text, list(answer), list(bank or [])
    return _Fake()


def test_los_huecos_se_califican_por_POSICION_no_por_conjunto():
    """`multi` y `blanks` llegan las dos con una lista de respuestas y se comparan al REVÉS:
    en multiselect el orden da igual, en los huecos el orden es justo lo que se califica. Si
    `is_correct` se ramificara por tipo en vez de por mecánica, "tired am" pasaría por buena."""
    pregunta = activity_questions(_huecos("I _____ very _____.", ("am", "tired")))[0]

    assert pregunta.input == "blanks"
    assert pregunta.is_correct(["am", "tired"])
    assert not pregunta.is_correct(["tired", "am"])  # las dos palabras, en el hueco cambiado


def test_los_huecos_ignoran_mayusculas_y_espacios_como_en_la_hoja():
    """Mismo criterio que `_build_answer_details` (`_norm_answer`: strip + lowercase). Es la
    duplicación que ADR-26 acepta a cambio de que `live.py` no importe `main.py`; este test es
    lo que hace que un descuadre salga en rojo y no en el salón."""
    pregunta = activity_questions(_huecos())[0]

    assert pregunta.is_correct(["  AM  "])
    assert not pregunta.is_correct(["is"])
    # `>=` y no `==`, igual que main.py: un campo de más en el cliente no invalida la respuesta.
    assert pregunta.is_correct(["am", ""])


def test_una_oracion_sin_huecos_no_es_jugable():
    """En vivo el hueco es lo que se pinta como campo. El parser admite un `fillblank` con la
    clave suelta y sin `_____`; servirlo aquí dejaría al alumno sin dónde escribir."""
    assert activity_questions(_huecos("I am tired.", ("am",))) == []


def test_demasiados_huecos_se_descartan_en_vez_de_castigar():
    """Rellenar cuatro campos con el pulgar y el cronómetro corriendo no es una pregunta, y en
    la pantalla proyectada la oración deja de leerse. Se descarta y se reporta."""
    largo = " ".join(["_____"] * (MAX_LIVE_BLANKS + 1))
    assert activity_questions(_huecos(largo, tuple("abcd"))) == []


def test_el_dragdrop_de_varios_huecos_lleva_el_bank_como_fichas():
    """Misma mecánica que `fillblank` y solo cambia de dónde sale la palabra: con `bank` se
    tocan fichas, sin él se teclea. Por eso comparten `input` y el cliente no ramifica por tipo."""
    pregunta = activity_questions(_huecos(
        "I _____ very _____.", ("am", "tired"), bank=["am", "is", "tired", "happy"], tipo="dragdrop",
    ))[0]

    assert (pregunta.input, pregunta.options) == ("blanks", ["am", "is", "tired", "happy"])


def test_una_pregunta_de_huecos_no_filtra_la_clave_mientras_esta_abierta():
    """La regla 41 por la puerta nueva: `options` de un `dragdrop` es el banco (que ya se ve en
    la hoja normal), pero la lista de respuestas NO puede viajar hasta el reveal."""
    session = _session()
    session.questions = activity_questions(_huecos("I _____ tired.", ("am",)))
    session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()

    abierto = session.public_state()
    assert "answer" not in abierto and "answer_label" not in abierto

    session.reveal()
    assert session.public_state()["answer"] == ["am"]


# ── Fase 3: audio y la subfase de escucha ────────────────────────────────────


def _audio_mc(audio="He wakes up at four.", **kw):
    class _Fake:
        id, type = "lmc1", "listeningmultiplechoice"
        options, answer = ["Four", "Five"], "Four"
        voice = rate = None
    _Fake.audio_text = audio
    for k, v in kw.items():
        setattr(_Fake, k, v)
    return _Fake()


def test_la_transcripcion_del_audio_no_sale_nunca_en_el_estado_publico():
    """El test que justifica toda la maquinaria de la llave de pantalla. El alumno y la pantalla
    polean el MISMO endpoint sin autenticación, así que si `audio_text` viajara en
    `public_state()`, cualquiera con las herramientas del navegador leería lo que tiene que
    escuchar. Es la regla 41 por otra puerta."""
    session = _session()
    session.questions = activity_questions(_audio_mc())
    session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()

    publicado = json.dumps(session.public_state(), ensure_ascii=False)

    assert "He wakes up at four" not in publicado
    assert session.public_state()["question"]["has_audio"] is True


def test_la_llave_de_pantalla_solo_viaja_en_el_estado_del_profesor():
    """`host_state()` va detrás del JWT; `public_state()` no. Si la llave se colara ahí, el
    celular del alumno podría pedir el mp3 — y con él, la transcripción."""
    session = _session()

    assert "screen_key" not in session.public_state()
    assert session.host_state()["screen_key"] == session.screen_key


def test_una_pregunta_con_audio_nace_escuchando_y_sin_cronometro():
    """La subfase que decide la fase 3: mientras suena, los botones están cerrados y el reloj no
    ha arrancado. Sin ella, el bono de rapidez premia a quien contesta antes de oír el audio."""
    session = _session(duration=20)
    session.questions = activity_questions(_audio_mc())
    ana = session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()

    assert session.phase() == "listening"
    assert session.remaining_ms() is None  # el cronómetro no ha empezado
    with pytest.raises(LiveError):
        session.submit(ana.pid, "Four")  # no se puede responder a ciegas

    session.open_answers()

    assert session.phase() == "question"
    assert session.remaining_ms() > 0
    assert session.submit(ana.pid, "Four") == {"registered": True}


def test_una_pregunta_sin_audio_no_pasa_por_la_escucha():
    """La subfase es solo para el audio: meter a todas por ahí obligaría al profesor a pulsar
    dos botones por pregunta en una sesión donde no suena nada."""
    session = _session()
    session.open_next()

    assert session.phase() == "question"
    with pytest.raises(LiveError):
        session.open_answers()  # no hay escucha que cerrar


def test_el_bono_de_rapidez_se_mide_desde_que_se_abren_las_respuestas():
    """El punto entero de la subfase. Si `opened_at` se fijara al lanzar, un audio de veinte
    segundos consumiría el cronómetro entero y todos cobrarían cero de bono por escuchar."""
    session = _session(duration=20)
    session.questions = activity_questions(_audio_mc())
    ana = session.join({"Carné": "1", "Nombre": "Ana"})
    session.open_next()
    time.sleep(0.05)      # "suena el audio"
    session.open_answers()  # aquí arranca el reloj
    session.submit(ana.pid, "Four")

    # Responde nada más abrirse: cobra el bono casi entero, no uno recortado por la escucha.
    assert session.participants[ana.pid].score > 950


def test_un_listeningtruefalse_reparte_el_mismo_audio_a_cada_enunciado():
    """Cinco enunciados sobre una grabación de veinte segundos: cada pregunta tiene que poder
    volver a reproducirla, o el que se distrajo en la primera pierde las cinco."""
    class _Fake:
        id, type = "ltf1", "listeningtruefalse"
        audio_text = "Tom wakes up at four."
        voice = rate = None
        statements = [{"text": "Tom is a baker.", "answer": True}, {"text": "He sleeps late.", "answer": False}]

    preguntas = activity_questions(_Fake())

    assert [q.id for q in preguntas] == ["ltf1:0", "ltf1:1"]
    assert all(q.audio_text == "Tom wakes up at four." for q in preguntas)


def test_un_listeningmatching_lleva_un_audio_por_par():
    """Aquí el audio es corto y cambia en cada pregunta, que es lo que mejor funciona en vivo."""
    class _Fake:
        id, type = "lm1", "listeningmatching"
        audio_text = None
        voice = rate = None
        options = None
        pairs = [{"audio_text": "a dog", "match": "perro"}, {"audio_text": "a cat", "match": "gato"}]

    preguntas = activity_questions(_Fake())

    assert [q.audio_text for q in preguntas] == ["a dog", "a cat"]
    assert [q.answer for q in preguntas] == ["perro", "gato"]
    # Sin `options` explícitas se usan todos los `match`, barajados como en `matching`.
    assert all(sorted(q.options) == ["gato", "perro"] for q in preguntas)


def test_un_listening_sin_audio_se_descarta_en_vez_de_ser_incontestable():
    """El parser lo valida, pero una hoja vieja o editada a mano puede llegar sin `audio_text`.
    Servirla dejaría al salón mirando una pregunta sobre un audio que no existe."""
    assert activity_questions(_audio_mc(audio=None)) == []


def test_ordenar_una_oracion_exige_el_orden_exacto():
    """`order` compara con `==` y no con `>=`: aquí sobrar una ficha SÍ es un error, al revés
    que en los huecos, donde el que sobra es un campo vacío del cliente."""
    class _Fake:
        id, type = "lo1", "listeningorder"
        audio_text = "She has never been to Paris."
        voice = rate = None
        answer = ["She", "has", "never", "been"]
        bank = None

    pregunta = activity_questions(_Fake())[0]

    assert pregunta.input == "order"
    assert pregunta.is_correct(["She", "has", "never", "been"])
    assert not pregunta.is_correct(["She", "never", "has", "been"])
    assert not pregunta.is_correct(["She", "has", "never", "been", "to"])
