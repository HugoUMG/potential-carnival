from typing import Any
import asyncio
import hashlib
import os
import re
import time

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer

from .ai import ai_grade_activities, generate_vocabulary_csv, generate_worksheet_script, edit_worksheet_script, summarize_worksheet_performance as ai_summarize, transcribe_audio as ai_transcribe
from .database import initialize_database
from .models import (
    AiGenerateRequest,
    AiEditRequest,
    AnswerDetail,
    AnswerReview,
    Classroom,
    ClassroomCreate,
    ClassroomDetail,
    ClassroomStudentAssignment,
    ClassroomVisibilityUpdate,
    ClassroomWorksheetAssignment,
    GoogleAuthRequest,
    LoginRequest,
    LoginResponse,
    PasswordUpdate,
    PublicUser,
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
)
from .parser import WorksheetScriptError, parse_worksheet_script, strip_non_printable
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
    """Un profesor solo administra los alumnos que él creó.

    Falla en cerrado: un alumno sin dueño tampoco lo administra nadie salvo el admin. Antes
    se permitía (eran los alumnos anteriores a `created_by`), pero eso dejaba borrarlos por id
    a cualquier profesor recién registrado. La migración de arranque ya les asigna dueño."""
    if current_user.role == UserRole.admin:
        return
    if repository.get_user_owner(student_id) != current_user.id:
        raise HTTPException(status_code=403, detail="Ese estudiante pertenece a otro profesor")


@app.post("/students", response_model=PublicUser)
def create_student(payload: StudentCreate, current_user: PublicUser = Depends(require_teacher_or_admin)) -> PublicUser:
    try:
        return repository.create_student(payload, created_by=current_user.id)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="No se pudo crear el estudiante. Verifica que el usuario no exista.") from exc


@app.get("/students", response_model=list[PublicUser])
def list_students(current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[PublicUser]:
    return repository.list_students(None if current_user.role == UserRole.admin else current_user.id)




@app.put("/users/{user_id}", response_model=PublicUser)
def update_user(user_id: str, payload: UserUpdate, current_user: PublicUser = Depends(get_current_user)) -> PublicUser:
    if current_user.role == UserRole.student and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="No puedes editar otro usuario")
    if current_user.role == UserRole.teacher:
        target = repository.get_user(user_id)
        if not target or target.role != UserRole.student:
            raise HTTPException(status_code=403, detail="Los profesores solo pueden editar estudiantes")
        require_student_manager(user_id, current_user)
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
    elif current_user.role == UserRole.teacher:
        if target.role != UserRole.student:
            raise HTTPException(status_code=403, detail="Los profesores solo pueden cambiar contraseñas de estudiantes")
        require_student_manager(user_id, current_user)
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
    return repository.teacher_dashboard(None if current_user.role == UserRole.admin else current_user.id)


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


