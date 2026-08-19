"""Botón "Probar el audio": qué texto suena en cada actividad y cuándo se considera entendido.

La ida y vuelta real (edge-tts → Whisper) necesita red; aquí se prueba la lógica que la rodea.
No toca la base de datos ni llama a ninguna IA (regla 34).
"""
from backend.app.main import (
    DEFAULT_TTS_RATE,
    _audible_text,
    _resolve_conversation_voice,
    _same_words,
    _tts_rate,
    _tts_voice,
)
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


def test_rate_y_voice_no_dejan_pasar_ssml():
    # `rate` y `voice` llegan del query string y acaban dentro del SSML que edge-tts manda a
    # Microsoft: lo que no tenga la forma exacta cae al valor por defecto en vez de viajar.
    assert _tts_rate("-35%") == "-35%"
    assert _tts_rate("+0%") == "+0%"
    assert _tts_rate("slow") == DEFAULT_TTS_RATE
    assert _tts_rate('-15%"/><break time="5s"/>') == DEFAULT_TTS_RATE
    assert _tts_voice("en-GB-SoniaNeural") == "en-GB-SoniaNeural"
    assert _tts_voice('x"/><voice name="en-US-AnaNeural') == "en-US-AndrewNeural"


def test_voz_de_cada_hablante_se_resuelve_como_en_el_front():
    # Sin voz fijada → la curada del género del hablante (igual que /tts/conversation por defecto).
    assert _resolve_conversation_voice(None, "en-US-AndrewNeural") == "en-US-AndrewNeural"
    assert _resolve_conversation_voice(None, "en-US-AriaNeural") == "en-US-AriaNeural"
    # Alias del género → la voz curada de ese género (el profesor puede cruzarlos a propósito).
    assert _resolve_conversation_voice("male", "en-US-AndrewNeural") == "en-US-AndrewNeural"
    assert _resolve_conversation_voice("female", "en-US-AriaNeural") == "en-US-AriaNeural"
    # Nombre literal de edge-tts (voz infantil, por ejemplo) → pasa tal cual.
    assert _resolve_conversation_voice("en-US-AnaNeural", "en-US-AriaNeural") == "en-US-AnaNeural"
    assert _resolve_conversation_voice("en-US-RogerNeural", "en-US-AndrewNeural") == "en-US-RogerNeural"
