from typing import Any
import asyncio
import time

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer

from .ai import ai_grade_activities, generate_worksheet_script
from .database import initialize_database
from .models import (
    AiGenerateRequest,
    AnswerDetail,
    AnswerReview,
    Classroom,
    ClassroomCreate,
    ClassroomDetail,
    ClassroomStudentAssignment,
    ClassroomWorksheetAssignment,
    LoginRequest,
    LoginResponse,
    PasswordUpdate,
    PublicUser,
    ReaderCreate,
    StudentActivity,
    StudentCreate,
    TeacherCreate,
    TeacherDashboardStats,
    UserRole,
    UserSession,
    UserUpdate,
    VocabularyAssignment,
    VocabularyList,
    VocabularyListCreate,
    Worksheet,
    WorksheetCreate,
    WorksheetJson,
    GuestResponseCreate,
    WorksheetResponse,
    WorksheetResponseCreate,
)
from .parser import WorksheetScriptError, parse_worksheet_script
from .repository import repository
from .security import create_access_token, decode_access_token, get_access_token_expire_minutes, hash_password
from .settings import get_allowed_origins

app = FastAPI(title="API del constructor de hojas con IA", version="1.0.0")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
_response_locks: dict[tuple[str, str], float] = {}

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


@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict[str, str]:
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


@app.post("/auth/logout", status_code=204)
def logout(current_user: PublicUser = Depends(get_current_user)) -> None:
    repository.close_active_session(current_user.id)