@app.get("/tts/conversation")
async def tts_conversation(
    lines: str = Query(min_length=1),
    male: str = "en-US-GuyNeural",
    female: str = "en-US-JennyNeural",
) -> StreamingResponse:
    # `lines`: una por renglón, formato `speaker|texto` (speaker que empieza con 'f' = femenina).
    # Se sintetiza cada turno con su voz y se concatenan los MP3 en una sola pista.
    # ponytail: concatenación cruda de frames MP3 (suena bien para habla). Si se necesita
    #           una pausa marcada entre turnos, intercalar un MP3 de silencio corto.
    try:
        import edge_tts
        chunks: list[bytes] = []
        for raw in lines.split("\n"):
            raw = raw.strip()
            if not raw or "|" not in raw:
                continue
            speaker, text = raw.split("|", 1)
            text = text.strip()
            if not text:
                continue
            voice = female if speaker.strip().lower().startswith("f") else male
            communicate = edge_tts.Communicate(text, voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    chunks.append(chunk["data"])
        if not chunks:
            raise ValueError("Sin líneas de audio válidas")
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
def delete_student(student_id: str, current_user: PublicUser = Depends(require_teacher_or_admin)) -> None:
    require_student_manager(student_id, current_user)
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
    script, _provider = generate_worksheet_script(payload.prompt, printable=payload.printable)
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


@app.get("/worksheets", response_model=list[Worksheet])
def list_worksheets(created_by: str | None = None, published: bool | None = None, archived: bool | None = None, current_user: PublicUser = Depends(require_teacher_or_admin)) -> list[Worksheet]:
    owner_id = created_by
    if current_user.role != UserRole.admin:
        if created_by and created_by != current_user.id:
            raise HTTPException(status_code=403, detail="No puedes consultar evaluaciones de otro profesor")
        owner_id = current_user.id
    return repository.list_worksheets(created_by=owner_id, published=published, archived=archived)


@app.get("/worksheets/response-counts")
def worksheet_response_counts(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, int]:
    owner_id = None if current_user.role == UserRole.admin else current_user.id
    return repository.count_responses_per_worksheet(owner_id)


@app.get("/worksheets/classroom-assignments", response_model=dict[str, list[Classroom]])
def worksheet_classroom_assignments(current_user: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, list[Classroom]]:
    owner_id = None if current_user.role == UserRole.admin else current_user.id
    return repository.list_classrooms_per_worksheet(owner_id)


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
    teacher_id = None if current_user.role == UserRole.admin else current_user.id
    return repository.get_recent_responses_for_teacher(teacher_id, since_iso)


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
    teacher_id = None if current_user.role == UserRole.admin else current_user.id
    notas = repository.get_recent_responses_for_teacher(teacher_id, since_iso)
    events = [{"tipo": "nota", "nombre": n["student_name"], "detalle": n["worksheet_title"], "ts": n["submitted_at"]} for n in notas]
    events += repository.get_recent_ingresos(since_iso)
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
    # max_attempts None = ilimitada: no se bloquea por cantidad (el lock de 5s evita doble envío accidental).
    _response_locks[lock_key] = now

    details = _build_answer_details(worksheet, payload.answers_json)
    if worksheet.ai_grading:
        details = ai_grade_activities(details, worksheet.title, worksheet.ai_tolerance, _activity_notes(worksheet))
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
    if worksheet.ai_grading:
        details = ai_grade_activities(details, worksheet.title, worksheet.ai_tolerance, _activity_notes(worksheet))
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


@app.post("/public/guest-sessions", status_code=204)
def log_guest_session(payload: GuestSessionLog) -> None:
    """Registra un acceso de invitado. Sin autenticación."""
    repository.log_guest_access(payload.guest_token, payload.name, payload.classroom_id, payload.classroom_name)


@app.post("/public/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict[str, str]:
    """Transcribe el audio del micrófono (actividad speaking) con Groq Whisper. Público."""
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="Audio vacío")
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="El audio es demasiado largo (máx 10 MB)")
    try:
        text = ai_transcribe(audio, file.filename or "speech.webm", file.content_type or "audio/webm")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="No se pudo transcribir el audio") from exc
    return {"transcript": text}


@app.get("/teacher/guest-logs")
def list_guest_logs(_: PublicUser = Depends(require_teacher_or_admin)) -> list[dict]:
    """Historial de accesos de invitados para el panel del profesor."""
    return repository.list_guest_access_logs()


@app.get("/teacher/guest-detail")
def guest_detail(guest_token: str, classroom_id: str, _: PublicUser = Depends(require_teacher_or_admin)) -> dict[str, Any]:
    """Detalle de seguimiento de un invitado: respuestas (con título) y hojas pendientes del aula."""
    responses = repository.list_responses_by_guest_token(guest_token)
    classroom_worksheets = repository.list_classroom_worksheets(classroom_id)
    title_by_id = {w.id: w.title for w in classroom_worksheets}
    answered = {r.worksheet_id for r in responses}

    resp_payload = []
    for r in responses:
        title = title_by_id.get(r.worksheet_id)
        if title is None:
            w = repository.get_worksheet(r.worksheet_id)
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


def _build_answer_details(worksheet: Worksheet, answers: dict[str, Any]) -> list[AnswerDetail]:
    details: list[AnswerDetail] = []
    for activity in worksheet.json_content.iter_activities():
        if activity.type == "content":
            continue  # bloque informativo: no se responde ni califica (no entra al score)
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
