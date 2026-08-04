"""Biblioteca de imágenes personal del profesor: aislamiento por dueño.

`delete_teacher_image` borra siempre filtrando por `teacher_id` en el propio SQL — sin eso,
cualquier profesor podría borrar la imagen de otro con solo adivinar el id. Este test es el
único aviso si ese filtro se pierde en un refactor.
"""
import pytest

from backend.app.database import get_connection, initialize_database
from backend.app.repository import repository


@pytest.fixture
def db(tmp_path, monkeypatch):
    # Mismo motivo que en test_student_isolation.py: sin esto el test correría contra la
    # base de PRODUCCIÓN si el .env local apunta a Aiven.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "test.db"))
    initialize_database()
    with get_connection() as conn:
        conn.execute("INSERT INTO users (id, name, username, password_hash, role) VALUES ('prof-a', 'A', 'a', 'x', 'teacher')")
        conn.execute("INSERT INTO users (id, name, username, password_hash, role) VALUES ('prof-b', 'B', 'b', 'x', 'teacher')")


def test_un_profesor_no_ve_ni_puede_borrar_la_imagen_de_otro(db):
    image = repository.add_teacher_image("prof-a", "mydinoenglish/prof-a/foo", "https://example.com/foo.jpg")

    assert [i.id for i in repository.list_teacher_images("prof-a")] == [image.id]
    assert repository.list_teacher_images("prof-b") == []

    assert repository.delete_teacher_image(image.id, "prof-b") is False  # dueño equivocado
    assert [i.id for i in repository.list_teacher_images("prof-a")] == [image.id]  # sigue ahí

    assert repository.delete_teacher_image(image.id, "prof-a") is True
    assert repository.list_teacher_images("prof-a") == []
