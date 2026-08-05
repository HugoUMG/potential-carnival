"""Las dos puertas que se cerraron tras la revisión de seguridad.

1. El `reader` no entraba en ninguna rama de los endpoints de usuario y caía directo al
   update: podía fijar la contraseña del admin. Es la cuenta compartida, así que la
   credencial la conoce mucha gente.
2. Los endpoints públicos que cuestan CPU (`/tts`) o dinero (`/public/transcribe`) no tenían
   ningún tope: ni de tamaño por petición ni de peticiones por IP.
"""
import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.database import get_connection, initialize_database
from backend.app.models import PasswordUpdate, PublicUser, UserRole, UserUpdate
from backend.app.repository import repository


@pytest.fixture
def db(tmp_path, monkeypatch):
    # Sin borrar DATABASE_URL el test correría contra Postgres — que en local, con la URL de
    # Aiven en el .env, es la base de PRODUCCIÓN.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "test.db"))
    initialize_database()


def _usuario(uid: str, role: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, name, username, password_hash, role) VALUES (?, ?, ?, 'x', ?)",
            (uid, uid, uid, role),
        )


def _hash(uid: str) -> str:
    with get_connection() as conn:
        return conn.execute("SELECT password_hash FROM users WHERE id = ?", (uid,)).fetchone()[0]


# El reader solo vive como fila en Postgres (el CHECK de schema.sql aún no lo incluye), pero
# estos endpoints solo consultan al usuario OBJETIVO: basta con presentar el rol del que llama.
def _lector() -> PublicUser:
    return PublicUser(id="reader-1", name="Lector", username="lector", role=UserRole.reader)


def test_lector_no_cambia_la_contrasena_del_admin(db):
    _usuario("admin-1", "admin")
    antes = _hash("admin-1")

    with pytest.raises(HTTPException) as exc:
        main.update_user_password("admin-1", PasswordUpdate(new_password="tomada12345"), _lector())

    assert exc.value.status_code == 403
    assert _hash("admin-1") == antes  # lo que importa: la contraseña sigue siendo la de antes


def test_lector_no_edita_a_otro_usuario(db):
    _usuario("teacher-1", "teacher")

    with pytest.raises(HTTPException) as exc:
        main.update_user("teacher-1", UserUpdate(name="Secuestrado", username="secuestrado"), _lector())

    assert exc.value.status_code == 403


def _aula(aula_id: str, dueno: str) -> None:
    with get_connection() as conn:
        conn.execute("INSERT INTO classrooms (id, name, created_by) VALUES (?, ?, ?)", (aula_id, aula_id, dueno))


def _profesor(uid: str) -> PublicUser:
    return PublicUser(id=uid, name=uid, username=uid, role=UserRole.teacher)


def test_los_invitados_del_panel_son_solo_los_de_las_aulas_propias(db):
    """El agujero más ancho: bastaba tener rol de profesor para ver los invitados de todos."""
    _usuario("prof-a", "teacher")
    _usuario("prof-b", "teacher")
    _aula("aula-a", "prof-a")
    _aula("aula-b", "prof-b")
    repository.log_guest_access("tok-a", "Ana", "aula-a", "Aula A")
    repository.log_guest_access("tok-b", "Beto", "aula-b", "Aula B")

    de_a = repository.list_guest_access_logs("prof-a")

    assert [log["guest_token"] for log in de_a] == ["tok-a"]
    assert len(repository.list_guest_access_logs(None)) == 2  # el admin sigue viéndolos todos


def test_el_detalle_de_un_invitado_exige_ser_dueno_del_aula(db):
    _usuario("prof-a", "teacher")
    _usuario("prof-b", "teacher")
    _aula("aula-b", "prof-b")
    repository.log_guest_access("tok-b", "Beto", "aula-b", "Aula B")

    with pytest.raises(HTTPException) as exc:
        main.guest_detail("tok-b", "aula-b", _profesor("prof-a"))

    assert exc.value.status_code == 403
    assert main.guest_detail("tok-b", "aula-b", _profesor("prof-b"))["responses"] == []


def test_un_classroom_id_inventado_no_aparece_en_el_panel_de_nadie(db):
    """`/public/guest-sessions` no lleva auth y acepta cualquier cadena como aula."""
    _usuario("prof-a", "teacher")
    repository.log_guest_access("tok-x", "Nadie", "aula-que-no-existe", "Inventada")

    assert repository.list_guest_access_logs("prof-a") == []
    assert repository.list_guest_access_logs(None) == []


class _PeticionFalsa:
    """Lo mínimo que mira `_client_ip`: cabeceras y cliente."""

    def __init__(self, xff: str | None = None, host: str = "10.0.0.1"):
        self.headers = {"x-forwarded-for": xff} if xff else {}
        self.client = type("C", (), {"host": host})()


def test_el_rate_limit_corta_al_superar_el_tope():
    main._rate_hits.clear()
    peticion = _PeticionFalsa(host="203.0.113.9")

    for _ in range(3):
        main._rate_limit(peticion, limit=3)

    with pytest.raises(HTTPException) as exc:
        main._rate_limit(peticion, limit=3)
    assert exc.value.status_code == 429


def test_cada_ip_tiene_su_propio_cupo():
    """Si el cupo fuera global, un solo abusador dejaría sin audio a todos los demás."""
    main._rate_hits.clear()
    main._rate_limit(_PeticionFalsa(host="203.0.113.9"), limit=1)

    main._rate_limit(_PeticionFalsa(host="203.0.113.10"), limit=1)  # no debe lanzar


def test_la_ip_se_toma_de_la_derecha_del_x_forwarded_for():
    """La entrada de la derecha la pone el proxy de Render; lo que manda el cliente queda a la
    izquierda. Tomar la izquierda dejaría falsificar la IP y saltarse el límite con una cabecera."""
    ip = main._client_ip(_PeticionFalsa(xff="1.1.1.1, 198.51.100.7"))

    assert ip == "198.51.100.7"
