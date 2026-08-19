"""Estímulo compartido de `block {}`: UN texto o UN audio arriba y N actividades de cualquier
tipo debajo, todas preguntando sobre él.

Antes la única forma de hacer varias preguntas sobre un mismo audio era repetir el audio en cada
actividad (y solo con los tipos listening*, que traen su pregunta pegada). Aquí se prueba que el
estímulo se lee del bloque, que no se lo roba a una actividad hija y que en papel el bloque con
audio desaparece entero.

No toca la base de datos ni llama a ninguna IA (regla 34).
"""
import pytest

from backend.app.parser import (
    WorksheetScriptError,
    parse_worksheet_script,
    strip_non_printable,
)

CONVERSACION = '''worksheet {
  title: "Listening A1"

  block {
    title: "Part 1: Listening"
    instructions: "Listen to the conversation and answer."
    lines:
    - f: "Hi! What is your name?"
    - m: "My name is Tom."

    multiplechoice {
      question: "What is the boy's name?"
      options:
      - Tom
      - Sam
      answer: "Tom"
    }
    truefalse {
      statements:
      - The girl asks his name. | true
    }
    textbox {
      prompt: "Write one sentence about the conversation."
    }
  }
}'''

LECTURA = '''worksheet {
  title: "Reading A1"

  block {
    title: "Part 1: Reading"
    text: "My school is big. There is a library."

    multiselect {
      question: "Select what the school has."
      options:
      - a library
      - a pool
      answer: ["a library"]
    }
    dragdrop {
      text: "My school is _____."
      answer:
      - big
      bank:
      - big
      - small
    }
  }
}'''


def test_conversacion_del_bloque_con_varias_actividades():
    worksheet = parse_worksheet_script(CONVERSACION)
    block = worksheet.blocks[0]

    assert block.lines == [
        {"speaker": "female", "text": "Hi! What is your name?"},
        {"speaker": "male", "text": "My name is Tom."},
    ]
    assert block.title == "Part 1: Listening"
    # Un solo audio, tres actividades de tipos distintos colgando de él.
    assert [a.type for a in block.activities] == ["multiplechoice", "truefalse", "textbox"]
    assert block.to_dict()["lines"] == block.lines


def test_texto_de_lectura_del_bloque():
    worksheet = parse_worksheet_script(LECTURA)
    block = worksheet.blocks[0]

    assert block.text == "My school is big. There is a library."
    assert [a.type for a in block.activities] == ["multiselect", "dragdrop"]
    # El `text:` del dragdrop hijo es SUYO, no el del bloque.
    assert block.activities[1].text == "My school is _____."


def test_el_bloque_no_roba_los_campos_de_sus_actividades():
    """`_block_header`: sin él, `_get_scalar` encontraba el `title:` del reading hijo y el
    `audio_text:` del listeningfillblank, y el bloque se quedaba con ambos."""
    script = '''worksheet {
  title: "Sin estímulo"

  block {
    reading {
      title: "My school"
      content: "My school is big."
      questions:
      - What is it about?
    }
    listeningfillblank {
      audio_text: "Tom didn't have to wear a uniform."
      text: "Tom _____ wear a uniform."
      answer: "didn't have to"
    }
  }
}'''
    block = parse_worksheet_script(script).blocks[0]

    assert block.title is None
    assert block.text is None
    assert block.audio_text is None
    assert block.lines is None
    assert block.activities[0].title == "My school"


def test_audio_y_conversacion_a_la_vez_es_error():
    script = CONVERSACION.replace('    lines:', '    audio_text: "Hello."\n    lines:')
    with pytest.raises(WorksheetScriptError, match="no puede tener 'audio_text' y 'lines'"):
        parse_worksheet_script(script)


def test_estimulo_sin_actividades_es_error():
    script = '''worksheet {
  title: "Vacío"

  block {
    audio_text: "Nobody answers this."
  }
  block {
    truefalse {
      statements:
      - Dogs bark. | true
    }
  }
}'''
    with pytest.raises(WorksheetScriptError, match="necesita al menos una actividad"):
        parse_worksheet_script(script)


def test_en_papel_el_bloque_con_audio_se_va_entero():
    """Sus actividades son de tipos imprimibles, pero preguntan sobre un audio que en papel
    nadie va a oír: quedarían preguntas sin enunciado real."""
    script = CONVERSACION[:-2] + '''
  block {
    title: "Part 2: Grammar"
    fillblank {
      text: "She _____ to school."
      answer: "goes"
    }
  }
}'''
    limpio = strip_non_printable(script)
    worksheet = parse_worksheet_script(limpio)

    assert [b.title for b in worksheet.blocks] == ["Part 2: Grammar"]
    assert "My name is Tom." not in limpio


def test_en_papel_el_bloque_de_lectura_se_conserva():
    limpio = strip_non_printable(LECTURA)
    block = parse_worksheet_script(limpio).blocks[0]

    assert block.text == "My school is big. There is a library."
    assert len(block.activities) == 2


def test_la_ia_recibe_el_estimulo_del_bloque_como_contexto():
    """Sin esto la IA calificaría el `textbox` viendo solo «Write one sentence about the
    conversation.», sin saber de qué conversación habla."""
    from types import SimpleNamespace

    from backend.app.main import _block_contexts
    from backend.app.models import WorksheetJson

    json_content = WorksheetJson.model_validate(parse_worksheet_script(CONVERSACION).to_dict())
    contexts = _block_contexts(SimpleNamespace(json_content=json_content))

    assert len(contexts) == 3  # las tres actividades del bloque, no solo las de audio
    for context in contexts.values():
        assert "My name is Tom." in context

    lectura = WorksheetJson.model_validate(parse_worksheet_script(LECTURA).to_dict())
    for context in _block_contexts(SimpleNamespace(json_content=lectura)).values():
        assert "There is a library." in context
