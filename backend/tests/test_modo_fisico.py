"""Modo físico / imprimible de la generación con IA (cambio #12).

El prompt le pide al modelo que no use audio, pero el modelo desobedece de vez en cuando y una hoja
para imprimir con un `listening` dentro sale con un hueco silencioso en el papel. Lo que se prueba
aquí es el FILTRO, que es la parte que no depende de la buena voluntad del modelo.

No toca la base de datos ni llama a ninguna IA (regla 34).
"""
import pytest

from backend.app.ai import _PRINTABLE_MODE, generate_worksheet_script
from backend.app.parser import (
    NON_PRINTABLE_TYPES,
    PRINTABLE_TYPES,
    SUPPORTED_BLOCKS,
    WorksheetScriptError,
    parse_worksheet_script,
    strip_non_printable,
)

CON_AUDIO = '''worksheet {
  title: "Mixed"

  block {
    title: "Part 1"

    fillblank {
      text: "She _____ to school."
      answer: "goes"
    }
    listening {
      text: "The bus leaves at eight."
      question: "When does the bus leave?"
      answer: "at eight"
    }
    listeningfillblank {
      audio_text: "Tom didn't have to wear a uniform."
      text: "Tom _____ wear a uniform."
      answer: "didn't have to"
    }
    speaking {
      prompt: "Read the sentence aloud."
      target: "She goes to school every day."
    }
    conversation {
      lines:
      - f: "Hi, are you new here?"
      - m: "Yes, I started today."
      question: "When did he start?"
      answer: "today"
    }
    truefalse {
      statements:
      - Dogs bark. | true
      - Cats fly. | false
    }
  }
}'''


def test_las_dos_listas_de_tipos_cubren_el_total():
    assert PRINTABLE_TYPES | NON_PRINTABLE_TYPES == SUPPORTED_BLOCKS
    assert not (PRINTABLE_TYPES & NON_PRINTABLE_TYPES)
    # La misma lista que descarta isPrintable() en WorksheetPrint.tsx.
    assert NON_PRINTABLE_TYPES == {
        "speaking", "conversation", "listening", "listeningfillblank",
        "listeningmultiplechoice", "listeningmatching", "listeningtruefalse", "listeningorder",
    }


def test_el_filtro_deja_solo_lo_que_pasa_a_papel():
    hoja = parse_worksheet_script(strip_non_printable(CON_AUDIO))
    tipos = [a.type for b in hoja.blocks for a in b.activities]
    assert tipos == ["fillblank", "truefalse"]


def test_el_filtro_no_toca_una_hoja_que_ya_era_imprimible():
    ya_limpia = strip_non_printable(CON_AUDIO)
    assert strip_non_printable(ya_limpia) == ya_limpia


def test_listening_no_se_lleva_por_delante_a_listeningfillblank():
    # `listening` es prefijo de los demás: si el recorte se hiciera por prefijo, borraría de más
    # (o de menos) y el resto de la hoja quedaría descuadrado.
    solo_fillblank = '''worksheet {
  title: "x"
  listeningfillblank {
    audio_text: "Tom didn't have to wear a uniform."
    text: "Tom _____ wear a uniform."
    answer: "didn't have to"
  }
  textbox {
    prompt: "Write about your weekend."
  }
}'''
    hoja = parse_worksheet_script(strip_non_printable(solo_fillblank))
    assert [a.type for a in hoja.activities] == ["textbox"]


def test_una_hoja_entera_de_audio_se_rechaza_en_vez_de_guardarse_vacia():
    solo_audio = '''worksheet {
  title: "Only audio"
  listening {
    text: "The bus leaves at eight."
    question: "When?"
    answer: "at eight"
  }
}'''
    with pytest.raises(WorksheetScriptError, match="al menos una actividad"):
        parse_worksheet_script(strip_non_printable(solo_audio))


def test_el_modo_fisico_solo_cambia_el_prompt_cuando_se_pide(monkeypatch):
    vistos = []

    def fake_call(system, user, prefer_fast=False):
        vistos.append(system)
        return 'worksheet {\n title: "x"\n textbox {\n  prompt: "Write."\n }\n}', "test"

    monkeypatch.setattr("backend.app.ai._ai_call", fake_call)
    generate_worksheet_script("una hoja")
    generate_worksheet_script("una hoja", printable=True)

    assert "PHYSICAL / PRINTABLE MODE" not in vistos[0]  # por defecto apagado
    assert _PRINTABLE_MODE in vistos[1]


def test_el_banco_de_imagenes_solo_entra_al_prompt_cuando_se_provee(monkeypatch):
    vistos = []

    def fake_call(system, user, prefer_fast=False):
        vistos.append(system)
        return 'worksheet {\n title: "x"\n textbox {\n  prompt: "Write."\n }\n}', "test"

    monkeypatch.setattr("backend.app.ai._ai_call", fake_call)
    generate_worksheet_script("una hoja")
    generate_worksheet_script("una hoja", image_bank=[
        {"id": "dr-001", "name": "Morning Alarm Clock", "description": "An alarm clock rings",
         "url": "https://example.com/clock.jpg", "tags": ["morning", "alarm"], "level": "A1"},
    ])

    assert "IMAGE BANK" not in vistos[0]
    assert "https://example.com/clock.jpg" in vistos[1]
    assert "An alarm clock rings" in vistos[1]  # la descripción viaja para que las oraciones la respeten
