"""Varios profesores: aulas y alumnos compartidos, y el admin como administrador de profesores.

El dueño sigue siendo `created_by`. Compartir da ACCESO (ver, editar, asignar), no propiedad
(borrar, compartir a su vez). Y el admin, en el portal docente, es un profesor más: lo de todos
lo ve en /admin/overview o entrando a la vista de un profesor concreto.
"""
import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.database import get_connection, initialize_database
from backend.app.models import (
    ClassroomCreate,
    ClassroomStudentAssignment,
    OwnerUpdate,
    PublicUser,
    ShareRequest,
    StudentCreate,
    UserRole,
)
from backend.app.repository import repository
from backend.app.security import decode_access_token


@pytest.fixture
def db(tmp_path, monkeypatch):
    # Sin borrar DATABASE_URL el test correría contra Postgres — que en local, con la URL de
    # Aiven en el .env, es la base de PRODUCCIÓN.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "test.db"))
    initialize_database()
    for uid, role in (("ana", "teacher"), ("beto", "teacher"), ("caro", "teacher"), ("jefe", "admin")):
        _usuario(uid, role)


def _usuario(uid: str, role: str, created_by: str | None = None) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, name, username, email, password_hash, role, created_by)"
            " VALUES (?, ?, ?, ?, 'x', ?, ?)",
            (uid, uid, uid, f"{uid}@escuela.test", role, created_by),
        )


def _perfil(uid: str, role: UserRole = UserRole.teacher) -> PublicUser:
    return PublicUser(id=uid, name=uid, username=uid, role=role)


ANA, BETO, CARO = _perfil("ana"), _perfil("beto"), _perfil("caro")
JEFE = _perfil("jefe", UserRole.admin)


def _prohibido(fn, *args) -> None:
    with pytest.raises(HTTPException) as err:
        fn(*args)
    assert err.value.status_code == 403


def _ids(items) -> list[str]:
    return sorted(item.id for item in items)


# ── Aulas compartidas ────────────────────────────────────────────────────────

def test_un_aula_compartida_la_ven_el_dueno_y_el_invitado_pero_no_un_tercero(db):
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)

    main.share_classroom(aula.id, ShareRequest(username="BETO"), ANA)  # sin distinguir mayúsculas

    assert _ids(main.list_classrooms(ANA)) == [aula.id]
    assert _ids(main.list_classrooms(BETO)) == [aula.id]
    assert main.list_classrooms(CARO) == []
    detalle = main.get_classroom_detail(aula.id, BETO)
    assert detalle.owner_name == "ana" and [t.id for t in detalle.teachers] == ["beto"]
    _prohibido(main.get_classroom_detail, aula.id, CARO)


def test_se_puede_compartir_por_correo(db):
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)

    main.share_classroom(aula.id, ShareRequest(username="beto@escuela.test"), ANA)

    assert _ids(main.list_classrooms(BETO)) == [aula.id]


def test_el_invitado_no_borra_ni_comparte_ni_abre_el_aula_a_invitados(db):
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)
    main.share_classroom(aula.id, ShareRequest(username="beto"), ANA)

    _prohibido(main.delete_classroom, aula.id, BETO)
    _prohibido(main.share_classroom, aula.id, ShareRequest(username="caro"), BETO)
    _prohibido(main.require_classroom_manager, aula.id, BETO)
    _prohibido(main.unshare_classroom, aula.id, "beto", CARO)  # un tercero no saca a nadie

    main.unshare_classroom(aula.id, "beto", BETO)  # pero sí puede salirse él
    assert main.list_classrooms(BETO) == []


def test_un_profesor_no_comparte_por_id_solo_por_usuario(db):
    """El id directo es del admin: un profesor no tiene de dónde sacar ids ajenos."""
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)

    with pytest.raises(HTTPException) as err:
        main.share_classroom(aula.id, ShareRequest(teacher_id="beto"), ANA)

    assert err.value.status_code == 404
    main.share_classroom(aula.id, ShareRequest(teacher_id="beto"), JEFE)
    assert _ids(main.list_classrooms(BETO)) == [aula.id]


# ── Alumnos compartidos ──────────────────────────────────────────────────────

def test_un_alumno_compartido_lo_alcanza_el_invitado_pero_solo_el_dueno_lo_borra(db):
    _usuario("luis", "student", created_by="ana")

    assert main.list_students(BETO) == []
    main.share_student("luis", ShareRequest(username="beto"), ANA)

    [luis] = main.list_students(BETO)
    assert luis.owner_name == "ana" and [t.id for t in luis.shared_with] == ["beto"]
    main.require_student_access("luis", BETO)
    _prohibido(main.require_student_manager, "luis", BETO)
    _prohibido(main.delete_student, "luis", BETO)
    _prohibido(main.share_student, "luis", ShareRequest(username="caro"), BETO)
    _prohibido(main.require_student_access, "luis", CARO)


