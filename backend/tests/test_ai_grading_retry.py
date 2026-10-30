"""Dos envíos seguidos: si la IA falla en uno (rate-limit), ese envío no se queda sin calificar.

Antes `ai_grade_activities` se tragaba el error y la respuesta se guardaba con la
auto-calificación para siempre. Ahora lanza y `_retry_ai_grading` la recalifica en segundo plano.
No toca la base de datos: el repositorio se reemplaza en memoria (regla 34).
"""
import json

import pytest

from backend.app import ai, main
from backend.app.models import AnswerDetail, WorksheetResponse
from backend.tests.test_note_privada import _hoja


def _respuesta() -> WorksheetResponse:
    detalle = AnswerDetail(activity_id="a1", activity_type="textbox", prompt="Write.", student_answer="I play.", status="pending")
    return WorksheetResponse(worksheet_id="h1", student_name="Ana", answers_json={}, details=[detalle], score=0, correct_count=0, pending_count=1)


def test_si_la_ia_falla_el_error_no_se_traga(monkeypatch):
    def caida(*a, **k):
        raise RuntimeError("429 rate limit")

    monkeypatch.setattr(ai, "_ai_call", caida)
    with pytest.raises(RuntimeError):
        ai.ai_grade_activities(_respuesta().details, "Hoja")
    assert main._try_ai_grade(_respuesta().details, _hoja()) is False


def test_el_envio_avisa_al_alumno_que_la_nota_sigue_en_camino(monkeypatch):
    from fastapi import BackgroundTasks
    from backend.app.models import GuestResponseCreate

    def caida(*a, **k):
        raise RuntimeError("429 rate limit")

    hoja = _hoja()
    monkeypatch.setattr(ai, "_ai_call", caida)
    monkeypatch.setattr(main.repository, "get_worksheet", lambda wid: hoja)
    monkeypatch.setattr(main.repository, "count_guest_attempts", lambda wid, tok: 0)
    monkeypatch.setattr(main.repository, "add_response", lambda r: r)

    tareas = BackgroundTasks()
    textbox = hoja.json_content.iter_activities()[1]
    payload = GuestResponseCreate(worksheet_id=hoja.id, student_name="Ana", guest_token="token-de-prueba-123", answers_json={textbox.id: "I played."})
    enviada = main.submit_guest_response(payload, tareas)

    assert enviada.ai_pending is True
    assert len(tareas.tasks) == 1  # el reintento quedó en cola


def test_el_reintento_califica_y_guarda_la_respuesta(monkeypatch):
    guardada = _respuesta()
    actualizadas = []
    llamadas = {"n": 0}

    def ia(*a, **k):
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            raise RuntimeError("429 rate limit")  # el primer reintento también choca
        return json.dumps({"grades": [{"id": "a1", "status": "correct", "comment": "Bien."}]}), "test"

    monkeypatch.setattr(ai, "_ai_call", ia)
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    monkeypatch.setattr(main.repository, "get_response", lambda rid: guardada)
    monkeypatch.setattr(main.repository, "update_response_review", actualizadas.append)

    main._retry_ai_grading(guardada.id, _hoja())

    assert len(actualizadas) == 1
    assert guardada.details[0].status == "correct"
    assert guardada.score == 100 and guardada.pending_count == 0