@app.get("/auth/me", response_model=PublicUser)
def read_current_user(current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    return current_user


@app.post("/students", response_model=PublicUser)
def create_student(payload: StudentCreate, _: PublicUser = Depends(require_teacher_or_admin)) -> PublicUser:
    try:
        return repository.create_student(payload)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el estudiante. Verifica que el usuario no exista.") from exc


@app.get("/students", response_model=list[PublicUser])
def list_students(_: PublicUser = Depends(require_teacher_or_admin)) -> list[PublicUser]:
    return repository.list_students()




@app.put("/users/{user_id}", response_model=PublicUser)
def update_user(user_id: str, payload: UserUpdate, current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    if current_user.role == UserRole.student and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="No puedes editar otro usuario")
    if current_user.role == UserRole.teacher:
        target = repository.get_user(user_id)
        if not target or target.role != UserRole.student:
            raise HTTPException(status_code=403, detail="Los profesores solo pueden editar estudiantes")
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
    if current_user.role == UserRole.student:
        if current_user.id != user_id:
            raise HTTPException(status_code=403, detail="No puedes cambiar la contraseña de otro usuario")
        if not payload.current_password or not repository.verify_user_password(user_id, payload.current_password):
            raise HTTPException(status_code=403, detail="La contraseña actual no es correcta")
    elif current_user.role == UserRole.teacher and target.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Los profesores solo pueden cambiar contraseñas de estudiantes")
    repository.update_password_hash(user_id, hash_password(payload.new_password))


@app.post("/classrooms", response_model=Classroom)
def create_classroom(payload: ClassroomCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Classroom:
    return repository.create_classroom(payload.name, current_user.id)


@app.get("/classrooms", response_model=list[Classroom])
def list_classrooms(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Classroom]:
    return repository.list_classrooms(None if current_user.role == UserRole.admin else current_user.id)


def require_classroom_manager(classroom_id: str, current_user: PublicUser) -> Classroom:
    classroom = repository.get_classroom(classroom_id)
    if not classroom:
        raise HTTPException(status_code=404, detail="Aula no encontrada")
    if current_user.role != UserRole.admin and classroom.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes administrar esta aula")
    return classroom


@app.get("/classrooms/{classroom_id}", response_model=ClassroomDetail)
def get_classroom_detail(classroom_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> ClassroomDetail:
    classroom = require_classroom_manager(classroom_id, current_user)
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
    require_classroom_manager(classroom_id, current_user)
    student = repository.get_user(payload.student_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    repository.assign_student_to_classroom(classroom_id, payload.student_id)


@app.delete("/classrooms/{classroom_id}/students/{student_id}", status_code=204)
def unassign_student(classroom_id: str, student_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_manager(classroom_id, current_user)
    repository.unassign_student_from_classroom(classroom_id, student_id)


@app.post("/classrooms/{classroom_id}/worksheets", status_code=204)
def assign_worksheet(classroom_id: str, payload: ClassroomWorksheetAssignment, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_manager(classroom_id, current_user)
    require_worksheet_manager(payload.worksheet_id, current_user)
    due_date_str = payload.due_date.isoformat() if payload.due_date else None
    repository.assign_worksheet_to_classroom(classroom_id, payload.worksheet_id, due_date_str)


@app.delete("/classrooms/{classroom_id}/worksheets/{worksheet_id}", status_code=204)
def unassign_worksheet(classroom_id: str, worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_classroom_manager(classroom_id, current_user)
    require_worksheet_manager(worksheet_id, current_user)
    repository.unassign_worksheet_from_classroom(classroom_id, worksheet_id)


@app.get("/worksheets/{worksheet_id}/classrooms", response_model=list[Classroom])
def list_worksheet_classrooms(worksheet_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Classroom]:
    require_worksheet_manager(worksheet_id, current_user)
    return repository.list_worksheet_classrooms(worksheet_id)


@app.get("/dashboard/teacher", response_model=TeacherDashboardStats)
def teacher_dashboard(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    return repository.teacher_dashboard(None if current_user.role == UserRole.admin else current_user.id)


@app.get("/tts")
async def tts(text: str = Query(min_length=1), voice: str = "en-US-GuyNeural") -> StreamingResponse:
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text, voice)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
    except Exception as exc:
        raise HTTPException(status_code=503, detail="No se pudo generar audio TTS. Verifica la conexión a internet.") from exc
    return StreamingResponse(iter(chunks), media_type="audio/mpeg")


@app.post("/teachers", response_model=PublicUser)
def create_teacher(payload: TeacherCreate, _: PublicUser = Depends(require_admin)) -> PublicUser:
    try:
        return repository.create_teacher(payload)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el profesor. Verifica que el usuario no exista.") from exc


@app.get("/teachers", response_model=list[PublicUser])
def list_teachers(_: PublicUser = Depends(require_admin)) -> list[PublicUser]:
    return repository.list_teachers()


@app.delete("/students/{student_id}", status_code=204)
def delete_student(student_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> None:
    if not repository.delete_student(student_id):
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")


@app.delete("/teachers/{teacher_id}", status_code=204)
def delete_teacher(teacher_id: str, current_user: PublicUser = Depends(require_admin)) -> None:
    if teacher_id == current_user.id:
        raise HTTPException(status_code=403, detail="No puedes eliminar tu propio usuario administrador")
    if not repository.delete_teacher(teacher_id, current_user.id):
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
    )
    return repository.add_worksheet(worksheet)


@app.post("/worksheets/ai-generate", response_model=Worksheet)
def ai_generate(payload: AiGenerateRequest, current_user: PublicUser = Depends(require_teacher_or_admin)) -> Worksheet:
    script = generate_worksheet_script(payload.prompt)
    return create_worksheet(WorksheetCreate(script_content=script, created_by=current_user.id), current_user)


@app.get("/worksheets", response_model=list[Worksheet])
def list_worksheets(created_by: str | None = None, published: bool | None = None, archived: bool | None = None, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Worksheet]:
    owner_id = created_by
    if current_user.role != UserRole.admin:
        if created_by and created_by != current_user.id:
            raise HTTPException(status_code=403, detail="No puedes consultar evaluaciones de otro profesor")
        owner_id = current_user.id
    return repository.list_worksheets(created_by=owner_id, published=published, archived=archived)


@app.get("/students/{student_id}/worksheets", response_model=list[Worksheet])
def list_student_worksheets(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[Worksheet]:
    require_student_owner_or_staff(student_id, current_user)
    assigned = repository.list_student_assigned_worksheets(student_id)
    answered_ids = {response.worksheet_id for response in repository.list_responses(student_id=student_id, include_archived=False)}
    answered_unpublished = [w for w in assigned if w.id in answered_ids and not w.published]
    all_worksheets = assigned + [w for w in answered_unpublished if w.id not in {item.id for item in assigned}]
    # Poblar attempts_used / attempts_remaining en una sola query
    attempt_counts = repository.count_attempts_per_worksheet(student_id, [w.id for w in all_worksheets])
    for worksheet in all_worksheets:
        used = attempt_counts.get(worksheet.id, 0)
        worksheet.attempts_used = used
        if worksheet.max_attempts is None:
            # Sin límite configurado: el índice único permite solo 1 entrega por estudiante.
            # Si ya entregó, marcar como 0 para que el frontend la mueva a Calificadas.
            worksheet.attempts_remaining = 0 if worksheet.id in answered_ids else None
        else:
            worksheet.attempts_remaining = max(0, worksheet.max_attempts - used)
    return all_worksheets


@app.get("/students/{student_id}/responses", response_model=list[WorksheetResponse])
def list_student_responses(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[WorksheetResponse]:
    require_student_owner_or_staff(student_id, current_user)
    return repository.list_responses(student_id=student_id, include_archived=False)


@app.get("/students/{student_id}/classrooms", response_model=list[Classroom])
def list_student_classrooms(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[Classroom]:
    require_student_owner_or_staff(student_id, current_user)
    return repository.list_student_classrooms(student_id)


@app.get("/students/activity", response_model=list[StudentActivity])
def get_students_activity(_: PublicUser = Depends(require_teacher_or_admin)) -> list[StudentActivity]:
    return repository.get_students_activity(get_access_token_expire_minutes())


@app.get("/students/{student_id}/sessions", response_model=list[UserSession])
def list_student_sessions(student_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> list[UserSession]:
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


@app.post("/responses", response_model=WorksheetResponse)
def submit_response(payload: WorksheetResponseCreate, current_user: PublicUser = Depends(require_student)) -> WorksheetResponse:
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
    if worksheet.max_attempts is None and attempts > 0:
        raise HTTPException(status_code=409, detail="Ya enviaste esta hoja de trabajo")
    _response_locks[lock_key] = now

    details = _build_answer_details(worksheet, payload.answers_json)
    details = ai_grade_activities(details, worksheet.title)
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
    return repository.add_response(response)


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

@app.get("/public/classrooms")
def public_classrooms() -> list[dict]:
    """Lista todas las aulas disponibles para selección de invitados. Sin autenticación."""
    from .models import Classroom
    classrooms: list[Classroom] = repository.list_classrooms()
    return [{"id": c.id, "name": c.name} for c in classrooms]


@app.get("/public/classrooms/{classroom_id}/worksheets", response_model=list[Worksheet])
def public_classroom_worksheets(classroom_id: str) -> list[Worksheet]:
    """Hojas publicadas de un aula específica. Sin autenticación."""
    worksheets = repository.list_classroom_worksheets(classroom_id)
    return [w for w in worksheets if w.published and not w.archived]


@app.get("/public/worksheets", response_model=list[Worksheet])
def public_worksheets() -> list[Worksheet]:
    """Todas las hojas publicadas y no archivadas, sin autenticación."""
    return repository.list_worksheets(published=True, archived=False)


@app.post("/public/responses", response_model=WorksheetResponse)
def submit_guest_response(payload: GuestResponseCreate) -> WorksheetResponse:
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
    details = ai_grade_activities(details, worksheet.title)
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
    return repository.add_response(response)


@app.get("/public/responses", response_model=list[WorksheetResponse])
def list_guest_responses(guest_token: str) -> list[WorksheetResponse]:
    """Devuelve todas las respuestas de un invitado por su token."""
    if not guest_token or len(guest_token) < 10:
        raise HTTPException(status_code=422, detail="guest_token inválido")
    return repository.list_responses_by_guest_token(guest_token)


# ── Vocabulario público (sin autenticación) ───────────────────────────────────

@app.get("/public/readers-vocabulary")
def public_readers_vocabulary() -> list[dict]:
    """Devuelve todos los readers con sus listas de vocabulario. No requiere autenticación."""
    readers = repository.list_readers()
    result = []
    for reader in readers:
        lists = repository.list_reader_vocabulary(reader.id)
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


def _norm_answer(v: Any) -> str:
    """Normaliza una respuesta para comparación: strip, lowercase, y elimina comillas residuales."""
    s = str(v or "").strip().lower()
    if len(s) >= 2 and s[0] == s[-1] == '"':
        s = s[1:-1].strip()
    return s


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


def _build_answer_details(worksheet: Worksheet, answers: dict[str, Any]) -> list[AnswerDetail]:
    details: list[AnswerDetail] = []
    for activity in worksheet.json_content.iter_activities():
        student_answer = answers.get(activity.id)
        prompt = activity.text or activity.question or activity.prompt or activity.title or activity.type
        if activity.type == "fillblank" and activity.answer:
            correct_answers = _resolve_correct_answers(activity.answer)
            student_answers = student_answer if isinstance(student_answer, list) else [student_answer]
            is_correct = len(student_answers) >= len(correct_answers) and all(_norm_answer(student_answers[index]) == correct for index, correct in enumerate(correct_answers))
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        if activity.type in {"multiplechoice", "listening"} and activity.answer:
            is_correct = str(student_answer or "").strip().lower() == str(activity.answer).strip().lower()
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
            continue
        if activity.type == "matching" and activity.left and activity.right:
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
        details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=None, status="pending"))
    return details


def _score_details(details: list[AnswerDetail]) -> tuple[int, int, float | None]:
    graded = [detail for detail in details if detail.status in {"correct", "incorrect"}]
    correct_count = sum(1 for detail in details if detail.status == "correct")
    pending_count = sum(1 for detail in details if detail.status == "pending")
    if not graded:
        return correct_count, pending_count, None
    return correct_count, pending_count, round((correct_count / len(graded)) * 100, 2)
