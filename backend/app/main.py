from pathlib import Path
from collections import OrderedDict
from typing import Any
import asyncio
import hashlib
import json
import os
import random
import re
import secrets
import threading
import time

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.security import OAuth2PasswordBearer

from .ai import _ai_lock as ai_lock, ai_grade_activities, ai_json, define_words, transcribe_with_clarity, FROG_CATEGORIES, frog_example, frog_norm, generate_frog_words, generate_game_questions, generate_reinforcement_plan, generate_vocabulary_csv, generate_worksheet_script, edit_worksheet_script, review_worksheet_script, summarize_worksheet_performance as ai_summarize, transcribe_audio as ai_transcribe
from .database import get_connection, initialize_database
from . import live
from . import roleplay
from . import rooms
from .models import (
    AiGenerateRequest,
    AiEditRequest,
    AiReviewRequest,
    AnswerDetail,
    AnswerReview,
    AdminOverview,
    Classroom,
    ClassroomCreate,
    ClassroomDetail,
    ClassroomRename,
    OwnerUpdate,
    ShareRequest,
    StudentSummary,
    ClassroomStudentAssignment,
    ClassroomVisibilityUpdate,
    ClassroomWorksheetAssignment,
    GameAiRequest,
    GameQuestion,
    GameSet,
    GameSetPayload,
    GameSetSummary,
    FrogExample,
    FrogPool,
    GoogleAuthRequest,
    PublicGameSet,
    RoleplayReply,
    RoleplayReport,
    RoleplayScenario,
    RoleplayStart,
    RoleplayStartRequest,
    RoleplayTurnRequest,
    Verb,
    VocabWord,
    WordMeaning,
    LiveAnswer,
    LiveEmoji,
    LiveJoin,
    LiveOpenQuestion,
    LiveSessionCreate,
    LoginRequest,
    LoginResponse,
    PasswordUpdate,
    PublicUser,
    ReinforcementPlan,
    ReaderCreate,
    StudentActivity,
    StudentCreate,
    TeacherCreate,
    TeacherDashboardStats,
    TeacherImage,
    TeacherImageCreate,
    UserRole,
    UserSession,
    UserUpdate,
    VocabularyAssignment,
    VocabularyList,
    VocabularyAiRequest,
    VocabularyListCreate,
    Worksheet,
    WorksheetCreate,
    WorksheetUpdate,
    WorksheetJson,
    GuestResponseCreate,
    GuestSessionLog,
    WorksheetResponse,
    WorksheetResponseCreate,
    PracticeGrade,
    RoomCreate,
    RoomJoin,
    RoomPush,
    RoomSay,
    RoomTurn,
)
from .parser import WorksheetScriptError, parse_worksheet_script, strip_non_printable
from .repository import repository
from .security import create_access_token, decode_access_token, get_access_token_expire_minutes, hash_password
from .settings import get_allowed_origins

app = FastAPI(title="API del constructor de hojas con IA", version="1.0.0")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
_response_locks: dict[tuple[str, str], float] = {}
_rate_hits: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    """IP real del cliente detrás del proxy de Render.

    Se toma la ENTRADA MÁS A LA DERECHA de X-Forwarded-For: es la que añade el proxy y el
    cliente no puede falsificarla (lo que él mande queda a la izquierda). Sin esto, con
    `request.client.host` todo el tráfico compartiría la IP del proxy y el límite de abajo
    castigaría a todos los usuarios como si fueran uno.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else "desconocido"


def _rate_limit(request: Request, limit: int, window: float = 60.0) -> None:
    """Ventana deslizante por IP para los endpoints públicos que cuestan CPU o dinero.

    ponytail: dict en memoria en vez de Redis o slowapi — el backend corre con un worker
    (`render.yaml`) y esto solo tiene que frenar un script en bucle. Dos techos conocidos:
    es POR PROCESO (con varios workers el límite real se multiplica por worker) y es POR IP
    (un colegio entero tras un NAT comparte cupo, por eso los límites van holgados). Si hace
    falta un límite exacto o por usuario, ahí sí: Redis.
    """
    now = time.monotonic()
    ip = _client_ip(request)
    hits = [t for t in _rate_hits.get(ip, ()) if now - t < window]
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="Demasiadas peticiones. Espera un momento.")
    hits.append(now)
    _rate_hits[ip] = hits
    if len(_rate_hits) > 5000:  # cota del dict: sin esto crece con cada IP vista y nunca baja
        for stale in [k for k, v in _rate_hits.items() if not v or now - v[-1] > window]:
            del _rate_hits[stale]

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    initialize_database()
    try:
        added = seed_frog_words()
        if added:
            print(f"[juegos] rana: {added} palabras nuevas de la semilla")
    except Exception as exc:  # sin semilla el juego sigue: la IA llena el banco como antes
        print(f"[juegos] rana: no se pudo cargar la semilla: {exc!r}")
    try:
        changed = seed_verbs()
        if changed:
            print(f"[juegos] verbos: {changed} verbos nuevos o cambiados de la semilla")
    except Exception as exc:  # sin semilla, Camaleón y Oruga avisan de que no hay verbos
        print(f"[juegos] verbos: no se pudo cargar la semilla: {exc!r}")
    # Solo en Render (lo define Render): en local el .env apunta a Aiven y gastaría IA de producción
    # con el servidor de desarrollo abierto (regla 2).
    if os.getenv("RENDER"):
        threading.Thread(target=_frog_passive_loop, name="frog-passive", daemon=True).start()


@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict[str, str]:
    # UptimeRobot pega aquí cada 5 min: la consulta evita que Aiven apague la base por "sin uso"
    with get_connection() as connection:
        connection.execute("SELECT 1")
    return {"estado": "correcto"}


def get_current_user(token: str = Depends(oauth2_scheme)) -> PublicUser:
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Token inválido o expirado") from exc
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Token inválido")
    user = repository.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    return user


def require_teacher_or_admin(current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    if current_user.role not in {UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=403, detail="Se requiere rol de profesor o administrador")
    return current_user


def require_admin(current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")
    return current_user


def require_student(current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Se requiere rol de estudiante")
    return current_user


def require_student_owner_or_staff(student_id: str, current_user: PublicUser) -> None:
    if current_user.role in {UserRole.student, UserRole.reader} and current_user.id != student_id:
        raise HTTPException(status_code=403, detail="No puedes consultar datos de otro usuario")
    if current_user.role not in {UserRole.student, UserRole.reader, UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=403, detail="No autorizado")
    # Antes cualquier profesor leía hojas, respuestas y aulas de cualquier alumno con su id.
    if current_user.role == UserRole.teacher:
        require_student_access(student_id, current_user)


def require_worksheet_manager(worksheet_id: str, current_user: PublicUser) -> Worksheet:
    worksheet = repository.get_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if current_user.role != UserRole.admin and worksheet.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes administrar esta evaluación")
    return worksheet


@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    user = repository.authenticate(payload.username, payload.password, payload.role)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    repository.create_session(user.id)
    return LoginResponse(user=user, access_token=create_access_token(user.id, user.role.value))


# No hay alta pública con usuario/contraseña a propósito: no había forma de comprobar que
# el correo escrito a mano fuera de quien se registra. El único registro abierto es
# /auth/google, que trae el correo ya verificado. Alternativa cerrada: POST /teachers (admin).


def _verify_google_id_token(credential: str) -> dict:
    """Valida el ID token contra Google y devuelve sus claims.
    ponytail: se usa el endpoint tokeninfo de Google en vez de verificar la firma con JWKS
    localmente — httpx ya es dependencia y no hace falta ninguna librería nueva. Si el
    volumen de logins llega a molestar, cachear las claves y verificar en local."""
    expected_aud = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    # Falla en cerrado: sin el Client ID no se puede comprobar que el token sea de ESTA app,
    # y un ID token válido de cualquier otra aplicación de Google abriría cuentas aquí.
    if not expected_aud:
        raise HTTPException(status_code=503, detail="El acceso con Google no está configurado en el servidor.")
    with httpx.Client(timeout=10) as client:
        resp = client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="El token de Google no es válido.")
    claims = resp.json()
    if claims.get("aud") != expected_aud:
        raise HTTPException(status_code=401, detail="El token de Google no es de esta aplicación.")
    if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Emisor del token no reconocido.")
    if claims.get("email_verified") not in {True, "true"}:
        raise HTTPException(status_code=401, detail="La cuenta de Google no tiene el correo verificado.")
    return claims


@app.post("/auth/google", response_model=LoginResponse)
def google_auth(payload: GoogleAuthRequest) -> LoginResponse:
    """Login y registro con Google en un solo paso: si el correo no existe, crea el profesor."""
    claims = _verify_google_id_token(payload.credential)
    email = (claims.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=401, detail="Google no entregó un correo.")
    user = repository.get_user_by_email(email)
    if not user:
        user = repository.create_google_teacher(email, claims.get("name") or email.split("@")[0])
    elif user.role == UserRole.reader:
        raise HTTPException(status_code=403, detail="Esta cuenta no puede entrar con Google.")
    repository.create_session(user.id)
    return LoginResponse(user=user, access_token=create_access_token(user.id, user.role.value))


@app.post("/auth/logout", status_code=204)
def logout(current_user: PublicUser = Depends(get_current_user)) -> None:
    repository.close_active_session(current_user.id)


@app.get("/auth/me", response_model=PublicUser)
def read_current_user(current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    return current_user


def require_student_manager(student_id: str, current_user: PublicUser) -> None:
    """Dueño del alumno (o admin): lo único que puede borrarlo o compartirlo.

    Falla en cerrado: un alumno sin dueño tampoco lo administra nadie salvo el admin. Antes
    se permitía (eran los alumnos anteriores a `created_by`), pero eso dejaba borrarlos por id
    a cualquier profesor recién registrado. La migración de arranque ya les asigna dueño."""
    if current_user.role == UserRole.admin:
        return
    if repository.get_user_owner(student_id) != current_user.id:
        raise HTTPException(status_code=403, detail="Ese estudiante pertenece a otro profesor")


def require_student_access(student_id: str, current_user: PublicUser) -> None:
    """Dueño, profesor con quien se compartió, o profesor de un aula donde está el alumno.
    Alcanza para verlo, editarlo, cambiarle la contraseña y meterlo en un aula; no para
    borrarlo ni compartirlo (eso es `require_student_manager`)."""
    if current_user.role == UserRole.admin:
        return
    if not repository.can_access_student(student_id, current_user.id):
        raise HTTPException(status_code=403, detail="Ese estudiante pertenece a otro profesor")


def _resolve_teacher(payload: ShareRequest, current_user: PublicUser) -> PublicUser:
    """El profesor nombra a su colega por usuario o correo exacto; el id directo es del admin
    (un profesor no tiene de dónde sacar ids ajenos y no hay directorio que se los dé)."""
    teacher = None
    if payload.teacher_id and current_user.role == UserRole.admin:
        teacher = repository.get_user(payload.teacher_id)
    elif payload.username:
        teacher = repository.find_teacher(payload.username)
    if not teacher or teacher.role not in {UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=404, detail="No hay ningún profesor con ese usuario o correo")
    return teacher


def _owner_for_create(owner_id: str | None, current_user: PublicUser) -> str:
    """A nombre de quién se crea un aula o un alumno: solo el admin puede elegir a otro."""
    if not owner_id or owner_id == current_user.id:
        return current_user.id
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Solo el administrador puede crear a nombre de otro profesor")
    owner = repository.get_user(owner_id)
    if not owner or owner.role not in {UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=404, detail="Profesor no encontrado")
    return owner.id


@app.post("/students", response_model=PublicUser)
def create_student(payload: StudentCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> PublicUser:
    owner_id = _owner_for_create(payload.owner_id, current_user)
    try:
        return repository.create_student(payload, created_by=owner_id)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el estudiante. Verifica que el usuario no exista.") from exc


@app.get("/students", response_model=list[StudentSummary])
def list_students(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[StudentSummary]:
    # También para el admin: en el portal docente es un profesor más y ve lo suyo. La vista de
    # todos los alumnos es /admin/overview.
    return repository.list_students(current_user.id)


@app.post("/students/{student_id}/teachers", status_code=204)
def share_student(student_id: str, payload: ShareRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    student = repository.get_user(student_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    require_student_manager(student_id, current_user)
    teacher = _resolve_teacher(payload, current_user)
    if teacher.id == repository.get_user_owner(student_id):
        raise HTTPException(status_code=409, detail="Ese profesor ya es el dueño del estudiante")
    repository.share_student(student_id, teacher.id)


@app.delete("/students/{student_id}/teachers/{teacher_id}", status_code=204)
def unshare_student(student_id: str, teacher_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    # El dueño retira a quien quiera; el profesor invitado solo puede retirarse a sí mismo.
    if teacher_id != current_user.id:
        require_student_manager(student_id, current_user)
    repository.unshare_student(student_id, teacher_id)


@app.put("/students/{student_id}/owner", status_code=204)
def set_student_owner(student_id: str, payload: OwnerUpdate, _: PublicUser = Depends(require_admin)) -> None:
    student = repository.get_user(student_id)
    owner = repository.get_user(payload.teacher_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    if not owner or owner.role not in {UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=404, detail="Profesor no encontrado")
    repository.set_student_owner(student_id, owner.id)




@app.put("/users/{user_id}", response_model=PublicUser)
def update_user(user_id: str, payload: UserUpdate, current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    # Lista blanca por rol, no cadena de `if`: antes el `reader` no entraba en ninguna rama y
    # caía directo al update, pudiendo editar a cualquier usuario (incluido el admin).
    if current_user.role in {UserRole.student, UserRole.reader}:
        if current_user.id != user_id:
            raise HTTPException(status_code=403, detail="No puedes editar otro usuario")
    elif current_user.role == UserRole.teacher:
        target = repository.get_user(user_id)
        if not target or target.role != UserRole.student:
            raise HTTPException(status_code=403, detail="Los profesores solo pueden editar estudiantes")
        require_student_access(user_id, current_user)
    elif current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="No autorizado")
    try:
        user = repository.update_user(user_id, payload.name, payload.email, payload.username)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="El nombre de usuario ya existe") from exc
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@app.put("/users/{user_id}/password", status_code=204)
def update_user_password(user_id: str, payload: PasswordUpdate, current_user: PublicUser = Depends(get_current_user)) -> None:
    target = repository.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    # Los lectores no pueden cambiar contraseña bajo ninguna circunstancia
    if target.role == UserRole.reader:
        raise HTTPException(status_code=403, detail="La contraseña de un lector no puede modificarse")
    # Lista blanca por rol, no cadena de `if`: antes el `reader` no entraba en ninguna rama y
    # caía directo al update, pudiendo fijar la contraseña de CUALQUIER usuario, admin incluido.
    # El `reader` es además la cuenta compartida, la credencial que más gente conoce.
    if current_user.role == UserRole.student:
        if current_user.id != user_id:
            raise HTTPException(status_code=403, detail="No puedes cambiar la contraseña de otro usuario")
        if not payload.current_password or not repository.verify_user_password(user_id, payload.current_password):
            raise HTTPException(status_code=403, detail="La contraseña actual no es correcta")
    elif current_user.role == UserRole.teacher:
        if target.role != UserRole.student:
            raise HTTPException(status_code=403, detail="Los profesores solo pueden cambiar contraseñas de estudiantes")
        require_student_access(user_id, current_user)
    elif current_user.role != UserRole.admin:
        # `reader` cae aquí: su propia contraseña ya la bloquea el guard de `target` de arriba.
        raise HTTPException(status_code=403, detail="No autorizado")
    repository.update_password_hash(user_id, hash_password(payload.new_password))


@app.post("/classrooms", response_model=Classroom)
def create_classroom(payload: ClassroomCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Classroom:
    return repository.create_classroom(payload.name, _owner_for_create(payload.owner_id, current_user))


@app.get("/classrooms", response_model=list[Classroom])
def list_classrooms(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Classroom]:
    # Propias + compartidas. El admin aquí es un profesor más; todas las aulas van en /admin/overview.
    return repository.list_classrooms(current_user.id)


def require_classroom_manager(classroom_id: str, current_user: PublicUser) -> Classroom:
    """Dueño del aula (o admin): borrarla, renombrarla, compartirla o abrirla a invitados."""
    classroom = repository.get_classroom(classroom_id)
    if not classroom:
        raise HTTPException(status_code=404, detail="Aula no encontrada")
    if current_user.role != UserRole.admin and classroom.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes administrar esta aula")
    return classroom


def require_classroom_access(classroom_id: str, current_user: PublicUser) -> Classroom:
    """Dueño, profesor con quien se compartió el aula, o admin: ver el detalle y asignar
    alumnos y hojas propias."""
    classroom = repository.get_classroom(classroom_id)
    if not classroom:
        raise HTTPException(status_code=404, detail="Aula no encontrada")
    if (
        current_user.role != UserRole.admin
        and classroom.created_by != current_user.id
        and all(teacher.id != current_user.id for teacher in classroom.teachers)
    ):
        raise HTTPException(status_code=403, detail="No puedes administrar esta aula")
    return classroom


@app.patch("/classrooms/{classroom_id}", response_model=Classroom)
def rename_classroom(classroom_id: str, payload: ClassroomRename, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Classroom:
    classroom = require_classroom_manager(classroom_id, current_user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El aula necesita un nombre")
    repository.rename_classroom(classroom_id, name)
    classroom.name = name
    return classroom


@app.post("/classrooms/{classroom_id}/teachers", status_code=204)
def share_classroom(classroom_id: str, payload: ShareRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    classroom = require_classroom_manager(classroom_id, current_user)
    teacher = _resolve_teacher(payload, current_user)
    if teacher.id == classroom.created_by:
        raise HTTPException(status_code=409, detail="Ese profesor ya es el dueño del aula")
    repository.add_classroom_teacher(classroom_id, teacher.id)


@app.delete("/classrooms/{classroom_id}/teachers/{teacher_id}", status_code=204)
def unshare_classroom(classroom_id: str, teacher_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    # El dueño retira a quien quiera; el profesor invitado solo puede salirse él.
    if teacher_id != current_user.id:
        require_classroom_manager(classroom_id, current_user)
    repository.remove_classroom_teacher(classroom_id, teacher_id)


@app.put("/classrooms/{classroom_id}/owner", status_code=204)
def set_classroom_owner(classroom_id: str, payload: OwnerUpdate, _: PublicUser = Depends(require_admin)) -> None:
    owner = repository.get_user(payload.teacher_id)
    if not repository.get_classroom(classroom_id):
        raise HTTPException(status_code=404, detail="Aula no encontrada")
    if not owner or owner.role not in {UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=404, detail="Profesor no encontrado")
    repository.set_classroom_owner(classroom_id, owner.id)


@app.get("/classrooms/{classroom_id}", response_model=ClassroomDetail)
def get_classroom_detail(classroom_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> ClassroomDetail:
    classroom = require_classroom_access(classroom_id, current_user)
    students = repository.list_classroom_students(classroom_id)
    worksheets = repository.list_classroom_worksheets(classroom_id)
    statuses = {}
    worksheet_ids = [w.id for w in worksheets]
    student_ids = [s.id for s in students]
    responded_pairs = repository.get_responded_pairs(worksheet_ids, student_ids)
    for student in students:
        completed = sum(1 for w_id in worksheet_ids if (w_id, student.id) in responded_pairs)
        pending = max(len(worksheets) - completed, 0)
        statuses[student.id] = "Completado ✓" if pending == 0 else f"Pendiente {pending} de {len(worksheets)}"
    return ClassroomDetail(**classroom.model_dump(), students=students, worksheets=worksheets, student_statuses=statuses)


@app.post("/classrooms/{classroom_id}/students", status_code=204)
def assign_student(classroom_id: str, payload: ClassroomStudentAssignment, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_access(classroom_id, current_user)
    student = repository.get_user(payload.student_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    # Sin esto, cualquier profesor metía en su aula a un alumno ajeno con solo su id — y estar
    # en el aula es justo lo que da acceso al alumno.
    require_student_access(payload.student_id, current_user)
    repository.assign_student_to_classroom(classroom_id, payload.student_id)


@app.delete("/classrooms/{classroom_id}/students/{student_id}", status_code=204)
def unassign_student(classroom_id: str, student_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_access(classroom_id, current_user)
    repository.unassign_student_from_classroom(classroom_id, student_id)


@app.post("/classrooms/{classroom_id}/worksheets", status_code=204)
def assign_worksheet(classroom_id: str, payload: ClassroomWorksheetAssignment, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_access(classroom_id, current_user)
    require_worksheet_manager(payload.worksheet_id, current_user)
    due_date_str = payload.due_date.isoformat() if payload.due_date else None
    repository.assign_worksheet_to_classroom(classroom_id, payload.worksheet_id, due_date_str)


@app.delete("/classrooms/{classroom_id}/worksheets/{worksheet_id}", status_code=204)
def unassign_worksheet(classroom_id: str, worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_access(classroom_id, current_user)
    require_worksheet_manager(worksheet_id, current_user)
    repository.unassign_worksheet_from_classroom(classroom_id, worksheet_id)


@app.delete("/classrooms/{classroom_id}", status_code=204)
def delete_classroom(classroom_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_manager(classroom_id, current_user)
    repository.delete_classroom(classroom_id)


@app.get("/worksheets/{worksheet_id}/classrooms", response_model=list[Classroom])
def list_worksheet_classrooms(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Classroom]:
    require_worksheet_manager(worksheet_id, current_user)
    return repository.list_worksheet_classrooms(worksheet_id)


@app.get("/dashboard/teacher", response_model=TeacherDashboardStats)
def teacher_dashboard(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    return repository.teacher_dashboard(current_user.id)


@app.post("/uploads/signature")
def upload_signature(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Firma una subida directa del navegador a Cloudinary.

    El archivo NUNCA pasa por este backend: el front hace POST a Cloudinary con esta firma.
    Render no gasta ancho de banda ni RAM, y la subida no depende del cold start del free tier.

    ponytail: firma HMAC a mano (SHA-1, 4 líneas) en vez de instalar el SDK de Cloudinary,
    que solo se usaría para esto. Si algún día hace falta borrar o listar assets, ahí sí.
    """
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    if not (cloud_name and api_key and api_secret):
        raise HTTPException(status_code=503, detail="La subida de imágenes no está configurada en el servidor.")

    timestamp = int(time.time())
    folder = f"mydinoenglish/{current_user.id}"
    # Cloudinary firma los parámetros ordenados alfabéticamente: folder antes que timestamp.
    # La firma debe cubrir EXACTAMENTE los campos que el front envía (aparte de file/api_key).
    to_sign = f"folder={folder}&timestamp={timestamp}{api_secret}"
    return {
        "cloud_name": cloud_name,
        "api_key": api_key,
        "timestamp": timestamp,
        "folder": folder,
        "signature": hashlib.sha1(to_sign.encode()).hexdigest(),
    }


