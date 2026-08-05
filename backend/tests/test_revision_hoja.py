"""Botón "Revisar hoja": la IA resuelve la hoja como alumno y devuelve un informe.

Se prueba lo que no depende del modelo: qué llega al prompt. No llama a la IA (regla 34).
"""
from backend.app import ai


def _fake_call(monkeypatch):
    seen: dict[str, str] = {}

    def fake(system: str, user: str, prefer_fast: bool = False):
        seen["system"], seen["user"] = system, user
        return "**Veredicto:** lista para usar", "Fake · test"

    monkeypatch.setattr(ai, "_ai_call", fake)
    return seen


def test_el_prompt_pide_resolverla_como_alumno(monkeypatch):
    seen = _fake_call(monkeypatch)
    report, provider = ai.review_worksheet_script('worksheet {\n  textbox { prompt: "Write." }\n}')
    assert provider == "Fake · test"
    assert "Veredicto" in report
    assert "ESTUDIANTE" in seen["system"]
    assert 'prompt: "Write."' in seen["user"]  # el script completo va en el prompt


def test_el_medio_cambia_el_system_prompt(monkeypatch):
    """Regresión: con un solo prompt "hoja impresa" la IA reportaba los `listening*` como
    imposibles incluso en hojas de pantalla, donde el TTS los lee sin problema."""
    seen = _fake_call(monkeypatch)
    ai.review_worksheet_script("worksheet { }", printable=True)
    assert ai._REVIEW_ON_PAPER in seen["system"]
    assert ai._REVIEW_ON_SCREEN not in seen["system"]

    ai.review_worksheet_script("worksheet { }", printable=False)
    assert ai._REVIEW_ON_SCREEN in seen["system"]
    assert ai._REVIEW_ON_PAPER not in seen["system"]
    assert "TTS" in seen["system"]  # en pantalla el audio existe


def test_filtra_las_quejas_de_interfaz():
    """El prompt las prohíbe pero gemini-flash-lite las cuela: cada tipo YA trae su campo de
    respuesta, así que "falta una caja de texto" siempre es falso."""
    informe = ai._strip_ui_complaints(
        "**Veredicto:** tiene errores.\n\n"
        "- **[Part 4]** — La actividad de `reading` carece de campos de respuesta (cajas de texto)\n"
        "  para que el alumno responda; se debe añadir un `textbox` por pregunta.\n"
        "- **[Part 5]** — La tercera afirmación es ambigua: el texto no dice si ya planeó el viaje.\n"
    )
    assert "cajas de texto" not in informe
    assert "La tercera afirmación es ambigua" in informe
    assert "Veredicto" in informe


def test_si_solo_habia_quejas_de_interfaz_la_hoja_queda_lista():
    # Dejar "tiene errores" sin errores debajo confundiría más que no filtrar.
    informe = ai._strip_ui_complaints(
        "**Veredicto:** tiene errores.\n\n- **[Part 4]** — Falta la caja de texto para responder.\n"
    )
    assert informe == ai._VERDICT_OK


def test_no_toca_un_informe_limpio():
    limpio = "**Veredicto:** con detalles menores\n\n- **[Part 2]** — El distractor «water» también encaja."
    assert ai._strip_ui_complaints(limpio) == limpio
