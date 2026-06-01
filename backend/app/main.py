from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .ai import generate_worksheet_script
from .models import AiGenerateRequest, Worksheet, WorksheetCreate, WorksheetJson, WorksheetResponse, WorksheetResponseCreate
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"estado": "correcto"}


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
    )
    return repository.add_worksheet(worksheet)


@app.post("/worksheets/ai-generate", response_model=Worksheet)
def ai_generate(payload: AiGenerateRequest) -> Worksheet:
    script = generate_worksheet_script(payload.prompt)
    return create_worksheet(WorksheetCreate(script_content=script, created_by=payload.created_by))


@app.get("/worksheets", response_model=list[Worksheet])
def list_worksheets(created_by: str | None = None) -> list[Worksheet]:
    return repository.list_worksheets(created_by=created_by)


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


@app.post("/worksheets/{worksheet_id}/duplicate", response_model=Worksheet)
def duplicate_worksheet(worksheet_id: str) -> Worksheet:
    worksheet = repository.duplicate_worksheet(worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return worksheet


@app.post("/responses", response_model=WorksheetResponse)
def submit_response(payload: WorksheetResponseCreate) -> WorksheetResponse:
    worksheet = repository.get_worksheet(payload.worksheet_id)
    if not worksheet:
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")

    score = _score_response(worksheet, payload.answers_json)
    response = WorksheetResponse(**payload.model_dump(), score=score)
    return repository.add_response(response)


@app.get("/worksheets/{worksheet_id}/responses", response_model=list[WorksheetResponse])
def list_responses(worksheet_id: str) -> list[WorksheetResponse]:
    if not repository.get_worksheet(worksheet_id):
        raise HTTPException(status_code=404, detail="Hoja de trabajo no encontrada")
    return repository.list_responses(worksheet_id)


def _score_response(worksheet: Worksheet, answers: dict[str, object]) -> float | None:
    graded = [activity for activity in worksheet.json_content.activities if activity.answer]
    if not graded:
        return None
    correct = sum(1 for activity in graded if str(answers.get(activity.id, "")).strip().lower() == activity.answer.strip().lower())
    return round((correct / len(graded)) * 100, 2)