def test_estar_en_un_aula_del_profesor_da_acceso_al_alumno(db):
    """El caso del admin que arma el aula: el profesor tiene que ver a los alumnos que le tocan
    aunque no los haya creado él."""
    _usuario("luis", "student", created_by="ana")
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)
    main.assign_student(aula.id, ClassroomStudentAssignment(student_id="luis"), ANA)

    _prohibido(main.require_student_access, "luis", BETO)
    main.share_classroom(aula.id, ShareRequest(username="beto"), ANA)

    main.require_student_access("luis", BETO)
    assert _ids(main.list_students(BETO)) == ["luis"]
    assert [a.student_id for a in main.get_students_activity(BETO)] == ["luis"]
    assert main.get_students_activity(CARO) == []


def test_un_profesor_no_mete_en_su_aula_a_un_alumno_ajeno(db):
    """Antes bastaba el id: y estar en el aula es justo lo que da acceso al alumno."""
    _usuario("luis", "student", created_by="ana")
    aula_de_beto = main.create_classroom(ClassroomCreate(name="Intrusa"), BETO)

    _prohibido(main.assign_student, aula_de_beto.id, ClassroomStudentAssignment(student_id="luis"), BETO)
    _prohibido(main.list_student_sessions, "luis", BETO)
    _prohibido(main.list_student_responses, "luis", BETO)


# ── El admin administra profesores ───────────────────────────────────────────

def test_el_admin_en_el_portal_docente_solo_ve_lo_suyo(db):
    main.create_classroom(ClassroomCreate(name="3A"), ANA)
    _usuario("luis", "student", created_by="ana")

    assert main.list_classrooms(JEFE) == []
    assert main.list_students(JEFE) == []


def test_el_panel_de_administracion_ve_a_todos_con_sus_cifras(db):
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)
    main.share_classroom(aula.id, ShareRequest(username="beto"), ANA)
    _usuario("luis", "student", created_by="ana")
    main.assign_student(aula.id, ClassroomStudentAssignment(student_id="luis"), ANA)

    panel = main.admin_overview(JEFE)

    cifras = {t.id: t for t in panel["teachers"]}
    assert (cifras["ana"].classrooms_owned, cifras["ana"].students) == (1, 1)
    assert (cifras["beto"].classrooms_owned, cifras["beto"].classrooms_shared, cifras["beto"].students) == (0, 1, 1)
    assert cifras["caro"].students == 0
    assert panel["classrooms"][0].student_ids == ["luis"]
    assert _ids(panel["students"]) == ["luis"]


def test_el_admin_crea_el_aula_y_el_alumno_a_nombre_de_un_profesor(db):
    aula = main.create_classroom(ClassroomCreate(name="3A", owner_id="ana"), JEFE)
    alumno = main.create_student(StudentCreate(name="Luis", username="luis", password="clave1234", owner_id="ana"), JEFE)
    main.assign_student(aula.id, ClassroomStudentAssignment(student_id=alumno.id), JEFE)

    assert _ids(main.list_classrooms(ANA)) == [aula.id]
    assert _ids(main.list_students(ANA)) == [alumno.id]
    # Un profesor no puede usar el mismo campo para colarle un aula a otro.
    _prohibido(main.create_classroom, ClassroomCreate(name="Colada", owner_id="ana"), BETO)
    _prohibido(main.create_student, StudentCreate(name="X", username="equis", password="clave1234", owner_id="ana"), BETO)


def test_el_admin_cambia_el_dueno_de_un_aula_y_de_un_alumno(db):
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)
    main.share_classroom(aula.id, ShareRequest(username="beto"), ANA)
    _usuario("luis", "student", created_by="ana")

    main.set_classroom_owner(aula.id, OwnerUpdate(teacher_id="beto"), JEFE)
    main.set_student_owner("luis", OwnerUpdate(teacher_id="beto"), JEFE)

    cambiada = repository.get_classroom(aula.id)
    assert cambiada.created_by == "beto" and cambiada.teachers == []  # ya no figura como invitado
    assert main.list_classrooms(ANA) == []
    main.require_student_manager("luis", BETO)
    _prohibido(main.require_student_access, "luis", ANA)


def test_la_vista_de_profesor_entrega_un_token_de_ese_profesor_marcado(db):
    sesion = main.impersonate_teacher("ana", JEFE)

    claims = decode_access_token(sesion.access_token)
    assert (claims["sub"], claims["role"], claims["imp"]) == ("ana", "teacher", "jefe")
    with pytest.raises(HTTPException) as err:
        main.impersonate_teacher("jefe", JEFE)  # nunca otro admin
    assert err.value.status_code == 404
    with get_connection() as conn:  # no cuenta como ingreso del profesor
        assert conn.execute("SELECT COUNT(*) FROM user_sessions").fetchone()[0] == 0


def test_borrar_a_un_profesor_pasa_sus_aulas_y_alumnos_al_heredero(db):
    """`classrooms.created_by` es FK sin CASCADE: sin reasignar, borrar a un profesor con un
    aula reventaba, y sus alumnos quedaban apuntando a un dueño que ya no existe."""
    aula = main.create_classroom(ClassroomCreate(name="3A"), ANA)
    main.share_classroom(aula.id, ShareRequest(username="beto"), ANA)
    _usuario("luis", "student", created_by="ana")

    main.delete_teacher("ana", "beto", JEFE)

    heredada = repository.get_classroom(aula.id)
    assert heredada.created_by == "beto" and heredada.teachers == []
    main.require_student_manager("luis", BETO)
    assert repository.get_user("ana") is None
