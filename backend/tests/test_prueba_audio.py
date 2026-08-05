"""Botón "Probar el audio": qué texto suena en cada actividad y cuándo se considera entendido.

La ida y vuelta real (edge-tts → Whisper) necesita red; aquí se prueba la lógica que la rodea.
No toca la base de datos ni llama a ninguna IA (regla 34).
"""
from backend.app.main import _audible_text, _same_words
from backend.app.parser import parse_worksheet_script

SCRIPT = """worksheet {
  title: "Audio"
  listening {
    text: "The bus leaves at eight."
    question: "When?"
    answer: "at eight"
  }
  listeningfillblank {
    audio_text: "Tom didn't have to wear a uniform."
    text: "Tom _____ wear a uniform."
    answer: "didn't have to"
  }
  speaking {
    prompt: "Read it aloud."
    target: "She goes to school every day."
  }
  conversation {
    lines:
    - f: "Are you new here?"
    - m: "Yes, I started today."
    question: "When did he start?"
    answer: "today"
  }
  fillblank {
    text: "She _____ to school."
    answer: "goes"
  }
}"""


def test_solo_suenan_las_actividades_con_audio_o_habla():
    ws = parse_worksheet_script(SCRIPT)
    audibles = [(a.type, _audible_text(a)) for a in ws.activities if _audible_text(a)]
    assert [t for t, _ in audibles] == ["listening", "listeningfillblank", "speaking", "conversation"]
    # `fillblank` no suena; `listening` usa `text` y el resto `audio_text`.
    assert dict(audibles)["listening"] == "The bus leaves at eight."
    assert dict(audibles)["listeningfillblank"] == "Tom didn't have to wear a uniform."
    # `speaking` prueba el `target` (lo que el alumno debe pronunciar), no el `prompt`.
    assert dict(audibles)["speaking"] == "She goes to school every day."
    # `conversation` encadena los turnos: es lo que se sintetiza en una sola pista.
    assert dict(audibles)["conversation"] == "Are you new here? Yes, I started today."


def test_la_comparacion_ignora_puntuacion_y_cifras():
    # Whisper escribe "7" donde la voz dijo "seven": no es un fallo del audio.
    assert _same_words("I wake up at seven o'clock.", "I wake up at 7 o'clock")
    assert _same_words("Yes, I started today.", "yes I started today")
    # Lo que sí importa: la voz dice otra cosa distinta de lo que está escrito.
    assert not _same_words("He paid for the 3rd ticket.", "He paid for the third ticket.")
