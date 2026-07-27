"""Aislamiento de alumnos por profesor.

Con el registro por Google abierto, la diferencia entre "cada profesor ve a los suyos" y
"cualquier desconocido que se registre ve a los de todos" es esta migración, así que tiene
comprobación propia. Cubre el arranque que asigna dueño a los alumnos heredados y las dos
puertas que ese dueño protege: la lista y la administración por id.
"""
import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.database import get_connection, initialize_database
from backend.app.models import PublicUser, UserRole
from backend.app.repository import repository


@pytest.fixture
def db(tmp_path, monkeypatch):
    # Sin borrar DATABASE_URL el test correría contra Postgres — que en local, con la URL de
    # Aiven en el .env, es la base de PRODUCCIÓN.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "test.db"))
    initialize_database()


def _usuario(uid: str, role: str, created_at: str, created_by: str | None = None) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, name, username, password_hash, role, created_at, created_by)"
            " VALUES (?, ?, ?, 'x', ?, ?, ?)",
            (uid, uid, uid, role, created_at, created_by),
        )


def _dueno(uid: str) -> str | None:
    with get_connection() as conn:
        return conn.execute("SELECT created_by FROM users WHERE id = ?", (uid,)).fetchone()[0]


def _perfil(uid: str, role: UserRole) -> PublicUser:
    return PublicUser(id=uid, name=uid, username=uid, role=role)


def test_el_arranque_asigna_los_alumnos_heredados_al_profesor_mas_antiguo(db):
    _usuario("prof-viejo", "teacher", "2024-01-01")
    _usuario("prof-nuevo", "teacher", "2026-07-01")
    _usuario("alumno-heredado", "student", "2024-02-01")  # created_by NULL, como en producción

    initialize_database()  # segundo arranque: aquí corre la migración

    assert _dueno("alumno-heredado") == "prof-viejo"


def test_un_profesor_recien_registrado_no_ve_los_alumnos_heredados(db):
    _usuario("prof-viejo", "teacher", "2024-01-01")
    _usuario("alumno-heredado", "student", "2024-02-01")
    initialize_database()
    _usuario("prof-google", "teacher", "2026-07-27")  # se registra después del despliegue

    assert [u.id for u in repository.list_students("prof-viejo")] == ["alumno-heredado"]
    assert repository.list_students("prof-google") == []
    assert len(repository.list_students(None)) == 1  # el admin los sigue viendo todos


def test_un_profesor_ajeno_tampoco_puede_administrarlo_por_id(db):
    """La lista es solo una de las puertas: sin esto, `prof-google` no lo vería pero
    podría borrarlo llamando a DELETE /students/{id} con el id a mano."""
    _usuario("prof-viejo", "teacher", "2024-01-01")
    _usuario("alumno-heredado", "student", "2024-02-01")
    initialize_database()
    _usuario("prof-google", "teacher", "2026-07-27")

    with pytest.raises(HTTPException) as err:
        main.require_student_manager("alumno-heredado", _perfil("prof-google", UserRole.teacher))
    assert err.value.status_code == 403

    main.require_student_manager("alumno-heredado", _perfil("prof-viejo", UserRole.teacher))


def test_el_seed_demo_deja_al_alumno_a_nombre_del_profesor_demo(tmp_path, monkeypatch):
    """El seed corre después de la migración, así que su alumno nace sin dueño. Sin la línea
    que lo adopta no lo vería nadie y en desarrollo parecería un seed roto."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "true")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "demo.db"))
    initialize_database()

    assert [u.username for u in repository.list_students("teacher-demo")] == ["estudiante"]


def test_psycopg_no_expone_executemany_en_la_conexion():
    """Por esto `_seed_demo_users` inserta fila a fila: en psycopg3 `executemany` vive en el
    cursor, no en la conexión, y la rama de Postgres reventaba al arrancar con
    SEED_DEMO_USERS=true. Si algún día lo añaden, este test cae y el rodeo se puede quitar."""
    import psycopg

    assert not hasattr(psycopg.Connection, "executemany")


def test_sin_ningun_profesor_el_alumno_queda_sin_dueno_y_solo_lo_toca_el_admin(db):
    """Caso raro (una base sin profesores), pero define hacia dónde falla: en cerrado."""
    _usuario("alumno-huerfano", "student", "2024-02-01")
    initialize_database()

    assert _dueno("alumno-huerfano") is None
    with pytest.raises(HTTPException):
        main.require_student_manager("alumno-huerfano", _perfil("cualquiera", UserRole.teacher))
    main.require_student_manager("alumno-huerfano", _perfil("jefe", UserRole.admin))
