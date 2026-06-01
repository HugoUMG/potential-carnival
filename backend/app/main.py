from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer

from .ai import generate_worksheet_script
from .database import initialize_database
from .models import (
    AiGenerateRequest,
    AnswerDetail,
    AnswerReview,
    LoginRequest,
    LoginResponse,
    PublicUser,
    StudentCreate,
    TeacherCreate,
    UserRole,
    Worksheet,
    WorksheetCreate,
    WorksheetJson,
    WorksheetResponse,
    WorksheetResponseCreate,
)
from .parser import WorksheetScriptError, parse_worksheet_script
from .repository import repository
from .security import create_access_token, decode_access_token
from .settings import get_allowed_origins

app = FastAPI(title="API del constructor de hojas con IA", version="1.0.0")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

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


@app.get("/health")
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
    if current_user.role == UserRole.student and current_user.id != student_id:
        raise HTTPException(status_code=403, detail="No puedes consultar datos de otro estudiante")
    if current_user.role not in {UserRole.student, UserRole.teacher, UserRole.admin}:
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
    return LoginResponse(user=user, access_token=create_access_token(user.id, user.role.value))


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


@app.post("/teachers", response_model=PublicUser)
def create_teacher(payload: TeacherCreate, _: PublicUser = Depends(require_admin)) -> PublicUser:
    try:
        return repository.create_teacher(payload)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el profesor. Verifica que el usuario no exista.") from exc


@app.get("/teachers", response_model=list[PublicUser])
def list_teachers(_: PublicUser = Depends(require_admin)) -> list[PublicUser]:
    return repository.list_teachers()


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
    answered_ids = {response.worksheet_id for response in repository.list_responses(student_id=student_id, include_archived=False)}
    published = repository.list_worksheets(published=True, archived=False)
    answered_unpublished = [worksheet for worksheet in repository.list_worksheets(archived=False) if worksheet.id in answered_ids and not worksheet.published]
    return published + answered_unpublished


@app.get("/students/{student_id}/responses", response_model=list[WorksheetResponse])
def list_student_responses(student_id: str, current_user: PublicUser = Depends(get_current_user)) -> list[WorksheetResponse]:
    require_student_owner_or_staff(student_id, current_user)
    return repository.list_responses(student_id=student_id, include_archived=False)


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


@app.post("/responses", response_model=WorksheetResponse)
def submit_response(payload: WorksheetResponseCreate, current_user: PublicUser = Depends(require_student)) -> WorksheetResponse:
    if payload.student_id and payload.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="No puedes enviar respuestas por otro estudiante")

    worksheet = repository.get_worksheet(payload.worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if worksheet.archived or not worksheet.published:
        raise HTTPException(status_code=403, detail="Esta hoja de trabajo no está disponible")
    if worksheet.max_attempts is not None:
        attempts = repository.count_student_attempts(worksheet.id, current_user.id)
        if attempts >= worksheet.max_attempts:
            raise HTTPException(status_code=403, detail="Ya alcanzaste el número máximo de intentos para esta evaluación")

    details = _build_answer_details(worksheet, payload.answers_json)
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

def _build_answer_details(worksheet: Worksheet, answers: dict[str, Any]) -> list[AnswerDetail]:
    details: list[AnswerDetail] = []
    for activity in worksheet.json_content.activities:
        student_answer = answers.get(activity.id)
        prompt = activity.text or activity.question or activity.prompt or activity.title or activity.type
        if activity.type in {"fillblank", "multiplechoice"} and activity.answer:
            is_correct = str(student_answer or "").strip().lower() == activity.answer.strip().lower()
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=activity.answer, status="correct" if is_correct else "incorrect"))
        else:
            details.append(AnswerDetail(activity_id=activity.id, activity_type=activity.type, prompt=prompt, student_answer=student_answer, correct_answer=None, status="pending"))
    return details


def _score_details(details: list[AnswerDetail]) -> tuple[int, int, float | None]:
    graded = [detail for detail in details if detail.status in {"correct", "incorrect"}]
    correct_count = sum(1 for detail in details if detail.status == "correct")
    pending_count = sum(1 for detail in details if detail.status == "pending")
    if not graded:
        return correct_count, pending_count, None
    return correct_count, pending_count, round((correct_count / len(graded)) * 100, 2)
