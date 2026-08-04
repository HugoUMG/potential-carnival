"""Campo privado `note` (ADR-19).

La nota es la pista que el profesor le deja a la IA para calificar respuestas abiertas. Su valor
depende de UNA garantía: que el alumno no la vea nunca. Este test cubre los dos extremos de la
cadena — que se persiste al parsear, y que se cae del payload que recibe el alumno.

No toca la base de datos: solo construye modelos en memoria (regla 34).
"""
import json

from backend.app import ai
from backend.app.main import _activity_notes, _without_notes
from backend.app.models import Worksheet, WorksheetJson
from backend.app.parser import parse_worksheet_script


SCRIPT = '''worksheet {
  title: "Describe the picture"

  imagequestion {
    image: "https://example.test/car.png"
    prompt: "What do you see?"
    note: "En la foto hay un carro rojo: debe mencionar el color."
  }

  textbox {
    prompt: "Write about your weekend."
  }
}'''


def _hoja() -> Worksheet:
    data = parse_worksheet_script(SCRIPT).to_dict()
    return Worksheet(
        title=data["title"],
        description=data["description"],
        script_content=SCRIPT,
        json_content=WorksheetJson(**data),
        created_by="prof",
        published=True,
    )


def test_la_nota_se_parsea_y_se_persiste_en_el_json():
    hoja = _hoja()
    imagen, texto = hoja.json_content.iter_activities()
    assert imagen.note == "En la foto hay un carro rojo: debe mencionar el color."
    assert texto.note is None  # sin `note:` en el DSL no se inventa


def test_la_nota_no_viaja_al_alumno_ni_en_el_json_ni_en_el_script():
    publica = _without_notes(_hoja())
    assert all(a.note is None for a in publica.json_content.iter_activities())
    assert "note:" not in publica.script_content
    assert "carro rojo" not in publica.script_content
    # Lo demás de la hoja sigue intacto: solo se quita la línea de la nota.
    assert "What do you see?" in publica.script_content


def test_la_hoja_del_profesor_conserva_la_nota():
    # _without_notes devuelve una copia: el original que edita el profesor no se toca.
    hoja = _hoja()
    _without_notes(hoja)
    assert hoja.json_content.iter_activities()[0].note is not None


def test_la_nota_llega_a_la_ia_calificadora_pero_no_al_detalle_del_alumno(monkeypatch):
    hoja = _hoja()
    imagen = hoja.json_content.iter_activities()[0]

    class Detalle:
        def __init__(self, activity_id):
            self.activity_id = activity_id
            self.activity_type = "imagequestion"
            self.prompt = "What do you see?"
            self.correct_answer = None
            self.student_answer = "A car."
            self.status = "pending"
            self.teacher_comment = ""
            self.graded_by = None

    # Un id derivado ("actividad:0", como reading/matching) debe encontrar la nota de su raíz.
    detalles = [Detalle(imagen.id), Detalle(f"{imagen.id}:0")]

    enviado = {}

    def fake_call(system, user, prefer_fast=False):
        enviado["user"] = user
        return json.dumps({"grades": []}), "test"

    monkeypatch.setattr(ai, "_ai_call", fake_call)
    resultado = ai.ai_grade_activities(detalles, "Describe the picture", 50, _activity_notes(hoja))

    payload = enviado["user"]
    assert payload.count("teacher_note") == 2
    assert "carro rojo" in payload
    # El detalle que se le devuelve al alumno no gana un campo con la nota.
    assert not any(hasattr(d, "note") for d in resultado)


def test_el_prompt_de_calificacion_explica_que_la_nota_no_se_revela():
    reglas = ai._grade_system(50)
    assert "teacher_note" in reglas
    assert "NEVER quote it" in reglas


def test_el_alumno_autenticado_no_recibe_la_nota_al_pedir_la_hoja_por_id(monkeypatch):
    # GET /worksheets/{id} lo usa cualquier usuario autenticado (regla 13): un alumno que lo
    # llame no debe llevarse las `note` del profesor, igual que en el flujo público.
    from backend.app import main
    from backend.app.models import PublicUser, UserRole

    hoja = _hoja()
    monkeypatch.setattr(main.repository, "get_worksheet", lambda wid: hoja)

    resultado = main.get_worksheet(
        "hoja-001",
        PublicUser(id="alumno1", name="Alumno", username="alumno1", role=UserRole.student),
    )
    assert all(a.note is None for a in resultado.json_content.iter_activities())
    assert "note:" not in resultado.script_content

    # El profesor dueño (que edita la hoja) sí la conserva.
    resultado_prof = main.get_worksheet(
        "hoja-001",
        PublicUser(id="prof", name="Prof", username="prof", role=UserRole.teacher),
    )
    assert resultado_prof.json_content.iter_activities()[0].note is not None
