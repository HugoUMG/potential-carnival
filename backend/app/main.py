from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
    Worksheet,
    WorksheetCreate,
    WorksheetJson,
    WorksheetResponse,
    WorksheetResponseCreate,
)
from .parser import WorksheetScriptError, parse_worksheet_script
from .repository import repository

app = FastAPI(title="API del constructor de hojas con IA", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://*.vercel.app"],
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


@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    user = repository.authenticate(payload.username, payload.password, payload.role)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    return LoginResponse(user=user, access_token=f"demo-token-{user.id}")


@app.post("/students", response_model=PublicUser)
def create_student(payload: StudentCreate) -> PublicUser:
    try:
        return repository.create_student(payload)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el estudiante. Verifica que el usuario no exista.") from exc


@app.get("/students", response_model=list[PublicUser])
def list_students() -> list[PublicUser]:
    return repository.list_students()


@app.post("/worksheets", response_model=Worksheet)
def create_worksheet(payload: WorksheetCreate) -> Worksheet:
    try:
        worksheet_data = parse_worksheet_script(payload.script_content)
        worksheet_json = WorksheetJson(**worksheet_data.to_dict())
    except WorksheetScriptError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

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
def ai_generate(payload: AiGenerateRequest) -> Worksheet:
    script = generate_worksheet_script(payload.prompt)
    return create_worksheet(WorksheetCreate(script_content=script, created_by=payload.created_by))


@app.get("/worksheets", response_model=list[Worksheet])
def list_worksheets(created_by: str | None = None, published: bool | None = None) -> list[Worksheet]:
    return repository.list_worksheets(created_by=created_by, published=published)


@app.get("/students/{student_id}/worksheets", response_model=list[Worksheet])
def list_student_worksheets(student_id: str) -> list[Worksheet]:
    answered_ids = {response.worksheet_id for response in repository.list_responses(student_id=student_id)}
    published = repository.list_worksheets(published=True)
    answered_unpublished = [worksheet for worksheet in repository.list_worksheets() if worksheet.id in answered_ids and not worksheet.published]
    return published + answered_unpublished


@app.get("/students/{student_id}/responses", response_model=list[WorksheetResponse])
def list_student_responses(student_id: str) -> list[WorksheetResponse]:
    return repository.list_responses(student_id=student_id)


@app.get("/worksheets/{worksheet_id}", response_model=Worksheet)
def get_worksheet(worksheet_id: str) -> Worksheet:
    worksheet = repository.get_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/worksheets/{worksheet_id}/publish", response_model=Worksheet)
def publish_worksheet(worksheet_id: str) -> Worksheet:
    worksheet = repository.publish_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/worksheets/{worksheet_id}/unpublish", response_model=Worksheet)
def unpublish_worksheet(worksheet_id: str) -> Worksheet:
    worksheet = repository.unpublish_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/responses", response_model=WorksheetResponse)
def submit_response(payload: WorksheetResponseCreate) -> WorksheetResponse:
    worksheet = repository.get_worksheet(payload.worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    if worksheet.max_attempts is not None and payload.student_id:
        attempts = repository.count_student_attempts(worksheet.id, payload.student_id)
        if attempts >= worksheet.max_attempts:
            raise HTTPException(status_code=403, detail="Ya alcanzaste el número máximo de intentos para esta evaluación")

    details = _build_answer_details(worksheet, payload.answers_json)
    correct_count, pending_count, score = _score_details(details)
    response = WorksheetResponse(**payload.model_dump(), details=details, score=score, correct_count=correct_count, pending_count=pending_count)
    return repository.add_response(response)


@app.get("/worksheets/{worksheet_id}/responses", response_model=list[WorksheetResponse])
def list_responses(worksheet_id: str) -> list[WorksheetResponse]:
    if not repository.get_worksheet(worksheet_id):
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return repository.list_responses(worksheet_id=worksheet_id)


@app.post("/responses/{response_id}/review", response_model=WorksheetResponse)
def review_response(response_id: str, payload: AnswerReview) -> WorksheetResponse:
    response = repository.get_response(response_id)
    if not response:
        raise HTTPException(status_code=404, detail="Respuesta no encontrada")
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
