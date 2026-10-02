"""Plan de reforzamiento tras una nota mala o regular.

No llama a la IA ni a la base: `_ai_call` y `repository.get_response/get_worksheet` van con
monkeypatch (regla 35: importar backend.app carga el .env real, así que nada aquí escribe).
"""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app import ai, main
from backend.app.models import AnswerDetail, WorksheetResponse

PLAN = {
    "intro": "Vamos a repasar.",
    "areas": [{"topic": "Pasado simple", "mistakes": ["Escribiste 'goed'"], "explanation": "Go → went."}, {"sin": "topic"}],
    "quiz": [
        {"question": "Yesterday I ___ home.", "options": ["go", "went", "goed"], "answer": 1, "explanation": "Irregular."},
        {"question": "Clave fuera de rango", "options": ["a", "b"], "answer": 5},
    ],
}


def _detail(status: str) -> AnswerDetail:
    return AnswerDetail(activity_id="a1", activity_type="fillblank", prompt="I ___ (go) home.", student_answer="goed", correct_answer="went", status=status)


@pytest.fixture
def fake_ai(monkeypatch):
    seen = {}

    def fake(system, user, prefer_fast=False):
        seen["user"] = user
        return "```json\n" + json.dumps(PLAN) + "\n```", "Fake"

    monkeypatch.setattr(ai, "_ai_call", fake)
    return seen


def test_sanea_la_salida_de_la_ia(fake_ai):
    plan = ai.generate_reinforcement_plan("Past simple", [_detail("incorrect")])
    assert [a["topic"] for a in plan["areas"]] == ["Pasado simple"]  # el área sin topic se cae
    assert [q["question"] for q in plan["quiz"]] == ["Yesterday I ___ home."]  # la de clave rota también
    assert '"goed"' in fake_ai["user"] and '"went"' in fake_ai["user"]  # los fallos llegan al prompt


def _with_response(monkeypatch, score, guest_token="tok-1234567890", status="incorrect"):
    resp = WorksheetResponse(worksheet_id="w1", student_name="Ana", answers_json={}, details=[_detail(status)], score=score, guest_token=guest_token)
    monkeypatch.setattr(main.repository, "get_response", lambda _id: resp)
    monkeypatch.setattr(main.repository, "get_worksheet", lambda _id: SimpleNamespace(title="Past simple"))
    monkeypatch.setattr(main, "_rate_limit", lambda *a, **k: None)


def test_nota_baja_devuelve_plan(fake_ai, monkeypatch):
    _with_response(monkeypatch, score=40)
    plan = main.reinforcement_plan("r1", request=None)
    assert plan.areas[0].topic == "Pasado simple" and len(plan.quiz) == 1


@pytest.mark.parametrize("kwargs, code", [
    ({"score": 80}, 409),             # nota buena: no hace falta
    ({"score": None}, 409),           # todo pendiente de revisión
    ({"score": 40, "guest_token": None}, 404),  # alumno registrado: no por ruta pública
])
def test_guardas(fake_ai, monkeypatch, kwargs, code):
    _with_response(monkeypatch, **kwargs)
    with pytest.raises(HTTPException) as exc:
        main.reinforcement_plan("r1", request=None)
    assert exc.value.status_code == code