@app.get("/uploads/images", response_model=list[TeacherImage])
def list_my_images(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[TeacherImage]:
    return repository.list_teacher_images(current_user.id)


@app.post("/uploads/images", response_model=TeacherImage)
def register_image(payload: TeacherImageCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> TeacherImage:
    return repository.add_teacher_image(current_user.id, payload.public_id, payload.url)


@app.delete("/uploads/images/{image_id}", status_code=204)
def delete_my_image(image_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    if not repository.delete_teacher_image(image_id, current_user.id):
        raise HTTPException(status_code=404, detail="Imagen no encontrada")


# ── TTS ───────────────────────────────────────────────────────────────────────
# Dos motores. Con `ELEVENLABS_API_KEY` las voces son de ElevenLabs (las de edge-tts no se
# entendían ni en lento); sin ella, o si ElevenLabs falla (cuota agotada, red), edge-tts como
# siempre. Lo de ElevenLabs se guarda en `tts_cache`: el plan gratuito son 10 000 créditos al mes
# y cada mp3 se paga UNA vez, no una por alumno y reproducción.
# `rate` hace que el motor RE-SINTETICE más lento (articulación y pausas limpias). No es el
# playbackRate del navegador, que estira la onda y enseña una articulación que no existe.
DEFAULT_TTS_RATE = "-15%"
_RATE_RE = re.compile(r"^[+-]\d{1,2}%$")
_VOICE_RE = re.compile(r"^[A-Za-z0-9-]{5,48}$")
_ELEVEN_ID_RE = re.compile(r"^[A-Za-z0-9]{20}$")  # un voice_id de ElevenLabs escrito tal cual en el DSL

# Las voces en inglés que expone el endpoint público de edge-tts (47, `edge-tts --list-voices`),
# con su género, que es lo que decide qué voz de ElevenLabs las sustituye. Es la ÚLTIMA PALABRA
# sobre si una voz existe: `en-GB-OliverNeural` está en el catálogo de Azure pero el endpoint de
# Edge no la sirve (NoAudioReceived). Un nombre literal del DSL que no esté aquí se rechaza con un
# mensaje claro, en vez de un 500 críptico o un Andrew silencioso.
_EDGE_EN_VOICES: dict[str, str] = {
    **dict.fromkeys((
        "en-AU-WilliamMultilingualNeural", "en-CA-LiamNeural", "en-HK-SamNeural", "en-IN-PrabhatNeural",
        "en-IE-ConnorNeural", "en-KE-ChilembaNeural", "en-NZ-MitchellNeural", "en-NG-AbeoNeural",
        "en-PH-JamesNeural", "en-US-AndrewNeural", "en-US-BrianNeural", "en-SG-WayneNeural",
        "en-ZA-LukeNeural", "en-TZ-ElimuNeural", "en-GB-RyanNeural", "en-GB-ThomasNeural",
        "en-US-AndrewMultilingualNeural", "en-US-BrianMultilingualNeural", "en-US-ChristopherNeural",
        "en-US-EricNeural", "en-US-GuyNeural", "en-US-RogerNeural", "en-US-SteffanNeural",
    ), "male"),
    **dict.fromkeys((
        "en-AU-NatashaNeural", "en-CA-ClaraNeural", "en-HK-YanNeural", "en-IN-NeerjaExpressiveNeural",
        "en-IN-NeerjaNeural", "en-IE-EmilyNeural", "en-KE-AsiliaNeural", "en-NZ-MollyNeural",
        "en-NG-EzinneNeural", "en-PH-RosaNeural", "en-US-AvaNeural", "en-US-EmmaNeural",
        "en-SG-LunaNeural", "en-ZA-LeahNeural", "en-TZ-ImaniNeural", "en-GB-LibbyNeural",
        "en-GB-MaisieNeural", "en-GB-SoniaNeural", "en-US-AnaNeural", "en-US-AriaNeural",
        "en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural", "en-US-JennyNeural",
        "en-US-MichelleNeural",
    ), "female"),
}
# Región del nombre edge (`en-GB-…`) → etiqueta `accent` de ElevenLabs. Lo que no esté, americano.
_ACCENTS = {"GB": "british", "AU": "australian", "IE": "irish", "IN": "indian"}

# Voz de niño en edge-tts solo hay una (`en-US-RogerNeural`) y suena más a adulto joven que a niño.
# Subirle el tono lo acerca a una voz infantil (a Ana no le hace falta). Ajuste empírico: +35Hz.
_VOICE_PITCH = {"en-US-RogerNeural": "+35Hz"}


def _tts_rate(rate: str) -> str:
    """`rate` y `voice` llegan del query string y viajan al SSML que edge-tts manda a Microsoft:
    se validan, no se confía en ellos."""
    return rate if _RATE_RE.match(rate) else DEFAULT_TTS_RATE


def _tts_voice(voice: str, fallback: str = "en-US-AndrewNeural") -> str:
    return voice if _VOICE_RE.match(voice) else fallback


def _check_voice_exists(voice: str) -> None:
    """Una voz con formato válido pero que el endpoint de edge-tts no sirve (p. ej.
    `en-GB-OliverNeural`) fallaría al sintetizar con un error ajeno. Se corta antes."""
    if voice not in _EDGE_EN_VOICES:
        raise ValueError(
            f"La voz '{voice}' no existe en el servicio de edge-tts. "
            f"Consulta `edge-tts --list-voices` (solo voces en inglés)."
        )


def _pitch_for(voice: str) -> str | None:
    return _VOICE_PITCH.get(voice)


def _tts_params(voice: str, rate: str) -> dict:
    """Kwargs de `edge_tts.Communicate`. OJO: la librería hace `TypeError` si le pasas
    `pitch=None` explícitamente (edge-tts 7.2.8), así que solo se manda `pitch` cuando existe."""
    params: dict = {"rate": _tts_rate(rate)}
    if pitch := _pitch_for(voice):
        params["pitch"] = pitch
    return params


def _conversation_parts(lines: list[dict], male: str, female: str) -> list[tuple[str, str]]:
    """Turnos de un diálogo → (texto, voz), cada uno con la voz de SU hablante (`speaker` que
    empieza por 'f' = femenina). Los turnos vacíos no suenan."""
    parts: list[tuple[str, str]] = []
    for line in lines:
        text = (line.get("text") or "").strip()
        if text:
            parts.append((text, female if (line.get("speaker") or "").strip().lower().startswith("f") else male))
    return parts


async def _edge_stream(text: str, voice: str, rate: str):
    """Los trozos de mp3 según llegan de edge-tts.

    Con tope de espera: la librería aguanta 10 s conectando y 60 s callada, y mientras tanto el
    alumno ve el juego "pillado". Si falla antes del primer trozo se reintenta una vez con otra
    conexión (los picos son de la conexión, no del texto); después ya no, o el mp3 saldría repetido.
    """
    if _ELEVEN_ID_RE.match(voice):  # un voice_id de ElevenLabs fijado en el DSL: edge no lo conoce
        voice = "en-US-AndrewNeural"
    import edge_tts
    for attempt in (1, 2):
        sent = False
        try:
            communicate = edge_tts.Communicate(text, voice, connect_timeout=5, receive_timeout=8, **_tts_params(voice, rate))
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    sent = True
                    yield chunk["data"]
            return
        except Exception as exc:
            if sent or attempt == 2:
                raise
            print(f"[tts] edge-tts falló antes de dar audio, se reintenta: {exc!r}")


async def _edge_synth(text: str, voice: str, rate: str) -> bytes:
    return b"".join([chunk async for chunk in _edge_stream(text, voice, rate)])


# ── Caché de edge-tts ────────────────────────────────────────────────────────
# edge es gratis, pero sintetizar cuesta ~1-3 s y una clase entera toca la misma palabra a la vez.
# El mp3 se guarda en `tts_cache` (la misma tabla de ElevenLabs, con prefijo en la clave) y se
# sintetiza UNA vez por texto+voz+velocidad: los que llegan mientras tanto esperan y lo leen.

_EDGE_LOCKS_GUARD = threading.Lock()


class _EdgeLock:
    __slots__ = ("lock", "users")

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.users = 0


_edge_locks: dict[str, _EdgeLock] = {}


def _edge_cache_key(text: str, voice: str, rate: str) -> str:
    # El prefijo evita chocar con la clave de ElevenLabs (modelo|voice_id|speed|texto).
    return hashlib.sha256(f"edge|{voice}|{_tts_rate(rate)}|{text}".encode()).hexdigest()


# Delante de la base, los últimos mp3 en la memoria del proceso: leer `tts_cache` es un viaje a la
# base por cada toque, y en un juego la clase entera repite las mismas frases.
_EDGE_MEMORY_MAX = 300  # ~20 KB cada uno
_edge_memory: OrderedDict[str, bytes] = OrderedDict()


def _edge_remember(key: str, audio: bytes) -> None:
    _edge_memory[key] = audio
    _edge_memory.move_to_end(key)
    while len(_edge_memory) > _EDGE_MEMORY_MAX:
        _edge_memory.popitem(last=False)


async def _read_edge_cache(key: str) -> bytes | None:
    """La caché es una optimización: si la base falla, el audio sigue saliendo de edge."""
    if audio := _edge_memory.get(key):
        _edge_memory.move_to_end(key)
        return audio
    try:
        audio = await asyncio.to_thread(repository.get_tts_audio, key)
    except Exception as exc:
        print(f"[tts] no se pudo leer la caché de edge: {exc!r}")
        return None
    if audio:
        _edge_remember(key, audio)
    return audio


async def _write_edge_cache(key: str, audio: bytes) -> None:
    _edge_remember(key, audio)
    try:
        await asyncio.to_thread(repository.put_tts_audio, key, audio)
    except Exception as exc:
        print(f"[tts] no se pudo guardar la caché de edge: {exc!r}")


def _edge_lock_register(key: str) -> _EdgeLock:
    with _EDGE_LOCKS_GUARD:
        entry = _edge_locks.setdefault(key, _EdgeLock())
        entry.users += 1
        return entry


def _edge_lock_unregister(key: str, entry: _EdgeLock) -> None:
    with _EDGE_LOCKS_GUARD:
        entry.users -= 1
        if entry.users == 0:
            _edge_locks.pop(key, None)


async def _edge_cached_stream(text: str, voice: str, rate: str):
    """El mp3 por trozos, con caché y una sola síntesis por frase a la vez.

    El primero sintetiza y guarda; los demás esperan a que suelte y lo leen de la caché. Así 30
    alumnos que tocan la misma palabra no abren 30 websockets contra Microsoft.
    """
    key = _edge_cache_key(text, voice, rate)
    if cached := await _read_edge_cache(key):
        yield cached
        return
    entry = _edge_lock_register(key)
    try:
        await entry.lock.acquire()
    except BaseException:
        _edge_lock_unregister(key, entry)
        raise
    try:
        if cached := await _read_edge_cache(key):
            yield cached
            return
        data = bytearray()
        async for chunk in _edge_stream(text, voice, rate):
            data.extend(chunk)
            yield chunk
        if data:
            await _write_edge_cache(key, bytes(data))
    finally:
        entry.lock.release()
        _edge_lock_unregister(key, entry)


# ── Voz con la conexión adelantada (conversación con IA, ADR-39) ──
# Abrir la conexión con edge-tts es lo caro (0,7-2 s, con picos de 8) y no depende del texto;
# sintetizar son ~0,5 s. El turno la abre MIENTRAS la IA piensa y manda el texto en cuanto lo tiene.
# Usa piezas internas de edge-tts (las mismas que `Communicate.stream`): si una versión nueva las
# cambia, cualquier error cae a `_edge_synth`, que abre su propia conexión. Solo se pierde la ventaja.

async def _edge_connect():
    """(sesión, websocket) de edge-tts con la configuración ya enviada, listos para un SSML."""
    import aiohttp
    from edge_tts import communicate as ec, constants as k
    from edge_tts.drm import DRM
    session = aiohttp.ClientSession(trust_env=True)
    try:
        ws = await session.ws_connect(
            f"{k.WSS_URL}&ConnectionId={ec.connect_id()}&Sec-MS-GEC={DRM.generate_sec_ms_gec()}"
            f"&Sec-MS-GEC-Version={k.SEC_MS_GEC_VERSION}",
            compress=15, headers=DRM.headers_with_muid(k.WSS_HEADERS), ssl=ec._SSL_CTX)
        await ws.send_str(
            f"X-Timestamp:{ec.date_to_string()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"
            '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},'
            '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n')
    except BaseException:
        await session.close()
        raise
    return session, ws


async def _edge_speak(conn, text: str, voice: str, rate: str):
    """Manda el texto por una conexión de `_edge_connect` y entrega el mp3 por trozos, según llega.
    Cierra la conexión al terminar."""
    import aiohttp
    import edge_tts
    from edge_tts import communicate as ec
    session, ws = conn
    try:
        c = edge_tts.Communicate(text, voice, **_tts_params(voice, rate))  # valida la voz y escapa el texto
        await ws.send_str(ec.ssml_headers_plus_data(ec.connect_id(), ec.date_to_string(), ec.mkssml(c.tts_config, next(c.texts))))
        sent = False
        while True:
            # edge a veces se queda callado: mejor cortar que dejar al alumno esperando la voz.
            msg = await ws.receive(timeout=8)
            if msg.type == aiohttp.WSMsgType.BINARY:
                n = int.from_bytes(msg.data[:2], "big")  # largo de las cabeceras; después viene el mp3
                if b"Path:audio" in msg.data[2:2 + n] and msg.data[2 + n:]:
                    sent = True
                    yield msg.data[2 + n:]
            elif msg.type == aiohttp.WSMsgType.TEXT:
                if "Path:turn.end" in msg.data:
                    break
            else:  # cerrada o con error
                break
        if not sent:
            raise RuntimeError("edge-tts no devolvió audio")
    finally:
        await ws.close()
        await session.close()


async def _turn_voice(conn: "asyncio.Task", text: str, voice: str, rate: str):
    """El mp3 por la conexión adelantada; si falla antes del primer trozo, por una conexión nueva."""
    sent = False
    try:
        async for chunk in _edge_speak(await conn, text, voice, rate):
            sent = True
            yield chunk
        return
    except Exception as exc:
        if sent:
            raise
        print(f"[tts] la conexión adelantada falló, se abre otra: {exc!r}")
    async for chunk in _edge_stream(text, voice, rate):
        yield chunk


async def _drop_connection(conn: "asyncio.Task") -> None:
    """Cierra una conexión adelantada que ya no se usará (la IA falló)."""
    conn.cancel()  # si aún conectaba; si ya conectó no hace nada y se cierra abajo
    try:
        session, ws = await conn
        await ws.close()
        await session.close()
    except BaseException:
        pass


# ── ElevenLabs ────────────────────────────────────────────────────────────────
_eleven_voices: list[dict] | None = None  # las voces de la cuenta; se consultan una vez por proceso
# Una síntesis a la vez. El plan gratuito admite 2, pero con 2 turnos dos alumnos que piden el MISMO
# texto a la vez lo pagaban dos veces (probado). Con 1, el segundo lo encuentra en caché.
# ponytail: semáforo global; si la cola de síntesis nueva molesta, un lock por clave y 2 turnos.
_eleven_slots = asyncio.Semaphore(1)
# `use_case` de la voz: desempata a favor de la educativa y nunca un personaje de dibujos (a Roger
# le tocaba "Harry - Fierce Warrior"). Pesa menos que el acento: quien pide británica quiere británica.
_USE_CASE_RANK = {"informative_educational": 2, "narrative_story": 1, "conversational": 1, "characters_animation": -3}


def _eleven_headers() -> dict[str, str]:
    return {"xi-api-key": os.environ["ELEVENLABS_API_KEY"]}


def _eleven_pinned(edge_name: str) -> str | None:
    """`ELEVENLABS_VOICES="en-US-AndrewNeural=Brian,en-US-RogerNeural=Will"`: la voz de la cuenta (su
    nombre, lo que va antes del ' - ', o su voice_id) que sustituye a cada nombre de edge-tts. Para
    cambiar una voz por defecto sin tocar código. Lo que no esté aquí se elige por etiquetas."""
    for pair in os.getenv("ELEVENLABS_VOICES", "").split(","):
        edge, sep, wanted = pair.partition("=")
        if sep and edge.strip() == edge_name and wanted.strip():
            return wanted.strip()
    return None


def _eleven_speed(rate: str) -> float:
    """`-15%` → 0.85. ElevenLabs acota `speed` a [0.7, 1.2]: «Muy lento» (-35%) se queda en 0.7."""
    return round(min(1.2, max(0.7, 1 + int(_tts_rate(rate).rstrip("%")) / 100)), 2)


async def _eleven_voice_for(edge_name: str) -> str:
    """La voz de ElevenLabs que sustituye a una de edge-tts: la fijada en `ELEVENLABS_VOICES` si la
    hay; si no, mismo género, mismo acento si lo hay, uso educativo antes que otros,
    y joven para las infantiles (ElevenLabs no trae voces de niño: para una de verdad, añadirla a
    My Voices desde la Voice Library y escribir su `voice_id` en el DSL). Se elige entre las voces
    de la cuenta (`GET /v2/voices`) por sus etiquetas y no por ids fijos: las voces por defecto
    caducan el 31-12-2026 y las reemplazan otras."""
    global _eleven_voices
    if not _eleven_voices:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get("https://api.elevenlabs.io/v2/voices", params={"page_size": 100}, headers=_eleven_headers())
        response.raise_for_status()
        _eleven_voices = response.json().get("voices") or []
        if not _eleven_voices:
            raise ValueError("La cuenta de ElevenLabs no tiene voces")
    if wanted := _eleven_pinned(edge_name):
        for voice in _eleven_voices:
            if wanted in (voice.get("voice_id"), voice.get("name", "").split(" - ")[0].strip()):
                return voice["voice_id"]
        print(f"[tts] ELEVENLABS_VOICES: no hay ninguna voz '{wanted}' en la cuenta; se elige por etiquetas")
    gender = _EDGE_EN_VOICES.get(edge_name, "male")
    accent = _ACCENTS.get(edge_name[3:5], "american")
    age = "young" if edge_name in ("en-US-AnaNeural", "en-US-RogerNeural") else "middle_aged"

    def score(voice: dict) -> int:
        labels = {k: str(v).lower().replace("-", "_") for k, v in (voice.get("labels") or {}).items()}
        return (8 * (labels.get("gender") == gender) + 4 * (labels.get("accent") == accent) + 2 * (labels.get("age") == age)
                + _USE_CASE_RANK.get(labels.get("use_case", ""), 0))

    # `max` devuelve el primero de los empatados: ordenadas por nombre, la elección es estable.
    return max(sorted(_eleven_voices, key=lambda v: v.get("name", "")), key=score)["voice_id"]


async def _eleven_synth(text: str, voice: str, rate: str) -> bytes:
    text = text.strip()
    voice_id = voice if _ELEVEN_ID_RE.match(voice) else await _eleven_voice_for(voice)
    speed = _eleven_speed(rate)
    model = os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    key = hashlib.sha256(f"{model}|{voice_id}|{speed}|{text}".encode()).hexdigest()
    if cached := await asyncio.to_thread(repository.get_tts_audio, key):
        return cached
    async with _eleven_slots:
        # Segunda mirada ya con el turno: 30 alumnos que abren la hoja a la vez piden el mismo mp3
        # 30 veces. Así lo paga el primero y los demás lo encuentran hecho.
        if cached := await asyncio.to_thread(repository.get_tts_audio, key):
            return cached
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                params={"output_format": "mp3_44100_128"},
                headers=_eleven_headers(),
                json={"text": text, "model_id": model, "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": speed}},
            )
        response.raise_for_status()
        await asyncio.to_thread(repository.put_tts_audio, key, response.content)
        return response.content


async def _synth_mp3(parts: list[tuple[str, str]], rate: str, edge_only: bool = False) -> bytes:
    """Sintetiza cada (texto, voz) y concatena los mp3 en una sola pista. ElevenLabs si hay clave;
    si falla CUALQUIER turno, la pista entera se rehace con edge-tts: mezclar mp3 de los dos
    motores (44,1 kHz y 24 kHz) en una pista se traba en el navegador. Los turnos que ElevenLabs
    sí hizo quedan en caché, así que no se pagan otra vez. `edge_only` salta ElevenLabs."""
    for _, voice in parts:
        if not _ELEVEN_ID_RE.match(voice):
            _check_voice_exists(voice)
    if os.getenv("ELEVENLABS_API_KEY") and not edge_only:
        try:
            return b"".join([await _eleven_synth(text, voice, rate) for text, voice in parts])
        except Exception as exc:  # cuota, red, voz borrada: se degrada, no se calla
            body = getattr(getattr(exc, "response", None), "text", "")[:200]
            print(f"[tts] ElevenLabs falló, se usa edge-tts: {exc!r} {body}")
    return b"".join([await _edge_synth(text, voice, rate) for text, voice in parts])


@app.get("/tts")
async def tts(
    request: Request,
    text: str = Query(min_length=1, max_length=2000),
    voice: str = "en-US-AndrewNeural",
    rate: str = DEFAULT_TTS_RATE,
    engine: str = "auto",
) -> Response:
    # Público a la fuerza: el front lo usa como `src` de un <audio>, que no manda cabeceras.
    # El coste se acota por los dos lados — `max_length` limita lo que cuesta UNA petición
    # (el mp3 entero se sintetiza en RAM antes de responder) y el rate limit, cuántas.
    _rate_limit(request, limit=300)
    # `engine=edge`: los juegos (ADR-38) y la conversación con IA (ADR-39) suenan siempre con
    # edge-tts, que es gratis. Una palabra que 30 alumnos tocan en clase no gasta créditos de
    # ElevenLabs, que se quedan para las hojas. Va en streaming: el <audio> empieza a sonar con el
    # primer trozo (~1 s) en vez de esperar la frase entera (~3 s), que es lo que hace sentir la
    # conversación en tiempo real. El primer trozo se pide ANTES de responder, para que un fallo de
    # edge siga siendo un 503 y no un 200 cortado. Con `Cache-Control` el navegador no la vuelve a pedir.
    edge_only = engine == "edge"
    if edge_only:
        voice_name = _tts_voice(voice)
        try:
            _check_voice_exists(voice_name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        stream = _edge_cached_stream(text, voice_name, rate)
        try:
            first = await anext(stream, b"")
        except Exception as exc:
            raise HTTPException(status_code=503, detail="No se pudo generar audio TTS. Verifica la conexión a internet.") from exc

        async def body():
            yield first
            async for chunk in stream:
                yield chunk
        return StreamingResponse(body(), media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=604800"})
    try:
        mp3 = await _synth_mp3([(text, _tts_voice(voice))], rate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="No se pudo generar audio TTS. Verifica la conexión a internet.") from exc
    return Response(content=mp3, media_type="audio/mpeg")


@app.get("/tts/conversation")
async def tts_conversation(
    request: Request,
    lines: str = Query(min_length=1, max_length=8000),
    male: str = "en-US-AndrewNeural",
    female: str = "en-US-AriaNeural",
    rate: str = DEFAULT_TTS_RATE,
) -> Response:
    _rate_limit(request, limit=300)
    # `lines`: una por renglón, formato `speaker|texto`. Cada turno con su voz, MP3 concatenados.
    # ponytail: concatenación cruda de frames MP3 (suena bien para habla). Si se necesita
    #           una pausa marcada entre turnos, intercalar un MP3 de silencio corto.
    turns = [{"speaker": speaker, "text": text} for speaker, sep, text in (raw.partition("|") for raw in lines.split("\n")) if sep]
    parts = _conversation_parts(turns, _tts_voice(male), _tts_voice(female))
    if not parts:
        raise HTTPException(status_code=400, detail="Sin líneas de audio válidas")
    try:
        mp3 = await _synth_mp3(parts, rate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="No se pudo generar audio TTS. Verifica la conexión a internet.") from exc
    return Response(content=mp3, media_type="audio/mpeg")


@app.post("/worksheets/audio-check")
async def audio_check(payload: AiReviewRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Prueba el audio de la hoja: cada texto audible se sintetiza con edge-tts y se transcribe con
    Whisper. Si Whisper no reconoce lo que la voz dijo, el alumno tampoco lo va a entender.

    Es el único modo de verificar `listening*`, `conversation` y `speaking`: el revisor de texto lee
    el guion, pero no oye cómo suena («seven o'clock» que se transcribe «7 o'clock», `Mr.`, `3rd`,
    `$5.50`, siglas y homógrafos). NO guarda nada.
    """
    try:
        worksheet = parse_worksheet_script(payload.script_content)
    except WorksheetScriptError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Una hoja sin `block {}` deja las actividades en `worksheet.activities`, no en `blocks`.
    todas = list(worksheet.activities) + [a for b in worksheet.blocks for a in b.activities]
    items: list[tuple[str, Any, str]] = []
    for a in todas:
        if texto := _audible_text(a):
            items.append((a.type, a, texto))
    # El audio compartido de un `block {}` también suena: se prueba igual que el de una actividad.
    for b in worksheet.blocks:
        if texto := _block_audio_text(b):
            items.append(("conversation" if b.lines else "listening", b, texto))
    if not items:
        return {"items": [], "detail": "La hoja no tiene actividades con audio ni de habla."}

    results: list[dict[str, Any]] = []
    for tipo, fuente, texto in items:
        # Con la voz y la velocidad que el alumno va a oír (las del DSL, o las por defecto): con
        # ElevenLabs cada síntesis cuesta créditos, y así la prueba deja en caché justo los mp3 que
        # la hoja va a pedir después, en vez de pagar una versión con otra voz que nadie oirá.
        rate = getattr(fuente, "rate", None) or DEFAULT_TTS_RATE
        try:
            if tipo == "conversation":
                # Cada turno se sintetiza con la voz de SU hablante (igual que /tts/conversation):
                # si el profesor no fijó `male_voice`/`female_voice`, la curada de su género.
                male_v = _resolve_conversation_voice(getattr(fuente, "male_voice", None), "en-US-AndrewNeural")
                female_v = _resolve_conversation_voice(getattr(fuente, "female_voice", None), "en-US-AriaNeural")
                mp3 = await _synth_mp3(_conversation_parts(fuente.lines, male_v, female_v), rate)
            else:
                voice = _tts_voice(_resolve_conversation_voice(getattr(fuente, "voice", None), "en-US-AndrewNeural"))
                mp3 = await _synth_mp3([(texto, voice)], rate)
            heard = (await asyncio.to_thread(ai_transcribe, mp3, "check.mp3", "audio/mpeg")).strip()
        except Exception as exc:  # una actividad que falle no tumba el informe entero
            results.append({"type": tipo, "text": texto, "heard": "", "ok": False, "error": str(exc)[:120]})
            continue
        results.append({"type": tipo, "text": texto, "heard": heard, "ok": _same_words(texto, heard)})
    return {"items": results}


# ── Prueba de audio (ida y vuelta TTS → Whisper) ───────────────────────────────
_AUDIBLE_TYPES = {"listening", "listeningmultiplechoice", "listeningfillblank", "listeningtruefalse",
                  "listeningorder", "listeningmatching", "conversation", "speaking"}


def _block_audio_text(block: Any) -> str:
    """Lo que dice el audio compartido de un bloque ("" si el bloque no lleva audio)."""
    if getattr(block, "lines", None):
        return " ".join((line.get("text") or "").strip() for line in block.lines).strip()
    return (getattr(block, "audio_text", None) or "").strip()


def _audible_text(activity: Any) -> str:
    """Lo que la voz va a decir en esta actividad ("" si no suena nada)."""
    if activity.type not in _AUDIBLE_TYPES:
        return ""
    if activity.type == "speaking":
        return (activity.target or "").strip()
    if activity.type == "conversation":
        return " ".join((line.get("text") or "").strip() for line in (activity.lines or [])).strip()
    if activity.type == "listeningmatching":
        return " ".join((pair.get("audio_text") or "").strip() for pair in (activity.pairs or [])).strip()
    if activity.type == "listening":
        return (activity.text or "").strip()
    return (activity.audio_text or "").strip()


def _resolve_conversation_voice(voice: str | None, gender_default: str) -> str:
    """`male_voice`/`female_voice` del DSL → nombre de voz edge-tts, igual que `resolveVoice` en el
    front: el alias 'male'/'female' se traduce a la voz curada de ese género; un nombre literal se
    pasa tal cual; None → la voz curada del género del hablante."""
    if not voice:
        return gender_default
    return {"male": "en-US-AndrewNeural", "female": "en-US-AriaNeural"}.get(voice, voice)


def _same_words(said: str, heard: str) -> bool:
    """Compara ignorando puntuación y mayúsculas. Los números en cifra cuentan como iguales a su
    palabra («seven» ≡ «7»): Whisper los escribe como quiere y no es un fallo del audio."""
    return _spoken_words(said) == _spoken_words(heard)


_NUM_WORDS = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
              "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12"}


def _spoken_words(text: str) -> list[str]:
    words = re.sub(r"[^a-z0-9 ]", " ", text.lower()).split()
    return [_NUM_WORDS.get(w, w) for w in words]


@app.post("/teachers", response_model=PublicUser)
def create_teacher(payload: TeacherCreate, _: PublicUser = Depends(require_admin)) -> PublicUser:
    try:
        return repository.create_teacher(payload)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el profesor. Verifica que el usuario no exista.") from exc


@app.get("/teachers", response_model=list[PublicUser])
def list_teachers(_: PublicUser = Depends(require_admin)) -> list[PublicUser]:
    return repository.list_teachers()


@app.get("/admin/overview", response_model=AdminOverview)
def admin_overview(_: PublicUser = Depends(require_admin)) -> dict[str, Any]:
    """Panel de administración: profesores con sus cifras, todas las aulas y todos los alumnos."""
    return repository.admin_overview()


@app.post("/admin/teachers/{teacher_id}/impersonate", response_model=LoginResponse)
def impersonate_teacher(teacher_id: str, current_user: PublicUser = Depends(require_admin)) -> LoginResponse:
    """"Vista de profesor": entrega al admin un token de ESE profesor para abrir su portal tal
    como él lo ve. Solo profesores (nunca otro admin). No abre `user_sessions`: no es un ingreso
    del profesor. El token lleva `imp` con el id del admin que lo pidió."""
    teacher = repository.get_user(teacher_id)
    if not teacher or teacher.role != UserRole.teacher:
        raise HTTPException(status_code=404, detail="Profesor no encontrado")
    token = create_access_token(teacher.id, teacher.role.value, impersonated_by=current_user.id)
    return LoginResponse(user=teacher, access_token=token)


@app.delete("/students/{student_id}", status_code=204)
def delete_student(student_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_student_manager(student_id, current_user)
    if not repository.delete_student(student_id):
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")


@app.delete("/teachers/{teacher_id}", status_code=204)
def delete_teacher(teacher_id: str, transfer_to: str | None = None, current_user: PublicUser = Depends(require_admin)) -> None:
    """Borra al profesor. Sus hojas, aulas, alumnos y listas pasan a `transfer_to` (otro
    profesor) o, si no se indica, al admin que lo borra."""
    if teacher_id == current_user.id:
        raise HTTPException(status_code=403, detail="No puedes eliminar tu propio usuario administrador")
    heir_id = current_user.id
    if transfer_to and transfer_to != current_user.id:
        heir = repository.get_user(transfer_to)
        if not heir or heir.role not in {UserRole.teacher, UserRole.admin} or heir.id == teacher_id:
            raise HTTPException(status_code=404, detail="El profesor que recibe el contenido no existe")
        heir_id = heir.id
    if not repository.delete_teacher(teacher_id, heir_id):
        raise HTTPException(status_code=404, detail="Profesor no encontrado")


@app.post("/worksheets", response_model=Worksheet)
def create_worksheet(payload: WorksheetCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    try:
        worksheet_data = parse_worksheet_script(payload.script_content)
        worksheet_json = WorksheetJson(**worksheet_data.to_dict())
    except WorksheetScriptError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if current_user.role != UserRole.admin and payload.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes crear evaluaciones para otro profesor")

    worksheet = Worksheet(
        title=worksheet_json.title,
        description=worksheet_json.description,
        script_content=payload.script_content,
        json_content=worksheet_json,
        created_by=payload.created_by,
        max_attempts=payload.max_attempts,
        theme=worksheet_data.theme or payload.theme,
        ai_grading=payload.ai_grading,
        ai_tolerance=payload.ai_tolerance,
    )
    return repository.add_worksheet(worksheet)


@app.put("/worksheets/{worksheet_id}", response_model=Worksheet)
def update_worksheet(worksheet_id: str, payload: WorksheetUpdate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    require_worksheet_manager(worksheet_id, current_user)
    existing = repository.get_worksheet(worksheet_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    try:
        worksheet_data = parse_worksheet_script(payload.script_content)
        worksheet_json = WorksheetJson(**worksheet_data.to_dict())
    except WorksheetScriptError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    updated = Worksheet(
        title=worksheet_json.title,
        description=worksheet_json.description,
        script_content=payload.script_content,
        json_content=worksheet_json,
        created_by=existing.created_by,
        max_attempts=payload.max_attempts,
        theme=worksheet_data.theme or payload.theme,
        ai_grading=payload.ai_grading,
        ai_tolerance=payload.ai_tolerance,
    )
    result = repository.update_worksheet_content(worksheet_id, updated)
    if not result:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return result


@app.post("/worksheets/ai-generate", response_model=Worksheet)
def ai_generate(payload: AiGenerateRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    script, _provider = generate_worksheet_script(payload.prompt, printable=payload.printable, image_bank=payload.image_bank)
    if payload.printable:
        # Prompt + filtro: el prompt es barato, pero el modelo cuela un listening de vez en cuando
        # y en papel eso es una actividad que el alumno no puede resolver.
        script = strip_non_printable(script)
    return create_worksheet(WorksheetCreate(script_content=script, created_by=current_user.id,
                                            ai_grading=payload.ai_grading, ai_tolerance=payload.ai_tolerance), current_user)


@app.post("/worksheets/ai-edit")
def ai_edit(payload: AiEditRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, str]:
    """Modifica una hoja (agregar/quitar/cambiar actividades) con IA. Devuelve el script
    modificado + qué IA lo hizo. NO guarda: el profesor revisa y guarda desde el editor."""
    if not payload.instruction.strip():
        raise HTTPException(status_code=422, detail="Escribe qué quieres que la IA cambie")
    try:
        script, provider = edit_worksheet_script(payload.script_content, payload.instruction.strip())
        parse_worksheet_script(script)  # valida que la IA devolvió un script parseable
    except WorksheetScriptError as exc:
        raise HTTPException(status_code=422, detail=f"La IA devolvió un script inválido: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="No se pudo contactar a la IA. Intenta de nuevo.") from exc
    return {"script": script, "provider": provider}


@app.post("/worksheets/ai-review")
def ai_review(payload: AiReviewRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, str]:
    """La IA resuelve la hoja como alumno y devuelve un informe en Markdown con los problemas.
    Es OPCIONAL (botón "Revisar hoja") y no modifica ni guarda nada."""
    if not payload.script_content.strip():
        raise HTTPException(status_code=422, detail="No hay hoja que revisar")
    try:
        report, provider = review_worksheet_script(payload.script_content, printable=payload.printable)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="No se pudo contactar a la IA. Intenta de nuevo.") from exc
    return {"report": report, "provider": provider}


@app.get("/worksheets", response_model=list[Worksheet])
def list_worksheets(created_by: str | None = None, published: bool | None = None, archived: bool | None = None, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Worksheet]:
    # Sin `created_by` cada quien ve lo suyo, el admin incluido (antes veía las de todos
    # mezcladas). El admin puede pedir las de un profesor concreto.
    if created_by and created_by != current_user.id and current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="No puedes consultar evaluaciones de otro profesor")
    owner_id = created_by or current_user.id
    return repository.list_worksheets(created_by=owner_id, published=published, archived=archived)


@app.get("/worksheets/response-counts")
def worksheet_response_counts(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, int]:
    return repository.count_responses_per_worksheet(current_user.id)


@app.get("/worksheets/classroom-assignments", response_model=dict[str, list[Classroom]])
def worksheet_classroom_assignments(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, list[Classroom]]:
    return repository.list_classrooms_per_worksheet(current_user.id)


@app.get("/students/{student_id}/worksheets", response_model=list[Worksheet])
def list_student_worksheets(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[Worksheet]:
    require_student_owner_or_staff(student_id, current_user)
    assigned = repository.list_student_assigned_worksheets(student_id)
    assigned_ids = {item.id for item in assigned}
    answered_ids = {response.worksheet_id for response in repository.list_responses(student_id=student_id, include_archived=False)}
    # Incluir hojas ya respondidas que dejaron de estar asignadas/publicadas (p. ej. tras
    # archivar y desarchivar, que deja la hoja despublicada) para que el historial conserve
    # el título y sigan apareciendo en "Calificadas". Las archivadas siguen ocultas.
    extra_answered = []
    for worksheet_id in answered_ids - assigned_ids:
        worksheet = repository.get_worksheet(worksheet_id)
        if worksheet and not worksheet.archived:
            extra_answered.append(worksheet)
    all_worksheets = assigned + extra_answered
    # Poblar attempts_used / attempts_remaining en una sola query
    attempt_counts = repository.count_attempts_per_worksheet(student_id, [w.id for w in all_worksheets])
    for worksheet in all_worksheets:
        used = attempt_counts.get(worksheet.id, 0)
        worksheet.attempts_used = used
        if worksheet.max_attempts is None:
            # Ilimitada: siempre re-intentable (None = sin límite).
            worksheet.attempts_remaining = None
        else:
            worksheet.attempts_remaining = max(0, worksheet.max_attempts - used)
    # El alumno nunca recibe las `note` privadas del profesor (ADR-19). El staff sí las necesita
    # para editar la hoja desde este mismo listado.
    if current_user.role == UserRole.student:
        return [_without_notes(w) for w in all_worksheets]
    return all_worksheets


@app.get("/teacher/notifications")
def get_teacher_notifications(since: str | None = None, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[dict]:
    from datetime import datetime, timezone, timedelta
    if since:
        since_iso = since
    else:
        since_iso = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    return repository.get_recent_responses_for_teacher(current_user.id, since_iso)


@app.get("/teacher/worksheet-summary/{worksheet_id}")
def worksheet_summary(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, str]:
    worksheet = repository.get_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if current_user.role != UserRole.admin and worksheet.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes analizar evaluaciones de otro profesor")

    responses = repository.list_responses(worksheet_id=worksheet_id)
    if not responses:
        return {"summary": ""}

    # Agregar por actividad: aciertos, fallos y ejemplos de respuestas incorrectas.
    by_activity: dict[str, dict] = {}
    for response in responses:
        for detail in response.details:
            prompt = (detail.prompt or "").strip() or detail.activity_id
            stat = by_activity.setdefault(prompt, {"prompt": prompt, "correct": 0, "incorrect": 0, "sample_wrong": []})
            if detail.status == "correct":
                stat["correct"] += 1
            elif detail.status == "incorrect":
                stat["incorrect"] += 1
                if len(stat["sample_wrong"]) < 5 and detail.student_answer not in (None, "", []):
                    stat["sample_wrong"].append(str(detail.student_answer)[:120])

    activities = [
        {**v, "total": v["correct"] + v["incorrect"]}
        for v in by_activity.values()
        if (v["correct"] + v["incorrect"]) > 0
    ]
    return {"summary": ai_summarize(worksheet.title, activities)}


@app.get("/teacher/activity-feed")
def teacher_activity_feed(since: str | None = None, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[dict]:
    from datetime import datetime, timezone, timedelta
    since_iso = since or (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    notas = repository.get_recent_responses_for_teacher(current_user.id, since_iso)
    events = [{"tipo": "nota", "nombre": n["student_name"], "detalle": n["worksheet_title"], "ts": n["submitted_at"]} for n in notas]
    events += repository.get_recent_ingresos(since_iso, current_user.id)
    events.sort(key=lambda e: e["ts"], reverse=True)
    return events[:100]


@app.get("/students/{student_id}/responses", response_model=list[WorksheetResponse])
def list_student_responses(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[WorksheetResponse]:
    require_student_owner_or_staff(student_id, current_user)
    return repository.list_responses(student_id=student_id, include_archived=False)


@app.get("/students/{student_id}/classrooms", response_model=list[Classroom])
def list_student_classrooms(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[Classroom]:
    require_student_owner_or_staff(student_id, current_user)
    return repository.list_student_classrooms(student_id)


@app.get("/students/activity", response_model=list[StudentActivity])
def get_students_activity(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[StudentActivity]:
    return repository.get_students_activity(get_access_token_expire_minutes(), current_user.id)


@app.get("/students/{student_id}/sessions", response_model=list[UserSession])
def list_student_sessions(student_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[UserSession]:
    require_student_access(student_id, current_user)
    return repository.list_student_sessions(student_id)


@app.get("/worksheets/{worksheet_id}", response_model=Worksheet)
def get_worksheet(worksheet_id: str, current_user: PublicUser = Depends(get_current_user)) -> Worksheet:
    worksheet = repository.get_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if current_user.role == UserRole.student and (worksheet.archived or not worksheet.published):
        raise HTTPException(status_code=403, detail="Esta hoja de trabajo no está disponible")
    if current_user.role == UserRole.teacher and worksheet.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes consultar esta evaluación")
    # Un alumno autenticado puede pedir una hoja por id: no debe llevarse las `note` privadas (ADR-19).
    if current_user.role == UserRole.student:
        return _without_notes(worksheet)
    return worksheet


@app.post("/worksheets/{worksheet_id}/publish", response_model=Worksheet)
def publish_worksheet(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    require_worksheet_manager(worksheet_id, current_user)
    worksheet = repository.publish_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/worksheets/{worksheet_id}/unpublish", response_model=Worksheet)
def unpublish_worksheet(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    require_worksheet_manager(worksheet_id, current_user)
    worksheet = repository.unpublish_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/worksheets/{worksheet_id}/archive", response_model=Worksheet)
def archive_worksheet(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    require_worksheet_manager(worksheet_id, current_user)
    worksheet = repository.archive_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/worksheets/{worksheet_id}/unarchive", response_model=Worksheet)
def unarchive_worksheet(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    require_worksheet_manager(worksheet_id, current_user)
    worksheet = repository.unarchive_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.delete("/worksheets/{worksheet_id}", status_code=204)
def delete_worksheet(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_worksheet_manager(worksheet_id, current_user)
    if not repository.delete_worksheet(worksheet_id):
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")


@app.post("/worksheets/{worksheet_id}/duplicate", response_model=Worksheet)
def duplicate_worksheet(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    require_worksheet_manager(worksheet_id, current_user)
    original = repository.get_worksheet(worksheet_id)
    if not original:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    new_title = f"Copia de {original.title}"
    duplicated = repository.duplicate_worksheet(worksheet_id, new_title, current_user.id)
    if not duplicated:
        raise HTTPException(status_code=500, detail="No se pudo duplicar la hoja")
    return duplicated


def _try_ai_grade(details: list, worksheet: Worksheet) -> bool:
    """Califica con IA en el sitio. False si la IA falló: el envío se guarda con la
    auto-calificación y `_retry_ai_grading` lo vuelve a intentar en segundo plano."""
    try:
        ai_grade_activities(details, worksheet.title, worksheet.ai_tolerance, _activity_notes(worksheet))
        return True
    except Exception as exc:
        print(f"[AI:grade] falló al enviar, se reintentará: {exc}")
        return False


# Esperas antes de cada reintento: el rate-limit por minuto del proveedor es lo que tumbaba el
# segundo de dos envíos seguidos, así que hay que dejar pasar su ventana.
# ponytail: reintento en memoria; un redeploy durante la espera lo pierde. Cola en BD si llega a pasar.
_AI_RETRY_DELAYS = (15, 45, 120)


def _retry_ai_grading(response_id: str, worksheet: Worksheet) -> None:
    for delay in _AI_RETRY_DELAYS:
        time.sleep(delay)
        response = repository.get_response(response_id)
        if not response:
            return  # el profesor la borró mientras tanto
        # Lo que el profesor ya revisó a mano (tiene comentario) no se vuelve a pasar por la IA.
        fresh = [d for d in response.details if not d.teacher_comment]
        try:
            ai_grade_activities(fresh, worksheet.title, worksheet.ai_tolerance, _activity_notes(worksheet))
        except Exception as exc:
            print(f"[AI:grade] reintento fallido para {response_id}: {exc}")
            continue
        response.correct_count, response.pending_count, response.score = _score_details(response.details)
        repository.update_response_review(response)
        return
    print(f"[AI:grade] {response_id} quedó sin calificar por IA tras {len(_AI_RETRY_DELAYS)} reintentos")


@app.post("/responses", response_model=WorksheetResponse)
def submit_response(payload: WorksheetResponseCreate, background: BackgroundTasks, current_user: PublicUser = Depends(require_student)) -> WorksheetResponse:
    if payload.student_id and payload.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes enviar respuestas por otro estudiante")

    worksheet = repository.get_worksheet(payload.worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if worksheet.archived or not worksheet.published:
        raise HTTPException(status_code=403, detail="Esta hoja de trabajo no está disponible")
    lock_key = (current_user.id, worksheet.id)
    now = time.monotonic()
    if now - _response_locks.get(lock_key, 0) < 5:
        raise HTTPException(status_code=409, detail="Ya enviaste esta hoja de trabajo")
    attempts = repository.count_student_attempts(worksheet.id, current_user.id)
    if worksheet.max_attempts is not None and attempts >= worksheet.max_attempts:
        raise HTTPException(status_code=409, detail="Ya has alcanzado el número máximo de intentos para esta hoja")
    # max_attempts None = ilimitada: no se bloquea por cantidad (el lock de 5s evita doble envío accidental).
    _response_locks[lock_key] = now

    details = _build_answer_details(worksheet, payload.answers_json)
    ai_failed = worksheet.ai_grading and not _try_ai_grade(details, worksheet)
    correct_count, pending_count, score = _score_details(details)
    response = WorksheetResponse(
        worksheet_id=payload.worksheet_id,
        student_id=current_user.id,
        student_name=current_user.name,
        answers_json=payload.answers_json,
        details=details,
        score=score,
        correct_count=correct_count,
        pending_count=pending_count,
    )
    saved = repository.add_response(response)
    if ai_failed:
        background.add_task(_retry_ai_grading, saved.id, worksheet)
        saved.ai_pending = True
    return saved


@app.post("/worksheets/{worksheet_id}/practice")
def practice_grade(worksheet_id: str, payload: PracticeGrade, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Modo práctica del profesor: resuelve la hoja y la califica SIN guardar (dry-run).
    Solo auto-calificación determinista (sin IA). Sirve para verificar la clave de respuestas."""
    require_worksheet_manager(worksheet_id, current_user)
    worksheet = repository.get_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    details = _build_answer_details(worksheet, payload.answers_json)
    correct_count, pending_count, score = _score_details(details)
    return {"details": details, "score": score, "correct_count": correct_count, "pending_count": pending_count}


@app.get("/worksheets/{worksheet_id}/responses", response_model=list[WorksheetResponse])
def list_responses(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[WorksheetResponse]:
    require_worksheet_manager(worksheet_id, current_user)
    return repository.list_responses(worksheet_id=worksheet_id)


@app.delete("/responses/{response_id}", status_code=204)
def delete_response(response_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    response = repository.get_response(response_id)
    if not response:
        raise HTTPException(status_code=404, detail="Respuesta no encontrada")
    require_worksheet_manager(response.worksheet_id, current_user)
    repository.delete_response(response_id)


@app.post("/responses/{response_id}/review", response_model=WorksheetResponse)
def review_response(response_id: str, payload: AnswerReview, current_user: PublicUser = Depends(require_teacher_or_admin)) -> WorksheetResponse:
    response = repository.get_response(response_id)
    if not response:
        raise HTTPException(status_code=404, detail="Respuesta no encontrada")
    require_worksheet_manager(response.worksheet_id, current_user)
    updated = False
    for detail in response.details:
        if detail.activity_id == payload.activity_id:
            detail.status = payload.status
            detail.teacher_comment = payload.comment
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Actividad no encontrada en la respuesta")
    response.correct_count, response.pending_count, response.score = _score_details(response.details)
    return repository.update_response_review(response)

# ── Lectores ─────────────────────────────────────────────────────────────────

@app.post("/readers", response_model=PublicUser)
def create_reader(payload: ReaderCreate, _: PublicUser = Depends(require_teacher_or_admin)) -> PublicUser:
    try:
        return repository.create_reader(payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/readers", response_model=list[PublicUser])
def list_readers(_: PublicUser = Depends(require_teacher_or_admin)) -> list[PublicUser]:
    return repository.list_readers()


@app.delete("/readers/{reader_id}", status_code=204)
def delete_reader(reader_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> None:
    if not repository.delete_reader(reader_id):
        raise HTTPException(status_code=404, detail="Lector no encontrado")


@app.post("/reader/log-session", status_code=204)
def log_reader_session(current_user: PublicUser = Depends(get_current_user)) -> None:
    """El portal de lectores llama este endpoint al cargar para registrar la sesión."""
    repository.log_reader_access(current_user.id, current_user.name)


@app.get("/teacher/reader-logs")
def list_reader_logs(_: PublicUser = Depends(require_teacher_or_admin)) -> list[dict]:
    """Historial de sesiones de lectores para el panel del profesor."""
    return repository.list_reader_access_logs()


@app.get("/readers/{reader_id}/vocabulary", response_model=list[VocabularyList])
def list_reader_vocabulary(reader_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[VocabularyList]:
    if current_user.role == UserRole.reader and current_user.id != reader_id:
        raise HTTPException(status_code=403, detail="No autorizado")
    if current_user.role not in {UserRole.reader, UserRole.teacher, UserRole.admin}:
        raise HTTPException(status_code=403, detail="No autorizado")
    return repository.list_reader_vocabulary(reader_id)


@app.post("/vocabulary/{list_id}/readers", status_code=204)
def assign_reader_to_list(list_id: str, payload: dict, _: PublicUser = Depends(require_teacher_or_admin)) -> None:
    reader_id = payload.get("reader_id")
    if not reader_id:
        raise HTTPException(status_code=422, detail="reader_id requerido")
    if not repository.get_vocabulary_list(list_id):
        raise HTTPException(status_code=404, detail="Lista no encontrada")
    repository.assign_reader_to_list(reader_id, list_id)


@app.delete("/vocabulary/{list_id}/readers/{reader_id}", status_code=204)
def unassign_reader_from_list(list_id: str, reader_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> None:
    repository.unassign_reader_from_list(reader_id, list_id)


@app.get("/vocabulary/{list_id}/readers", response_model=list[PublicUser])
def list_readers_for_list(list_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> list[PublicUser]:
    return repository.list_readers_for_list(list_id)


# ── Endpoints de invitado (sin autenticación) ────────────────────────────────

@app.patch("/classrooms/{classroom_id}/visibility", status_code=204)
def set_classroom_visibility(classroom_id: str, payload: ClassroomVisibilityUpdate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_manager(classroom_id, current_user)
    repository.set_classroom_visibility(classroom_id, payload.is_public)


@app.get("/public/classrooms")
def public_classrooms() -> list[dict]:
    """Lista solo las aulas marcadas como públicas para selección de invitados. Sin autenticación."""
    from .models import Classroom
    classrooms: list[Classroom] = repository.list_classrooms()
    return [{"id": c.id, "name": c.name} for c in classrooms if c.is_public]


@app.get("/public/classrooms/{classroom_id}/worksheets", response_model=list[Worksheet])
def public_classroom_worksheets(classroom_id: str) -> list[Worksheet]:
    """Hojas publicadas de un aula específica. Sin autenticación."""
    worksheets = repository.list_classroom_worksheets(classroom_id)
    return [_without_notes(w) for w in worksheets if w.published and not w.archived]


@app.get("/public/worksheets", response_model=list[Worksheet])
def public_worksheets() -> list[Worksheet]:
    """Todas las hojas publicadas y no archivadas, sin autenticación."""
    return [_without_notes(w) for w in repository.list_worksheets(published=True, archived=False)]


@app.get("/public/worksheets/{worksheet_id}", response_model=Worksheet)
def public_worksheet(worksheet_id: str) -> Worksheet:
    """Carga una hoja PUBLICADA por su id, sin autenticación — para enlaces directos que el
    profesor comparte. El id es un UUID no adivinable (URL-capability). No requiere aula/login."""
    worksheet = repository.get_worksheet(worksheet_id)
    if not worksheet or worksheet.archived or not worksheet.published:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no disponible")
    return _without_notes(worksheet)


@app.post("/public/responses", response_model=WorksheetResponse)
def submit_guest_response(payload: GuestResponseCreate, background: BackgroundTasks) -> WorksheetResponse:
    """Envía respuestas como invitado. Identificación por guest_token (UUID en localStorage)."""
    if not payload.guest_token or len(payload.guest_token) < 10:
        raise HTTPException(status_code=422, detail="guest_token inválido")
    if not payload.student_name.strip():
        raise HTTPException(status_code=422, detail="El nombre no puede estar vacío")

    worksheet = repository.get_worksheet(payload.worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if worksheet.archived or not worksheet.published:
        raise HTTPException(status_code=403, detail="Esta hoja de trabajo no está disponible")

    # Prevenir doble envío por token + worksheet
    lock_key = (f"guest:{payload.guest_token}", worksheet.id)
    now = time.monotonic()
    if now - _response_locks.get(lock_key, 0) < 5:
        raise HTTPException(status_code=409, detail="Ya enviaste esta hoja de trabajo")
    attempts = repository.count_guest_attempts(worksheet.id, payload.guest_token)
    if attempts > 0:
        raise HTTPException(status_code=409, detail="Ya enviaste esta hoja de trabajo")
    _response_locks[lock_key] = now

    details = _build_answer_details(worksheet, payload.answers_json)
    ai_failed = worksheet.ai_grading and not _try_ai_grade(details, worksheet)
    correct_count, pending_count, score = _score_details(details)
    response = WorksheetResponse(
        worksheet_id=payload.worksheet_id,
        student_id=None,
        student_name=payload.student_name.strip(),
        answers_json=payload.answers_json,
        details=details,
        score=score,
        correct_count=correct_count,
        pending_count=pending_count,
        guest_token=payload.guest_token,
    )
    saved = repository.add_response(response)
    if ai_failed:
        background.add_task(_retry_ai_grading, saved.id, worksheet)
        saved.ai_pending = True
    return saved


# Debajo de esta nota se ofrece plan de reforzamiento (la misma frontera que `moodForScore`: <75 = "le falta mejorar").
REINFORCEMENT_MAX_SCORE = 75


@app.post("/public/responses/{response_id}/reinforcement", response_model=ReinforcementPlan)
def reinforcement_plan(response_id: str, request: Request) -> ReinforcementPlan:
    """Plan de reforzamiento para una respuesta con nota mala o regular: qué falló, explicación y
    un quiz corto. Los fallos se leen DE LA BD, no del cliente. Solo respuestas de invitado/enlace
    directo: las de un alumno registrado no se exponen por una ruta pública."""
    _rate_limit(request, limit=20)  # cada llamada cuesta IA
    response = repository.get_response(response_id)
    if not response or not response.guest_token:
        raise HTTPException(status_code=404, detail="Respuesta no encontrada")
    if response.score is None or response.score >= REINFORCEMENT_MAX_SCORE:
        raise HTTPException(status_code=409, detail="Esta nota no necesita plan de reforzamiento")
    failed = [d for d in response.details if d.status == "incorrect"]
    if not failed:
        raise HTTPException(status_code=409, detail="No hay respuestas incorrectas que reforzar")
    worksheet = repository.get_worksheet(response.worksheet_id)
    try:
        return ReinforcementPlan(**generate_reinforcement_plan(worksheet.title if worksheet else "", failed))
    except Exception:
        raise HTTPException(status_code=503, detail="No se pudo generar el plan ahora. Intenta de nuevo en un momento.")


@app.get("/public/responses", response_model=list[WorksheetResponse])
def list_guest_responses(guest_token: str) -> list[WorksheetResponse]:
    """Devuelve todas las respuestas de un invitado por su token."""
    if not guest_token or len(guest_token) < 10:
        raise HTTPException(status_code=422, detail="guest_token inválido")
    return repository.list_responses_by_guest_token(guest_token)


@app.post("/public/guest-sessions", status_code=204)
def log_guest_session(payload: GuestSessionLog) -> None:
    """Registra un acceso de invitado. Sin autenticación."""
    repository.log_guest_access(payload.guest_token, payload.name, payload.classroom_id, payload.classroom_name)


# ── Evaluación en tiempo real ────────────────────────────────────────────────
#
# El profesor lanza cada pregunta y los alumnos responden desde el celular. El estado vive en
# memoria (`live.py`); aquí solo van los endpoints, que reusan la autenticación de siempre.
#
# NINGUNO pasa por `_rate_limit`, y es a propósito: el límite es POR IP y 50 alumnos en el WiFi
# de un salón comparten una sola IP, así que el aula entera se comería un 429 en el primer
# minuto de polling. Lo que protege estos endpoints es que son lecturas de un dict en memoria
# (no cuestan BD ni dinero) y que `live.py` acota participantes y sesiones.


@app.exception_handler(live.LiveError)
def _live_error(_: Request, exc: live.LiveError) -> JSONResponse:
    """Traduce el error de dominio de `live.py` a HTTP. Así ese módulo no importa FastAPI y
    se puede probar sin levantar la app (ni cargar el `.env` de producción)."""
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


@app.post("/live/sessions")
def create_live_session(payload: LiveSessionCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Abre una sesión en vivo a partir de una hoja propia. Devuelve el código para proyectar."""
    worksheet = require_worksheet_manager(payload.worksheet_id, current_user)
    content = worksheet.json_content
    activities = content.iter_activities()
    # Los bloques van APARTE porque `iter_activities()` los aplana y tira el `BlockData` entero:
    # sin esto, una hoja con una lectura arriba y varias preguntas debajo (ADR-24) mandaba al
    # alumno las preguntas sin el texto del que hablan.
    blocks = content.blocks
    session = live.create_session(
        worksheet_id=worksheet.id,
        worksheet_title=worksheet.title,
        owner_id=current_user.id,
        info_fields=worksheet.json_content.info_fields,
        questions=live.extract_questions(activities, blocks),
        duration=payload.duration,
        instant_feedback=payload.instant_feedback,
        # Lo que la hoja tiene y en vivo no se puede jugar. Viaja al panel para que descartarlo
        # sea visible, en vez de que la sesión salga más corta sin explicación.
        skipped=live.summarize(activities, blocks)["skipped"],
    )
    return session.host_state()


# Declarado ANTES de `/live/{code}`: FastAPI resuelve por orden y si no, "sessions" entraría
# como código de sesión.
@app.get("/live/sessions")
def list_live_sessions(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[dict[str, Any]]:
    return live.list_sessions(current_user.id, current_user.role == UserRole.admin)


# También antes de `/live/{code}`, por el mismo motivo que `/live/sessions`.
@app.get("/live/history")
def live_history(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[dict[str, Any]]:
    """Sesiones en vivo ya terminadas. Sale de las entregas que guarda `finish`, no de la
    memoria: una sesión sobrevive al reinicio del proceso aquí, en `list_sessions` no."""
    owner = None if current_user.role == UserRole.admin else current_user.id
    return repository.live_session_history(owner)


@app.get("/live/{code}")
def live_state(code: str, pid: str | None = None) -> dict[str, Any]:
    """Estado de la sesión. Sin autenticación: es lo que polean el alumno y la pantalla.

    La respuesta correcta solo viaja cuando la pregunta ya se reveló (ver `public_state`).
    """
    return live.get_session(code).public_state(pid=pid)


@app.post("/live/{code}/join")
def live_join(code: str, payload: LiveJoin) -> dict[str, Any]:
    """Entra a la sesión con los campos `info {}` de la hoja (Carné, Nombre…), todos obligatorios."""
    session = live.get_session(code)
    participant = session.join(payload.info, payload.emoji)
    return {"pid": participant.pid, "label": participant.label, **session.public_state(pid=participant.pid)}


@app.post("/live/{code}/answer")
def live_answer(code: str, payload: LiveAnswer) -> dict[str, Any]:
    session = live.get_session(code)
    result = session.submit(payload.pid, payload.answer)
    return {**result, **session.public_state(pid=payload.pid)}


@app.post("/live/{code}/react")
def live_react(code: str, payload: LiveEmoji) -> dict[str, Any]:
    """Lanza uno de los cinco emojis de `live.REACTIONS`. No es un chat, a propósito: lo que se
    manda aquí acaba proyectado en la pared del salón."""
    session = live.get_session(code)
    session.react(payload.pid, payload.emoji)
    return session.public_state(pid=payload.pid)


@app.post("/live/{code}/avatar")
def live_avatar(code: str, payload: LiveEmoji) -> dict[str, Any]:
    """Cambia el avatar del alumno. Solo en la sala de espera o al terminar (ver `set_avatar`)."""
    session = live.get_session(code)
    session.set_avatar(payload.pid, payload.emoji)
    return session.public_state(pid=payload.pid)


@app.get("/live/{code}/audio")
async def live_audio(code: str, request: Request, k: str = "") -> Response:
    """El mp3 de la pregunta abierta, para la PANTALLA PROYECTADA. Sin JWT pero con llave.

    Por qué una llave y no el estado de siempre: el alumno y la pantalla polean el MISMO
    endpoint (`GET /live/{code}`), así que cualquier cosa que se mande a la pantalla por ahí
    llega también al celular — y `audio_text` es la transcripción literal de lo que hay que
    escuchar. Con `screen_key` (que solo viaja en `host_state()`, detrás del JWT del profesor)
    el audio se sirve sin que el texto salga nunca en un payload público.

    Se sintetiza a demanda en vez de mandar la URL de `/tts?text=…`, que llevaría el texto en el
    query string y volvería a filtrarlo por el historial del navegador.
    """
    _rate_limit(request, limit=120)  # la pantalla pide uno por pregunta; la llave hace el resto
    session = live.get_session(code)
    if not secrets.compare_digest(k, session.screen_key):
        raise HTTPException(status_code=403, detail="Esta pantalla no puede reproducir el audio")
    question = session.current()
    if question is None or not question.audio_text:
        raise HTTPException(status_code=404, detail="Esta pregunta no tiene audio")
    # Mismo mapeo que el renderer de la hoja (`resolveVoice`): el alias 'male'/'female' del DSL
    # se traduce a la voz curada, un nombre literal pasa tal cual. Así el audio en vivo suena
    # igual que el de la hoja normal, que es lo que el profesor ya escuchó al crearla.
    voice = _tts_voice(_resolve_conversation_voice(question.voice, "en-US-AndrewNeural"))
    try:
        mp3 = await _synth_mp3([(question.audio_text, voice)], question.rate or DEFAULT_TTS_RATE)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="No se pudo generar el audio.") from exc
    # `no-store`: el mp3 ES la respuesta de la pregunta. Que se quede en la caché del navegador
    # de la pantalla no aporta nada y lo deja recuperable después de la sesión.
    return Response(content=mp3, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@app.get("/live/{code}/host")
def live_host_state(code: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    return live.owned_session(code, current_user.id, current_user.role == UserRole.admin).host_state()


@app.post("/live/{code}/next")
def live_next_question(code: str, payload: LiveOpenQuestion = LiveOpenQuestion(), current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    session = live.owned_session(code, current_user.id, current_user.role == UserRole.admin)
    session.open_next(payload.duration)
    return session.host_state()


@app.post("/live/{code}/answers")
def live_open_answers(code: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Cierra la escucha y arranca el cronómetro (fase `listening` → `question`).

    Es el paso que impide que el bono de rapidez premie a quien toca un botón antes de oír el
    audio: mientras suena, los botones del alumno están cerrados y el reloj no ha empezado.
    """
    session = live.owned_session(code, current_user.id, current_user.role == UserRole.admin)
    session.open_answers()
    return session.host_state()


@app.post("/live/{code}/reveal")
def live_reveal(code: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Cierra la pregunta actual antes de que se acabe el tiempo y muestra la respuesta."""
    session = live.owned_session(code, current_user.id, current_user.role == UserRole.admin)
    session.reveal()
    return session.host_state()


@app.post("/live/{code}/finish")
def live_finish(code: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Termina la sesión y GUARDA una respuesta por alumno, como cualquier otra entrega: así
    aparecen en Revisión y sobreviven al reinicio del proceso, que es lo único que la sesión en
    memoria no aguanta."""
    session = live.owned_session(code, current_user.id, current_user.role == UserRole.admin)
    session.end()
    saved = 0
    for row in session.snapshot():
        if not row["answered"]:
            continue  # entró pero nunca respondió: no se le inventa una entrega
        details = [AnswerDetail(**detail) for detail in row["details"]]
        correct_count, pending_count, score = _score_details(details)
        answers: dict[str, Any] = dict(row["answers"])
        for index, label in enumerate(session.info_fields):
            answers[f"_info_{index}"] = row["info"].get(label, "")
        repository.add_response(WorksheetResponse(
            worksheet_id=session.worksheet_id,
            student_id=None,
            student_name=row["label"],
            answers_json=answers,
            details=details,
            score=score,
            correct_count=correct_count,
            pending_count=pending_count,
            guest_token=f"live:{session.code}:{row['pid']}",
        ))
        saved += 1
    return {"saved": saved, **session.host_state()}


@app.delete("/live/{code}", status_code=204)
def live_close(code: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    live.owned_session(code, current_user.id, current_user.role == UserRole.admin)
    live.close_session(code)


# ── Salas de juego (`rooms.py`, ADR-40) ──────────────────────────────────────
# Públicas y sin login, como `/live/{code}`. Los errores de `rooms` son `live.LiveError`, así que
# los traduce el mismo handler. Solo crear y unirse pasan por `_rate_limit` (holgado: un salón
# comparte la IP del WiFi); el polling no, por el mismo motivo que `/live`.


@app.post("/rooms")
def room_create(payload: RoomCreate, request: Request) -> dict[str, Any]:
    _rate_limit(request, limit=60)
    room, host = rooms.create_room(payload.game, payload.set_id, payload.mode, payload.name)
    return {"token": host.token, "me": host.id, **room.public_state()}


@app.get("/rooms/{code}")
def room_state(code: str, token: str | None = None, since: int | None = None) -> dict[str, Any]:
    room = rooms.get_room(code)
    room.touch(token)
    return room.public_state(since)


@app.post("/rooms/{code}/join")
def room_join(code: str, payload: RoomJoin, request: Request) -> dict[str, Any]:
    _rate_limit(request, limit=60)
    room = rooms.get_room(code)
    player = room.join(payload.name)
    return {"token": player.token, "me": player.id, **room.public_state()}


@app.post("/rooms/{code}/state")
def room_push(code: str, payload: RoomPush) -> dict[str, Any]:
    room = rooms.get_room(code)
    room.push(payload.token, payload.version, payload.state, payload.turn)
    return room.public_state(room.version)


@app.post("/rooms/{code}/say")
def room_say(code: str, payload: RoomSay, request: Request) -> dict[str, Any]:
    """Lo que dijo un jugador (su respuesta por voz, ya transcrita en su navegador). Cualquier
    jugador de la sala puede escribirlo, tenga o no el control: quien responde casi nunca lo tiene."""
    _rate_limit(request, limit=120)
    room = rooms.get_room(code)
    room.say(payload.token, payload.text)
    return room.public_state(room.version)


@app.post("/rooms/{code}/turn")
def room_turn(code: str, payload: RoomTurn) -> dict[str, Any]:
    room = rooms.get_room(code)
    room.pass_turn(payload.token, payload.to, payload.lend)
    return room.public_state(room.version)


@app.post("/public/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...), clarity: bool = False, context: str = Form("")) -> dict[str, Any]:
    """Transcribe el audio del micrófono (actividad speaking y conversación con IA) con Groq
    Whisper. Público. Con `clarity=true` devuelve además la claridad 0-100 (ADR-39), y acepta
    `context` (escena + últimas líneas) para que Whisper entienda la palabra que encaja ahí.

    Es el endpoint sin login que cuesta DINERO (cuota de Groq), así que se acota por los dos
    lados: 4 MB por petición —de sobra para una respuesta hablada; 10 MB era diez veces lo que
    hace falta— y un tope de peticiones por IP. El invitado no tiene cuenta contra la que
    limitar, y no se le va a pedir una: el modo invitado existe para no pedirla. El tope es por IP
    y un salón entero comparte la del WiFi: 30 alumnos conversando con la IA hablan cada ~20 s
    (90/min), de ahí 180.
    """
    _rate_limit(request, limit=180)
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="Audio vacío")
    if len(audio) > 4 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="El audio es demasiado largo (máx 4 MB)")
    try:
        if clarity:
            text, score = await asyncio.to_thread(transcribe_with_clarity, audio, file.filename or "speech.webm", file.content_type or "audio/webm", context.strip())
            return {"transcript": text, "clarity": score}
        text = ai_transcribe(audio, file.filename or "speech.webm", file.content_type or "audio/webm")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="No se pudo transcribir el audio") from exc
    return {"transcript": text}


@app.get("/teacher/guest-logs")
def list_guest_logs(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[dict]:
    """Historial de accesos de invitados **de las aulas propias o compartidas**.

    Antes devolvía los invitados de todos los profesores a cualquiera que tuviera rol de
    profesor, sin necesidad de adivinar ningún id: era el agujero de aislamiento más ancho.
    """
    return repository.list_guest_access_logs(current_user.id)


@app.get("/teacher/guest-detail")
def guest_detail(guest_token: str, classroom_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Detalle de seguimiento de un invitado: respuestas (con título) y hojas pendientes del aula.

    El aula tiene que ser propia: con solo el rol de profesor, un `guest_token` sacado del
    listado abierto de antes daba las respuestas de un invitado de otro profesor.
    """
    require_classroom_access(classroom_id, current_user)
    responses = repository.list_responses_by_guest_token(guest_token)
    classroom_worksheets = repository.list_classroom_worksheets(classroom_id)
    title_by_id = {w.id: w.title for w in classroom_worksheets}
    answered = {r.worksheet_id for r in responses}

    resp_payload = []
    for r in responses:
        title = title_by_id.get(r.worksheet_id)
        if title is None:
            # Hoja que ya no está en el aula (se desasignó después). Se conserva en el historial,
            # pero solo si es de este profesor: el `guest_token` es del invitado, no del aula, y
            # sin esto arrastraría respuestas de hojas ajenas.
            w = repository.get_worksheet(r.worksheet_id)
            if w and current_user.role != UserRole.admin and w.created_by != current_user.id:
                continue
            title = w.title if w else "(hoja eliminada)"
        data = r.model_dump(mode="json")
        data["worksheet_title"] = title
        resp_payload.append(data)

    pending = [
        {"id": w.id, "title": w.title}
        for w in classroom_worksheets
        if w.published and not w.archived and w.id not in answered
    ]
    return {"responses": resp_payload, "pending": pending}


# ── Vocabulario público (sin autenticación) ───────────────────────────────────

@app.get("/public/vocabulary/{list_id}", response_model=VocabularyList)
def public_vocabulary(list_id: str) -> VocabularyList:
    """Carga una lista de vocabulario por id, sin login — para enlaces directos que el profesor
    comparte. El id es un UUID no adivinable (URL-capability). No requiere aula/login/reader."""
    vocab = repository.get_vocabulary_list(list_id)
    if not vocab:
        raise HTTPException(status_code=404, detail="Vocabulario no disponible")
    return vocab


@app.get("/public/readers-vocabulary")
def public_readers_vocabulary() -> list[dict]:
    """Devuelve todos los readers con sus listas de vocabulario. No requiere autenticación."""
    readers = repository.list_readers()
    vocab_by_reader = repository.list_all_readers_vocabulary()  # 1 query en vez de una por reader (N+1)
    result = []
    for reader in readers:
        lists = vocab_by_reader.get(reader.id, [])
        if lists:
            result.append({
                "id": reader.id,
                "name": reader.name,
                "username": reader.username,
                "vocabulary_lists": [
                    {
                        "id": vl.id,
                        "title": vl.title,
                        "description": vl.description,
                        "items": [item.model_dump() for item in vl.items],
                    }
                    for vl in lists
                ],
            })
    return result


# ── Vocabulario ──────────────────────────────────────────────────────────────

@app.post("/vocabulary", response_model=VocabularyList)
def create_vocabulary_list(payload: VocabularyListCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> VocabularyList:
    payload.created_by = current_user.id
    return repository.create_vocabulary_list(payload)


@app.post("/vocabulary/ai-generate")
def ai_generate_vocabulary(payload: VocabularyAiRequest, _: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, str]:
    """Tema → CSV de vocabulario. NO guarda: el profesor revisa la vista previa y guarda."""
    if not payload.prompt.strip():
        raise HTTPException(status_code=422, detail="Escribe un tema para el vocabulario")
    try:
        csv, provider = generate_vocabulary_csv(payload.prompt.strip())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"La IA no pudo generar el vocabulario: {exc}") from exc
    return {"csv": csv, "provider": provider}


@app.get("/vocabulary", response_model=list[VocabularyList])
def list_vocabulary_lists(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[VocabularyList]:
    created_by = None if current_user.role == UserRole.admin else current_user.id
    return repository.list_vocabulary_lists(created_by=created_by)


@app.get("/vocabulary/{list_id}", response_model=VocabularyList)
def get_vocabulary_list(list_id: str, _: PublicUser = Depends(get_current_user)) -> VocabularyList:
    vocab = repository.get_vocabulary_list(list_id)
    if not vocab:
        raise HTTPException(status_code=404, detail="Lista de vocabulario no encontrada")
    return vocab


@app.delete("/vocabulary/{list_id}", status_code=204)
def delete_vocabulary_list(list_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    vocab = repository.get_vocabulary_list(list_id)
    if not vocab:
        raise HTTPException(status_code=404, detail="Lista de vocabulario no encontrada")
    if current_user.role == UserRole.teacher and vocab.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes eliminar esta lista")
    repository.delete_vocabulary_list(list_id)


@app.post("/vocabulary/{list_id}/assign", status_code=204)
def assign_vocabulary_to_classroom(list_id: str, payload: VocabularyAssignment, _: PublicUser = Depends(require_teacher_or_admin)) -> None:
    if not repository.get_vocabulary_list(list_id):
        raise HTTPException(status_code=404, detail="Lista de vocabulario no encontrada")
    repository.assign_vocabulary_to_classroom(list_id, payload.classroom_id)


@app.delete("/vocabulary/{list_id}/assign/{classroom_id}", status_code=204)
def unassign_vocabulary_from_classroom(list_id: str, classroom_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> None:
    repository.unassign_vocabulary_from_classroom(list_id, classroom_id)


@app.get("/vocabulary/{list_id}/classrooms", response_model=list[str])
def list_vocabulary_classrooms(list_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> list[str]:
    return repository.list_vocabulary_classrooms(list_id)


@app.get("/students/{student_id}/vocabulary", response_model=list[VocabularyList])
def list_student_vocabulary(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[VocabularyList]:
    require_student_owner_or_staff(student_id, current_user)
    return repository.list_student_vocabulary(student_id)


# ── Conversación con IA por role-play (ADR-39) ─────────────────────────────────
# Públicos a propósito: el alumno practica sin cuenta para no sentirse juzgado. Cuestan IA, así
# que se acotan por IP (holgado: un salón comparte la del WiFi) y por tamaño (`history` ≤ 24
# mensajes de ≤ 600 caracteres, y el turno se niega pasado el tope del nivel). No se guarda nada.

@app.get("/public/roleplay/scenarios", response_model=list[RoleplayScenario])
def roleplay_scenarios() -> list[dict]:
    return roleplay.public_scenarios()


@app.post("/public/roleplay/start", response_model=RoleplayStart)
def roleplay_start(payload: RoleplayStartRequest, request: Request) -> dict:
    _rate_limit(request, limit=120)
    try:
        return roleplay.start(payload.scenario, payload.role, payload.level, secrets.randbelow(2**31),
                              payload.with_info, payload.with_missions)
    except roleplay.RoleplayError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/public/roleplay/turn")
async def roleplay_turn(payload: RoleplayTurnRequest, request: Request) -> StreamingResponse:
    """La siguiente línea del personaje y su voz, en UNA respuesta. Con historial vacío, la que abre la escena.

    Cuerpo: una línea JSON (`RoleplayReply`) y después el mp3 según lo manda edge-tts. El navegador
    empieza a sonar con los primeros trozos. Medido en Render: edge-tts tarda de 0,5 a 5 s en mandar
    una frase entera, y esperarla completa (antes iba en base64 dentro del JSON) era lo que más se
    notaba. La conexión con edge-tts se abre mientras la IA piensa (`_edge_connect`). Si la voz falla,
    el cuerpo trae solo el JSON y el cliente la pide a /tts: la conversación no se detiene por la voz."""
    _rate_limit(request, limit=240)
    conn = asyncio.create_task(_edge_connect())  # lo caro de la voz, mientras la IA piensa
    try:
        out = await asyncio.to_thread(roleplay.reply, payload.scenario, payload.role, payload.level, payload.seed,
                                      [m.model_dump() for m in payload.history], ai_json, payload.with_info)
    except roleplay.RoleplayError as exc:
        await _drop_connection(conn)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        await _drop_connection(conn)
        print(f"[roleplay] la IA no respondió: {exc!r}")
        raise HTTPException(status_code=503, detail="El personaje no respondió. Intenta de nuevo.") from exc
    head = (RoleplayReply(**out).model_dump_json() + "\n").encode()

    async def body():
        yield head
        try:
            async for chunk in _turn_voice(conn, out["reply"], out["voice"], payload.rate):
                yield chunk
        except Exception as exc:
            print(f"[roleplay] la voz se cortó; el cliente la pedirá a /tts si no le llegó nada: {exc!r}")

    return StreamingResponse(body(), media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


@app.post("/public/roleplay/report", response_model=RoleplayReport)
def roleplay_report(payload: RoleplayTurnRequest, request: Request) -> dict:
    """Nota del 1 al 10 y revisión de cada respuesta. La IA juzga gramática, vocabulario y
    comunicación; la pronunciación sale de la claridad de Whisper, con la curva del nivel."""
    _rate_limit(request, limit=60)
    try:
        return roleplay.report(payload.scenario, payload.role, payload.level, payload.seed,
                               [m.model_dump() for m in payload.history], ai_json, payload.with_info, payload.with_missions)
    except roleplay.RoleplayError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[roleplay] no se pudo armar el informe: {exc!r}")
        raise HTTPException(status_code=503, detail="No se pudo calcular tu nota. Intenta de nuevo.") from exc


# ── Juegos de práctica (ADR-38) ───────────────────────────────────────────────

# El front parte el texto con la MISMA regex (`src/games/words.ts`): si cambia una, cambia la otra,
# o el alumno toca palabras que nunca tendrán significado.
_WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)*")
_GAME_QUESTIONS_RANGE = (4, 60)
_glossary_jobs: set[str] = set()     # sets cuyo diccionario se está pidiendo ahora mismo
_words_attempted: set[str] = set()   # palabras que la IA ya intentó definir en este proceso


def _set_words(questions: list[GameQuestion]) -> list[str]:
    """Palabras distintas de un set, en minúsculas y en orden de aparición."""
    words: dict[str, None] = {}
    for q in questions:
        words.update(dict.fromkeys(_WORD_RE.findall(q.text.lower().replace("’", "'"))))
    return list(words)


def _fill_glossary(set_id: str, missing: list[str]) -> None:
    """Pide a la IA las palabras que aún no están en `word_meanings`. Corre en segundo plano: el
    profesor no espera al guardar y el alumno ve los significados en cuanto existen."""
    try:
        repository.put_word_meanings([WordMeaning(**m) for m in define_words(missing)])
    except Exception as exc:  # sin IA el juego funciona igual, solo sin significados
        print(f"[juegos] no se pudo completar el diccionario del set {set_id}: {exc!r}")
    finally:
        _words_attempted.update(missing)
        _glossary_jobs.discard(set_id)


def _queue_glossary(background: BackgroundTasks, set_id: str, missing: list[str]) -> None:
    if missing and set_id not in _glossary_jobs:
        _glossary_jobs.add(set_id)
        background.add_task(_fill_glossary, set_id, missing)


def _missing_words(game_set: GameSet) -> tuple[list[str], dict[str, WordMeaning]]:
    words = _set_words(game_set.questions)
    known = repository.get_word_meanings(words)
    return [w for w in words if w not in known], known


def _clean_game_set(payload: GameSetPayload) -> GameSetPayload:
    payload.questions = [q for q in payload.questions if q.text.strip()]
    low, high = _GAME_QUESTIONS_RANGE
    if not low <= len(payload.questions) <= high:
        raise HTTPException(status_code=422, detail=f"Un juego lleva entre {low} y {high} preguntas (tiene {len(payload.questions)}).")
    return payload


def _own_game_set(set_id: str, user: PublicUser) -> GameSet:
    game_set = repository.get_game_set(set_id)
    if not game_set:
        raise HTTPException(status_code=404, detail="Juego no encontrado")
    if user.role == UserRole.teacher and game_set.created_by != user.id:
        raise HTTPException(status_code=403, detail="Este juego es de otro profesor")
    return game_set


@app.get("/game-sets", response_model=list[GameSet])
def list_game_sets(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[GameSet]:
    return repository.list_game_sets(created_by=None if current_user.role == UserRole.admin else current_user.id)


@app.post("/game-sets/ai-generate")
def ai_generate_game_set(payload: GameAiRequest, _: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Tema → preguntas. NO guarda: el profesor las revisa en el editor y guarda."""
    try:
        data, provider = generate_game_questions(payload.topic.strip(), payload.level, payload.focus, payload.count)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"La IA no pudo generar las preguntas: {exc}") from exc
    return {**data, "provider": provider}


@app.post("/game-sets", response_model=GameSet)
def create_game_set(payload: GameSetPayload, background: BackgroundTasks, current_user: PublicUser = Depends(require_teacher_or_admin)) -> GameSet:
    game_set = repository.create_game_set(GameSet(**_clean_game_set(payload).model_dump(), created_by=current_user.id))
    _queue_glossary(background, game_set.id, _missing_words(game_set)[0])
    return game_set


@app.put("/game-sets/{set_id}", response_model=GameSet)
def update_game_set(set_id: str, payload: GameSetPayload, background: BackgroundTasks, current_user: PublicUser = Depends(require_teacher_or_admin)) -> GameSet:
    _own_game_set(set_id, current_user)
    game_set = repository.update_game_set(set_id, _clean_game_set(payload))
    _queue_glossary(background, set_id, _missing_words(game_set)[0])
    return game_set


@app.delete("/game-sets/{set_id}", status_code=204)
def delete_game_set(set_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    _own_game_set(set_id, current_user)
    repository.delete_game_set(set_id)


@app.get("/public/game-sets", response_model=list[GameSetSummary])
def public_game_sets() -> list[GameSetSummary]:
    """Catálogo de /juegos: solo los sets que el profesor marcó como destacados."""
    return [
        GameSetSummary(id=s.id, title=s.title, topic=s.topic, level=s.level, question_count=len(s.questions))
        for s in repository.list_game_sets(featured_only=True)
    ]


@app.get("/public/game-sets/{set_id}", response_model=PublicGameSet)
def public_game_set(set_id: str, background: BackgroundTasks) -> PublicGameSet:
    """Un set por id, sin login: el id es un UUID no adivinable (URL-capability, como
    /public/vocabulary). Trae el diccionario de sus palabras. Si falta alguna (la IA falló al
    guardar), se vuelve a pedir en segundo plano — una vez por proceso, para que una palabra que
    la IA no sabe definir no cueste una llamada en cada visita."""
    game_set = repository.get_game_set(set_id)
    if not game_set:
        raise HTTPException(status_code=404, detail="Juego no disponible")
    missing, glossary = _missing_words(game_set)
    _queue_glossary(background, set_id, [w for w in missing if w not in _words_attempted])
    return PublicGameSet(
        id=game_set.id, title=game_set.title, topic=game_set.topic, level=game_set.level,
        questions=game_set.questions, glossary=glossary,
    )



# ── Rana hambrienta: banco de vocabulario A1-C1 (ADR-44) ─────────────────────
# Un solo banco para todo el sitio, fuera de los sets: cada palabra se le pide a la IA UNA vez, pasa
# la revisión y queda en `frog_words`. Crece con el uso, una tanda de 16 cuando alguien juega un
# nivel y tipo de palabra que aún no llega a su meta.

# Palabras nuevas que aporta cada nivel (no repite las de abajo): A1 ≈ 500, A2 ≈ 860, B1 ≈ 1330,
# B2 ≈ 1775, C1 ≈ 2200, unas 6 700 en total, el orden de las listas del MCER. Las preposiciones y
# los conectores se acaban pronto: su meta es baja para no pedirle a la IA lo que no existe.
_FROG_TARGETS = {
    "A1": {"sustantivo": 250, "verbo": 120, "adjetivo": 80, "adverbio": 30, "preposicion": 15, "conector": 10},
    "A2": {"sustantivo": 400, "verbo": 220, "adjetivo": 150, "adverbio": 50, "preposicion": 20, "conector": 20},
    "B1": {"sustantivo": 600, "verbo": 350, "adjetivo": 250, "adverbio": 80, "preposicion": 20, "conector": 30},
    "B2": {"sustantivo": 800, "verbo": 450, "adjetivo": 350, "adverbio": 120, "preposicion": 15, "conector": 40},
    "C1": {"sustantivo": 1000, "verbo": 550, "adjetivo": 450, "adverbio": 150, "preposicion": 10, "conector": 40},
}
_FROG_STARTER = 48        # por debajo, sin espera entre tandas: cada visita suma una
_FROG_COOLDOWN_S = 180    # por encima, entre tandas del mismo nivel y tipo: crece con el uso sin acaparar la IA
_FROG_RETRY_S = 600       # tras un fallo de la IA
_FROG_POOL_MAX = 500      # palabras por respuesta: un C1 completo pesaría ~400 KB
_frog_job: set[tuple[str, str]] = set()          # la tanda en curso (una a la vez en todo el servidor)
_frog_next: dict[tuple[str, str], float] = {}   # (nivel, tipo) → desde cuándo puede pedir otra
# Crecimiento pasivo (solo en Render): sin que nadie juegue, una tanda cada 3 min para el tipo más
# atrasado de TODO el banco. Techo diario de 40 tandas (~120 llamadas) para no comerse el plan
# gratuito de la IA; la calificación va primero (no arranca si `_ai_lock` está ocupado).
_FROG_PASSIVE_S = 180
_FROG_PASSIVE_DAY = 40


def _frog_need(count: int, target: int) -> float:
    """Qué tan atrasado va un nivel y tipo (menor = más urgente). Primero todos llegan a su piso
    (48, o su meta si es menor: los conectores de A1 son 10), del más vacío al menos; después,
    hacia la meta. Así 6 conectores van antes que 40 sustantivos de 250."""
    floor = min(target, _FROG_STARTER)
    return count / floor if count < floor else 1 + count / target


def _frog_gap(level: str, category: str, counts: dict[str, int]) -> str | None:
    """Qué tipo de palabra crecer: el pedido si no llegó a su meta; en "mixto", el más atrasado."""
    targets = _FROG_TARGETS[level]
    if category:
        return category if counts.get(category, 0) < targets[category] else None
    # Empate (todo vacío): en el orden de la tabla, primero sustantivos y verbos.
    gaps = [(_frog_need(counts.get(c, 0), t), i, c) for i, (c, t) in enumerate(targets.items()) if counts.get(c, 0) < t]
    return min(gaps)[2] if gaps else None


def _frog_passive_pick(counts: dict[str, dict[str, int]], now: float) -> tuple[str, str] | None:
    """El nivel y tipo más atrasado de todo el banco que no esté esperando tras un fallo o una tanda."""
    gaps = [(_frog_need(counts[lv].get(c, 0), t), lv, c) for lv, targets in _FROG_TARGETS.items()
            for c, t in targets.items() if counts[lv].get(c, 0) < t and now >= _frog_next.get((lv, c), 0)]
    return min(gaps)[1:] if gaps else None


def _frog_passive_loop() -> None:
    """Hilo de fondo: el banco crece aunque nadie estrene un nivel. Render apaga el servidor gratuito
    tras ~15 min sin visitas, así que solo crece mientras el sitio está en uso."""
    done: dict[str, int] = {}  # día → tandas pasivas
    while True:
        time.sleep(_FROG_PASSIVE_S)
        today = time.strftime("%Y-%m-%d")
        if done.get(today, 0) >= _FROG_PASSIVE_DAY or _frog_job or ai_lock.locked():
            continue
        try:
            pick = _frog_passive_pick({lv: repository.count_frog_words(lv) for lv in _FROG_TARGETS}, time.time())
        except Exception as exc:  # la base caída no tumba el hilo
            print(f"[juegos] rana: crecimiento pasivo sin base: {exc!r}")
            continue
        if pick and not _frog_job:
            _frog_job.add(pick)
            done = {today: done.get(today, 0) + 1}
            _grow_frog_words(*pick)


def _grow_frog_words(level: str, category: str) -> None:
    """Una tanda de 16. Una a la vez y de una en una: si varios alumnos estrenan niveles distintos,
    se turnan en vez de esperar a que uno llene el suyo."""
    key = (level, category)
    try:
        # Se evita lo que ya hay de ese tipo en TODOS los niveles: una palabra vive en un solo nivel.
        avoid = repository.frog_word_keys(category)[-400:]
        taken_es = {frog_norm(w.es) for w in repository.get_frog_words(level)}
        words = [VocabWord(**w) for w in generate_frog_words(level, category, avoid) if frog_norm(w["es"]) not in taken_es]
        if not repository.put_frog_words(level, category, words):
            raise ValueError("la IA no dejó ninguna palabra nueva")
        full = repository.count_frog_words(level).get(category, 0) >= _FROG_STARTER
        _frog_next[key] = time.time() + (_FROG_COOLDOWN_S if full else 0)
    except Exception as exc:
        _frog_next[key] = time.time() + _FROG_RETRY_S
        print(f"[juegos] rana: no se pudo ampliar {level}/{category}: {exc!r}")
    finally:
        _frog_job.clear()


# Semilla del banco (ADR-45): unas 1 980 palabras escritas y revisadas a mano, más de 370 por nivel
# y al menos 6 por nivel y tipo, para que nadie espere a la IA al jugar. Entra al arrancar y la IA sigue sumando encima.
FROG_SEED = Path(__file__).with_name("frog_seed.json")


def seed_frog_words() -> int:
    """Guarda las palabras de la semilla que falten y devuelve cuántas entraron. No pisa nada: se
    salta la palabra que ya está en el banco (en cualquier nivel) y la que repetiría la traducción
    de otra del mismo nivel, igual que una tanda de la IA. Con todo ya guardado, solo lee."""
    seed: dict[str, dict[str, list[dict]]] = json.loads(FROG_SEED.read_text(encoding="utf-8"))
    taken_en = {key for category in FROG_CATEGORIES for key in repository.frog_word_keys(category)}
    added = 0
    for level, by_category in seed.items():
        taken_es = {frog_norm(w.es) for w in repository.get_frog_words(level)}
        for category, raw_words in by_category.items():
            fresh: list[VocabWord] = []
            for raw in raw_words:
                word = VocabWord(**raw, pos=FROG_CATEGORIES[category][0])
                if frog_norm(word.en) in taken_en or frog_norm(word.es) in taken_es:
                    continue
                taken_en.add(frog_norm(word.en))
                taken_es.add(frog_norm(word.es))
                fresh.append(word)
            if fresh:
                added += repository.put_frog_words(level, category, fresh)
    return added


# Banco de verbos de Camaleón y Oruga (ADR-46): 200 verbos con sus 5 formas y 2 oraciones con hueco
# por forma, escritos y revisados a mano. Sin IA: en cada hueco tiene que caber UNA sola forma.
VERB_SEED = Path(__file__).with_name("verb_seed.json")


def seed_verbs() -> int:
    """Deja en `verb_bank` los verbos de la semilla tal como están en el JSON y devuelve cuántos
    escribió. Al revés que la rana, aquí la semilla manda: un verbo corregido en el JSON se corrige
    en la base en el siguiente arranque. Los que no están en la semilla no se tocan. Con todo al
    día hace una sola lectura."""
    current = repository.get_verbs()
    changed = 0
    for raw in json.loads(VERB_SEED.read_text(encoding="utf-8")):
        verb = Verb(**(raw | {"forms": raw["forms"].split()})).model_dump()
        if current.get(verb["forms"][0]) != verb:
            repository.put_verb(verb["forms"][0], verb)
            changed += 1
    return changed


@app.get("/public/verbs", response_model=list[Verb])
def public_verbs() -> list[Verb]:
    """El banco de verbos entero, en orden alfabético. Lo bajan Camaleón y Oruga una vez por visita."""
    return [Verb(**data) for data in repository.get_verbs().values()]


@app.get("/public/frog-words", response_model=FrogPool)
def public_frog_words(background: BackgroundTasks, level: str = "A1", category: str = "") -> FrogPool:
    """Palabras del banco para un nivel y tipo ("" = mixto). Si ese nivel aún no llega a su meta,
    programa una tanda nueva en segundo plano; si la IA está con otra, `generating` sigue en true
    (en cola) y la siguiente visita la lanza. La lista sale en el mismo orden para todos los que la
    piden el mismo día (en una sala, los índices de la cola coinciden)."""
    if level not in _FROG_TARGETS or (category and category not in FROG_CATEGORIES):
        raise HTTPException(status_code=422, detail="Nivel o tipo de palabra desconocido")
    grow = _frog_gap(level, category, repository.count_frog_words(level))
    due = grow is not None and time.time() >= _frog_next.get((level, grow), 0)
    if due and not _frog_job:
        _frog_job.add((level, grow))
        background.add_task(_grow_frog_words, level, grow)
    words = repository.get_frog_words(level, category or None)
    if len(words) > _FROG_POOL_MAX:
        words = random.Random(f"{time.strftime('%Y-%m-%d')}|{level}|{category}").sample(words, _FROG_POOL_MAX)
    busy = next(iter(_frog_job), None)
    mine = busy is not None and busy[0] == level and category in ("", busy[1])
    return FrogPool(words=words, generating=mine or (due and busy is not None))


@app.get("/public/frog-words/example", response_model=FrogExample)
def public_frog_example(en: str = Query(min_length=1, max_length=40)) -> FrogExample:
    """Oración de ejemplo de una palabra del banco. La IA la escribe la primera vez que alguien la
    pide (un botón al final de la partida, nunca sola) y queda en `frog_words.data`: las demás veces
    no hay llamada. Solo palabras del banco, así nadie gasta la IA con texto libre."""
    # ponytail: dos alumnos pidiendo la misma palabra en el mismo segundo pagan dos llamadas; candado por palabra si pasa.
    key = frog_norm(en)
    found = repository.get_frog_word(key)
    if not found:
        raise HTTPException(status_code=404, detail="Esa palabra no está en el banco")
    level, data = found
    if not data.get("example_en"):
        try:
            data |= frog_example(data["en"], data["es"], data.get("pos", ""), level)
        except Exception as exc:
            print(f"[juegos] rana: sin oración para {en!r}: {exc!r}")
            raise HTTPException(status_code=503, detail="La IA no pudo escribir la oración. Prueba en un momento.") from exc
        repository.set_frog_word_data(key, data)
    return FrogExample(en=data["example_en"], es=data["example_es"])


def _norm_answer(v: Any) -> str:
    """Normaliza una respuesta para comparación: strip, lowercase, y elimina comillas residuales."""
    s = str(v or "").strip().lower()
    if len(s) >= 2 and s[0] == s[-1] == '"':
        s = s[1:-1].strip()
    return s


def _speaking_match(said: Any, target: str) -> bool:
    """Compara la transcripción con la oración objetivo por SECUENCIA de palabras (LCS).
    Correcto si la similitud (Dice sobre la subsecuencia común) ≥ 0.85, de modo que un
    error en una palabra clave de una frase corta (p. ej. 'studies' vs 'studied') no pase."""
    import re
    def words(t: Any) -> list[str]:
        return re.sub(r"[^\w\s]", "", str(t or "").lower()).split()
    a, b = words(target), words(said)
    if not a:
        return False
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            dp[i][j] = dp[i - 1][j - 1] + 1 if a[i - 1] == b[j - 1] else max(dp[i - 1][j], dp[i][j - 1])
    lcs = dp[m][n]
    return (2 * lcs) / (m + n) >= 0.85 if (m + n) else False


def _resolve_correct_answers(answer: Any) -> list[str]:
    """Convierte el campo answer de una actividad en lista normalizada.
    Maneja tres formatos:
      1. Lista Python/JSON: ["have to", "don't have to"]            → lista directa
      2. Cadena inline array: '["have to", "don\\'t have to"]'      → parsea manualmente
      3. Cadena simple: "have to"                                    → lista de un elemento
    """
    if isinstance(answer, list):
        return [_norm_answer(a) for a in answer]
    s = str(answer or "").strip()
    # Inline array format stored as string: ["a", "b", ...]
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1]
        items: list[str] = []
        current: list[str] = []
        in_quote = False
        for ch in inner:
            if ch == '"' and not in_quote:
                in_quote = True
            elif ch == '"' and in_quote:
                in_quote = False
            elif ch == ',' and not in_quote:
                val = "".join(current).strip().strip('"').strip()
                if val:
                    items.append(_norm_answer(val))
                current = []
                continue
            current.append(ch)
        val = "".join(current).strip().strip('"').strip()
        if val:
            items.append(_norm_answer(val))
        if items:
            return items
    return [_norm_answer(s)]


_NOTE_LINE = re.compile(r"^[ \t]*note[ \t]*:.*$\n?", re.MULTILINE)


def _without_notes(worksheet: Worksheet) -> Worksheet:
    """Copia de la hoja sin las `note` privadas del profesor. El alumno nunca las ve: son la
    pista que la IA usa al calificar, no contenido de la hoja (ADR-19).

    Se limpian los dos sitios donde viaja el texto: el json y el script_content.
    ponytail: en el script se borra la LÍNEA `note:`; una nota multilínea (\"\"\"…\"\"\") no la
    escribe el constructor visual, y si alguien la escribe a mano solo dejaría el cuerpo suelto
    en un campo que el alumno no lee. Si eso llega a pasar, parsear en vez de regexear.
    """
    clean = worksheet.model_copy(deep=True)
    for activity in clean.json_content.iter_activities():
        activity.note = None
    clean.script_content = _NOTE_LINE.sub("", clean.script_content)
    return clean


def _activity_notes(worksheet: Worksheet) -> dict[str, str]:
    """{activity_id: note} para la IA calificadora. Va por separado de los AnswerDetail porque
    esos SÍ se le devuelven al alumno con la respuesta corregida."""
    return {a.id: a.note for a in worksheet.json_content.iter_activities() if a.note}


def _block_contexts(worksheet: Worksheet) -> dict[str, str]:
    """{activity_id: estímulo del bloque al que pertenece}. Cuando el audio o el texto vive en el
    `block {}` y no en la actividad, sin esto la IA calificaría una respuesta abierta sin saber
    qué escuchó o leyó el alumno."""
    contexts: dict[str, str] = {}
    for block in worksheet.json_content.blocks or []:
        if block.lines:
            context = "Diálogo escuchado: " + " ".join(f"{ln.get('speaker', '')}: {ln.get('text', '')}" for ln in block.lines)
        elif block.audio_text:
            context = f"Audio escuchado: «{block.audio_text}»"
        elif block.text:
            context = f"Texto de lectura sobre el que se responde: «{block.text}»"
        else:
            continue
        for activity in block.activities:
            contexts[activity.id] = context
    return contexts


def _build_answer_details(worksheet: Worksheet, answers: dict[str, Any]) -> list[AnswerDetail]:
    details: list[AnswerDetail] = []
    block_contexts = _block_contexts(worksheet)
    for activity in worksheet.json_content.iter_activities():
        if activity.type in {"content", "poll"}:
            # `content` no se responde; `poll` sí, pero es opinión: no hay clave, así que no entra
            # al score NI a `pending` (pending significa "que lo califique la IA").
            # ponytail: el voto se guarda en answers_json pero no se pinta en Revisión; el sitio
            # donde se leen los votos es el reparto en vivo. Si hace falta verlos en una hoja
            # asignada, ahí es donde hay que añadir un estado nuevo.
            continue
        student_answer = answers.get(activity.id)
        prompt = activity.text or activity.question or activity.prompt or activity.title or activity.type
        # Qué escuchó el alumno. La IA lo necesita para juzgar una respuesta abierta a un audio:
        # sin esto sólo ve la pregunta y la clave, y no puede reconocer una respuesta válida
        # formulada de otra manera.
        context = None
        if activity.type == "conversation" and activity.lines:
            context = "Diálogo escuchado: " + " ".join(f"{ln.get('speaker', '')}: {ln.get('text', '')}" for ln in activity.lines)
        elif activity.type == "listening" and activity.text:
            context = f"Audio escuchado: «{activity.text}»"
        elif getattr(activity, "audio_text", None):
            context = f"Audio escuchado: «{activity.audio_text}»"
        else:
            context = block_contexts.get(activity.id)  # el estímulo lo pone el bloque
        if activity.type == "reading":
            # Un detalle POR PREGUNTA con el texto de lectura como contexto para la IA.
            # (Sin preguntas = texto de referencia: no se califica.)
            if not activity.questions:
                continue
            ans = student_answer if isinstance(student_answer, dict) else {}
            passage = activity.content or ""
            for index, question in enumerate(activity.questions):
                details.append(AnswerDetail(
                    activity_id=f"{activity.id}:{index}",
                    activity_type="reading",
                    prompt=question,
                    student_answer=ans.get(str(index), ans.get(index)),
                    correct_answer=None,
                    status="pending",
                    context=f"Texto de lectura sobre el que se responde: «{passage}»",
                ))
            continue
        if activity.type in {"fillblank", "dragdrop"} and activity.answer:
            correct_answers = _resolve_correct_answers(activity.answer)
            student_answers = student_answer if isinstance(student_answer, list) else [student_answer]
            is_correct = len(student_answers) >= len(correct_answers) and all(_norm_answer(student_answers[index]) == correct for index, correct in enumerate(correct_answers))
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        # `imagechoice` se califica como un multiplechoice: la clave es el TEXTO de la opción, las
        # imágenes solo deciden qué se pinta (ADR-20).
        if activity.type in {"multiplechoice", "listening", "imagechoice"} and activity.answer:
            is_correct = str(student_answer or "").strip().lower() == str(activity.answer).strip().lower()
            # `listening` es texto libre: el exacto casi siempre falla y la IA lo re-juzga con el contexto.
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect", context=context))
            continue
        if activity.type == "multiselect" and activity.answer:
            # Varias opciones correctas: acierto si el conjunto elegido coincide exactamente.
            correct_set = {_norm_answer(a) for a in _resolve_correct_answers(activity.answer)}
            selected = student_answer if isinstance(student_answer, list) else ([student_answer] if student_answer else [])
            selected_set = {_norm_answer(s) for s in selected}
            is_correct = bool(correct_set) and selected_set == correct_set
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        # `imagematching` comparte el modelo de respuesta de `matching` ({izquierda: derecha elegida});
        # `left_images` solo cambia lo que ve el alumno (ADR-20).
        if activity.type in {"matching", "imagematching"} and activity.left and activity.right:
            selected_matches = student_answer if isinstance(student_answer, dict) else {}
            for index, left_item in enumerate(activity.left):
                correct_match = activity.right[index] if index < len(activity.right) else None
                selected_match = selected_matches.get(left_item)
                is_correct = selected_match == correct_match
                details.append(
                    AnswerDetail(
                        activity_id=f"{activity.id}:{index}",
                        activity_type=activity.type,
                        prompt=str(left_item),
                        student_answer=selected_match,
                        correct_answer=correct_match,
                        status="correct" if is_correct else "incorrect",
                    )
                )
            continue
        if activity.type == "listeningfillblank" and activity.answer:
            correct_answers = _resolve_correct_answers(activity.answer)
            student_answers = student_answer if isinstance(student_answer, list) else [student_answer]
            is_correct = len(student_answers) >= len(correct_answers) and all(
                _norm_answer(student_answers[i]) == correct
                for i, correct in enumerate(correct_answers)
            )
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        if activity.type == "conversation" and activity.answer:
            is_correct = str(student_answer or "").strip().lower() == str(activity.answer).strip().lower()
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect", context=context))
            continue
        if activity.type == "listeningorder" and activity.answer:
            # Ordenar palabras: acierto si el orden coincide exactamente (misma longitud + posición).
            correct_answers = _resolve_correct_answers(activity.answer)
            student_answers = student_answer if isinstance(student_answer, list) else [student_answer]
            is_correct = len(student_answers) == len(correct_answers) and all(
                _norm_answer(student_answers[i]) == correct for i, correct in enumerate(correct_answers)
            )
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        if activity.type == "listeningmultiplechoice" and activity.answer:
            is_correct = str(student_answer or "").strip().lower() == str(activity.answer).strip().lower()
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        if activity.type == "listeningmatching" and activity.pairs:
            selected = student_answer if isinstance(student_answer, dict) else {}
            for index, pair in enumerate(activity.pairs):
                correct_match = pair.get("match")
                selected_match = selected.get(str(index))
                is_correct = selected_match == correct_match
                details.append(AnswerDetail(
                    activity_id=f"{activity.id}:{index}",
                    activity_type=activity.type,
                    prompt=f"Audio {index + 1}",
                    student_answer=selected_match,
                    correct_answer=correct_match,
                    status="correct" if is_correct else "incorrect",
                ))
            continue
        if activity.type in {"truefalse", "readingtruefalse", "listeningtruefalse"} and activity.statements:
            selected = student_answer if isinstance(student_answer, dict) else {}
            for index, statement in enumerate(activity.statements):
                correct = statement.get("answer")
                raw = selected.get(str(index))
                if isinstance(raw, bool):
                    student_bool: bool | None = raw
                elif isinstance(raw, str):
                    student_bool = raw.lower() == "true"
                else:
                    student_bool = None
                is_correct = student_bool == correct if student_bool is not None else False
                details.append(AnswerDetail(
                    activity_id=f"{activity.id}:{index}",
                    activity_type=activity.type,
                    prompt=statement.get("text", ""),
                    student_answer=raw,
                    correct_answer=correct,
                    status="correct" if is_correct else "incorrect",
                ))
            continue
        if activity.type == "speaking":
            target = (activity.target or "").strip()
            if target:
                # Modo "leer en voz alta": se compara la transcripción con la oración objetivo.
                is_correct = _speaking_match(student_answer, target)
                details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=target, status="correct" if is_correct else "incorrect"))
            else:
                # Modo pregunta abierta: la IA evalúa la transcripción (pendiente).
                details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=None, status="pending"))
            continue
        details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=None, status="pending", context=context))
    return details


def _score_details(details: list[AnswerDetail]) -> tuple[int, int, float | None]:
    graded = [detail for detail in details if detail.status in {"correct", "incorrect"}]
    correct_count = sum(1 for detail in details if detail.status == "correct")
    pending_count = sum(1 for detail in details if detail.status == "pending")
    if not graded:
        return correct_count, pending_count, None
    return correct_count, pending_count, round((correct_count / len(graded)) * 100, 2)
